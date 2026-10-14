use std::collections::HashMap;
use std::future::Future;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::oneshot;

use crate::error::AppError;

pub const CANCELLED: &str = "__bypass_probe_cancelled__";

#[derive(Default)]
struct Jobs {
    active: HashMap<String, oneshot::Sender<()>>,
    // IPC 的取消可能先于探测注册到达，短暂记住它，避免重新开始已取消的任务。
    cancelled: HashMap<String, Instant>,
}

fn jobs() -> &'static Mutex<Jobs> {
    static JOBS: OnceLock<Mutex<Jobs>> = OnceLock::new();
    JOBS.get_or_init(Default::default)
}

fn cancelled_error() -> AppError { AppError::Bypass(CANCELLED.into()) }

struct Registration(String);

impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut jobs) = jobs().lock() { jobs.active.remove(&self.0); }
    }
}

fn register(id: String) -> Result<(Registration, oneshot::Receiver<()>), AppError> {
    if id.is_empty() || id.len() > 128 {
        return Err(AppError::Bypass("探测任务标识不合法".into()));
    }
    let mut jobs = jobs().lock().map_err(|_| AppError::Bypass("探测任务状态无法读取".into()))?;
    jobs.cancelled.retain(|_, at| at.elapsed() < Duration::from_secs(60));
    if jobs.cancelled.remove(&id).is_some() { return Err(cancelled_error()); }
    if jobs.active.contains_key(&id) { return Err(AppError::Bypass("探测任务已在运行".into())); }
    let (sender, receiver) = oneshot::channel();
    jobs.active.insert(id.clone(), sender);
    Ok((Registration(id), receiver))
}

pub fn cancel(id: &str) -> Result<(), AppError> {
    if id.is_empty() || id.len() > 128 {
        return Err(AppError::Bypass("探测任务标识不合法".into()));
    }
    let mut jobs = jobs().lock().map_err(|_| AppError::Bypass("探测任务状态无法读取".into()))?;
    if let Some(sender) = jobs.active.remove(id) {
        let _ = sender.send(());
    } else {
        jobs.cancelled.retain(|_, at| at.elapsed() < Duration::from_secs(60));
        if jobs.cancelled.len() >= 256 {
            if let Some(oldest) = jobs.cancelled.iter().min_by_key(|(_, at)| **at).map(|(id, _)| id.clone()) {
                jobs.cancelled.remove(&oldest);
            }
        }
        jobs.cancelled.insert(id.into(), Instant::now());
    }
    Ok(())
}

/// 取消分支会丢弃整个异步探测 future，终止在途连接和后续候选，调用方不再缓存或写库。
pub async fn run<T>(id: Option<String>, work: impl Future<Output = Result<T, String>>) -> Result<T, AppError> {
    let Some(id) = id else { return work.await.map_err(AppError::Bypass); };
    let (_registration, cancelled) = register(id)?;
    tokio::select! {
        biased;
        _ = cancelled => Err(cancelled_error()),
        result = work => result.map_err(AppError::Bypass),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, atomic::{AtomicBool, Ordering}};

    struct Dropped(Arc<AtomicBool>);
    impl Drop for Dropped { fn drop(&mut self) { self.0.store(true, Ordering::SeqCst); } }

    #[tokio::test]
    async fn cancelling_drops_the_running_future_and_cleans_the_registry() {
        let id = uuid::Uuid::new_v4().to_string();
        let dropped = Arc::new(AtomicBool::new(false));
        let (started, ready) = oneshot::channel();
        let flag = dropped.clone();
        let job_id = id.clone();
        let job = tokio::spawn(run(Some(job_id), async move {
            let _guard = Dropped(flag);
            let _ = started.send(());
            std::future::pending::<Result<(), String>>().await
        }));
        ready.await.unwrap();
        cancel(&id).unwrap();
        let result = tokio::time::timeout(Duration::from_secs(1), job).await.unwrap().unwrap();
        assert!(matches!(result, Err(AppError::Bypass(message)) if message == CANCELLED));
        assert!(dropped.load(Ordering::SeqCst));
        assert!(!jobs().lock().unwrap().active.contains_key(&id));
    }

    #[tokio::test]
    async fn cancellation_before_registration_does_not_start_the_probe() {
        let id = uuid::Uuid::new_v4().to_string();
        cancel(&id).unwrap();
        let entered = Arc::new(AtomicBool::new(false));
        let flag = entered.clone();
        let result = run(Some(id), async move { flag.store(true, Ordering::SeqCst); Ok(()) }).await;
        assert!(result.is_err());
        assert!(!entered.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn cancellation_is_scoped_to_the_requested_probe() {
        let id = uuid::Uuid::new_v4().to_string();
        cancel(&id).unwrap();
        let other = run(Some(uuid::Uuid::new_v4().to_string()), async { Ok(42) }).await.unwrap();
        assert_eq!(other, 42);
        assert!(run(Some(id), async { Ok(0) }).await.is_err());
    }
}
