use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinHandle;

use tg_core::backend::mock::MockBackend;
use tg_core::backend::TelegramBackend;
use tg_core::config::Config;
use tg_core::domain::{
    Chat, ChatId, ChatType, Message, MessageContent, MessageId, MessageStatus, Sender, UserId,
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
        title: format!("Chat {}", id),
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
// CHALLENGE 1: High-Concurrency Multi-Threaded Rapid Chat Switching
// ============================================================================

#[tokio::test]
async fn test_concurrency_rapid_chat_switching_no_deadlocks() {
    let mock = Arc::new(MockBackend::new());
    let mut tasks: Vec<JoinHandle<()>> = Vec::new();

    // 20 concurrent tasks rapidly opening and closing across 50 chats
    for task_idx in 0..20 {
        let m = mock.clone();
        tasks.push(tokio::spawn(async move {
            for i in 0..100 {
                let chat_id = ChatId(((task_idx * 7 + i) % 50) as i64);
                if i % 2 == 0 {
                    let _ = m.open_chat(chat_id).await;
                } else {
                    let _ = m.close_chat(chat_id).await;
                }
            }
        }));
    }

    for task in tasks {
        task.await.expect("task must complete without panic or deadlock");
    }
}

// ============================================================================
// CHALLENGE 2: High-Concurrency Engine Command Flow Saturation
// ============================================================================

#[tokio::test]
async fn test_concurrency_engine_command_queue_saturation() {
    let mut config = Config::default();
    config.use_mock = true;

    let (handle, mut rx) = Engine::start(config).await.expect("engine starts");
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Authenticate mock backend to trigger init_mock_chats
    handle.send_phone_number("+1234567890").await.expect("phone succeeds");
    handle.send_code("12345").await.expect("code succeeds");
    tokio::time::sleep(Duration::from_millis(50)).await;

    let mut tasks = Vec::new();

    // Spawn 15 concurrent callers sending 1500 total commands (open, close, load_history, send_message)
    for caller_id in 0..15 {
        let h = handle.clone();
        tasks.push(tokio::spawn(async move {
            for step in 0..100 {
                let chat_id = ChatId((caller_id % 4 + 1) as i64);
                match step % 4 {
                    0 => {
                        let _ = h.open_chat(chat_id).await;
                    }
                    1 => {
                        let _ = h.load_history(chat_id, None, 10).await;
                    }
                    2 => {
                        let _ = h.send_text_message(chat_id, format!("msg {} from caller {}", step, caller_id), None).await;
                    }
                    3 => {
                        let _ = h.close_chat(chat_id).await;
                    }
                    _ => unreachable!(),
                }
            }
        }));
    }

    for task in tasks {
        task.await.expect("all concurrent engine callers must succeed");
    }

    // Verify engine is still responsive and read_state works
    tokio::time::sleep(Duration::from_millis(150)).await;
    let s = handle.read_state();
    assert!(!s.chats.is_empty(), "Engine state should have chats");
    drop(s);

    // Verify no unhandled critical errors were emitted
    while let Ok(evt) = rx.try_recv() {
        if let CoreEvent::ErrorOccurred(err) = evt {
            panic!("Unexpected engine error during saturation: {}", err);
        }
    }
}

// ============================================================================
// CHALLENGE 3: Non-Linear Overlapping Pagination Invariants
// ============================================================================

#[test]
fn test_adversarial_non_linear_overlapping_pagination() {
    let mut state = CoreState::new();
    let chat_id = ChatId(101);

    // Seed chat with latest message: id 100, date 10000
    let last = make_msg(100, 101, 10000, "Initial latest message");
    state.insert_or_update_chat(make_chat(101, ChatType::Supergroup, Some(last)));

    // Page A: Messages 70..=100 (overlapping with last message)
    let page_a: Vec<Message> = (70..=100)
        .map(|id| make_msg(id, 101, 7000 + (id - 70) * 100, &format!("Page A Msg {}", id)))
        .collect();
    state.insert_history_messages(chat_id, page_a);

    // Page B arrives out-of-order: Messages 10..=30
    let page_b: Vec<Message> = (10..=30)
        .map(|id| make_msg(id, 101, 1000 + (id - 10) * 100, &format!("Page B Msg {}", id)))
        .collect();
    state.insert_history_messages(chat_id, page_b);

    // Page C arrives with bridge and duplicate overlap: Messages 25..=75
    let page_c: Vec<Message> = (25..=75)
        .map(|id| make_msg(id, 101, 2500 + (id - 25) * 100, &format!("Page C Msg {}", id)))
        .collect();
    state.insert_history_messages(chat_id, page_c);

    let msgs = state.get_messages(chat_id).expect("messages exist");

    // Invariant 1: No duplicates anywhere
    let mut seen_ids = HashSet::new();
    for msg in msgs {
        assert!(seen_ids.insert(msg.id.0), "Duplicate message ID detected: {}", msg.id.0);
    }

    // Invariant 2: Total unique count matches union (10..=100 = 91 messages)
    assert_eq!(msgs.len(), 91, "Union of [10..=30], [25..=75], [70..=100] must be exactly 91 messages");

    // Invariant 3: Strict chronological sort ascending
    for i in 0..msgs.len() - 1 {
        assert!(
            msgs[i].date <= msgs[i + 1].date,
            "Chronological sorting violation: msg[{}] date {} > msg[{}] date {}",
            i, msgs[i].date, i + 1, msgs[i + 1].date
        );
        assert!(
            msgs[i].id.0 < msgs[i + 1].id.0,
            "ID order violation for strictly ascending keys: msg[{}] ID {} >= msg[{}] ID {}",
            i, msgs[i].id.0, i + 1, msgs[i + 1].id.0
        );
    }

    // Invariant 4: chat.last_message must NOT regress to an older pagination message
    let chat = state.get_chat(chat_id).unwrap();
    let chat_last = chat.last_message.as_ref().unwrap();
    assert_eq!(chat_last.id, MessageId(100), "chat.last_message ID must remain 100");
    assert_eq!(chat_last.date, 10000, "chat.last_message date must remain 10000");
}

// ============================================================================
// CHALLENGE 4: Complex Multi-Message Race Involving Negative Temp IDs
// ============================================================================

#[test]
fn test_adversarial_temp_id_race_with_interleaved_messages() {
    let mut state = CoreState::new();
    let chat_id = ChatId(202);

    // 1. Optimistic outgoing temp message 1: ID -1, date 2000
    state.add_message(make_msg(-1, 202, 2000, "Optimistic 1"));

    // 2. Optimistic outgoing temp message 2: ID -2, date 2005
    state.add_message(make_msg(-2, 202, 2005, "Optimistic 2"));

    // 3. Interleaved incoming message from peer: ID 500, date 2002
    state.add_message(make_msg(500, 202, 2002, "Incoming peer reply"));

    // 4. Server confirms temp message 2 first: confirmed ID 602, server date 2008
    state.apply_update(&CoreEvent::MessageSendSucceeded {
        chat_id,
        old_message_id: MessageId(-2),
        message: Box::new(make_msg(602, 202, 2008, "Optimistic 2")),
    });

    // 5. Server confirms temp message 1: confirmed ID 601, server date 2001
    state.apply_update(&CoreEvent::MessageSendSucceeded {
        chat_id,
        old_message_id: MessageId(-1),
        message: Box::new(make_msg(601, 202, 2001, "Optimistic 1")),
    });

    let msgs = state.get_messages(chat_id).unwrap();
    assert_eq!(msgs.len(), 3, "All 3 messages must exist without duplicates");

    let ids: Vec<i64> = msgs.iter().map(|m| m.id.0).collect();
    let dates: Vec<i64> = msgs.iter().map(|m| m.date).collect();

    // Chronological order: date 2001 (ID 601), date 2002 (ID 500), date 2008 (ID 602)
    assert_eq!(dates, vec![2001, 2002, 2008]);
    assert_eq!(ids, vec![601, 500, 602]);

    // Check no negative IDs remain
    assert!(msgs.iter().all(|m| m.id.0 > 0));
}

// ============================================================================
// CHALLENGE 5: Synthetic Date 0 Edit Protection
// ============================================================================

#[test]
fn test_adversarial_synthetic_date_0_on_nonexistent_and_existing() {
    let mut state = CoreState::new();
    let chat_id = ChatId(303);

    // 1. Synthetic date 0 for non-existent message should NOT be inserted into msgs
    let phantom_msg = Message {
        id: MessageId(9999),
        chat_id,
        sender: Sender::Unknown,
        date: 0,
        content: MessageContent::Text {
            text: "Phantom date 0".to_string(),
            entities: Vec::new(),
        },
        is_outgoing: false,
        status: MessageStatus::Sent,
        reply_to_message_id: None,
        can_be_edited: true,
        can_be_deleted: true,
    };
    state.add_message(phantom_msg.clone());
    assert!(
        state.get_messages(chat_id).is_none() || state.get_messages(chat_id).unwrap().is_empty(),
        "Date 0 message for empty chat must not be pushed into message history"
    );

    // 2. Now add real message
    let real_msg = make_msg(800, 303, 1729889999, "Real message");
    state.insert_or_update_chat(make_chat(303, ChatType::Private, Some(real_msg.clone())));
    state.add_message(real_msg);

    // 3. Synthetic edit with date 0 for real message
    let edit_msg = Message {
        id: MessageId(800),
        chat_id,
        sender: Sender::Unknown,
        date: 0,
        content: MessageContent::Text {
            text: "Edited content safely".to_string(),
            entities: Vec::new(),
        },
        is_outgoing: true,
        status: MessageStatus::Sent,
        reply_to_message_id: None,
        can_be_edited: true,
        can_be_deleted: true,
    };
    state.add_message(edit_msg);

    let msgs = state.get_messages(chat_id).unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].date, 1729889999, "Date must remain 1729889999");
    assert_eq!(msgs[0].sender, Sender::User(UserId(1001)), "Sender must remain UserId(1001)");
    if let MessageContent::Text { ref text, .. } = msgs[0].content {
        assert_eq!(text, "Edited content safely");
    } else {
        panic!("Expected text content");
    }

    // Check chat.last_message preservation
    let chat = state.get_chat(chat_id).unwrap();
    let last = chat.last_message.as_ref().unwrap();
    assert_eq!(last.date, 1729889999);
    assert_eq!(last.sender, Sender::User(UserId(1001)));
}

