use super::*;
use codex_core::modules::codex_account_backup as accounts;

struct Site(PathBuf);
impl Site {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("desko-account-backup-integration-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("attachments")).unwrap();
        drop(crate::db::Database::new(root.join("data.db").to_str().unwrap()).unwrap());
        Self(root)
    }
    fn db(&self) -> String { self.0.join("data.db").to_str().unwrap().to_string() }
    fn seed(&self, id: &str, access: &str) {
        let bytes = serde_json::to_vec(&serde_json::json!({
            "schema": "desko.codex-accounts", "version": 1,
            "accounts": [{"id":id,"email":"fixture@example.invalid","created_at":1,
                "tokens":{"id_token":"fixture-id-token","access_token":access,"refresh_token":"fixture-refresh"}}]
        })).unwrap();
        accounts::restore_account_backup_at(&self.0.join("codex"), &bytes).unwrap();
    }
    fn sessions(&self) -> Vec<(PathBuf, Vec<u8>)> {
        ["sessions", "archived_sessions", "codex_session_recycle_bin", "usage", "session_index", "logs"]
            .into_iter().map(|name| {
                let path = self.0.join("codex").join(name).join("fixture.jsonl");
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                let bytes = format!("private-local-{name}-marker").into_bytes();
                std::fs::write(&path, &bytes).unwrap(); (path, bytes)
            }).collect()
    }
}
impl Drop for Site { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }

#[test]
fn scheduled_backup_and_migration_export_include_accounts_but_never_sessions() {
    let source = Site::new(); source.seed("account-one", "portable-fixture-access");
    let before = source.sessions();
    let dek = crate::crypto::random_bytes(container::DEK_LEN);
    let wrap = container::Wrap::seal(&dek, "fixture-backup-password").unwrap();
    let backups = backups_dir(&source.0);
    let incremental = create_package(&source.db(), &source.0.join("attachments"), &backups, &dek, &wrap, "test", &|_,_|{}).unwrap();
    let exported = source.0.join("export.dsbk");
    export_package(&source.db(), &source.0.join("attachments"), &exported, &dek, &wrap, "test", &|_,_|{}).unwrap();
    for path in [backups.join(incremental.name), exported] {
        let bytes = container::unpack(&path, &dek).unwrap();
        let archive = zip::ZipArchive::new(std::io::Cursor::new(&bytes)).unwrap();
        assert_eq!(archive.file_names().collect::<Vec<_>>(), ["manifest.json", "data.db", "codex-accounts.json"]);
        let snapshot = container::read_account_snapshot(&bytes).unwrap().unwrap();
        let text = String::from_utf8(snapshot).unwrap();
        assert!(text.contains("portable-fixture-access"));
        for (_, marker) in &before { assert!(!text.contains(std::str::from_utf8(marker).unwrap())); }
        assert!(!text.contains("quota") && !text.contains("last_used") && !text.contains("usage"));
        assert!(!text.contains("secure-account-storage"));
    }
    for (path, bytes) in before { assert_eq!(std::fs::read(path).unwrap(), bytes); }
}

#[test]
fn restoring_accounts_keeps_local_credentials_key_and_all_session_files() {
    let source = Site::new(); source.seed("existing-account", "old-cloud-access"); source.seed("new-account", "restored-access");
    let target = Site::new(); target.seed("existing-account", "fresh-local-access");
    let before = target.sessions();
    let key_path = target.0.join("codex/secure-account-storage.key");
    let key_before = std::fs::read(&key_path).unwrap();
    let dek = crate::crypto::random_bytes(container::DEK_LEN);
    let wrap = container::Wrap::seal(&dek, "fixture-backup-password").unwrap();
    let pkg = source.0.join("migration.dsbk");
    export_package(&source.db(), &source.0.join("attachments"), &pkg, &dek, &wrap, "test", &|_,_|{}).unwrap();
    let staging = staging_dir(&target.0);
    let (_, snapshot) = unpack_to_staging_with_accounts(&pkg, &dek, &staging, &backups_dir(&target.0), &|_,_|{}).unwrap();
    assert!(!staging.join(container::ACCOUNT_ENTRY).exists(), "plaintext credentials must never be staged on disk");
    let mut db = crate::db::Database::new(&target.db()).unwrap();
    db.swap_into_restored_with_accounts(&target.0, &target.0.join("attachments"), &staging, snapshot.as_deref()).unwrap();
    drop(db);
    assert_eq!(std::fs::read(key_path).unwrap(), key_before);
    let restored = String::from_utf8(accounts::export_account_backup_at(&target.0.join("codex")).unwrap()).unwrap();
    assert!(restored.contains("fresh-local-access") && restored.contains("restored-access"));
    assert!(!restored.contains("old-cloud-access"));
    for (path, bytes) in before { assert_eq!(std::fs::read(path).unwrap(), bytes); }
}

