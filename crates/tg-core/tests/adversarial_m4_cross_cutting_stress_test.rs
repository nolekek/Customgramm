use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tg_core::backend::mock::MockBackend;
use tg_core::backend::TelegramBackend;
use tg_core::config::Config;
use tg_core::domain::{
    Chat, ChatId, ChatType, Message, MessageContent, MessageId, MessageStatus, Sender, UserId,
    UserStatus,
};
use tg_core::engine::Engine;
use tg_core::event::CoreEvent;
use tg_core::state::CoreState;

fn make_msg(id: i64, chat_id: i64, date: i64, text: &str) -> Message {
    Message {
        id: MessageId(id),
        chat_id: ChatId(chat_id),
        sender: Sender::User(UserId(1001)),
        date,
        content: MessageContent::Text {
            text: text.to_string(),
            entities: Vec::new(),
        },
        is_outgoing: true,
        status: MessageStatus::Sent,
        reply_to_message_id: None,
        can_be_edited: true,
        can_be_deleted: true,
    }
}

fn make_chat(id: i64, chat_type: ChatType, last_msg: Option<Message>) -> Chat {
    Chat {
        id: ChatId(id),
        title: format!("Stress Chat {}", id),
        chat_type,
        unread_count: 0,
        last_read_inbox_message_id: 0,
        last_read_outbox_message_id: 0,
        last_message: last_msg,
        position: None,
        is_muted: false,
        has_unread_mention: false,
        folder_ids: Vec::new(),
        photo_file_id: None,
        photo_path: None,
    }
}

// ============================================================================
// STRESS TEST 1: Direct State Concurrency with Interleaved Send Confirmations,
//                Presence Flapping, and Pagination
// ============================================================================

#[test]
fn test_stress_cache_concurrency_presence_and_send_confirmations() {
    let state = Arc::new(Mutex::new(CoreState::new()));
    let chat_id = ChatId(10);

    // Initial setup: create chat and 50 users
    {
        let mut s = state.lock().unwrap();
        s.insert_or_update_chat(make_chat(10, ChatType::Private, None));
        for u in 1..=50 {
            s.update_user(tg_core::domain::User {
                id: UserId(u),
                first_name: format!("User{}", u),
                last_name: String::new(),
                username: Some(format!("user_{}", u)),
                phone_number: None,
                status: UserStatus::Offline { was_online: 1700000000 },
                is_contact: true,
                is_bot: false,
                is_verified: false,
                photo_file_id: None,
                photo_path: None,
            });
        }
    }

    let mut handles = Vec::new();

    // Group 1: 4 threads dispatching optimistic messages and confirmations
    for t_idx in 0..4 {
        let s_arc = Arc::clone(&state);
        handles.push(thread::spawn(move || {
            for step in 0..100 {
                let temp_id = -((t_idx * 1000 + step + 1) as i64);
                let confirmed_id = (t_idx * 1000 + step + 1) as i64;
                let send_time = 1729900000 + step as i64;

                // Step 1: Add optimistic message
                {
                    let mut s = s_arc.lock().unwrap();
                    s.add_message(make_msg(temp_id, 10, send_time, &format!("Pending {}", step)));
                }

                // Step 2: Confirm message
                {
                    let mut s = s_arc.lock().unwrap();
                    s.apply_update(&CoreEvent::MessageSendSucceeded {
                        chat_id,
                        old_message_id: MessageId(temp_id),
                        message: Box::new(make_msg(
                            confirmed_id,
                            10,
                            send_time + 1,
                            &format!("Pending {}", step),
                        )),
                    });
                }
            }
        }));
    }

    // Group 2: 4 threads flapping presence across all 50 users
    for t_idx in 0..4 {
        let s_arc = Arc::clone(&state);
        handles.push(thread::spawn(move || {
            let statuses = [
                UserStatus::Online,
                UserStatus::Offline { was_online: 1729905000 },
                UserStatus::Recently,
                UserStatus::LastWeek,
                UserStatus::LastMonth,
            ];
            for step in 0..150 {
                let user_id = UserId(((step % 50) + 1) as i64);
                let st = statuses[(step + t_idx) % statuses.len()].clone();
                let mut s = s_arc.lock().unwrap();
                s.apply_update(&CoreEvent::UserStatusChanged {
                    user_id,
                    status: st,
                });
            }
        }));
    }

    // Group 3: 2 threads injecting history pages
    for t_idx in 0..2 {
        let s_arc = Arc::clone(&state);
        handles.push(thread::spawn(move || {
            for page in 0..20 {
                let start_id = 100_000 + (t_idx * 1000) + (page * 10);
                let page_msgs: Vec<Message> = (0..10)
                    .map(|offset| {
                        let id = start_id + offset;
                        make_msg(id, 10, 1720000000 + id, &format!("History {}", id))
                    })
                    .collect();
                let mut s = s_arc.lock().unwrap();
                s.insert_history_messages(chat_id, page_msgs);
            }
        }));
    }

    for h in handles {
        h.join().expect("Thread must not panic");
    }

    // INVARIANT CHECKS:
    let final_state = state.lock().unwrap();
    let msgs = final_state.get_messages(chat_id).expect("Messages must exist");

    // Invariant 1: No negative temporary IDs remain
    for m in msgs {
        assert!(
            m.id.0 > 0,
            "Negative temporary message ID {} found unconfirmed in cache",
            m.id.0
        );
    }

    // Invariant 2: No duplicate IDs
    let mut seen = HashSet::new();
    for m in msgs {
        assert!(
            seen.insert(m.id.0),
            "Duplicate message ID {} found in cache",
            m.id.0
        );
    }

    // Invariant 3: Strict chronological ordering (date ascending, id ascending for ties)
    for i in 0..msgs.len() - 1 {
        assert!(
            msgs[i].date <= msgs[i + 1].date,
            "Chronological ordering violation: date {} > date {}",
            msgs[i].date,
            msgs[i + 1].date
        );
        if msgs[i].date == msgs[i + 1].date {
            assert!(
                msgs[i].id.0 < msgs[i + 1].id.0,
                "Tie-breaker violation: id {} >= id {}",
                msgs[i].id.0,
                msgs[i + 1].id.0
            );
        }
    }

    // Invariant 4: All 50 users exist and possess valid status
    for u in 1..=50 {
        let user = final_state.get_user(UserId(u)).expect("User exists");
        match &user.status {
            UserStatus::Online
            | UserStatus::Offline { .. }
            | UserStatus::Recently
            | UserStatus::LastWeek
            | UserStatus::LastMonth => {}
            other => panic!("Unexpected user status for user {}: {:?}", u, other),
        }
    }
}