// ============================================================================
// CHALLENGE 6: Concurrent Deletion and Last Message Fallback
// ============================================================================

#[test]
fn test_adversarial_deletion_and_last_message_fallback() {
    let mut state = CoreState::new();
    let chat_id = ChatId(404);

    let msg1 = make_msg(1, 404, 1000, "Msg 1");
    let msg2 = make_msg(2, 404, 2000, "Msg 2");
    let msg3 = make_msg(3, 404, 3000, "Msg 3");

    state.insert_or_update_chat(make_chat(404, ChatType::Private, Some(msg3.clone())));
    state.add_message(msg1);
    state.add_message(msg2.clone());
    state.add_message(msg3);

    assert_eq!(state.get_messages(chat_id).unwrap().len(), 3);
    assert_eq!(state.get_chat(chat_id).unwrap().last_message.as_ref().unwrap().id, MessageId(3));

    // Delete the newest message (id 3)
    state.delete_messages(chat_id, &[MessageId(3)]);

    assert_eq!(state.get_messages(chat_id).unwrap().len(), 2);
    // last_message should automatically fall back to msg2 (id 2)
    let chat = state.get_chat(chat_id).unwrap();
    assert_eq!(chat.last_message.as_ref().unwrap().id, MessageId(2));
    assert_eq!(chat.last_message.as_ref().unwrap().date, 2000);

    // Delete remaining messages
    state.delete_messages(chat_id, &[MessageId(1), MessageId(2)]);
    assert_eq!(state.get_messages(chat_id).unwrap().len(), 0);
    let chat = state.get_chat(chat_id).unwrap();
    assert!(chat.last_message.is_none(), "last_message should be None when all messages deleted");
}

