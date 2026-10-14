use super::*;
use std::sync::{Barrier, MutexGuard};

struct Store {
    root: PathBuf,
    previous: Option<std::ffi::OsString>,
    _environment: MutexGuard<'static, ()>,
}

impl Store {
    fn new() -> Self {
        let environment = crate::modules::test_support::env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let root =
            std::env::temp_dir().join(format!("desko-index-concurrency-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let previous = std::env::var_os("COCKPIT_TOOLS_TEST_DATA_DIR");
        std::env::set_var("COCKPIT_TOOLS_TEST_DATA_DIR", &root);
        Self {
            root,
            previous,
            _environment: environment,
        }
    }
}

impl Drop for Store {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
        match &self.previous {
            Some(value) => std::env::set_var("COCKPIT_TOOLS_TEST_DATA_DIR", value),
            None => std::env::remove_var("COCKPIT_TOOLS_TEST_DATA_DIR"),
        }
    }
}

fn api(id: usize) -> CodexAccount {
    upsert_api_key_account(
        format!("sk-synthetic-index-test-{id}"),
        None,
        None,
        None,
        None,
        vec![],
        None,
        None,
        false,
        false,
        HashMap::new(),
        None,
        None,
        None,
    )
    .unwrap()
}

#[test]
fn concurrent_upserts_keep_every_account_in_the_index() {
    let _store = Store::new();
    let barrier = Arc::new(Barrier::new(20));
    let threads: Vec<_> = (0..20)
        .map(|id| {
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                api(id).id
            })
        })
        .collect();
    let expected: HashSet<_> = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    let index = load_account_index();
    assert_eq!(
        index
            .accounts
            .iter()
            .map(|a| a.id.clone())
            .collect::<HashSet<_>>(),
        expected
    );
    assert_eq!(list_accounts_checked().unwrap().len(), 20);
}

#[test]
fn concurrent_delete_plan_current_and_pending_creation_do_not_lose_or_resurrect_ids() {
    let _store = Store::new();
    let keep = api(1).id;
    let remove = api(2).id;
    let barrier = Arc::new(Barrier::new(4));
    std::thread::scope(|scope| {
        let start = barrier.clone();
        let kept_id = keep.clone();
        scope.spawn(move || {
            start.wait();
            for _ in 0..12 {
                update_account_plan_type_in_index(&kept_id, &Some("plus".into()), &None).unwrap();
            }
        });
        let start = barrier.clone();
        let kept_id = keep.clone();
        scope.spawn(move || {
            start.wait();
            for _ in 0..12 {
                record_current_account(&kept_id).unwrap();
            }
        });
        let start = barrier.clone();
        let removed_id = remove.clone();
        scope.spawn(move || {
            start.wait();
            remove_account(&removed_id).unwrap();
        });
        let start = barrier.clone();
        scope.spawn(move || {
            start.wait();
            for id in 0..12 {
                create_pending_oauth_account(
                    format!("pending-{id}@example.invalid"),
                    Default::default(),
                )
                .unwrap();
            }
        });
    });
    let index = load_account_index();
    assert_eq!(index.accounts.len(), 13);
    assert!(index.accounts.iter().all(|a| a.id != remove));
    assert_eq!(index.current_account_id.as_deref(), Some(keep.as_str()));
    assert_eq!(index.accounts.iter().find(|a| a.id == keep).unwrap().plan_type.as_deref(), Some("plus"));
    assert_eq!(list_accounts_checked().unwrap().len(), 13);
}

#[test]
fn unchecked_reads_never_rewrite_summaries_or_repair_a_missing_index() {
    let store = Store::new();
    let mut account = api(1);
    let path = store.root.join("codex_accounts.json");
    let original = fs::read(&path).unwrap();
    account.last_used += 100;
    save_account(&account).unwrap();
    assert_eq!(list_accounts()[0].last_used, account.last_used);
    assert_eq!(fs::read(&path).unwrap(), original);
    fs::remove_file(&path).unwrap();
    assert!(load_account_index().accounts.is_empty());
    assert!(list_accounts().is_empty());
    assert!(!path.exists());
    assert_eq!(list_accounts_checked().unwrap().len(), 1);
    assert!(path.exists());
}

#[test]
fn account_backup_merge_and_import_keep_both_new_accounts() {
    let store = Store::new();
    let seed = api(1);
    let mut snapshot: serde_json::Value = serde_json::from_slice(
        &crate::modules::codex_account_backup::export_account_backup_at(&store.root).unwrap(),
    )
    .unwrap();
    snapshot["accounts"][0]["id"] = serde_json::Value::from("restored-account");
    let bytes = serde_json::to_vec(&snapshot).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    std::thread::scope(|scope| {
        let start = barrier.clone();
        let root = &store.root;
        scope.spawn(move || {
            start.wait();
            assert_eq!(
                crate::modules::codex_account_backup::restore_account_backup_at(root, &bytes)
                    .unwrap(),
                1
            );
        });
        scope.spawn(move || {
            barrier.wait();
            api(2);
        });
    });
    let index = load_account_index();
    assert_eq!(index.accounts.len(), 3);
    assert!(index.accounts.iter().any(|a| a.id == seed.id));
    assert!(index.accounts.iter().any(|a| a.id == "restored-account"));
}
