// 裁剪占位：原 codex_official_app_server 模块承载官方 app-server 线程元数据重建等能力，
// 属已移除域；这里只保留被会话可见性修复引用到的签名。
// 该函数仅被 deep 修复路径调用（quick 的 rebuild_metadata 为 false），调用方只记日志并返回 bool，不传播 `?`。
use std::path::Path;

pub fn rebuild_thread_metadata(_codex_home: &Path) -> Result<(), String> {
    Err(String::from("该能力已在裁剪版中移除"))
}
