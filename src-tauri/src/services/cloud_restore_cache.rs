use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime};

use crate::error::AppError;

const STALE_AFTER: Duration = Duration::from_secs(7 * 24 * 60 * 60);
static ACTIVE: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

/// Owned by one restore future, including its blocking download workers.
/// Drop removes only this job; another restore's files and the upload spool stay intact.
pub struct RestoreCache {
    root: PathBuf,
}

impl RestoreCache {
    pub fn new(backups: &Path, target: &str) -> Result<Self, AppError> {
        if target.len() != 64 || !target.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(AppError::Backup("恢复缓存目标无效".into()));
        }
        let downloads = backups.join(".downloads");
        ensure_directory(&downloads)?;
        if let Err(error) = prune_stale(&downloads, SystemTime::now()) {
            eprintln!("清理旧恢复缓存失败: {error}");
        }
        let target_dir = downloads.join(target);
        ensure_directory(&target_dir)?;
        let root = target_dir.join(format!("restore-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root)?;
        ACTIVE
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(root.clone());
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

impl Drop for RestoreCache {
    fn drop(&mut self) {
        if let Err(error) = remove_cache_path(&self.root) {
            eprintln!("清理本次恢复缓存失败: {error}");
        }
        ACTIVE
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&self.root);
        if let Some(target) = self.root.parent() {
            let _ = fs::remove_dir(target); // Only succeeds when no other job remains.
            if let Some(downloads) = target.parent() {
                let _ = fs::remove_dir(downloads);
            }
        }
    }
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        } // REPARSE_POINT includes junctions.
    }
    metadata.file_type().is_symlink()
}

fn ensure_directory(path: &Path) -> Result<(), AppError> {
    fs::create_dir_all(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if is_link(&metadata) || !metadata.is_dir() {
        return Err(AppError::Backup("恢复缓存目录不能是链接".into()));
    }
    Ok(())
}

fn remove_cache_path(path: &Path) -> std::io::Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if metadata.is_dir() {
        if !is_link(&metadata) {
            for entry in fs::read_dir(path)? {
                remove_cache_path(&entry?.path())?;
            }
        }
        fs::remove_dir(path)
    } else {
        fs::remove_file(path)
    }
}

