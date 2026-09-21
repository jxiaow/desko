use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::backup::{self, container::Wrap, PackageInfo};
use crate::db::Database;
use crate::error::AppError;
use crate::services::{attachment_service, backup_service, cloud_service};
use crate::AppState;

/// 定时备份间隔（分钟），0 = 关
pub const META_INTERVAL: &str = "auto_backup_interval";
/// 实时备份：写入平息 8 秒后立即补一轮，默认关
pub const META_REALTIME: &str = "auto_backup_realtime";

pub const DEFAULT_INTERVAL_MIN: i64 = 5;

pub fn interval_min(db: &Database) -> i64 {
    db.get_meta(META_INTERVAL)
        .ok()
        .flatten()
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|v| (0..=1440).contains(v))
        .unwrap_or(DEFAULT_INTERVAL_MIN)
}

pub fn realtime_on(db: &Database) -> bool {
    db.get_meta(META_REALTIME)
        .ok()
        .flatten()
        .as_deref()
        == Some("true")
}

/// 同一时刻只允许一个备份任务：手动、退出、定时三条路都从这里排队。
/// 备份要读库打包，叠第二个只会让两个都变慢，还可能同时轮转把包删重了。
pub struct BusyGuard<'a>(&'a AppState);

impl<'a> BusyGuard<'a> {
    pub fn try_acquire(state: &'a AppState) -> Option<Self> {
        state
            .backup_busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| Self(state))
    }
}

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.backup_busy.store(false, Ordering::SeqCst);
    }
}

/// 一次备份要用的东西，全部取成 owned：备份本体在后台线程跑，不能借任何锁
pub struct Job {
    pub db_path: String,
    pub attachments: PathBuf,
    pub backups: PathBuf,
    pub dek: Vec<u8>,
    pub wrap: Wrap,
    pub keep: i64,
    master: Vec<u8>,
}

impl Job {
    /// 取参数。没解锁、没设备份密码都算「这轮不跑」而不是错误 —— 定时器每秒都可能撞上锁屏。
    pub fn prepare(app: &AppHandle, state: &AppState) -> Result<Option<Job>, AppError> {
        let master = {
            let m = state
                .master_key
                .lock()
                .map_err(|_| AppError::Database("lock error".to_string()))?;
            match m.as_ref() {
                Some(k) => k.clone(),
                None => return Ok(None),
            }
        };
        let wrap = {
            let db = state
                .db
                .lock()
                .map_err(|_| AppError::Database("lock error".to_string()))?;
            match backup_service::current_wrap(&db) {
                Ok(w) => w,
                Err(_) => return Ok(None), // 还没设备份密码
            }
        };
        let dek = {
            let mut cached = state
                .backup_key
                .lock()
                .map_err(|_| AppError::Database("lock error".to_string()))?;
            if let Some(k) = cached.as_ref() {
                k.clone()
            } else {
                let db = state
                    .db
                    .lock()
                    .map_err(|_| AppError::Database("lock error".to_string()))?;
                let k = backup_service::unwrap_backup_key(&db, &master)?
                    .ok_or_else(|| AppError::Backup("尚未设置备份密码".to_string()))?;
                *cached = Some(k.clone());
                k
            }
        };
        let (db_path, keep) = {
            let db = state
                .db
                .lock()
                .map_err(|_| AppError::Database("lock error".to_string()))?;
            (db.get_db_path(), backup_service::keep_local(&db))
        };
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::Io(e.to_string()))?;
        Ok(Some(Job {
            db_path,
            attachments: attachment_service::attachments_dir(),
            backups: backup::backups_dir(&data_dir),
            dek,
            wrap,
            keep,
            master,
        }))
    }

    /// 打本地包 + 轮转。云端上传是另一件事（run_round 里按节流决定）
    pub fn package(&self, progress: &dyn Fn(&str, u8)) -> Result<PackageInfo, AppError> {
        let info = backup::create_package(
            &self.db_path,
            &self.attachments,
            &self.backups,
            &self.dek,
            &self.wrap,
            env!("CARGO_PKG_VERSION"),
            progress,
        )?;
        backup::rotate(&self.backups, self.keep as usize);
        Ok(info)
    }
}

/// 备份后的云端捎带：没开自动同步或没配置就是空话，失败原因回给调用方
pub fn sync_cloud(state: &AppState, job: &Job, progress: &dyn Fn(&str, u8)) -> Option<String> {
    let auto = {
        let db = state.db.lock().ok()?;
        db.get_meta(cloud_service::META_AUTO)
            .ok()
            .flatten()
            .map(|v| v == "true")
            .unwrap_or(false)
    };
    if !auto {
        return None;
    }
    let (cfg, record, keep_remote) = {
        let db = state.db.lock().ok()?;
        (
            cloud_service::load_cfg(&db, &job.master).ok().flatten(),
            cloud_service::load_state(&job.backups),
            cloud_service::keep_remote(&db),
        )
    };
    let Some(cfg) = cfg else { return None };
    match cloud_service::sync_core(&cfg, &record, keep_remote, &job.backups, progress) {
        Ok(new_state) => {
            if let Err(e) = cloud_service::write_state(&job.backups, &new_state) {
                return Some(e.to_string());
            }
            None
        }
        Err(e) => Some(e.to_string()),
    }
}


/// 线程自己的状态：上一次成功备份时的数据指纹。
/// 放 sidecar 而不是放库 —— 写库等于"备份自己改动了 data.db"，下一轮就会判定
/// "用户改过数据"，于是再打一个包，自己追自己。
const WATCH_FILE: &str = ".watch-state.json";

#[derive(Serialize, serde::Deserialize, Default)]
struct Watch {
    /// 上次成功备份时的指纹。重启后拿它当基线，数据没动就不会白跑一轮。
    fingerprint: String,
}

