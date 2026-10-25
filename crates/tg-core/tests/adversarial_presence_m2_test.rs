use std::sync::{Arc, Mutex};
use std::thread;
use serde_json::json;
use tg_core::domain::{User, UserId, UserStatus};
use tg_core::event::CoreEvent;
use tg_core::state::CoreState;

fn create_dummy_user(id: i64, name: &str, status: UserStatus) -> User {
    User {
        id: UserId(id),
        first_name: name.to_string(),
        last_name: "Test".to_string(),
        username: Some(format!("user_{}", id)),
        phone_number: Some("+1234567890".to_string()),
        status,
        is_contact: true,
        is_bot: false,
        is_verified: false,
        photo_file_id: None,
        photo_path: None,
    }
}

/// 1. Empirically verify serde serialization and deserialization of CoreEvent::UserStatusChanged
/// with ALL variants of UserStatus, including boundary values.
#[test]
fn test_all_user_status_serde_variants_roundtrip() {
    let variants = vec![
        UserStatus::Online,
        UserStatus::Offline { was_online: 1729895000 },
        UserStatus::Offline { was_online: 0 },
        UserStatus::Offline { was_online: -1 },
        UserStatus::Offline { was_online: i64::MAX },
        UserStatus::Offline { was_online: i64::MIN },
        UserStatus::Recently,
        UserStatus::LastWeek,
        UserStatus::LastMonth,
        UserStatus::Unknown,
    ];

    for (idx, status) in variants.into_iter().enumerate() {
        let event = CoreEvent::UserStatusChanged {
            user_id: UserId(1000 + idx as i64),
            status: status.clone(),
        };

        // Serialize to JSON string
        let json_str = serde_json::to_string(&event).expect("Serialization failed");
        
        // Deserialize back to CoreEvent
        let deserialized: CoreEvent = serde_json::from_str(&json_str).expect("Deserialization failed");

        // Verify variant and equality
        match deserialized {
            CoreEvent::UserStatusChanged { user_id, status: deserialized_status } => {
                assert_eq!(user_id, UserId(1000 + idx as i64));
                assert_eq!(deserialized_status, status);
            }
            other => panic!("Expected UserStatusChanged variant, got {:?}", other),
        }
    }
}

/// Verify JSON representation format for frontend interoperability
#[test]
fn test_serde_json_structure_matches_frontend_contract() {
    let cases = vec![
        (
            CoreEvent::UserStatusChanged {
                user_id: UserId(101),
                status: UserStatus::Online,
            },
            json!({
                "UserStatusChanged": {
                    "user_id": 101,
                    "status": "Online"
                }
            }),
        ),
        (
            CoreEvent::UserStatusChanged {
                user_id: UserId(102),
                status: UserStatus::Offline { was_online: 1729895000 },
            },
            json!({
                "UserStatusChanged": {
                    "user_id": 102,
                    "status": {
                        "Offline": {
                            "was_online": 1729895000
                        }
                    }
                }
            }),
        ),
        (
            CoreEvent::UserStatusChanged {
                user_id: UserId(103),
                status: UserStatus::Recently,
            },
            json!({
                "UserStatusChanged": {
                    "user_id": 103,
                    "status": "Recently"
                }
            }),
        ),
        (
            CoreEvent::UserStatusChanged {
                user_id: UserId(104),
                status: UserStatus::LastWeek,
            },
            json!({
                "UserStatusChanged": {
                    "user_id": 104,
                    "status": "LastWeek"
                }
            }),
        ),
        (
            CoreEvent::UserStatusChanged {
                user_id: UserId(105),
                status: UserStatus::LastMonth,
            },
            json!({
                "UserStatusChanged": {
                    "user_id": 105,
                    "status": "LastMonth"
                }
            }),
        ),
        (
            CoreEvent::UserStatusChanged {
                user_id: UserId(106),
                status: UserStatus::Unknown,
            },
            json!({
                "UserStatusChanged": {
                    "user_id": 106,
                    "status": "Unknown"
                }
            }),
        ),
    ];

    for (event, expected_json) in cases {
        let serialized_value = serde_json::to_value(&event).expect("Serialization to Value failed");
        assert_eq!(serialized_value, expected_json);
        
        let deserialized: CoreEvent = serde_json::from_value(serialized_value).expect("Deserialization from Value failed");
        if let (
            CoreEvent::UserStatusChanged { user_id: u1, status: s1 },
            CoreEvent::UserStatusChanged { user_id: u2, status: s2 },
        ) = (&event, &deserialized) {
            assert_eq!(u1, u2);
            assert_eq!(s1, s2);
        } else {
            panic!("Event variant mismatch");
        }
    }
}

