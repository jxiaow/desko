// desko 新增：Codex 账号回收站的四条入口（列出 / 恢复 / 彻底删除 / 清空）。
// 模块侧 `codex_account_recycle_bin.rs` 早已随迁移搬入并在写侧生效（remove_accounts 会先 archive），
// 缺的只是这层命令入口。上游第 5 条 `export_codex_recycled_accounts` 把解密后的凭据明文落盘，
// 与 desko「账号导出只到剪贴板」相反，经裁定不接。详见 docs/design/codex/10-account-recycle-bin-port.md。

/// 列出账号留底摘要（不解密任何凭据）；目录还没生成时是空清单，不是错误。
#[tauri::command]
pub async fn list_codex_recycled_accounts(
) -> Result<Vec<codex_account::CodexRecycledAccount>, String> {
    tauri::async_runtime::spawn_blocking(codex_account::list_recycled_accounts)
        .await
        .map_err(|error| format!("读取 Codex 账号留底后台任务失败: {}", error))?
        .map_err(|error| format!("读取账号留底失败: {}", error))
}

/// 把留底原样写回活账号：同 id 已在册时直接拒，不覆盖。
#[tauri::command]
pub async fn restore_codex_recycled_account(recycle_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        codex_account::restore_recycled_account(&recycle_id)
    })
    .await
    .map_err(|error| format!("恢复 Codex 留底账号后台任务失败: {}", error))?
    .map_err(|error| {
        if error.contains("already exists") {
            "这个账号已经在册，留底原样保留".to_string()
        } else {
            format!("恢复留底账号失败: {}", error)
        }
    })
}

/// 彻底删除一条留底；文件本就不存在时按已完成算（幂等）。
#[tauri::command]
pub async fn delete_codex_recycled_account(recycle_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        codex_account::delete_recycled_account(&recycle_id)
    })
    .await
    .map_err(|error| format!("删除 Codex 留底账号后台任务失败: {}", error))?
    .map_err(|error| format!("删除留底账号失败: {}", error))
}

/// 清空：只删用户确认过的那批 id，串行执行、首错即停，
/// 不扫目录一把清——清空期间别处新删的号不该被顺手带走。
#[tauri::command]
pub async fn empty_codex_recycle_bin(recycle_ids: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        for recycle_id in &recycle_ids {
            codex_account::delete_recycled_account(recycle_id)?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|error| format!("清空 Codex 账号留底后台任务失败: {}", error))?
    .map_err(|error| format!("清空账号留底失败: {}", error))
}
