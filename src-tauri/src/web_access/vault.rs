//! Server-side Web contexts retain the service's authenticated master key.
//! Each browser login owns its note keys and drafts; desktop screen locking
//! never shares either side's note unlock state.
use crate::{AppState, error::AppError, services};
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};

pub(super) struct WebVault {
    pub state: AppState,
    generation: u64,
}
impl WebVault {
    /// Caller holds SESSION_GATE.read() while copying the authenticated key.
    pub fn new(desktop: &AppState) -> Result<Self, AppError> {
        let key = services::get_master_key(desktop)?;
        Ok(Self {
            generation: desktop.data_epoch.load(Ordering::SeqCst),
            state: AppState {
                db: desktop.db.clone(), data_epoch: desktop.data_epoch.clone(),
                master_key: Mutex::new(Some(key)), unlock_attempts: Mutex::new(Default::default()),
                lock_epoch: Default::default(), backup_key: Mutex::new(None), backup_busy: AtomicBool::new(false),
                fileshare: Default::default(), tunnel: Default::default(), note_keys: Mutex::new(Default::default()),
                note_key: Mutex::new(None), note_drafts: Mutex::new(Default::default()),
            },
        })
    }
    pub fn epoch(&self) -> Option<u64> {
        if self.state.data_epoch.load(Ordering::SeqCst) != self.generation { return None; }
        self.state.master_key.lock().ok()?.as_ref()?;
        Some(self.generation)
    }
    pub fn verify_password(&self, password: &str) -> Result<(), AppError> {
        let db = self.state.db.lock().map_err(|_| AppError::Database("无法读取当前档案".into()))?;
        services::auth_service::verify_password(&db, password).map(|_| ())
    }
    pub fn require_note_access(&self, id: &str) -> Result<(), AppError> {
        let master = self.state.master_key.lock().map_err(|_| AppError::NotUnlocked)?;
        master.as_ref().ok_or(AppError::NotUnlocked)?;
        let db = self.state.db.lock().map_err(|_| AppError::Database("无法读取小记".into()))?;
        if let Some(lock) = db.get_note_lock(id)? {
            crate::commands::note_lock::validated_dek(&self.state, id, &lock)?;
        }
        Ok(())
    }
    pub fn require_attachment_access(&self, name: &str) -> Result<(), AppError> {
        let master = self.state.master_key.lock().map_err(|_| AppError::NotUnlocked)?;
        master.as_ref().ok_or(AppError::NotUnlocked)?;
        let db = self.state.db.lock().map_err(|_| AppError::Database("无法读取图片".into()))?;
        let owners = db.attachment_note_ids(name)?;
        // 暂存图片尚未绑定；共享图片只要在一条可读的小记里出现就可读取。
        if owners.is_empty() { return Ok(()); }
        for id in owners {
            match db.get_note_lock(&id)? {
                None => return Ok(()),
                Some(lock) if crate::commands::note_lock::validated_dek(&self.state, &id, &lock).is_ok() => return Ok(()),
                Some(_) => {},
            }
        }
        Err(AppError::Database("请先解锁此图片所属的小记".into()))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{commands, command_state::CommandState};
    #[test]
    fn web_uses_current_desktop_master_password_and_same_note_recovery() {
        use crate::commands::note_lock;
        let desktop = crate::test_state();
        {
            let db = desktop.db.lock().unwrap();
            let mut key = desktop.master_key.lock().unwrap();
            services::auth_service::setup_master_password(&db, &mut key, "shared-desktop-password").unwrap();
        }
        let web = WebVault::new(&desktop).unwrap();
        commands::auth::clear_keys(&desktop).unwrap();
        assert!(web.verify_password("shared-desktop-password").is_ok());
        assert!(web.verify_password("old-web-only-password").is_err());
        assert!(desktop.master_key.lock().unwrap().is_none());
        note_lock::note_key_setup_with_state(&web.state, "shared-note-passphrase".into()).unwrap();
        note_lock::note_key_relock(CommandState::from_ref(&web.state)).unwrap();
        note_lock::note_key_recover(CommandState::from_ref(&web.state)).unwrap();
        note_lock::note_key_change_with_state(&web.state, "updated-note-passphrase".into()).unwrap();
        *desktop.master_key.lock().unwrap() = Some(services::auth_service::verify_password(&desktop.db.lock().unwrap(), "shared-desktop-password").unwrap());
        assert!(note_lock::note_key_unlock_with_state(&desktop, "shared-note-passphrase".into()).is_err());
        note_lock::note_key_unlock_with_state(&desktop, "updated-note-passphrase".into()).unwrap();
        assert_eq!(*desktop.note_key.lock().unwrap(), *web.state.note_key.lock().unwrap());
    }
    #[test]
    fn desktop_lock_and_unlock_leave_web_read_write_available_without_unlocking_desktop() {
        let desktop = crate::test_state();
        assert!(WebVault::new(&desktop).is_err());
        *desktop.master_key.lock().unwrap() = Some(vec![7;32]);
        let web = WebVault::new(&desktop).unwrap();
        assert!(std::sync::Arc::ptr_eq(&desktop.db, &web.state.db));
        commands::auth::clear_keys(&desktop).unwrap();
        assert!(desktop.master_key.lock().unwrap().is_none());
        assert_eq!(web.epoch(),Some(0));
        let entry = commands::entries::create_entry(CommandState::from_ref(&web.state), crate::db::CreateEntryInput {
            name:"Web while locked".into(), url:None, username:None, password:"fixture-secret".into(), notes:None, category:None,
        }).unwrap();
        assert_eq!(commands::entries::get_password(CommandState::from_ref(&web.state),entry.id).unwrap(),"fixture-secret");
        assert!(desktop.master_key.lock().unwrap().is_none(),"Web must not silently unlock desktop");
        *desktop.master_key.lock().unwrap() = Some(vec![7;32]);
        desktop.lock_epoch.fetch_add(1,Ordering::SeqCst);
        assert_eq!(web.epoch(),Some(0));
    }
    #[test]
    fn data_replacement_or_master_rekey_invalidates_existing_web_context() {
        let desktop = crate::test_state();
        *desktop.master_key.lock().unwrap() = Some(vec![7;32]);
        let web = WebVault::new(&desktop).unwrap();
        desktop.data_epoch.fetch_add(1,Ordering::SeqCst);
        assert!(web.epoch().is_none());
        let result = super::super::with_session_epoch(0, || web.epoch(), || -> Result<(),String> { panic!("stale context must never dispatch") });
        assert!(result.is_err());
    }
    #[test]
    fn desktop_note_lock_state_and_drafts_are_not_shared_with_the_web() {
        let desktop = crate::test_state();
        *desktop.master_key.lock().unwrap()=Some(vec![7;32]);
        *desktop.note_key.lock().unwrap()=Some(vec![8;32]);
        desktop.note_keys.lock().unwrap().insert("fixture".into(),vec![9;32]);
        let web=WebVault::new(&desktop).unwrap();
        assert!(web.state.note_key.lock().unwrap().is_none());
        assert!(web.state.note_keys.lock().unwrap().is_empty());
        *web.state.note_key.lock().unwrap()=Some(vec![10;32]);
        commands::auth::clear_keys(&desktop).unwrap();
        assert!(web.state.note_key.lock().unwrap().is_some());
    }

    #[test]
    fn note_passphrase_unlocks_only_the_browser_that_supplied_it() {
        use crate::{commands::{note_lock, notes}, db::CreateNoteInput};
        let desktop = crate::test_state();
        *desktop.master_key.lock().unwrap() = Some(vec![7; 32]);
        note_lock::note_key_setup_with_state(&desktop, "separate-note-password".into()).unwrap();
        let note = notes::create_note(CommandState::from_ref(&desktop), CreateNoteInput {
            title: "private note".into(), content_html: "<p>secret</p>".into(), category: None,
        }).unwrap();
        note_lock::lock_note(CommandState::from_ref(&desktop), note.id.clone()).unwrap();
        desktop.db.lock().unwrap().create_attachment(&crate::db::Attachment {
            id: "image-fixture".into(), note_id: note.id.clone(), file_name: "secret.png".into(),
            file_path: "fixture__secret.png".into(), file_size: 1, mime_type: "image/png".into(), created_at: 1,
        }).unwrap();
        let service = WebVault::new(&desktop).unwrap();
        let first = WebVault::new(&service.state).unwrap();
        let second = WebVault::new(&service.state).unwrap();
        assert!(first.require_note_access(&note.id).is_err());
        assert!(first.require_attachment_access("fixture__secret.png").is_err());
        assert!(note_lock::note_key_unlock_with_state(&first.state, "web-access-password".into()).is_err());
        assert!(note_lock::reveal_note(CommandState::from_ref(&first.state), note.id.clone()).is_err());
        note_lock::note_key_unlock_with_state(&first.state, "separate-note-password".into()).unwrap();
        assert!(first.require_note_access(&note.id).is_ok());
        assert!(first.require_attachment_access("fixture__secret.png").is_ok());
        assert!(second.require_attachment_access("fixture__secret.png").is_err());
        assert_eq!(note_lock::reveal_note(CommandState::from_ref(&first.state), note.id.clone()).unwrap(), "<p>secret</p>");
        assert!(note_lock::reveal_note(CommandState::from_ref(&second.state), note.id.clone()).is_err());
        assert!(service.state.note_keys.lock().unwrap().is_empty());
        note_lock::note_key_unlock_with_state(&second.state, "separate-note-password".into()).unwrap();
        note_lock::note_key_relock(CommandState::from_ref(&first.state)).unwrap();
        assert_eq!(note_lock::reveal_note(CommandState::from_ref(&second.state), note.id).unwrap(), "<p>secret</p>");
    }
}

#[cfg(test)]
mod rekey_tests {
    use super::*;
    use crate::{commands::{note_lock, notes}, command_state::CommandState as State, db::{CreateNoteInput, UpdateNoteInput}};
    #[test]
    fn another_contexts_new_note_key_cannot_be_overwritten_with_a_stale_cached_key() {
        let desktop=crate::test_state();
        *desktop.master_key.lock().unwrap()=Some(vec![7;32]);
        let web=WebVault::new(&desktop).unwrap();
        note_lock::note_key_setup_with_state(&desktop,"fixture-note-password".into()).unwrap();
        let note=notes::create_note(State::from_ref(&desktop),CreateNoteInput { title:"fixture".into(), content_html:"<p>original</p>".into(),category:None }).unwrap();
        note_lock::lock_note(State::from_ref(&desktop),note.id.clone()).unwrap();
        note_lock::note_key_recover(State::from_ref(&web.state)).unwrap();
        let input=UpdateNoteInput { title:"fixture".into(),content_html:"<p>changed on Web</p>".into(),category:None };
        note_lock::remove_note_lock(State::from_ref(&web.state),note.id.clone(),input.clone()).unwrap();
        note_lock::lock_note(State::from_ref(&web.state),note.id.clone()).unwrap();
        let result=notes::update_note(State::from_ref(&desktop),note.id.clone(),UpdateNoteInput {content_html:"stale desktop edit".into(),..input});
        assert!(result.is_err());
        assert_eq!(note_lock::unlock_note(State::from_ref(&desktop),note.id.clone()).unwrap(),"<p>changed on Web</p>");
        assert_eq!(note_lock::reveal_note(State::from_ref(&web.state),note.id).unwrap(),"<p>changed on Web</p>");
    }
}
