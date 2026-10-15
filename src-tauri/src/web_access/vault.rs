//! A Web service owns its unlock state. Only the database and data generation
//! are shared with the desktop; screen locking never gives either side a key.
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
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{commands, command_state::CommandState};
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