// ============================================================================
// CHALLENGE 7: Massive History & Deterministic Tie-Breaker Ordering
// ============================================================================

#[test]
fn test_adversarial_massive_identical_timestamps_deterministic_tie_breaker() {
    let mut state = CoreState::new();
    let chat_id = ChatId(505);

    // 5,000 messages all sharing the exact same timestamp (1_700_000_000)
    // but with shuffled / reversed IDs
    let mut batch = Vec::new();
    for i in (1..=5000).rev() {
        batch.push(make_msg(i, 505, 1_700_000_000, &format!("Tie msg {}", i)));
    }

    state.insert_history_messages(chat_id, batch);

    let msgs = state.get_messages(chat_id).unwrap();
    assert_eq!(msgs.len(), 5000);

    // Assert strictly ascending ID tie-breaker
    for i in 0..msgs.len() - 1 {
        assert_eq!(msgs[i].date, 1_700_000_000);
        assert_eq!(msgs[i].id.0 + 1, msgs[i + 1].id.0, "Tie breaker must order strictly by ID ascending");
    }
}

// ============================================================================
// CHALLENGE 8: Concurrent Idempotent Open/Close Thrashing on Same Chat
// ============================================================================

#[tokio::test]
async fn test_adversarial_concurrent_open_close_thrashing_same_chat() {
    let mock = Arc::new(MockBackend::new());
    let chat_id = ChatId(777);
    let mut tasks = Vec::new();

    // 30 concurrent tasks hammering open and close on chat 777
    for task_idx in 0..30 {
        let m = mock.clone();
        tasks.push(tokio::spawn(async move {
            for step in 0..50 {
                if (task_idx + step) % 2 == 0 {
                    m.open_chat(chat_id).await.expect("open_chat must never fail");
                } else {
                    m.close_chat(chat_id).await.expect("close_chat must never fail");
                }
            }
        }));
    }

    for task in tasks {
        task.await.expect("all thrashing tasks must complete cleanly");
    }

    // Final explicit close must succeed and leave it closed
    mock.close_chat(chat_id).await.expect("final close succeeds");
    assert!(!mock.is_chat_open(chat_id));
}

