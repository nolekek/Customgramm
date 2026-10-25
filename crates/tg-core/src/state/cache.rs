use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::domain::{
    AuthState, Chat, ChatFolder, ChatId, ChatPosition, ChatType, FileInfo, Message, MessageContent, MessageId,
    MessageStatus, Sender, User, UserId, UserStatus,
};
use crate::event::{ConnectionState, CoreEvent};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoreState {
    pub auth_state: AuthState,
    pub connection_state: ConnectionState,
    pub me: Option<User>,
    pub chats: HashMap<ChatId, Chat>,
    pub ordered_chats: Vec<ChatId>,
    pub chat_folders: Vec<ChatFolder>,
    pub messages: HashMap<ChatId, Vec<Message>>,
    pub users: HashMap<UserId, User>,
    pub files: HashMap<i32, FileInfo>,
}

impl Default for CoreState {
    fn default() -> Self {
        Self {
            auth_state: AuthState::Closed,
            connection_state: ConnectionState::WaitingForNetwork,
            me: None,
            chats: HashMap::new(),
            ordered_chats: Vec::new(),
            chat_folders: Vec::new(),
            messages: HashMap::new(),
            users: HashMap::new(),
            files: HashMap::new(),
        }
    }
}


impl CoreState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn update_auth_state(&mut self, state: AuthState) {
        self.auth_state = state;
    }

    pub fn update_connection_state(&mut self, state: ConnectionState) {
        self.connection_state = state;
    }

    pub fn set_me(&mut self, user: User) {
        self.users.insert(user.id, user.clone());
        self.me = Some(user);
    }

    pub fn update_user(&mut self, mut user: User) {
        if let Some(existing) = self.users.get(&user.id) {
            if user.photo_path.is_none() && existing.photo_path.is_some() {
                user.photo_path = existing.photo_path.clone();
            }
            if user.status == UserStatus::Unknown && existing.status != UserStatus::Unknown {
                user.status = existing.status.clone();
            }
        }
        let is_me = self.me.as_ref().map(|m| m.id == user.id).unwrap_or(false);
        if is_me {
            self.me = Some(user.clone());
        }
        self.users.insert(user.id, user);
    }

    pub fn update_user_status(&mut self, user_id: UserId, status: UserStatus) {
        if let Some(user) = self.users.get_mut(&user_id) {
            user.status = status.clone();
        }
        if let Some(ref mut me) = self.me {
            if me.id == user_id {
                me.status = status;
            }
        }
    }

    pub fn insert_or_update_chat(&mut self, mut chat: Chat) {
        if let Some(existing) = self.chats.get(&chat.id) {
            if chat.folder_ids.is_empty() && !existing.folder_ids.is_empty() {
                chat.folder_ids = existing.folder_ids.clone();
            }
            if chat.photo_path.is_none() && existing.photo_path.is_some() {
                chat.photo_path = existing.photo_path.clone();
            }
            // Preserve valid last_message if incoming chat has None or date: 0
            if chat.last_message.is_none() && existing.last_message.is_some() {
                chat.last_message = existing.last_message.clone();
            } else if let (Some(ref mut new_last), Some(ref old_last)) =
                (&mut chat.last_message, &existing.last_message)
            {
                if new_last.id == old_last.id {
                    if new_last.date == 0 && old_last.date != 0 {
                        new_last.date = old_last.date;
                    }
                    if new_last.sender == Sender::Unknown && old_last.sender != Sender::Unknown {
                        new_last.sender = old_last.sender.clone();
                    }
                } else if new_last.date == 0 && old_last.date != 0 {
                    chat.last_message = existing.last_message.clone();
                }
            }
        }
        if let Some(ref last_msg) = chat.last_message {
            if last_msg.date != 0 {
                let msgs = self.messages.entry(chat.id).or_default();
                if msgs.is_empty() {
                    msgs.push(last_msg.clone());
                }
            }
        }
        self.chats.insert(chat.id, chat);
        self.rebuild_chat_order();
    }

    /// Recompute the deterministic ordering of chats for the main chat list.
    /// Pinned chats come first, followed by descending order key, followed by descending ChatId.
    /// Chats with order == 0 (and not pinned) are excluded from the main list.
    pub fn rebuild_chat_order(&mut self) {
        let mut list: Vec<(ChatId, u64, bool)> = self
            .chats
            .values()
            .filter_map(|c| match c.position {
                Some(pos) if pos.order > 0 || pos.is_pinned => {
                    Some((c.id, pos.order, pos.is_pinned))
                }
                Some(pos) if pos.order == 0 && !pos.is_pinned => None,
                None => Some((c.id, 0, false)),
                _ => None,
            })
            .collect();

        // Sort: pinned first, then order descending, then ChatId descending
        list.sort_by(|a, b| {
            b.2.cmp(&a.2)
                .then_with(|| b.1.cmp(&a.1))
                .then_with(|| b.0.cmp(&a.0))
        });

        self.ordered_chats = list.into_iter().map(|(id, _, _)| id).collect();
    }

    pub fn update_chat_position(&mut self, chat_id: ChatId, position: Option<ChatPosition>) {
        if let Some(chat) = self.chats.get_mut(&chat_id) {
            chat.position = position;
            self.rebuild_chat_order();
        }
    }

    pub fn update_chat_read_inbox(
        &mut self,
        chat_id: ChatId,
        last_read_inbox_message_id: i64,
        unread_count: i32,
    ) {
        if let Some(chat) = self.chats.get_mut(&chat_id) {
            chat.last_read_inbox_message_id = last_read_inbox_message_id;
            chat.unread_count = unread_count;
        }
    }

    pub fn update_chat_read_outbox(&mut self, chat_id: ChatId, last_read_outbox_message_id: i64) {
        if let Some(chat) = self.chats.get_mut(&chat_id) {
            chat.last_read_outbox_message_id = last_read_outbox_message_id;
            if let Some(ref mut last_msg) = chat.last_message {
                if last_msg.is_outgoing && last_msg.id.0 <= last_read_outbox_message_id {
                    last_msg.status = MessageStatus::Read;
                }
            }
        }
        if let Some(msgs) = self.messages.get_mut(&chat_id) {
            for msg in msgs.iter_mut() {
                if msg.is_outgoing
                    && msg.id.0 <= last_read_outbox_message_id
                    && msg.status != MessageStatus::Read
                {
                    msg.status = MessageStatus::Read;
                }
            }
        }
    }

    pub fn update_message_content(
        &mut self,
        chat_id: ChatId,
        message_id: MessageId,
        content: MessageContent,
    ) {
        if let Some(msgs) = self.messages.get_mut(&chat_id) {
            if let Some(msg) = msgs.iter_mut().find(|m| m.id == message_id) {
                msg.content = content.clone();
            }
        }
        if let Some(chat) = self.chats.get_mut(&chat_id) {
            if let Some(ref mut last_msg) = chat.last_message {
                if last_msg.id == message_id {
                    last_msg.content = content;
                }
            }
        }
    }

    pub fn update_message_status(
        &mut self,
        chat_id: ChatId,
        message_id: MessageId,
        status: MessageStatus,
    ) {
        if let Some(msgs) = self.messages.get_mut(&chat_id) {
            if let Some(msg) = msgs.iter_mut().find(|m| m.id == message_id) {
                msg.status = status.clone();
            }
        }
        if let Some(chat) = self.chats.get_mut(&chat_id) {
            if let Some(ref mut last_msg) = chat.last_message {
                if last_msg.id == message_id {
                    last_msg.status = status;
                }
            }
        }
    }

    pub fn update_message_send_succeeded(
        &mut self,
        chat_id: ChatId,
        old_message_id: MessageId,
        mut message: Message,
    ) {
        message.status = MessageStatus::Sent;

        // Defensively inherit non-zero date and known sender if incoming message has dummy metadata
        if message.date == 0 || message.sender == Sender::Unknown {
            let existing_meta = self
                .messages
                .get(&chat_id)
                .and_then(|msgs| {
                    msgs.iter()
                        .find(|m| m.id == old_message_id || m.id == message.id)
                        .map(|m| (m.date, m.sender.clone()))
                })
                .or_else(|| {
                    self.chats
                        .get(&chat_id)
                        .and_then(|c| c.last_message.as_ref())
                        .filter(|m| m.id == old_message_id || m.id == message.id)
                        .map(|m| (m.date, m.sender.clone()))
                });

            if let Some((existing_date, existing_sender)) = existing_meta {
                if message.date == 0 && existing_date != 0 {
                    message.date = existing_date;
                }
                if message.sender == Sender::Unknown && existing_sender != Sender::Unknown {
                    message.sender = existing_sender;
                }
            }
        }

        if let Some(msgs) = self.messages.get_mut(&chat_id) {
            msgs.retain(|m| m.id != old_message_id && m.id != message.id);
            msgs.push(message.clone());
            msgs.sort_by_key(|m| (m.date, m.id.0));
        }

        if let Some(chat) = self.chats.get_mut(&chat_id) {
            let should_update = match &chat.last_message {
                Some(last) => {
                    last.id == old_message_id
                        || last.id == message.id
                        || (message.date != 0 && message.date >= last.date)
                }
                None => true,
            };
            if should_update {
                let mut final_msg = message;
                if let Some(ref last) = chat.last_message {
                    if final_msg.date == 0 && last.date != 0 {
                        final_msg.date = last.date;
                    }
                    if final_msg.sender == Sender::Unknown && last.sender != Sender::Unknown {
                        final_msg.sender = last.sender.clone();
                    }
                }
                chat.last_message = Some(final_msg);
            }
        }
    }

    pub fn delete_messages(&mut self, chat_id: ChatId, message_ids: &[MessageId]) {
        if let Some(msgs) = self.messages.get_mut(&chat_id) {
            msgs.retain(|m| !message_ids.contains(&m.id));
        }
        if let Some(chat) = self.chats.get_mut(&chat_id) {
            if let Some(ref last_msg) = chat.last_message {
                if message_ids.contains(&last_msg.id) {
                    chat.last_message = self
                        .messages
                        .get(&chat_id)
                        .and_then(|ms| ms.last())
                        .cloned();
                }
            }
        }
    }

    pub fn insert_history_messages(&mut self, chat_id: ChatId, history_messages: Vec<Message>) {
        let msgs = self.messages.entry(chat_id).or_default();
        for msg in history_messages {
            if let Some(pos) = msgs.iter().position(|m| m.id == msg.id) {
                msgs[pos] = msg;
            } else {
                msgs.push(msg);
            }
        }
        msgs.sort_by_key(|m| (m.date, m.id.0));
        if let Some(chat) = self.chats.get_mut(&chat_id) {
            if chat.last_message.is_none() {
                chat.last_message = msgs.last().cloned();
            }
        }
    }

    pub fn add_message(&mut self, mut message: Message) {
        let chat_id = message.chat_id;
        let msgs = self.messages.entry(chat_id).or_default();

        // 1. Defensively recover existing date and sender if incoming message has dummy metadata
        if message.date == 0 || message.sender == Sender::Unknown {
            let existing_meta = msgs
                .iter()
                .find(|m| m.id == message.id)
                .map(|m| (m.date, m.sender.clone()))
                .or_else(|| {
                    self.chats
                        .get(&chat_id)
                        .and_then(|c| c.last_message.as_ref())
                        .filter(|m| m.id == message.id)
                        .map(|m| (m.date, m.sender.clone()))
                });

            if let Some((existing_date, existing_sender)) = existing_meta {
                if message.date == 0 && existing_date != 0 {
                    message.date = existing_date;
                }
                if message.sender == Sender::Unknown && existing_sender != Sender::Unknown {
                    message.sender = existing_sender;
                }
            }
        }

        // 2. Update messages vector (never push date 0 messages into history)
        if let Some(pos) = msgs.iter().position(|m| m.id == message.id) {
            msgs[pos] = message.clone();
            msgs.sort_by_key(|m| (m.date, m.id.0));
        } else if message.date != 0 {
            msgs.push(message.clone());
            msgs.sort_by_key(|m| (m.date, m.id.0));
        }

        // 3. Update chat.last_message safely
        if let Some(chat) = self.chats.get_mut(&chat_id) {
            let should_update = match &chat.last_message {
                Some(last) => {
                    if last.id == message.id {
                        true
                    } else if message.date == 0 {
                        false
                    } else {
                        message.date >= last.date
                    }
                }
                None => message.date != 0,
            };

            if should_update {
                if message.date == 0 {
                    // Content-only mutation fallback
                    if let Some(ref mut last) = chat.last_message {
                        if last.id == message.id {
                            last.content = message.content;
                        }
                    }
                } else {
                    if let Some(ref last) = chat.last_message {
                        if message.sender == Sender::Unknown && last.sender != Sender::Unknown {
                            message.sender = last.sender.clone();
                        }
                    }
                    chat.last_message = Some(message);
                }
            }
        }
    }

    pub fn ordered_chats(&self) -> &[ChatId] {
        &self.ordered_chats
    }

    pub fn get_chat(&self, id: ChatId) -> Option<&Chat> {
        self.chats.get(&id)
    }

    pub fn get_messages(&self, chat_id: ChatId) -> Option<&Vec<Message>> {
        self.messages.get(&chat_id)
    }

    pub fn messages_for_chat(&self, chat_id: ChatId) -> &[Message] {
        self.messages.get(&chat_id).map(|v| v.as_slice()).unwrap_or(&[])
    }

    pub fn get_user(&self, user_id: UserId) -> Option<&User> {
        self.users.get(&user_id)
    }

    pub fn unread_count_for_type(&self, chat_type: &ChatType) -> i32 {
        self.chats
            .values()
            .filter(|c| &c.chat_type == chat_type)
            .map(|c| c.unread_count)
            .sum()
    }

    pub fn total_unread_count(&self) -> i32 {
        self.chats.values().map(|c| c.unread_count).sum()
    }

    pub fn update_file(&mut self, file: FileInfo) {
        if let Some(ref path) = file.local_path {
            let p_str = path.to_string_lossy().to_string();
            for chat in self.chats.values_mut() {
                if chat.photo_file_id == Some(file.id) {
                    chat.photo_path = Some(p_str.clone());
                }
            }
            for user in self.users.values_mut() {
                if user.photo_file_id == Some(file.id) {
                    user.photo_path = Some(p_str.clone());
                }
            }
            if let Some(ref mut me) = self.me {
                if me.photo_file_id == Some(file.id) {
                    me.photo_path = Some(p_str);
                }
            }
        }
        self.files.insert(file.id, file);
    }

    pub fn get_file(&self, file_id: i32) -> Option<&FileInfo> {
        self.files.get(&file_id)
    }

    pub fn apply_update(&mut self, event: &CoreEvent) {
        match event {
            CoreEvent::AuthStateChanged(auth) => self.update_auth_state(auth.clone()),
            CoreEvent::ConnectionStateChanged(conn) => self.update_connection_state(conn.clone()),
            CoreEvent::MeUpdated(user) => self.set_me(*user.clone()),
            CoreEvent::UserUpdated(user) => self.update_user(*user.clone()),
            CoreEvent::UserStatusChanged { user_id, status } => {
                self.update_user_status(*user_id, status.clone());
            }
            CoreEvent::ChatUpdated(chat) => self.insert_or_update_chat(*chat.clone()),
            CoreEvent::ChatListUpdated(_) => self.rebuild_chat_order(),
            CoreEvent::ChatPositionChanged { chat_id, position } => {
                self.update_chat_position(*chat_id, *position)
            }
            CoreEvent::ChatReadInboxChanged {
                chat_id,
                last_read_inbox_message_id,
                unread_count,
            } => self.update_chat_read_inbox(
                *chat_id,
                *last_read_inbox_message_id,
                *unread_count,
            ),
            CoreEvent::ChatReadOutboxChanged {
                chat_id,
                last_read_outbox_message_id,
            } => self.update_chat_read_outbox(*chat_id, *last_read_outbox_message_id),
            CoreEvent::MessageReceived(msg) | CoreEvent::MessageUpdated(msg) => {
                self.add_message(*msg.clone())
            }
            CoreEvent::MessageSendSucceeded {
                chat_id,
                old_message_id,
                message,
            } => {
                self.update_message_send_succeeded(*chat_id, *old_message_id, *message.clone());
            }
            CoreEvent::MessageContentChanged {
                chat_id,
                message_id,
                content,
            } => {
                self.update_message_content(*chat_id, *message_id, content.clone());
            }
            CoreEvent::MessagesDeleted {
                chat_id,
                message_ids,
            } => self.delete_messages(*chat_id, message_ids),
            CoreEvent::MessageStatusChanged {
                chat_id,
                message_id,
                status,
            } => self.update_message_status(*chat_id, *message_id, status.clone()),
            CoreEvent::FileUpdated(file) => self.update_file(file.clone()),
            CoreEvent::ChatFoldersUpdated(folders) => {
                self.chat_folders = folders.clone();
            }
            CoreEvent::ChatFolderPositionsChanged { chat_id, folder_ids } => {
                if let Some(chat) = self.chats.get_mut(chat_id) {
                    chat.folder_ids = folder_ids.clone();
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Sender, UserId, UserStatus};

    fn make_test_user(id: i64, name: &str, status: UserStatus) -> User {
        User {
            id: UserId(id),
            first_name: name.to_string(),
            last_name: "".to_string(),
            username: Some(format!("user_{}", id)),
            phone_number: None,
            status,
            is_contact: true,
            is_bot: false,
            is_verified: false,
            photo_file_id: None,
            photo_path: None,
        }
    }

    #[test]
    fn test_user_status_initial_and_update() {
        let mut state = CoreState::new();
        let user = make_test_user(1001, "Alice", UserStatus::Offline { was_online: 1729880000 });
        state.update_user(user);

        assert_eq!(
            state.get_user(UserId(1001)).unwrap().status,
            UserStatus::Offline { was_online: 1729880000 }
        );

        // Apply UserStatusChanged event
        state.apply_update(&CoreEvent::UserStatusChanged {
            user_id: UserId(1001),
            status: UserStatus::Online,
        });

        assert_eq!(state.get_user(UserId(1001)).unwrap().status, UserStatus::Online);
    }

    #[test]
    fn test_user_status_me_synchronization() {
        let mut state = CoreState::new();
        let me = make_test_user(42, "Current User", UserStatus::Online);
        state.set_me(me);

        assert_eq!(state.me.as_ref().unwrap().status, UserStatus::Online);
        assert_eq!(state.get_user(UserId(42)).unwrap().status, UserStatus::Online);

        // Transition me to Offline
        state.apply_update(&CoreEvent::UserStatusChanged {
            user_id: UserId(42),
            status: UserStatus::Offline { was_online: 1729885000 },
        });

        assert_eq!(
            state.me.as_ref().unwrap().status,
            UserStatus::Offline { was_online: 1729885000 }
        );
        assert_eq!(
            state.get_user(UserId(42)).unwrap().status,
            UserStatus::Offline { was_online: 1729885000 }
        );
    }

    #[test]
    fn test_user_status_presence_transitions() {
        let mut state = CoreState::new();
        let user = make_test_user(2002, "Bob", UserStatus::Unknown);
        state.update_user(user);

        let transitions = vec![
            UserStatus::Online,
            UserStatus::Offline { was_online: 1729881234 },
            UserStatus::Recently,
            UserStatus::LastWeek,
            UserStatus::LastMonth,
            UserStatus::Online,
        ];

        for next_status in transitions {
            state.update_user_status(UserId(2002), next_status.clone());
            assert_eq!(state.get_user(UserId(2002)).unwrap().status, next_status);
        }
    }

    #[test]
    fn test_user_status_preserve_on_unknown_user_update() {
        let mut state = CoreState::new();
        let user = make_test_user(3003, "Charlie", UserStatus::Online);
        state.update_user(user);

        // Incoming updateUser with Unknown status should preserve known Online status
        let user_update_unknown = make_test_user(3003, "Charlie Updated", UserStatus::Unknown);
        state.update_user(user_update_unknown);

        assert_eq!(state.get_user(UserId(3003)).unwrap().status, UserStatus::Online);
        assert_eq!(state.get_user(UserId(3003)).unwrap().first_name, "Charlie Updated");

        // Incoming updateUser with a known status should update it
        let user_update_recently = make_test_user(3003, "Charlie Updated", UserStatus::Recently);
        state.update_user(user_update_recently);
        assert_eq!(state.get_user(UserId(3003)).unwrap().status, UserStatus::Recently);
    }

    #[test]
    fn test_user_status_nonexistent_user_graceful() {
        let mut state = CoreState::new();
        // Should not panic on nonexistent user ID
        state.update_user_status(UserId(99999), UserStatus::Online);
        assert!(state.get_user(UserId(99999)).is_none());
    }

    #[test]
    fn test_user_status_event_serde_roundtrip() {
        let event = CoreEvent::UserStatusChanged {
            user_id: UserId(5555),
            status: UserStatus::Offline { was_online: 1729889999 },
        };

        let json = serde_json::to_string(&event).expect("serialize");
        let deserialized: CoreEvent = serde_json::from_str(&json).expect("deserialize");

        match deserialized {
            CoreEvent::UserStatusChanged { user_id, status } => {
                assert_eq!(user_id, UserId(5555));
                assert_eq!(status, UserStatus::Offline { was_online: 1729889999 });
            }
            _ => panic!("Expected UserStatusChanged variant"),
        }
    }

    fn make_test_message(id: i64, chat_id: i64, date: i64, text: &str) -> Message {
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

    #[test]
    fn test_seed_last_message_on_empty_cache() {
        let mut state = CoreState::new();
        let msg = make_test_message(10, 100, 1729880000, "Initial last message");
        let chat = Chat {
            id: ChatId(100),
            title: "Test Group".to_string(),
            chat_type: ChatType::Supergroup,
            unread_count: 0,
            last_read_inbox_message_id: 0,
            last_read_outbox_message_id: 0,
            last_message: Some(msg.clone()),
            position: None,
            is_muted: false,
            has_unread_mention: false,
            folder_ids: Vec::new(),
            photo_file_id: None,
            photo_path: None,
        };

        // Cache was empty for chat 100, so inserting chat must seed last_message
        state.insert_or_update_chat(chat);
        let cached = state.get_messages(ChatId(100)).expect("messages seeded");
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].id, MessageId(10));
        assert_eq!(cached[0].content, msg.content);
    }

    #[test]
    fn test_strictly_chronological_message_ordering() {
        let mut state = CoreState::new();
        let msg1 = make_test_message(101, 200, 1000, "First");
        let msg2 = make_test_message(102, 200, 2000, "Second");
        let msg3 = make_test_message(103, 200, 3000, "Third");
        let msg4 = make_test_message(104, 200, 2000, "Second concurrent");

        // Insert out of order
        state.add_message(msg3);
        state.add_message(msg1);
        state.add_message(msg4);
        state.add_message(msg2);

        let msgs = state.get_messages(ChatId(200)).unwrap();
        let order: Vec<(i64, i64)> = msgs.iter().map(|m| (m.date, m.id.0)).collect();
        assert_eq!(order, vec![(1000, 101), (2000, 102), (2000, 104), (3000, 103)]);
    }

    #[test]
    fn test_message_send_succeeded_deduplication() {
        let mut state = CoreState::new();
        let temp_msg = make_test_message(-100, 300, 5000, "Optimistic send");
        state.add_message(temp_msg);
        assert_eq!(state.get_messages(ChatId(300)).unwrap().len(), 1);

        let confirmed_msg = make_test_message(777, 300, 5000, "Optimistic send");
        state.apply_update(&CoreEvent::MessageSendSucceeded {
            chat_id: ChatId(300),
            old_message_id: MessageId(-100),
            message: Box::new(confirmed_msg),
        });

        let msgs = state.get_messages(ChatId(300)).unwrap();
        assert_eq!(msgs.len(), 1, "Temporary message must be replaced, not duplicated");
        assert_eq!(msgs[0].id, MessageId(777));
        assert_eq!(msgs[0].status, MessageStatus::Sent);
    }

    #[test]
    fn test_non_destructive_content_update_preserves_date_and_sender() {
        let mut state = CoreState::new();
        let original_msg = Message {
            id: MessageId(501),
            chat_id: ChatId(400),
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
        state.add_message(original_msg.clone());

        // Update via MessageContentChanged
        let updated_content = MessageContent::Text {
            text: "Updated non-destructively".to_string(),
            entities: Vec::new(),
        };
        state.apply_update(&CoreEvent::MessageContentChanged {
            chat_id: ChatId(400),
            message_id: MessageId(501),
            content: updated_content.clone(),
        });

        let cached = &state.get_messages(ChatId(400)).unwrap()[0];
        assert_eq!(cached.content, updated_content);
        assert_eq!(cached.date, 1729881234, "Date must remain intact");
        assert_eq!(cached.sender, Sender::User(UserId(9999)), "Sender must remain intact");
        assert_eq!(cached.status, MessageStatus::Read, "Status must remain intact");

        // Also test dummy date 0 via MessageUpdated does not wipe out original date/sender
        let dummy_updated_msg = Message {
            id: MessageId(501),
            chat_id: ChatId(400),
            sender: Sender::Unknown,
            date: 0,
            content: MessageContent::Text {
                text: "Edited second time".to_string(),
                entities: Vec::new(),
            },
            is_outgoing: false,
            status: MessageStatus::Read,
            reply_to_message_id: None,
            can_be_edited: false,
            can_be_deleted: false,
        };
        state.apply_update(&CoreEvent::MessageUpdated(Box::new(dummy_updated_msg)));

        let cached2 = &state.get_messages(ChatId(400)).unwrap()[0];
        assert_eq!(cached2.date, 1729881234, "Date must not be overwritten by epoch 0");
        assert_eq!(cached2.sender, Sender::User(UserId(9999)), "Sender must not be overwritten by Unknown");
        assert_eq!(
            cached2.content,
            MessageContent::Text {
                text: "Edited second time".to_string(),
                entities: Vec::new(),
            }
        );
    }
}

