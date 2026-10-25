use std::time::Duration;
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
// STRESS TEST 1: Message Ordering, Out-of-Order Inserts & Identical Timestamps
// ============================================================================

#[test]
fn test_stress_cache_ordering_and_identical_timestamps() {
    let mut state = CoreState::new();
    let chat_id = ChatId(10);

    // 1,000 messages generated in pseudo-random / reversed order
    let mut input_messages = Vec::new();
    for i in 0..1000 {
        // Pseudo-random date clustering: some identical dates
        let date = 1_700_000_000 + ((i * 37) % 200);
        let id = (i as i64) + 1;
        input_messages.push(make_msg(id, 10, date, &format!("Msg {}", id)));
    }

    // Insert out of order
    for msg in input_messages {
        state.add_message(msg);
    }

    let msgs = state.get_messages(chat_id).expect("messages exist");
    assert_eq!(msgs.len(), 1000, "All 1000 messages must be present");

    // Strict chronological invariant check:
    // date_i <= date_{i+1}, and if dates are equal, id_i <= id_{i+1}
    for i in 0..msgs.len() - 1 {
        let cur = &msgs[i];
        let next = &msgs[i + 1];
        assert!(
            cur.date < next.date || (cur.date == next.date && cur.id.0 <= next.id.0),
            "Violation of chronological order at index {}: cur=({:?}, date={}), next=({:?}, date={})",
            i,
            cur.id,
            cur.date,
            next.id,
            next.date
        );
    }
}

#[test]
fn test_stress_cache_duplicate_message_ids_overwrites_not_appends() {
    let mut state = CoreState::new();
    let chat_id = ChatId(20);

    // Add initial message
    state.add_message(make_msg(42, 20, 1000, "Initial"));
    assert_eq!(state.get_messages(chat_id).unwrap().len(), 1);

    // Add exact same ID 100 times with updated text
    for i in 1..=100 {
        state.add_message(make_msg(42, 20, 1000, &format!("Update {}", i)));
    }

    let msgs = state.get_messages(chat_id).unwrap();
    assert_eq!(msgs.len(), 1, "Duplicate IDs must overwrite, never append");
    if let MessageContent::Text { ref text, .. } = msgs[0].content {
        assert_eq!(text, "Update 100");
    } else {
        panic!("Expected text content");
    }
}

// ============================================================================
// STRESS TEST 2: History Pagination & Deduplication Invariant
// ============================================================================

#[test]
fn test_stress_history_pagination_deduplication() {
    let mut state = CoreState::new();
    let chat_id = ChatId(30);

    // Seed chat with last_message
    let last = make_msg(500, 30, 5000, "Last message");
    state.insert_or_update_chat(make_chat(30, ChatType::Channel, Some(last.clone())));
    assert_eq!(state.get_messages(chat_id).unwrap().len(), 1);

    // Simulate page 1: messages 400..=500 (overlapping with last message)
    let page1: Vec<Message> = (400..=500)
        .map(|id| make_msg(id, 30, 4000 + (id - 400) * 10, &format!("Hist {}", id)))
        .collect();
    state.insert_history_messages(chat_id, page1);

    let msgs1 = state.get_messages(chat_id).unwrap();
    assert_eq!(msgs1.len(), 101, "Page 1 should produce exactly 101 unique messages");

    // Check chronological order
    for i in 0..msgs1.len() - 1 {
        assert!(msgs1[i].date <= msgs1[i + 1].date);
        assert!(msgs1[i].id.0 < msgs1[i + 1].id.0);
    }

    // Simulate page 2: messages 300..=400 (overlapping with oldest message of page 1)
    let page2: Vec<Message> = (300..=400)
        .map(|id| make_msg(id, 30, 3000 + (id - 300) * 10, &format!("Hist {}", id)))
        .collect();
    state.insert_history_messages(chat_id, page2);

    let msgs2 = state.get_messages(chat_id).unwrap();
    assert_eq!(msgs2.len(), 201, "Combined pages should have 201 unique messages without duplicates");

    // Invariant: strictly sorted
    for i in 0..msgs2.len() - 1 {
        assert!(msgs2[i].date <= msgs2[i + 1].date);
        assert!(msgs2[i].id.0 < msgs2[i + 1].id.0);
    }
}

// ============================================================================
// STRESS TEST 3: Temporary Negative ID Replacement Edge Cases
// ============================================================================

#[test]
fn test_temp_negative_id_replaced_by_positive_id() {
    let mut state = CoreState::new();
    let chat_id = ChatId(40);

    let temp_msg = make_msg(-10, 40, 1000, "Sending...");
    state.add_message(temp_msg);
    assert_eq!(state.get_messages(chat_id).unwrap().len(), 1);

    let confirmed = make_msg(8888, 40, 1000, "Sent!");
    state.apply_update(&CoreEvent::MessageSendSucceeded {
        chat_id,
        old_message_id: MessageId(-10),
        message: Box::new(confirmed.clone()),
    });

    let msgs = state.get_messages(chat_id).unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].id, MessageId(8888));
    assert_eq!(msgs[0].status, MessageStatus::Sent);
}

