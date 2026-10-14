fn primary_trash_rollout_path(entry: &TrashedSessionEntry) -> PathBuf {
    entry
        .entry_dir
        .join("files")
        .join(&entry.manifest.relative_rollout_path)
}

fn legacy_trash_fixture(
    label: &str,
) -> (
    PathBuf,
    CodexSyncInstance,
    TrashedSessionEntry,
    PathBuf,
    PathBuf,
) {
    let (root, instance, batch) = trash_fixture(label);
    let first = instance.data_dir.join("sessions/2026/rollout-a.jsonl");
    let second = instance.data_dir.join("archived_sessions/rollout-b.jsonl");
    write_rollout(&first, "shared-session", "FIRST_VERSION");
    write_rollout(&second, "shared-session", "SECOND_VERSION");
    let snapshots = load_thread_snapshots(&instance).unwrap();
    let snapshot = snapshots
        .iter()
        .find(|item| item.rollout_path == first)
        .unwrap();
    move_snapshot_rollout_to_trash(&instance, &batch, snapshot).unwrap();
    let entry = load_trash_entries_from_root(&root.join(SESSION_TRASH_ROOT_DIR))
        .unwrap()
        .remove(0);
    let legacy_second = entry
        .entry_dir
        .join("files/archived_sessions/rollout-b.jsonl");
    fs::create_dir_all(legacy_second.parent().unwrap()).unwrap();
    move_rollout_without_replacing(&second, &legacy_second).unwrap();
    (root, instance, entry, first, second)
}

