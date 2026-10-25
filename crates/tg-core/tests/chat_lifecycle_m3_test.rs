use tg_core::backend::mock::MockBackend;
use tg_core::backend::TelegramBackend;
use tg_core::config::Config;
use tg_core::domain::{ChatId, Message, MessageContent, MessageId, MessageStatus, Sender, UserId};
use tg_core::engine::Engine;
use tg_core::event::CoreEvent;

#[tokio::test]
async fn test_mock_backend_open_close_chat_lifecycle() {
    let mock = MockBackend::new();
    let chat_id = ChatId(42);

    assert!(!mock.is_chat_open(chat_id));

    // Open chat
    mock.open_chat(chat_id).await.expect("open_chat succeeds");
    assert!(mock.is_chat_open(chat_id));

    // Close chat
    mock.close_chat(chat_id).await.expect("close_chat succeeds");
    assert!(!mock.is_chat_open(chat_id));
}

#[tokio::test]
async fn test_engine_open_close_chat_command_flow() {
    let mut config = Config::default();
    config.use_mock = true;

    let (handle, mut rx) = Engine::start(config).await.expect("engine starts");

    // Give engine loop a moment to start
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    // Send open_chat
    handle.open_chat(ChatId(101)).await.expect("open_chat dispatch succeeds");

    // Send close_chat
    handle.close_chat(ChatId(101)).await.expect("close_chat dispatch succeeds");

    // Engine shouldn't emit any error events for open/close chat
    while let Ok(evt) = rx.try_recv() {
        if let CoreEvent::ErrorOccurred(err) = evt {
            panic!("Unexpected error event: {}", err);
        }
    }
}

#[tokio::test]
async fn test_event_serde_message_send_succeeded_and_content_changed() {
    let msg = Message {
        id: MessageId(999),
        chat_id: ChatId(50),
        sender: Sender::User(UserId(10)),
        date: 1729880000,
        content: MessageContent::Text {
            text: "Hello World".to_string(),
            entities: Vec::new(),
        },
        is_outgoing: true,
        status: MessageStatus::Sent,
        reply_to_message_id: None,
        can_be_edited: true,
        can_be_deleted: true,
    };

    let evt_send = CoreEvent::MessageSendSucceeded {
        chat_id: ChatId(50),
        old_message_id: MessageId(-1),
        message: Box::new(msg),
    };

    let json_send = serde_json::to_string(&evt_send).expect("serialize send succeeded");
    let de_send: CoreEvent = serde_json::from_str(&json_send).expect("deserialize send succeeded");
    match de_send {
        CoreEvent::MessageSendSucceeded {
            chat_id,
            old_message_id,
            message,
        } => {
            assert_eq!(chat_id, ChatId(50));
            assert_eq!(old_message_id, MessageId(-1));
            assert_eq!(message.id, MessageId(999));
        }
        _ => panic!("Expected MessageSendSucceeded variant"),
    }

    let evt_content = CoreEvent::MessageContentChanged {
        chat_id: ChatId(50),
        message_id: MessageId(999),
        content: MessageContent::Text {
            text: "Updated World".to_string(),
            entities: Vec::new(),
        },
    };

    let json_content = serde_json::to_string(&evt_content).expect("serialize content changed");
    let de_content: CoreEvent = serde_json::from_str(&json_content).expect("deserialize content changed");
    match de_content {
        CoreEvent::MessageContentChanged {
            chat_id,
            message_id,
            content,
        } => {
            assert_eq!(chat_id, ChatId(50));
            assert_eq!(message_id, MessageId(999));
            assert_eq!(
                content,
                MessageContent::Text {
                    text: "Updated World".to_string(),
                    entities: Vec::new(),
                }
            );
        }
        _ => panic!("Expected MessageContentChanged variant"),
    }
}