#[test]
fn test_temp_id_replacement_preserves_sorted_order_when_timestamp_advances() {
    let mut state = CoreState::new();
    let chat_id = ChatId(50);

    // Message 1 (optimistic outgoing): date 1000, temp ID -10
    let temp_msg = make_msg(-10, 50, 1000, "My message");
    state.add_message(temp_msg);

    // Message 2 (incoming): date 1002, ID 200
    let incoming_msg = make_msg(200, 50, 1002, "Incoming response");
    state.add_message(incoming_msg);

    // Server confirms message 1, but server timestamp is 1005 (later than incoming message), confirmed ID 300
    let confirmed_msg = make_msg(300, 50, 1005, "My message");
    state.apply_update(&CoreEvent::MessageSendSucceeded {
        chat_id,
        old_message_id: MessageId(-10),
        message: Box::new(confirmed_msg),
    });

    let msgs = state.get_messages(chat_id).unwrap();
    assert_eq!(msgs.len(), 2, "Must contain exactly 2 messages");
    
    // Invariant: chronological order must hold
    let ids: Vec<i64> = msgs.iter().map(|m| m.id.0).collect();
    let dates: Vec<i64> = msgs.iter().map(|m| m.date).collect();
    println!("IDs after send succeeded with timestamp advance: {:?}", ids);
    println!("Dates after send succeeded with timestamp advance: {:?}", dates);

    assert_eq!(
        dates,
        vec![1002, 1005],
        "Messages must be strictly sorted by date after confirmation"
    );
    assert_eq!(
        ids,
        vec![200, 300],
        "Incoming message (1002) must precede confirmed message (1005)"
    );
}

#[test]
fn test_temp_id_replacement_when_server_update_new_message_arrived_first() {
    let mut state = CoreState::new();
    let chat_id = ChatId(60);

    // Optimistic message with temp ID -100
    let temp_msg = make_msg(-100, 60, 1000, "Hello");
    state.add_message(temp_msg);

    // Server updateNewMessage arrives first with confirmed ID 999
    let confirmed_msg = make_msg(999, 60, 1000, "Hello");
    state.add_message(confirmed_msg.clone());

    // State currently has [-100, 999]
    assert_eq!(state.get_messages(chat_id).unwrap().len(), 2);

    // Now updateMessageSendSucceeded arrives with old_message_id: -100, message: 999
    state.apply_update(&CoreEvent::MessageSendSucceeded {
        chat_id,
        old_message_id: MessageId(-100),
        message: Box::new(confirmed_msg),
    });

    let msgs = state.get_messages(chat_id).unwrap();
    println!("Messages after both updateNewMessage and sendSucceeded: {:?}", msgs.iter().map(|m| m.id.0).collect::<Vec<_>>());

    // Deduplication check: should NOT have duplicate 999
    let count_999 = msgs.iter().filter(|m| m.id == MessageId(999)).count();
    assert_eq!(
        count_999, 1,
        "Confirmed message ID 999 must not be duplicated in cache"
    );
    assert_eq!(msgs.len(), 1, "Cache should only retain the single confirmed message");
}

// ============================================================================
// STRESS TEST 4: Message Content Edits & Non-Destructive Preservation
// ============================================================================

#[test]
fn test_content_edit_preserves_date_sender_and_chat_last_message() {
    let mut state = CoreState::new();
    let chat_id = ChatId(70);

    let original = Message {
        id: MessageId(777),
        chat_id,
        sender: Sender::User(UserId(9999)),
        date: 1729881234,
        content: MessageContent::Text {
            text: "Original text".to_string(),
            entities: Vec::new(),
        },
        is_outgoing: false,
        status: MessageStatus::Read,
        reply_to_message_id: None,
        can_be_edited: true,
        can_be_deleted: true,
    };

    // Chat with this message as last_message
    state.insert_or_update_chat(make_chat(70, ChatType::Private, Some(original.clone())));
    state.add_message(original);

    // Apply MessageContentChanged
    let new_content = MessageContent::Text {
        text: "Updated text non-destructively".to_string(),
        entities: Vec::new(),
    };
    state.apply_update(&CoreEvent::MessageContentChanged {
        chat_id,
        message_id: MessageId(777),
        content: new_content.clone(),
    });

    // Check cached message in state.messages
    let cached = &state.get_messages(chat_id).unwrap()[0];
    assert_eq!(cached.content, new_content);
    assert_eq!(cached.date, 1729881234, "Date must not change");
    assert_eq!(cached.sender, Sender::User(UserId(9999)), "Sender must not change");

    // Check chat.last_message
    let chat = state.get_chat(chat_id).unwrap();
    let last = chat.last_message.as_ref().expect("last_message exists");
    assert_eq!(last.content, new_content);
    assert_eq!(last.date, 1729881234, "chat.last_message date must not change");
    assert_eq!(last.sender, Sender::User(UserId(9999)), "chat.last_message sender must not change");
}

