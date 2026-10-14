//! Uncommitted edits survive an application lock as ciphertext, never as a disk backup.
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use crate::{crypto::{self, EncryptedData}, db::{Database, UpdateNoteInput}, error::AppError, AppState};

#[derive(Clone, Serialize, Deserialize)]
pub struct NoteDraft {
    pub id: String,
    pub input: UpdateNoteInput,
}

#[derive(Default)]
pub struct DraftCache(HashMap<String, EncryptedData>);

impl DraftCache {
    pub fn stage(&mut self, db: &Database, key: &[u8], drafts: Vec<NoteDraft>) -> Result<(), AppError> {
        let mut sealed = Vec::new();
        for draft in drafts {
            if db.get_note(&draft.id)?.is_none() { continue; }
            let json = serde_json::to_string(&draft.input).map_err(|e| AppError::Crypto(e.to_string()))?;
            sealed.push((draft.id, crypto::encrypt_password(&json, key)?));
        }
        self.0.extend(sealed);
        Ok(())
    }

    pub fn recover(&self, db: &Database, key: &[u8], open_notes: &HashMap<String, Vec<u8>>) -> Result<Vec<NoteDraft>, AppError> {
        let mut out = Vec::new();
        for (id, sealed) in &self.0 {
            let Some(note) = db.get_note(id)? else { continue; };
            if note.encrypted && !open_notes.contains_key(id) { continue; }
            let json = crypto::decrypt_password(sealed, key)?;
            out.push(NoteDraft { id: id.clone(), input: serde_json::from_str(&json).map_err(|e| AppError::Crypto(e.to_string()))? });
        }
        Ok(out)
    }

    pub fn saved(&mut self, id: &str, input: &UpdateNoteInput, key: &[u8]) -> Result<(), AppError> {
        if let Some(sealed) = self.0.get(id) {
            let json = crypto::decrypt_password(sealed, key)?;
            let pending: UpdateNoteInput = serde_json::from_str(&json).map_err(|e| AppError::Crypto(e.to_string()))?;
            if pending == *input { self.0.remove(id); }
        }
        Ok(())
    }
    pub fn remove(&mut self, id: &str) { self.0.remove(id); }
    pub fn clear(&mut self) { self.0.clear(); }
    pub fn rekeyed(&self, old: &[u8], new: &[u8]) -> Result<Self, AppError> {
        let next = self.0.iter().map(|(id, sealed)| {
            Ok((id.clone(), crypto::encrypt_password(&crypto::decrypt_password(sealed, old)?, new)?))
        }).collect::<Result<HashMap<_, _>, AppError>>()?;
        Ok(Self(next))
    }
}

pub fn stage(state: &AppState, drafts: Vec<NoteDraft>) -> Result<(), AppError> {
    let master = state.master_key.lock().map_err(|_| AppError::NotUnlocked)?;
    let key = master.as_ref().ok_or(AppError::NotUnlocked)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".into()))?;
    let open_notes = state.note_keys.lock().map_err(|_| AppError::Database("lock error".into()))?;
    for draft in &drafts {
        if db.get_note(&draft.id)?.is_some_and(|n| n.encrypted) && !open_notes.contains_key(&draft.id) {
            return Err(AppError::Database("小记未解锁".into()));
        }
    }
    state.note_drafts.lock().map_err(|_| AppError::Database("lock error".into()))?.stage(&db, key, drafts)
}

pub fn recover(state: &AppState) -> Result<Vec<NoteDraft>, AppError> {
    let master = state.master_key.lock().map_err(|_| AppError::NotUnlocked)?;
    let key = master.as_ref().ok_or(AppError::NotUnlocked)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".into()))?;
    let open_notes = state.note_keys.lock().map_err(|_| AppError::Database("lock error".into()))?;
    state.note_drafts.lock().map_err(|_| AppError::Database("lock error".into()))?.recover(&db, key, &open_notes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypted_note_drafts_require_both_application_and_note_unlock() {
        let state = crate::test_state();
        let key = vec![7;32];
        *state.master_key.lock().unwrap() = Some(key.clone());
        let note = crate::services::note_service::create_note(&state.db.lock().unwrap(), crate::db::CreateNoteInput {
            title: "t".into(), content_html: "original".into(), category: None,
        }).unwrap();
        state.db.lock().unwrap().set_note_lock(&note.id, "fixture-cipher", "iv", "wrap", "t", 2).unwrap();
        let draft = NoteDraft { id: note.id.clone(), input: UpdateNoteInput { title: "t".into(), content_html: "protected draft".into(), category: None } };
        assert!(stage(&state, vec![draft.clone()]).is_err());
        state.note_keys.lock().unwrap().insert(note.id.clone(), vec![1;32]);
        stage(&state, vec![draft]).unwrap();
        crate::commands::auth::clear_keys(&state).unwrap();
        assert!(recover(&state).is_err());
        *state.master_key.lock().unwrap() = Some(key);
        assert!(recover(&state).unwrap().is_empty());
        state.note_keys.lock().unwrap().insert(note.id.clone(), vec![1;32]);
        assert_eq!(recover(&state).unwrap()[0].input.content_html, "protected draft");
        state.db.lock().unwrap().delete_note(&note.id).unwrap();
        assert!(recover(&state).unwrap().is_empty(), "deleted notes must never be resurrected");
    }
    #[test]
    fn lock_keeps_ciphertext_and_old_save_cannot_erase_new_edit() {
        let state = crate::test_state();
        let key = vec![7;32];
        *state.master_key.lock().unwrap() = Some(key.clone());
        let note = crate::services::note_service::create_note(&state.db.lock().unwrap(), crate::db::CreateNoteInput {
            title: "t".into(), content_html: "original".into(), category: None,
        }).unwrap();
        let old = UpdateNoteInput { title: "t".into(), content_html: "unsaved-old".into(), category: None };
        let mut new = old.clone(); new.content_html = "unsaved-new".into();
        stage(&state, vec![NoteDraft { id: note.id.clone(), input: new.clone() }]).unwrap();
        state.note_drafts.lock().unwrap().saved(&note.id, &old, &key).unwrap();
        crate::commands::auth::clear_keys(&state).unwrap();
        assert!(recover(&state).is_err());
        let raw = serde_json::to_string(state.note_drafts.lock().unwrap().0.get(&note.id).unwrap()).unwrap();
        assert!(!raw.contains("unsaved-new"));
        *state.master_key.lock().unwrap() = Some(key.clone());
        assert_eq!(recover(&state).unwrap()[0].input, new);
        state.note_drafts.lock().unwrap().saved(&note.id, &new, &key).unwrap();
        assert!(recover(&state).unwrap().is_empty());
    }
}