// ============================================================================
// STRESS TEST 2: High-Concurrency Engine Verification (Chat Open/Close + Messaging)
// ============================================================================

#[tokio::test]
async fn test_stress_engine_concurrent_chat_open_close_and_messaging() {
    let mut config = Config::default();
    config.use_mock = true;

    let (handle, mut rx) = Engine::start(config).await.expect("Engine starts successfully");
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Authenticate
    handle.send_phone_number("+1234567890").await.expect("Phone auth succeeds");
    handle.send_code("12345").await.expect("Code auth succeeds");
    tokio::time::sleep(Duration::from_millis(50)).await;

    let mut tasks = Vec::new();

    // 10 concurrent tokio tasks interleaving open_chat, send_text_message, and close_chat
    for worker_id in 0..10 {
        let h = handle.clone();
        tasks.push(tokio::spawn(async move {
            for i in 0..30 {
                let chat_id = ChatId((worker_id % 4 + 1) as i64);
                // 1. Open chat
                let _ = h.open_chat(chat_id).await;
                // 2. Send message
                let _ = h
                    .send_text_message(
                        chat_id,
                        format!("Worker {} Msg {}", worker_id, i),
                        None,
                    )
                    .await;
                // 3. Close chat
                let _ = h.close_chat(chat_id).await;
            }
        }));
    }

    for t in tasks {
        t.await.expect("Worker task must complete without error");
    }

    tokio::time::sleep(Duration::from_millis(150)).await;

    // Drain events and ensure no critical errors
    let mut received_messages = 0;
    while let Ok(evt) = rx.try_recv() {
        match evt {
            CoreEvent::ErrorOccurred(err) => {
                panic!("Engine emitted unexpected error: {}", err);
            }
            CoreEvent::MessageReceived(_) => {
                received_messages += 1;
            }
            _ => {}
        }
    }

    assert!(
        received_messages > 0,
        "Engine should have processed outgoing/received messages"
    );

    // Verify state responsiveness
    let state = handle.read_state();
    assert!(!state.chats.is_empty(), "Chats must be populated");
}

// ============================================================================
// STRESS TEST 3: MockBackend Open/Close State Tracking Under Thread Thrashing
// ============================================================================

#[tokio::test]
async fn test_stress_mock_backend_opened_chats_thread_thrashing() {
    let mock = Arc::new(MockBackend::new());
    let mut tasks = Vec::new();

    // 25 tasks concurrently opening and closing across 10 chat IDs
    for task_id in 0..25 {
        let m = mock.clone();
        tasks.push(tokio::spawn(async move {
            for step in 0..100 {
                let chat_id = ChatId((step % 10 + 1) as i64);
                if (task_id + step) % 2 == 0 {
                    m.open_chat(chat_id).await.expect("open_chat succeeds");
                } else {
                    m.close_chat(chat_id).await.expect("close_chat succeeds");
                }
            }
        }));
    }

    for t in tasks {
        t.await.expect("Task finished cleanly");
    }

    // Now explicitly close all 10 chats
    for c in 1..=10 {
        mock.close_chat(ChatId(c)).await.expect("Explicit close succeeds");
        assert!(!mock.is_chat_open(ChatId(c)), "Chat {} must be closed", c);
    }
}
