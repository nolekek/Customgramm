use tg_core::domain::{User, UserId, UserStatus};
use tg_core::event::CoreEvent;
use tg_core::state::CoreState;

#[test]
fn test_user_presence_cache_and_transitions() {
    let mut state = CoreState::new();

    let user_id = UserId(777);
    let initial_user = User {
        id: user_id,
        first_name: "Diana".to_string(),
        last_name: "Prince".to_string(),
        username: Some("wonder".to_string()),
        phone_number: Some("+123456789".to_string()),
        status: UserStatus::Offline { was_online: 1729880000 },
        is_contact: true,
        is_bot: false,
        is_verified: true,
        photo_file_id: None,
        photo_path: None,
    };

    state.update_user(initial_user);

    // Initial presence check
    let user = state.get_user(user_id).expect("User should exist");
    assert_eq!(user.status, UserStatus::Offline { was_online: 1729880000 });

    // Transition to Online
    state.apply_update(&CoreEvent::UserStatusChanged {
        user_id,
        status: UserStatus::Online,
    });
    assert_eq!(state.get_user(user_id).unwrap().status, UserStatus::Online);

    // Transition to Recently
    state.apply_update(&CoreEvent::UserStatusChanged {
        user_id,
        status: UserStatus::Recently,
    });
    assert_eq!(state.get_user(user_id).unwrap().status, UserStatus::Recently);

    // Transition to LastWeek
    state.apply_update(&CoreEvent::UserStatusChanged {
        user_id,
        status: UserStatus::LastWeek,
    });
    assert_eq!(state.get_user(user_id).unwrap().status, UserStatus::LastWeek);

    // Transition to LastMonth
    state.apply_update(&CoreEvent::UserStatusChanged {
        user_id,
        status: UserStatus::LastMonth,
    });
    assert_eq!(state.get_user(user_id).unwrap().status, UserStatus::LastMonth);

    // Transition to Offline with new timestamp
    state.apply_update(&CoreEvent::UserStatusChanged {
        user_id,
        status: UserStatus::Offline { was_online: 1729895000 },
    });
    assert_eq!(
        state.get_user(user_id).unwrap().status,
        UserStatus::Offline { was_online: 1729895000 }
    );
}

#[test]
fn test_user_presence_me_sync() {
    let mut state = CoreState::new();

    let my_id = UserId(1);
    let me = User {
        id: my_id,
        first_name: "My".to_string(),
        last_name: "Self".to_string(),
        username: Some("myself".to_string()),
        phone_number: None,
        status: UserStatus::Online,
        is_contact: false,
        is_bot: false,
        is_verified: false,
        photo_file_id: None,
        photo_path: None,
    };

    state.set_me(me);

    assert_eq!(state.me.as_ref().unwrap().status, UserStatus::Online);
    assert_eq!(state.get_user(my_id).unwrap().status, UserStatus::Online);

    // Updating my status synchronizes both me and users map
    state.apply_update(&CoreEvent::UserStatusChanged {
        user_id: my_id,
        status: UserStatus::Offline { was_online: 1729890000 },
    });

    assert_eq!(
        state.me.as_ref().unwrap().status,
        UserStatus::Offline { was_online: 1729890000 }
    );
    assert_eq!(
        state.get_user(my_id).unwrap().status,
        UserStatus::Offline { was_online: 1729890000 }
    );
}

#[test]
fn test_user_status_json_serialization() {
    let online_event = CoreEvent::UserStatusChanged {
        user_id: UserId(100),
        status: UserStatus::Online,
    };
    let json_online = serde_json::to_value(&online_event).unwrap();
    assert_eq!(json_online["UserStatusChanged"]["user_id"], 100);
    assert_eq!(json_online["UserStatusChanged"]["status"], "Online");

    let offline_event = CoreEvent::UserStatusChanged {
        user_id: UserId(200),
        status: UserStatus::Offline { was_online: 12345678 },
    };
    let json_offline = serde_json::to_value(&offline_event).unwrap();
    assert_eq!(json_offline["UserStatusChanged"]["user_id"], 200);
    assert_eq!(
        json_offline["UserStatusChanged"]["status"]["Offline"]["was_online"],
        12345678
    );
}
