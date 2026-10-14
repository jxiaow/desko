# Codex 账号与会话移植核验（2026-10-13）

## 对照范围

来源：[jlcodes99/cockpit-tools](https://github.com/jlcodes99/cockpit-tools/tree/be24ce6171279741c2cd141bc02bd9f380f4b67c)，移植基线 `be24ce6171279741c2cd141bc02bd9f380f4b67c`，上游 Rust 版本 `1.3.66`。
使用该提交的 Git 对象导出独立快照，未使用已经被裁剪脚本修改的上游工作树。此记录不宣称覆盖上游随后新增的全部能力。

用户本轮确认保留精简范围，随后排除模型配置。因此本轮仅补账号、会话与页面展示；API 网关、代理、多实例、唤醒、SSH、临时登录、模型配置不恢复。既有“不要自动切号”的决定继续有效。

## 结论与证据

账号与会话的主要 Rust 实现已经落地，不能根据页面入口少就认定后端没有移植。此次确认的缺口主要是前端可达性与解锁周期中的状态清理。

| 功能 | 上游入口或实现 | Desko 落点 | 本轮结论 |
| --- | --- | --- | --- |
| OAuth、设备码、回调与重新授权 | `commands/codex_account_commands.rs`、`modules/codex_oauth.rs` | 同名 Rust 模块、`CodexAuthDialog.vue` | 已接；OAuth 模块去除行尾差异后与基线一致 |
| API Key 新增与换凭据 | `add_codex_account_with_api_key`、`update_codex_api_key_credentials` | 同名命令、添加/编辑弹窗 | 已接；修复只改地址时前端静默忽略的问题 |
| Access Token 与 Token 组合导入 | `import_codex_access_token_account`、`add_codex_account_with_token` | 同名命令早已注册，原来没有 UI 调用 | 已补导入面折叠入口；沿用原协议与 Rust 实现 |
| 本机、文件、JSON 导入与导出 | `codex_account_import.rs` | 同名 Rust 分片、添加面与批量 dock | 已接；沿用此前无两段式导入预览的决定 |
| 账号资料、标签、备注 | `codex_account_mutations_quota.rs` | 编辑弹窗、账号行 | 已接；新增列表搜索、标签/类型/状态筛选、配额/最近使用/名称排序 |
| 配额、订阅、令牌刷新与主动重置 | `codex_quota.rs`、账号命令 | 账号行、菜单、`ResetCreditDialog.vue` | 已接；配额模块去除行尾差异后与基线一致 |
| 手动切号与会话可见性收尾 | `codex_account_projection.rs`、切号命令、visibility 模块 | `codexState.switchTo` | 已接；凭据投影模块与基线一致；取消按钮现在只给真实切号显示 |
| 删除、批量删除与账号回收站 | account lifecycle/recycle、batch delete 命令 | 删除作业弹窗、`CodexTrashPanel.vue` | 已接，保留此前的加密留底与暂停/续跑语义 |
| 会话目录、项目分组与累计 Token | `codex_session_manager.rs`、`codex_session_display.rs` | 单默认目录切片、`CodexSessionsPanel.vue` | 已接；17 项原生会话测试验证读取、统计与回收 |
| 会话正文搜索 | `list_sessions_across_instances(title_query, content_query)` | Rust 原有搜索与缓存已存在，前端一直传 `contentQuery: null` | 已补标题/正文切换与关键词保留，不增加新扫描实现 |
| 会话移入回收站、恢复与打开文件 | session manager / commands | 会话面、回收站面 | 已接；先留底再改官方目录、原样恢复的原生测试通过 |
| 用量窗口与按日/模型统计 | 上游 session usage；Desko 的 manager 读侧切片 | `CodexUsagePanel.vue`、本地 rollout 差分聚合 | 已接；保持即时聚合、没有另建上游缓存库的既有差异 |
| 锁屏与迟到的异步结果 | Desko 自己的生命周期 | `clearCodexSession`、各读侧、Token 弹窗 | 修复锁屏仍保留会话/统计/留底缓存，以及迟到导入结果显示邮箱的问题 |

账号协议路径没有因 UI 优化而重写。静态核验中 `codex_oauth.rs`、`codex_quota.rs`、`codex_account_projection.rs`、`codex_account_api_key_edit.rs` 与基线去除行尾差异后相同。
Token 刷新、导入和回收站分片已有裁剪或 Desko 留底改造，不能宣称逐字一致。

### 命令面

- 后端注册表和 `keep_cmds.json` 仍为 **62** 条；未新增账号认证命令或绕过宿主授权闸门。
- 前端 API 中可识别的静态 `invoke` 调用由 **51 → 53** 条，增加两个既有 Token 导入命令。未注册的前端调用为 **0**。
- 剩余 **9** 条未接 API：用户排除的模型配置族 **8** 条，以及由 `get_codex_storage_paths` 已覆盖的 `get_codex_config_toml_path` **1** 条。
- 上游前端静态 Codex `invoke` 字符串共 **232** 个。这个数字包含已排除的领域与重复能力，且不代表动态调用的完整公共接口数量，不用它推导“还缺 170 个功能”。

### 保留的精简差异

- 不代启动或重启官方客户端；手动切号仍显式确认写官方凭据，并保留原提示。
- 会话只管理官方默认 `CODEX_HOME`，没有多实例同步、会话跨实例导入导出。
- 账号组织使用已有标签加搜索筛选，没有新增上游自定义分组/拖拽排序的持久化域。
- 批量导入继续一次性执行；批量删除继续使用已落地的作业机。
- 模型配置的闲置入口与裁剪桩未在本轮启用。早期静态核验发现默认目录/模型 overlay 桩不适合恢复该功能，未来重新启用时必须先修复和验证，不可直接把 UI 接上。

## 重要操作确认（用户追加要求）

- 额度重置：菜单只打开明细确认面，展示账号、余次及不可撤销的后果；点击“确认重置”才消耗一次。新快照无可用次数、加载失败或操作在途时禁止提交；失败可重试明细。消费请求报错后重新核对余次，不能凭旧快照再次扣次。
- 更换 API Key：保存前独立确认是否重建档案及改写当前官方凭据，确认面不显示密钥。普通名称、标签、备注保存无需追加确认。API Key 行的编辑入口明确标为“账号与密钥”。
- 强制刷新登录令牌、放弃暂停中的批量删除任务：增加独立确认；取消不请求后端。API Key 没有 OAuth 登录令牌，隐藏不适用的刷新入口。
- 切号、账号/会话删除、永久删除、清空回收站：保留已有二次确认。
- 托盘“退出”：使用原生异步确认弹窗，窗口隐藏或应用锁定时也能展示；取消不退出，连续点击只开一个确认面。窗口关闭按钮仍按既有语义收进托盘。
- 重置和换密钥在途不能收起弹窗后重复提交；应用锁定卸载弹窗时，迟到的返回不继续写入资料、重读账号或显示成功提示。

上述网页确认路径由假后端界面测试验证，原生退出弹窗已核验本地 dialog/rfd 的回调映射并通过 Rust 编译，尚未在真实桌面中操作隐藏窗口/锁屏后的弹窗。

## 验证

- `npm run build`：类型检查和生产构建。
- Codex 筛选、状态与弹窗测试：52 项，包含锁屏清空、迟到读侧/配额/路径、真实切号取消、切号收尾、Token 导入卸载、额度重置防重复与更换密钥卸载后的隐私回归。
- Codex 原有 55 项界面回归与新增 9 项：64 项。新增覆盖组合筛选、筛选结果全选、正文搜索、两种 Token 导入、地址修改提示、800px 布局、强制刷新确认与 API Key 操作适用性；原有重置、换密钥与放弃任务回归增加取消/确认契约。
- `cargo test -p codex-core codex_session`：17 项通过。
- `cargo test --bin desko gate_tests`：3 项通过，验证命令注册表与模块开启/解锁闸门。
- `cargo test -p codex-core` 全量基线：**173 通过、8 失败、1 忽略**。失败项在本轮 Rust 行为修改前已复现，涉及已裁剪代理或 Agent Identity；本轮不恢复这些域，也不删除或忽略这些失败来制造全绿。

原生失败项：

```text
codex_oauth::tests::explicit_http_oauth_proxy_needs_no_node_engine
codex_oauth::tests::oauth_proxy_session_reuse_compares_normalized_addresses
codex_oauth::tests::oauth_proxy_use_keeps_resource_snapshots_backend_side
codex_oauth::tests::oauth_proxy_use_redacts_direct_proxy_credentials
codex_oauth::tests::reauth_proxy_priority_matches_account_proxy_policy
codex_quota::tests::agent_identity_quota_request_uses_common_headers_and_recovers_task_once
codex_quota::tests::local_proxy_error_clears_only_legacy_local_error
codex_quota::tests::local_proxy_errors_preserve_cached_quota_without_persistence
```

界面测试使用隔离的假后端，原生会话测试使用合成数据/临时目录。未使用用户真实账号执行 OAuth、联网刷新或改写官方凭据；这些外部效果只有静态契约核验，不能把 mock 成功当成真实服务验证。

后续根据用户“缺少当天统计、不直观”的反馈补上今日默认范围、每日明细与本地日期边界处理，新增验证记录见 [当天用量与每日明细](15-daily-usage-display.md)。