/// Test adversarial / corrupted serde inputs
#[test]
fn test_adversarial_serde_inputs() {
    // Missing required field "was_online" in Offline variant
    let malformed_offline = json!({
        "UserStatusChanged": {
            "user_id": 999,
            "status": {
                "Offline": {}
            }
        }
    });
    let result: Result<CoreEvent, _> = serde_json::from_value(malformed_offline);
    assert!(result.is_err(), "Missing was_online must fail deserialization cleanly");

    // Negative user_id (e.g. channel or special bot ID)
    let negative_uid_event = CoreEvent::UserStatusChanged {
        user_id: UserId(-100123456789),
        status: UserStatus::Online,
    };
    let json_val = serde_json::to_value(&negative_uid_event).unwrap();
    let roundtripped: CoreEvent = serde_json::from_value(json_val).unwrap();
    if let CoreEvent::UserStatusChanged { user_id, status } = roundtripped {
        assert_eq!(user_id, UserId(-100123456789));
        assert_eq!(status, UserStatus::Online);
    } else {
        panic!("Mismatch variant");
    }
}

/// 2. Verify state transition sequence: Online -> Offline -> Recently -> Online
/// and verify timestamps are retained properly and updated properly.
#[test]
fn test_online_offline_recently_online_transition_lifecycle() {
    let mut state = CoreState::new();
    let uid = UserId(500);

    // Initial state: Online
    state.update_user(create_dummy_user(500, "Eva", UserStatus::Online));
    assert_eq!(state.get_user(uid).unwrap().status, UserStatus::Online);

    // Step 1: Transition to Offline with timestamp T1
    let t1 = 1729891000;
    state.apply_update(&CoreEvent::UserStatusChanged {
        user_id: uid,
        status: UserStatus::Offline { was_online: t1 },
    });
    assert_eq!(
        state.get_user(uid).unwrap().status,
        UserStatus::Offline { was_online: t1 }
    );

    // Step 2: Transition to Recently
    state.apply_update(&CoreEvent::UserStatusChanged {
        user_id: uid,
        status: UserStatus::Recently,
    });
    assert_eq!(state.get_user(uid).unwrap().status, UserStatus::Recently);

    // Step 3: Transition back to Online
    state.apply_update(&CoreEvent::UserStatusChanged {
        user_id: uid,
        status: UserStatus::Online,
    });
    assert_eq!(state.get_user(uid).unwrap().status, UserStatus::Online);

    // Step 4: Transition to Offline again with newer timestamp T2
    let t2 = 1729899000;
    state.apply_update(&CoreEvent::UserStatusChanged {
        user_id: uid,
        status: UserStatus::Offline { was_online: t2 },
    });
    assert_eq!(
        state.get_user(uid).unwrap().status,
        UserStatus::Offline { was_online: t2 }
    );
    // Ensure T1 was not leaked or retained
    if let UserStatus::Offline { was_online } = state.get_user(uid).unwrap().status {
        assert_eq!(was_online, t2);
    } else {
        panic!("Expected Offline status");
    }
}

/// 3. Verify that unknown user status does not overwrite known status.
#[test]
fn test_unknown_status_does_not_overwrite_known_status_in_update_user() {
    let mut state = CoreState::new();

    // Known statuses to test
    let known_statuses = vec![
        UserStatus::Online,
        UserStatus::Offline { was_online: 1729895555 },
        UserStatus::Recently,
        UserStatus::LastWeek,
        UserStatus::LastMonth,
    ];

    for (i, initial_status) in known_statuses.into_iter().enumerate() {
        let uid = UserId(2000 + i as i64);
        state.update_user(create_dummy_user(uid.0, "Contact", initial_status.clone()));
        assert_eq!(state.get_user(uid).unwrap().status, initial_status);

        // Incoming updateUser with Unknown status
        let update_with_unknown = create_dummy_user(uid.0, "Contact Renamed", UserStatus::Unknown);
        state.update_user(update_with_unknown);

        // Verification: status MUST NOT be overwritten by Unknown
        let user = state.get_user(uid).unwrap();
        assert_eq!(user.status, initial_status, "Status was overwritten by Unknown for user {}", uid.0);
        // But metadata such as name must be updated
        assert_eq!(user.first_name, "Contact Renamed");

        // Now test that a genuine new known status DOES update
        let update_with_known = create_dummy_user(uid.0, "Contact Known", UserStatus::Online);
        state.update_user(update_with_known);
        assert_eq!(state.get_user(uid).unwrap().status, UserStatus::Online);
    }
}