#[test]
fn test_message_updated_with_dummy_date_0_does_not_corrupt_chat_last_message() {
    let mut state = CoreState::new();
    let chat_id = ChatId(80);

    let original = Message {
        id: MessageId(888),
        chat_id,
        sender: Sender::User(UserId(1234)),
        date: 1729885555,
        content: MessageContent::Text {
            text: "Initial text".to_string(),
            entities: Vec::new(),
        },
        is_outgoing: true,
        status: MessageStatus::Sent,
        reply_to_message_id: None,
        can_be_edited: true,
        can_be_deleted: true,
    };

    state.insert_or_update_chat(make_chat(80, ChatType::Supergroup, Some(original.clone())));
    state.add_message(original);

    // Dummy MessageUpdated with date: 0 and Sender::Unknown (synthetic edit event)
    let dummy = Message {
        id: MessageId(888),
        chat_id,
        sender: Sender::Unknown,
        date: 0,
        content: MessageContent::Text {
            text: "Edited with dummy date 0".to_string(),
            entities: Vec::new(),
        },
        is_outgoing: true,
        status: MessageStatus::Sent,
        reply_to_message_id: None,
        can_be_edited: true,
        can_be_deleted: true,
    };
    state.apply_update(&CoreEvent::MessageUpdated(Box::new(dummy)));

    // Verify state.messages
    let cached = &state.get_messages(chat_id).unwrap()[0];
    assert_eq!(cached.date, 1729885555, "state.messages date must stay 1729885555");
    assert_eq!(cached.sender, Sender::User(UserId(1234)), "state.messages sender must stay UserId(1234)");

    // Verify chat.last_message
    let chat = state.get_chat(chat_id).unwrap();
    let last = chat.last_message.as_ref().expect("last_message exists");
    assert_eq!(
        last.date, 1729885555,
        "chat.last_message date MUST NOT be overwritten to 0!"
    );
    assert_eq!(
        last.sender,
        Sender::User(UserId(1234)),
        "chat.last_message sender MUST NOT be overwritten to Sender::Unknown!"
    );
}

// ============================================================================
// STRESS TEST 5: Open/Close Chat Lifecycle Under Rapid Switching & Concurrency
// ============================================================================

#[tokio::test]
async fn test_stress_rapid_open_close_switching() {
    let mock = MockBackend::new();

    // Rapid alternating switches between 20 chats
    for i in 0..200 {
        let chat1 = ChatId(i % 10);
        let chat2 = ChatId((i + 1) % 10);

        mock.open_chat(chat1).await.unwrap();
        assert!(mock.is_chat_open(chat1));

        mock.close_chat(chat1).await.unwrap();
        assert!(!mock.is_chat_open(chat1));

        mock.open_chat(chat2).await.unwrap();
        assert!(mock.is_chat_open(chat2));
    }
}

#[tokio::test]
async fn test_stress_idempotent_open_and_close() {
    let mock = MockBackend::new();
    let chat_id = ChatId(999);

    // Closing already closed chat should be a harmless no-op
    mock.close_chat(chat_id).await.expect("closing unopened chat succeeds");
    assert!(!mock.is_chat_open(chat_id));

    // Opening multiple times
    mock.open_chat(chat_id).await.expect("opening chat succeeds");
    mock.open_chat(chat_id).await.expect("opening already opened chat succeeds");
    assert!(mock.is_chat_open(chat_id));

    // Closing multiple times
    mock.close_chat(chat_id).await.expect("closing chat succeeds");
    mock.close_chat(chat_id).await.expect("closing already closed chat succeeds");
    assert!(!mock.is_chat_open(chat_id));
}

#[tokio::test]
async fn test_stress_engine_command_queue_rapid_switching() {
    let mut config = Config::default();
    config.use_mock = true;

    let (handle, mut rx) = Engine::start(config).await.expect("engine starts");
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Send 300 rapid open/close commands
    for i in 0..300 {
        let chat_id = ChatId(i % 5);
        if i % 2 == 0 {
            handle.open_chat(chat_id).await.expect("open_chat succeeds");
        } else {
            handle.close_chat(chat_id).await.expect("close_chat succeeds");
        }
    }

    // Verify engine processes all without errors
    tokio::time::sleep(Duration::from_millis(100)).await;
    while let Ok(evt) = rx.try_recv() {
        if let CoreEvent::ErrorOccurred(err) = evt {
            panic!("Unexpected engine error during rapid switching: {}", err);
        }
    }
}