// ============================================================================
// CHALLENGE 9: update_message_send_succeeded with Dummy Metadata Recovery
// ============================================================================

#[test]
fn test_adversarial_send_succeeded_dummy_metadata_recovery_from_chat_last_message() {
    let mut state = CoreState::new();
    let chat_id = ChatId(808);

    // Setup chat whose last_message has date 1729890000 and Sender::User(1001)
    let initial_msg = Message {
        id: MessageId(-99),
        chat_id,
        sender: Sender::User(UserId(1001)),
        date: 1729890000,
        content: MessageContent::Text {
            text: "Hello from user".to_string(),
            entities: Vec::new(),
        },
        is_outgoing: true,
        status: MessageStatus::Sending,
        reply_to_message_id: None,
        can_be_edited: true,
        can_be_deleted: true,
    };
    state.insert_or_update_chat(make_chat(808, ChatType::Private, Some(initial_msg.clone())));
    state.add_message(initial_msg);

    // Server sends confirmation, but with date 0 and Sender::Unknown (TDLib dummy confirmation)
    let dummy_confirmed = Message {
        id: MessageId(12345),
        chat_id,
        sender: Sender::Unknown,
        date: 0,
        content: MessageContent::Text {
            text: "Hello from user".to_string(),
            entities: Vec::new(),
        },
        is_outgoing: true,
        status: MessageStatus::Sent,
        reply_to_message_id: None,
        can_be_edited: true,
        can_be_deleted: true,
    };

    state.apply_update(&CoreEvent::MessageSendSucceeded {
        chat_id,
        old_message_id: MessageId(-99),
        message: Box::new(dummy_confirmed),
    });

    let msgs = state.get_messages(chat_id).unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].id, MessageId(12345));
    // Must have recovered the legitimate date and sender
    assert_eq!(msgs[0].date, 1729890000, "Date must be recovered from previous temp message");
    assert_eq!(msgs[0].sender, Sender::User(UserId(1001)), "Sender must be recovered from previous temp message");

    let chat = state.get_chat(chat_id).unwrap();
    let chat_last = chat.last_message.as_ref().unwrap();
    assert_eq!(chat_last.id, MessageId(12345));
    assert_eq!(chat_last.date, 1729890000);
    assert_eq!(chat_last.sender, Sender::User(UserId(1001)));
}