#[test]
fn legacy_package_without_accounts_leaves_account_storage_and_sessions_untouched() {
    let target = Site::new(); target.seed("local-account", "fresh-local-access");
    let before = target.sessions();
    let accounts_before = accounts::export_account_backup_at(&target.0.join("codex")).unwrap();
    let staging = staging_dir(&target.0); std::fs::create_dir_all(&staging).unwrap();
    std::fs::copy(target.0.join("data.db"), staging.join("data.db")).unwrap();
    let mut db = crate::db::Database::new(&target.db()).unwrap();
    db.swap_into_restored_with_accounts(&target.0, &target.0.join("attachments"), &staging, None).unwrap();
    drop(db);
    assert_eq!(accounts::export_account_backup_at(&target.0.join("codex")).unwrap(), accounts_before);
    for (path, bytes) in before { assert_eq!(std::fs::read(path).unwrap(), bytes); }
}

#[test]
fn session_changes_do_not_trigger_an_account_backup() {
    let site = Site::new(); site.seed("account-one", "account-only");
    let before = fingerprint(&site.db(), &site.0.join("attachments"));
    site.sessions();
    assert_eq!(fingerprint(&site.db(), &site.0.join("attachments")), before);
    site.seed("account-two", "another-account");
    assert_ne!(fingerprint(&site.db(), &site.0.join("attachments")), before);
}

#[test]
fn pre_restore_safety_export_is_readable_when_sidecars_use_another_key() {
    let site = Site::new();
    let file = "asset__fixture.png";
    std::fs::write(site.0.join("attachments").join(file), b"recoverable-image").unwrap();
    let db = crate::db::Database::new(&site.db()).unwrap();
    crate::services::note_service::create_note(&db, crate::db::CreateNoteInput {
        title: "fixture".into(), content_html: format!("<p><img src=\"attachments/{file}\"></p>"), category: None,
    }).unwrap(); drop(db);
    let original_key = crate::crypto::random_bytes(container::DEK_LEN);
    let original_wrap = container::Wrap::seal(&original_key, "original-backup-password").unwrap();
    let backups = backups_dir(&site.0);
    let incremental = create_package(&site.db(), &site.0.join("attachments"), &backups, &original_key, &original_wrap, "test", &|_,_|{}).unwrap();
    assert_eq!(container::read_external_attachments_manifest(&backups.join(incremental.name), &original_key).unwrap().files.len(), 1);
    let sidecar = backups.join("attachments").join(format!("{file}.enc"));
    let before = std::fs::read(&sidecar).unwrap();
    let imported_key = crate::crypto::random_bytes(container::DEK_LEN);
    let imported_wrap = container::Wrap::seal(&imported_key, "imported-backup-password").unwrap();
    assert!(container::unpack(&sidecar, &imported_key).is_err());
    let safety = backups.join("desko-safety.dsbk");
    export_package(&site.db(), &site.0.join("attachments"), &safety, &imported_key, &imported_wrap, "test", &|_,_|{}).unwrap();
    assert!(container::read_external_attachments_manifest(&safety, &imported_key).unwrap().files.is_empty(), "cloud restore must not fetch absent sidecars for a self-contained package");
    let staging = staging_dir(&site.0);
    unpack_to_staging_with_accounts(&safety, &imported_key, &staging, &backups, &|_,_|{}).unwrap();
    assert_eq!(std::fs::read(staging.join("attachments").join(file)).unwrap(), b"recoverable-image");
    assert_eq!(std::fs::read(sidecar).unwrap(), before);
}