pub fn watch_path(backups: &Path) -> PathBuf {
    backups.join(WATCH_FILE)
}

fn read_watch(backups: &Path) -> Watch {
    std::fs::read(watch_path(backups))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_watch(backups: &Path, w: &Watch) {
    if let Ok(json) = serde_json::to_vec(w) {
        let p = watch_path(backups);
        let tmp = p.with_extension("json.tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, &p);
        }
    }
}

const NORMAL_POLL: Duration = Duration::from_secs(20);
const REALTIME_POLL: Duration = Duration::from_secs(2);
/// 与官方插件一致：最后一次写入平息 8 秒才动手，避免边打字边打包
const QUIET: Duration = Duration::from_secs(8);
/// 两轮之间的最小间隔。定时间隔最小就是 1 分钟，所以这条实际只掐实时那一档：
/// 持续写作时最多一分钟打一个包、一次上云，而不是停手一次一个。
const ROUND_FLOOR: Duration = Duration::from_secs(60);
/// 本地有没传上云的东西 —— 查它要扫两遍目录，别每个 tick 都扫
const DEBT_CHECK: Duration = Duration::from_secs(30);

/// 后台自动备份线程：一轮 = 打包 + （开了自动同步就）上云。
/// 「有没有变更」看的是库与附件目录的 mtime/大小指纹，基线存在 sidecar 里。
pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_fp: Option<String> = None;
        let mut dirty = false;
        let mut settled = Instant::now();
        let mut last_run: Option<Instant> = None;
        let mut last_debt = Instant::now();
        let mut has_debt = false;
        loop {
            let Cfg {
                interval,
                realtime,
                auto_sync,
            } = read_cfg(&app);
            std::thread::sleep(if realtime { REALTIME_POLL } else { NORMAL_POLL });
            if interval == 0 && !realtime {
                continue;
            }
            let Some((db_path, attachments, backups)) = paths(&app) else { continue };

            let fp = backup::fingerprint(&db_path, &attachments);
            let baseline = last_fp
                .clone()
                .unwrap_or_else(|| read_watch(&backups).fingerprint);
            if fp != baseline {
                last_fp = Some(fp);
                dirty = true;
                settled = Instant::now();
            } else {
                last_fp = Some(fp);
            }

            // 上一轮传云端失败了、或者本地还有没进记录的包/附件：算欠账，得补
            if auto_sync && (has_debt || last_debt.elapsed() >= DEBT_CHECK) {
                last_debt = Instant::now();
                has_debt = cloud_service::has_pending_upload(&backups);
            }
            if !dirty && !has_debt {
                continue;
            }

            let due_timer = interval > 0
                && last_run
                    .map(|t| t.elapsed() >= Duration::from_secs(interval as u64 * 60))
                    .unwrap_or(true);
            // 静默期只认真变更：欠账重传走定时那一档就够了
            let due_now = realtime && dirty && settled.elapsed() >= QUIET;
            if !(due_timer || due_now) {
                continue;
            }
            if last_run.map(|t| t.elapsed() < ROUND_FLOOR).unwrap_or(false) {
                continue;
            }

            match run_round(&app, dirty) {
                Ok(true) => {
                    last_run = Some(Instant::now());
                    if dirty {
                        dirty = false;
                        // 打包会碰库（WAL checkpoint），基线必须跑完之后重取，
                        // 否则下一轮把"自己干的活"当成用户改过数据
                        let after = backup::fingerprint(&db_path, &attachments);
                        write_watch(&backups, &Watch { fingerprint: after.clone() });
                        last_fp = Some(after);
                    }
                }
                // 跑失败也别立刻重试，等下一个周期；欠账标记会让它下一轮补上云
                Err(e) => {
                    eprintln!("auto backup round failed: {}", e);
                    last_run = Some(Instant::now());
                }
                Ok(false) => {}
            }
        }
    });
}

struct Cfg {
    interval: i64,
    realtime: bool,
    auto_sync: bool,
}

fn read_cfg(app: &AppHandle) -> Cfg {
    let state = app.state::<AppState>();
    let Ok(db) = state.db.lock() else {
        return Cfg { interval: 0, realtime: false, auto_sync: false };
    };
    Cfg {
        interval: interval_min(&db),
        realtime: realtime_on(&db),
        auto_sync: db
            .get_meta(cloud_service::META_AUTO)
            .ok()
            .flatten()
            .map(|v| v == "true")
            .unwrap_or(false),
    }
}

fn paths(app: &AppHandle) -> Option<(String, PathBuf, PathBuf)> {
    let state = app.state::<AppState>();
    let db = state.db.lock().ok()?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::Io("no app data dir".to_string()))
        .ok()?;
    Some((
        db.get_db_path(),
        attachment_service::attachments_dir(),
        backup::backups_dir(&data_dir),
    ))
}

/// 跑一轮。package=false 时只补上云（欠账重传），不再打新包。
/// 返回 true = 真的做了事；false = 这轮跳过（锁屏/没密码/已有任务在跑）
fn run_round(app: &AppHandle, package: bool) -> Result<bool, AppError> {
    let state = app.state::<AppState>();
    let Some(_guard) = BusyGuard::try_acquire(&state) else {
        return Ok(false);
    };
    let Some(job) = Job::prepare(app, &state)? else {
        return Ok(false);
    };
    if package {
        let info = job.package(&|_, _| {})?;
        let _ = app.emit("auto-backup", info);
    }
    if let Some(err) = sync_cloud(&state, &job, &|_, _| {}) {
        // 释放版没有控制台，光 eprintln 等于把失败吞了：抛给界面，下一轮还会补传
        eprintln!("auto cloud sync failed: {}", err);
        let _ = app.emit("auto-backup-note", err);
    }
    Ok(true)
}