/// Reap crash leftovers and legacy target-level caches after seven days.
/// The timestamp argument makes the retention boundary testable without sleeps.
fn prune_stale(downloads: &Path, now: SystemTime) -> std::io::Result<()> {
    for target in fs::read_dir(downloads)? {
        let target = target?;
        let name = target.file_name();
        let name = name.to_string_lossy();
        let metadata = fs::symlink_metadata(target.path())?;
        if name.len() != 64
            || !name.bytes().all(|byte| byte.is_ascii_hexdigit())
            || !metadata.is_dir()
            || is_link(&metadata)
        {
            continue;
        }
        for cached in fs::read_dir(target.path())? {
            let cached = cached?;
            if ACTIVE
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .contains(&cached.path())
            {
                continue;
            }
            let metadata = fs::symlink_metadata(cached.path())?;
            if metadata
                .modified()
                .ok()
                .and_then(|time| now.duration_since(time).ok())
                .is_some_and(|age| age >= STALE_AFTER)
            {
                remove_cache_path(&cached.path())?;
            }
        }
        let _ = fs::remove_dir(target.path());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("desko-restore-cache-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn job_cleanup_preserves_other_jobs_targets_and_upload_spool() {
        let fixture = Fixture::new();
        let first = RestoreCache::new(&fixture.0, &"a".repeat(64)).unwrap();
        let second = RestoreCache::new(&fixture.0, &"a".repeat(64)).unwrap();
        let other = RestoreCache::new(&fixture.0, &"b".repeat(64)).unwrap();
        fs::write(first.root().join("package.dsbk"), b"download").unwrap();
        fs::create_dir(first.root().join("attachments")).unwrap();
        fs::write(first.root().join("attachments/file.enc"), b"encrypted").unwrap();
        let spool = fixture.0.join("desko-20261014-120000.dsbk");
        fs::write(&spool, b"pending-upload").unwrap();
        let first_path = first.root().to_path_buf();
        drop(first);
        assert!(!first_path.exists());
        assert!(second.root().exists() && other.root().exists());
        assert_eq!(fs::read(spool).unwrap(), b"pending-upload");
        drop(second);
        drop(other);
        assert!(!fixture.0.join(".downloads").exists());
    }

    #[test]
    fn stale_crash_and_legacy_caches_expire_without_deleting_recent_jobs() {
        let fixture = Fixture::new();
        let cache = RestoreCache::new(&fixture.0, &"a".repeat(64)).unwrap();
        let downloads = fixture.0.join(".downloads");
        let target = downloads.join("b".repeat(64));
        fs::create_dir_all(target.join("attachments")).unwrap();
        fs::write(target.join("desko-20261014-120000.dsbk"), b"legacy").unwrap();
        fs::write(target.join("attachments/image.enc"), b"legacy").unwrap();
        fs::create_dir(target.join("restore-crash-leftover")).unwrap();
        fs::write(
            target.join("restore-crash-leftover/package.dsbk"),
            b"crash-leftover",
        )
        .unwrap();
        prune_stale(&downloads, SystemTime::now()).unwrap();
        assert!(target.exists() && cache.root().exists());
        prune_stale(
            &downloads,
            SystemTime::now() + STALE_AFTER + Duration::from_secs(1),
        )
        .unwrap();
        assert!(
            !target.exists() && cache.root().exists(),
            "仍有owner的任务不能按mtime淘汰"
        );
        drop(cache);
        assert!(!downloads.exists());
    }

    #[test]
    fn cancelled_outer_owner_keeps_the_cache_until_the_blocking_worker_finishes() {
        let fixture = Fixture::new();
        let cache = std::sync::Arc::new(RestoreCache::new(&fixture.0, &"c".repeat(64)).unwrap());
        let path = cache.root().to_path_buf();
        fs::write(path.join("package.dsbk"), b"worker-input").unwrap();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (resume_tx, resume_rx) = std::sync::mpsc::channel();
        let worker_owner = cache.clone();
        let worker = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            resume_rx.recv().unwrap();
            assert_eq!(
                fs::read(worker_owner.root().join("package.dsbk")).unwrap(),
                b"worker-input"
            );
        });
        started_rx.recv().unwrap();
        drop(cache); // Simulate an aborted command future while spawn_blocking continues.
        assert!(path.exists());
        prune_stale(
            &fixture.0.join(".downloads"),
            SystemTime::now() + STALE_AFTER + Duration::from_secs(1),
        )
        .unwrap();
        assert!(path.exists(), "后台任务仍持有缓存，即使时钟变化也不清理");
        resume_tx.send(()).unwrap();
        worker.join().unwrap();
        assert!(!path.exists());
    }

    #[cfg(windows)]
    #[test]
    fn cleanup_never_follows_a_junction_to_external_data() {
        let fixture = Fixture::new();
        let cache = RestoreCache::new(&fixture.0, &"a".repeat(64)).unwrap();
        let external = fixture.0.join("account-data");
        fs::create_dir(&external).unwrap();
        fs::write(external.join("retained.json"), b"must-stay").unwrap();
        // Root crate has no junction dependency; create a Windows directory junction.
        let status = std::process::Command::new("cmd")
            .args([
                "/C",
                "mklink",
                "/J",
                cache.root().join("linked").to_str().unwrap(),
                external.to_str().unwrap(),
            ])
            .output()
            .unwrap()
            .status;
        assert!(status.success());
        drop(cache);
        assert_eq!(
            fs::read(external.join("retained.json")).unwrap(),
            b"must-stay"
        );
    }
}