#[test]
fn safety_attachment_inventory_comes_from_the_database_snapshot() {
    let site = Site::new();
    let dek = crate::crypto::random_bytes(container::DEK_LEN);
    let wrap = container::Wrap::seal(&dek, "snapshot-backup-password").unwrap();
    let package = site.0.join("snapshot.dsbk");
    let injected = std::cell::Cell::new(false);
    export_package(&site.db(), &site.0.join("attachments"), &package, &dek, &wrap, "test", &|text, _| {
        if text == "导出库快照" && !injected.replace(true) {
            // Represents an edit arriving after restore began but before SQLite
            // captured its snapshot; its new image must travel with that row.
            std::fs::write(site.0.join("attachments/new__image.png"), b"new-image").unwrap();
            let db = crate::db::Database::new(&site.db()).unwrap();
            crate::services::note_service::create_note(&db, crate::db::CreateNoteInput {
                title: "new note".into(), content_html: "<p><img src=\"attachments/new__image.png\"></p>".into(), category: None,
            }).unwrap();
        }
    }).unwrap();
    let staging = staging_dir(&site.0);
    let (manifest, _) = unpack_to_staging_with_accounts(&package, &dek, &staging, &backups_dir(&site.0), &|_,_|{}).unwrap();
    assert_eq!(manifest.counts.notes, 1);
    assert_eq!(manifest.files.len(), 1);
    assert_eq!(std::fs::read(staging.join("attachments/new__image.png")).unwrap(), b"new-image");
}

#[cfg(windows)]
#[test]
fn failed_account_publication_rolls_back_notes_attachments_and_account_details() {
    use std::os::windows::fs::OpenOptionsExt;
    let source = Site::new(); source.seed("new-account", "portable-new-account");
    let target = Site::new(); target.seed("local-account", "fresh-local-access");
    let sessions = target.sessions();
    let before = accounts::export_account_backup_at(&target.0.join("codex")).unwrap();
    let mut db = crate::db::Database::new(&target.db()).unwrap();
    db.set_meta("restore_marker", "live-original").unwrap();
    std::fs::write(target.0.join("attachments/original.bin"), b"original").unwrap();
    let staging = staging_dir(&target.0);
    std::fs::create_dir_all(staging.join("attachments")).unwrap();
    std::fs::write(staging.join("attachments/restored.bin"), b"restored").unwrap();
    let staged = crate::db::Database::new(staging.join("data.db").to_str().unwrap()).unwrap();
    staged.set_meta("restore_marker", "restored-snapshot").unwrap(); drop(staged);
    // Read sharing lets preflight copy the index; denied delete sharing forces
    // publication to fail after the account directory and database have moved.
    let held = std::fs::OpenOptions::new().read(true).share_mode(1)
        .open(target.0.join("codex/codex_accounts.json")).unwrap();
    let bytes = accounts::export_account_backup_at(&source.0.join("codex")).unwrap();
    assert!(db.swap_into_restored_with_accounts(&target.0, &target.0.join("attachments"), &staging, Some(&bytes)).is_err());
    assert_eq!(db.get_meta("restore_marker").unwrap().as_deref(), Some("live-original"));
    assert!(target.0.join("attachments/original.bin").exists());
    assert!(!target.0.join("attachments/restored.bin").exists());
    assert_eq!(accounts::export_account_backup_at(&target.0.join("codex")).unwrap(), before);
    for (path, bytes) in sessions { assert_eq!(std::fs::read(path).unwrap(), bytes); }
    drop(held); drop(db);
}