/// Verify that nonexistent user status change is handled gracefully without panicking or creating invalid entries
#[test]
fn test_nonexistent_user_status_changed_event() {
    let mut state = CoreState::new();
    let ghost_id = UserId(987654321);

    // Dispatch UserStatusChanged for non-existent user
    state.apply_update(&CoreEvent::UserStatusChanged {
        user_id: ghost_id,
        status: UserStatus::Online,
    });

    // Should not panic and should not insert a ghost user without profile
    assert!(state.get_user(ghost_id).is_none());
}

/// Verify `me` presence synchronization and isolation from other user updates
#[test]
fn test_me_presence_synchronization_and_isolation() {
    let mut state = CoreState::new();
    let my_id = UserId(42);
    let other_id = UserId(99);

    state.set_me(create_dummy_user(42, "CurrentMe", UserStatus::Online));
    state.update_user(create_dummy_user(99, "OtherUser", UserStatus::Recently));

    assert_eq!(state.me.as_ref().unwrap().status, UserStatus::Online);
    assert_eq!(state.get_user(my_id).unwrap().status, UserStatus::Online);
    assert_eq!(state.get_user(other_id).unwrap().status, UserStatus::Recently);

    // Update other user
    state.apply_update(&CoreEvent::UserStatusChanged {
        user_id: other_id,
        status: UserStatus::Offline { was_online: 1729893333 },
    });
    // Me must remain untouched
    assert_eq!(state.me.as_ref().unwrap().status, UserStatus::Online);
    assert_eq!(state.get_user(other_id).unwrap().status, UserStatus::Offline { was_online: 1729893333 });

    // Update me
    state.apply_update(&CoreEvent::UserStatusChanged {
        user_id: my_id,
        status: UserStatus::Offline { was_online: 1729894444 },
    });
    assert_eq!(state.me.as_ref().unwrap().status, UserStatus::Offline { was_online: 1729894444 });
    assert_eq!(state.get_user(my_id).unwrap().status, UserStatus::Offline { was_online: 1729894444 });
}

/// 4. Stress testing rapid presence flapping and multi-user updates
#[test]
fn test_presence_flapping_and_concurrency_stress() {
    let state = Arc::new(Mutex::new(CoreState::new()));

    // Seed 20 users
    {
        let mut s = state.lock().unwrap();
        for i in 1..=20 {
            s.update_user(create_dummy_user(i, &format!("User_{}", i), UserStatus::Unknown));
        }
    }

    let mut handles = Vec::new();

    for thread_idx in 0..8 {
        let state_clone = Arc::clone(&state);
        handles.push(thread::spawn(move || {
            let statuses = [
                UserStatus::Online,
                UserStatus::Offline { was_online: 1729890000 + (thread_idx as i64) * 100 },
                UserStatus::Recently,
                UserStatus::LastWeek,
                UserStatus::LastMonth,
            ];

            for iter in 0..500 {
                let user_id = UserId(((iter % 20) + 1) as i64);
                let next_status = statuses[(iter + thread_idx) % statuses.len()].clone();

                let mut s = state_clone.lock().unwrap();
                s.apply_update(&CoreEvent::UserStatusChanged {
                    user_id,
                    status: next_status,
                });
            }
        }));
    }

    for h in handles {
        h.join().unwrap();
    }

    let final_state = state.lock().unwrap();
    for i in 1..=20 {
        let u = final_state.get_user(UserId(i)).expect("User must exist");
        // Status must be one of the valid known statuses (not corrupted)
        match &u.status {
            UserStatus::Online
            | UserStatus::Offline { .. }
            | UserStatus::Recently
            | UserStatus::LastWeek
            | UserStatus::LastMonth => {}
            other => panic!("Unexpected status for user {}: {:?}", i, other),
        }
    }
}
