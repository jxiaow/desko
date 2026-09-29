use crate::services::favicon_service;

/// 收藏页按需取 favicon：命中磁盘缓存即回，未命中现抓（阻塞 IO 挪到 spawn_blocking，
/// 不占主线程；4 秒超时最坏也就让那一行晚点到货）。
#[tauri::command]
pub async fn favicon_get(url: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || favicon_service::resolve(&url))
        .await
        .ok()
        .flatten()
}