#[test]
fn legacy_shared_manifest_restores_every_rollout_and_preserves_index_lines() {
    let (root, instance, entry, first, second) = legacy_trash_fixture("legacy-group-restore");
    let index = instance.data_dir.join(SESSION_INDEX_FILE);
    let original = "{\"id\":\"other-session\",\"thread_name\":\"unrelated\"}\nbroken-line\n";
    fs::write(&index, original).unwrap();
    restore_trashed_session_entry(&entry).unwrap();
    assert!(fs::read_to_string(first).unwrap().contains("FIRST_VERSION"));
    assert!(fs::read_to_string(second)
        .unwrap()
        .contains("SECOND_VERSION"));
    assert!(fs::read_to_string(&index).unwrap().starts_with(original));
    assert!(read_session_index_map(&instance.data_dir)
        .unwrap()
        .contains_key("shared-session"));
    assert!(!entry.entry_dir.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn restore_keeps_the_index_file_for_a_concurrent_codex_append_writer() {
    let (root, instance, entry, _first, _second) = legacy_trash_fixture("legacy-index-live-writer");
    let index = instance.data_dir.join(SESSION_INDEX_FILE);
    fs::write(&index, "{\"id\":\"existing\"}\n").unwrap();
    let mut writer = fs::OpenOptions::new().append(true).open(&index).unwrap();
    restore_trashed_session_entry(&entry).unwrap();
    writer
        .write_all(b"{\"id\":\"arrived-from-codex\"}\n")
        .unwrap();
    writer.sync_all().unwrap();
    drop(writer);
    let entries = read_session_index_map(&instance.data_dir).unwrap();
    assert!(entries.contains_key("existing"));
    assert!(entries.contains_key("shared-session"));
    assert!(entries.contains_key("arrived-from-codex"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn missing_files_directory_does_not_hide_other_valid_trash_entries() {
    let (root, _instance, entry, _first, _second) = legacy_trash_fixture("legacy-missing-files");
    let broken = entry.entry_dir.parent().unwrap().join("broken-entry");
    fs::create_dir(&broken).unwrap();
    fs::copy(
        entry.entry_dir.join("manifest.json"),
        broken.join("manifest.json"),
    )
    .unwrap();
    let entries = load_trash_entries_from_root(&root.join(SESSION_TRASH_ROOT_DIR)).unwrap();
    assert_eq!(entries.len(), 1);
    restore_trashed_session_entry(&entries[0]).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn legacy_group_conflict_preserves_all_copies_and_retry_restores_them() {
    let (root, _instance, entry, first, second) = legacy_trash_fixture("legacy-group-conflict");
    write_rollout(&second, "shared-session", "CURRENT_VERSION");
    assert!(restore_trashed_session_entry(&entry).is_err());
    assert!(!first.exists());
    assert_eq!(
        list_trash_restore_files(&entry.entry_dir.join("files"))
            .unwrap()
            .len(),
        2
    );
    assert!(fs::read_to_string(&second)
        .unwrap()
        .contains("CURRENT_VERSION"));
    fs::remove_file(&second).unwrap();
    restore_trashed_session_entry(&entry).unwrap();
    assert!(fs::read_to_string(first).unwrap().contains("FIRST_VERSION"));
    assert!(fs::read_to_string(second)
        .unwrap()
        .contains("SECOND_VERSION"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn legacy_primary_already_recovered_does_not_hide_remaining_rollouts() {
    let (root, _instance, entry, first, second) = legacy_trash_fixture("legacy-partial-restore");
    move_rollout_without_replacing(&primary_trash_rollout_path(&entry), &first).unwrap();
    let reloaded = load_trash_entries_from_root(&root.join(SESSION_TRASH_ROOT_DIR)).unwrap();
    assert_eq!(reloaded.len(), 1);
    restore_trashed_session_entry(&reloaded[0]).unwrap();
    assert!(fs::read_to_string(first).unwrap().contains("FIRST_VERSION"));
    assert!(fs::read_to_string(second)
        .unwrap()
        .contains("SECOND_VERSION"));
    assert!(!entry.entry_dir.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn recovery_preserves_unrecognized_files_and_rejects_mismatched_sessions() {
    let (root, _instance, entry, first, _second) = legacy_trash_fixture("legacy-unknown-files");
    let extra = entry.entry_dir.join("files/recovery-note.txt");
    fs::write(&extra, "retained").unwrap();
    let wrong = entry.entry_dir.join("files/rollout-other.jsonl");
    write_rollout(&wrong, "other-session", "WRONG_SESSION");
    assert!(restore_trashed_session_entry(&entry).is_err());
    assert!(!first.exists());
    assert_eq!(fs::read_to_string(&extra).unwrap(), "retained");
    fs::remove_file(wrong).unwrap();
    restore_trashed_session_entry(&entry).unwrap();
    assert_eq!(fs::read_to_string(extra).unwrap(), "retained");
    assert!(
        load_trash_entries_from_root(&root.join(SESSION_TRASH_ROOT_DIR))
            .unwrap()
            .is_empty()
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn restore_recreates_a_removed_instance_and_rejects_manifest_traversal() {
    let (root, instance, mut entry, first, second) = legacy_trash_fixture("legacy-root-removed");
    fs::remove_dir_all(&instance.data_dir).unwrap();
    let relative = entry.manifest.relative_rollout_path.clone();
    entry.manifest.relative_rollout_path = "../rollout-a.jsonl".into();
    assert!(restore_trashed_session_entry(&entry).is_err());
    assert!(!instance.data_dir.exists());
    entry.manifest.relative_rollout_path = relative;
    restore_trashed_session_entry(&entry).unwrap();
    assert!(fs::read_to_string(first).unwrap().contains("FIRST_VERSION"));
    assert!(fs::read_to_string(second)
        .unwrap()
        .contains("SECOND_VERSION"));
    fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
#[test]
fn locked_group_member_rolls_back_prior_moves_and_allows_retry() {
    use std::os::windows::fs::OpenOptionsExt;
    let (root, _instance, entry, first, second) = legacy_trash_fixture("legacy-group-rollback");
    let locked = primary_trash_rollout_path(&entry).clone(); // sessions/ sorts after archived_sessions/
    let writer = fs::OpenOptions::new()
        .append(true)
        .share_mode(3)
        .open(&locked)
        .unwrap();
    assert!(restore_trashed_session_entry(&entry).is_err());
    assert!(!first.exists());
    assert!(!second.exists());
    assert_eq!(
        list_trash_restore_files(&entry.entry_dir.join("files"))
            .unwrap()
            .len(),
        2
    );
    drop(writer);
    restore_trashed_session_entry(&entry).unwrap();
    assert!(first.exists() && second.exists());
    fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
#[test]
fn index_append_failure_rolls_back_every_rollout() {
    use std::os::windows::fs::OpenOptionsExt;
    let (root, instance, entry, first, second) = legacy_trash_fixture("legacy-index-rollback");
    let index = instance.data_dir.join(SESSION_INDEX_FILE);
    fs::write(&index, "{\"id\":\"other\"}\n").unwrap();
    let reader = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&index)
        .unwrap();
    assert!(restore_trashed_session_entry(&entry).is_err());
    assert!(!first.exists() && !second.exists());
    assert_eq!(
        list_trash_restore_files(&entry.entry_dir.join("files"))
            .unwrap()
            .len(),
        2
    );
    assert_eq!(fs::read_to_string(&index).unwrap(), "{\"id\":\"other\"}\n");
    drop(reader);
    restore_trashed_session_entry(&entry).unwrap();
    assert!(first.exists() && second.exists());
    fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
#[test]
fn restore_rejects_a_junction_to_external_rollouts() {
    let (root, instance, entry, first, _second) = legacy_trash_fixture("legacy-junction");
    let files = entry.entry_dir.join("files");
    let outside = root.join("external");
    fs::rename(&files, &outside).unwrap();
    junction::create(&outside, &files).unwrap();
    assert!(
        load_trash_entries_from_root(&root.join(SESSION_TRASH_ROOT_DIR))
            .unwrap()
            .is_empty()
    );
    assert!(restore_trashed_session_entry(&entry).is_err());
    assert!(!first.exists());
    assert_eq!(list_rollout_files(&outside).unwrap().len(), 2);
    assert!(!instance
        .data_dir
        .join("archived_sessions/rollout-b.jsonl")
        .exists());
    junction::delete(files).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
#[test]
fn restore_rejects_an_entry_junction_and_keeps_external_files() {
    let (root, _instance, entry, first, _second) = legacy_trash_fixture("legacy-entry-junction");
    let outside = root.join("external-entry");
    fs::rename(&entry.entry_dir, &outside).unwrap();
    junction::create(&outside, &entry.entry_dir).unwrap();
    assert!(
        load_trash_entries_from_root(&root.join(SESSION_TRASH_ROOT_DIR))
            .unwrap()
            .is_empty()
    );
    assert!(restore_trashed_session_entry(&entry).is_err());
    assert!(!first.exists());
    assert_eq!(list_rollout_files(&outside.join("files")).unwrap().len(), 2);
    junction::delete(&entry.entry_dir).unwrap();
    fs::remove_dir_all(root).unwrap();
}
