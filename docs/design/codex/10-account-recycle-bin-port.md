# Codex 账号回收站（10 设计稿 · 2026-10-12 · 已拍板）

配套 `08-token-stats-and-entry-audit.md` §3 Z 域与 §5 第 7 项。用户 2026-10-12 批复「按照你推荐的来」，推荐顺序第二位就是这一块；同日就「导出」那条单独裁定为**不接**（理由见 §3.2）。

## 1. 一句话方案

账号删除**早就在写留底**，缺的只是把留底读回来：补 4 条命令（列出 / 恢复 / 彻底删除 / 清空）+ 回收站档新增「账号留底」区，让删掉的号能原样回来。

## 2. 现状核验（这是本稿的前提，与 08 §3 的旧说法不同）

08 §3 的 Z 域那行写的是「账号页删除现在只删 desko 记录」——**这句已经不准**。逐行读 desko 自己的代码：

| 事实 | 位置 | 含义 |
|---|---|---|
| 留底分片**已经编进 crate** | `modules/codex_account.rs:14` `include!("codex_account_recycle_bin.rs")`（231 行，逐字节取自上游） | 不是孤儿文件，不是桩；`list_recycled_accounts` 等函数今天就编译得动，只是没人调用 |
| 删除账号**已经在写留底** | `modules/codex_account_lifecycle.rs:613-619`：`remove_accounts()` 先 `validate_recycle_account_id`，再对每条 `load_account_with_summary` → **`archive_codex_account(&account)?`**，全部落盘成功后才写 tombstone、剔索引 | 真机上 `<data dir>/codex_account_recycle_bin/<recycleId>.json` **已经在长**——用户历史上删过的每个号都躺在那儿，密文，谁也看不见 |
| 落盘形状 | `CodexRecycledAccountFile { summary, encrypted_account }`，`encrypted_account` 走与在册账号同一个信封 `secure_account_storage::serialize_account_file("codex", …)`，写入用 `write_secret_string_atomic` | 列目录**不解密**（上游注释同义）；恢复时才解 |
| tombstone 是活的 | `codex_account_storage_locks.rs:136/141`、`codex_account_index.rs:175/904/998`、`codex_account_lifecycle.rs:622` | 上游 restore/delete 依赖的 `account_is_tombstoned` / `read_account_tombstone` 在 desko 不是死码，语义原样成立 |

**所以本轮的账**：不是「移植一个功能」，是「把已经在磁盘上、但没有任何入口的那半截接上」。这与 06 那份「半成品」判定同一种形状——写侧到位、读侧为零。

## 3. 命令面

| 项 | 值 |
|---|---|
| 做 | `list_codex_recycled_accounts` `restore_codex_recycled_account` `delete_codex_recycled_account` `empty_codex_recycle_bin`（**4 条，名字与上游逐字一致**） |
| 不做 | `export_codex_recycled_accounts` |
| 在册账 | 71 → **75**；三相等 `main.rs` = `keep_cmds.json` = `#[tauri::command]` = 75 |
| 未入册账 | 188 → **184**（Z 域从 27 降到 23） |
| 落点 | 新建 `commands/codex_account_recycle_bin_commands.rs`，`include!` 进 `commands/codex.rs`（与 `codex_session_commands.rs` 同法）；上游该件 47 行，desko 收 4 条 |
| 模块侧 | **零改动**：4 条要调的 `list_recycled_accounts` / `restore_recycled_account` / `delete_recycled_account` 全是现成的 |

### 3.2 为什么不接「导出」

上游 `export_codex_recycled_accounts(recycle_ids, path)` 把留底**解密后**经 `serialize_accounts_for_export()`（`codex_account_import.rs:1875`，就是 `serde_json::to_string_pretty(accounts)`）明文写进用户选的路径。desko 对**在册**账号的导出从来不到磁盘：`CodexModule.vue:250 exportJson()` 拿 `export_codex_accounts` 的文本后 `navigator.clipboard.writeText`。给「已删除的账号」开一条明文落盘口，比在册账号那条更糟——它绕过 tombstone 与 generation 的收敛，把用户以为已经删掉的凭据又摊成一个不受 desko 口令保护的 `.json`。

2026-10-12 就此单独弹窗，用户裁定：**不接这条，只做 4 条**。要导一个留底号，先「恢复」回账号页，再走既有的「导出所选 JSON」（进剪贴板）。代价是批量导留底多一步逐条恢复；换来的是 desko 不新增任何明文凭据落盘路径。

## 4. 上游语义（逐行核验 `be24ce6` 的 `modules/codex_account_recycle_bin.rs`，231 行 = desko 那份）

**列出** `list_recycled_accounts()`：目录不存在 → 返空数组（不是错）；只认 `.json`；逐条 `parse_codex_recycled_account(文件名字干, 内容)`，**内容里的 `summary.id` 必须等于文件名字干**，否则 `Recycle entry identity mismatch`；再校验 `summary.account_id` 只含 `[A-Za-z0-9_-]`。排序 `deleted_at` 倒序，同刻按 `id` 升序。全程持锁？——不持：注释写明「快照是不可变的，列目录不得把活账号的写锁压在一次无界目录遍历上」。

**恢复** `restore_recycled_account(id)`：拿 `CODEX_ACCOUNT_MUTATION_LOCK` → 读快照 → **活账号里已有同一个 `account_id` 就直接拒**（`This account already exists; its recycled copy was kept`，留底原地不动）→ 解密 → 二次核 `account.id == summary.account_id` → `token_generation` 抬到 `max(快照, tombstone) + 1`（防旧 token 复活）→ 索引里先剔同 id 再 push 摘要 → `save_account_unchecked` + `save_account_index` + 写 tombstone(`deleted=false`) → **最后**才删快照文件，删不掉只 `log_warn` 不报错（活账号已提交，此时报失败会让重试与活账号撞车；残留的密文副本留在清单里等显式清理）。

**彻底删除** `delete_recycled_account(id)`：拿同一把锁 → 文件不存在即 `Ok(())`（幂等）→ 读快照 → **只有 tombstone 仍标 deleted 才**顺手清掉同 id 的活详情文件与 `.json.bak`（注释：清的是「软删中断的残留」，绝不删「删完后又新导入的同 id 账号」）→ 删快照。**tombstone 保留**，它是防旧 token 复活的凭据。

**清空** `empty_codex_recycle_bin(recycle_ids)`：不是「扫全目录」，是**逐个删用户确认过的那批 id**（上游注释：只清用户确认的快照，保住并发新删的），每条之间 `yield_now`。

## 5. desko 的改写点（必须写明，不是照搬）

1. **DTO 键名保持 snake_case**（`account_id` / `account_name` / `plan_type` / `deleted_at`）。desko 面向前端的 DTO 一般 `#[serde(rename_all = "camelCase")]`，这里**故意不加**：同一个结构体同时是磁盘落盘格式（`CodexRecycledAccountFile.summary`），而 §2 已确认真机上可能已经躺着旧留底——改键名等于让旧快照全部解析失败，把「可恢复」变成「读不到」。前端 `CodexAccount` 那套接口本来就是 snake_case（`account_name` / `plan_type` / `auth_mode`），这一处不破坏一致性。
2. **`empty` 的 id 由前端传全量**，与上游同形；desko 不给「扫目录一把清」的变体。这样清空的范围永远等于用户刚看到的那份清单，清空期间别处新删的号不会被顺手带走。
3. **不收 `path` 参数**（导出那条不接，见 §3.2），因此 desko 这一族命令**没有任何文件路径入参**，可达面比上游小一圈。
4. 错误文案照上游是英文串（`This account already exists; its recycled copy was kept` 等）。desko 的 toast 直接把 `Err` 串摊给用户，所以**命令层包一次中文化**：`restore` 撞活账号 → 「这个账号已经在册，留底原样保留」；解析/身份不符 → 「留底清单读不出可信内容」。模块内部串不动，只在 4 条 `#[tauri::command]` 的 `map_err` 里换话。
5. **恢复成功要立刻 `refreshAccounts()`**：这条路径会把号写回索引，账号页不重读就是假象。

## 6. 前端落点

| 层 | 改动 |
|---|---|
| API | `services/api/codex.ts` 加 `CodexRecycledAccount`（snake_case 四键 + `id`）与 `listRecycled / restoreRecycled / deleteRecycled / emptyRecycled` 四个 invoker |
| 状态 | `codexState.ts` 加 `recycledAccounts` / `recycledLoaded` / `recycledBusy` / `recycledError` + `loadRecycled()` / `restoreRecycledAccount(id)` / `deleteRecycledAccount(id)` / `emptyRecycledAccounts()`；与 `trash` 那一族同一套「进档才扫、扫过留在内存、成功当场摘行」的写法（见 08 §7.5） |
| 作废 | 账号页删除（单条与批量）成功后置 `recycledLoaded = false`；恢复成功走 `refreshAccounts()` |
| UI | `CodexTrashPanel.vue` 顶部加**「账号留底」区**，排在会话留底之上（账号是主体，会话是副产品）；两区各一行小标题，行仍走 `.rcard` 64px 一档、`.thr-l1/.thr-l2/.thr-acts` 同一套方言，禁卡中卡。每行动作：恢复 / 彻底删除；区头一个「清空账号留底」 |
| 页头 | `.titlebar-count` 从「N 条」改成「N 个账号 · M 条会话」；页条「刷新」同时重取两份清单 |
| 文案 | 账号页删除确认补一句留底事实：「删除 X？官方凭据不受影响，只移除 Desko 里的这条记录，同时留底进回收站，可恢复。」回收站空态与脚注同步改口，不再只讲会话 |
| 深色/动画 | 沿用既有令牌与 64px 档，无入场动画 |

## 7. 风险账

- **恢复会把凭据写回活账号**：解密 → `save_account_unchecked` → 索引 → tombstone。这条路径 desko 从没跑过真机，全部验收走 e2e mock（`*@e2e.dev`），且 `restore` 有「同 id 已在册即拒」的前闸，不会覆盖。
- **generation 抬升**依赖 tombstone 读得到；tombstone 缺失时按 0 起算，与上游同。
- 磁盘上可能已有**用户旧留底**（§2）。本轮第一次让它们在 UI 现身——这是预期收益，不是风险；但意味着 e2e 的 fixture 形状必须与真实落盘形状一致（snake_case 四键），否则测的是假格式。
- 不做真机验证：任何一次「恢复」都会动真账号索引（用户约束「千万不要拿真实数据测试」）。

## 8. 明确不做

- `export_codex_recycled_accounts`（§3.2）。
- 留底**自动过期 / 容量上限**：上游也没有，desko 不自造策略；腾磁盘由用户点「彻底删除 / 清空」。
- 会话回收站那 5 条（§7 已交付）之外的第二个留底体系：账号与会话共用「回收站」这一档，不另开立档。
- 从留底直接「重新授权」「刷新配额」：号不在册就没有这些动作，先恢复。

## 9. 验收判据

1. `cargo test -p codex-core codex_session` 17/17 不回归；新增账号回收站内联单测（`temp` 目录 + 全 mock 数据）：①列出按 `deleted_at` 倒序且目录不存在返空；②身份不符（`summary.id` ≠ 文件名字干）读不出；③恢复→在册、留底消失、再恢复同一条报「已在册」；④彻底删除幂等（连删两次不报错）。
2. `cargo test --bin desko gate_tests` 2/2；三相等 **75 = 75 = 75**。
3. `npx vue-tsc --noEmit` 0；`npx vitest run` 全绿，`codexState` 补 3 条（进档才扫 / 删除后置缓存位 / 恢复后重读账号）。
4. `PW_CHANNEL=msedge npx playwright test e2e/specs/codex.spec.ts` 全绿：mock 里**删除账号真的把这条挪进 `recycled` 数组**（与真机同形状），断言 列出→恢复回账号页→彻底删除→清空 全圈、错误块、幂等。全量 e2e（跑完实测）**246 passed / 2 failed / 1 flaky**：相对基线（240 passed / 2 failed）**多出的 6 条全是本轮新增，零新增红**——那 2 条 failed 仍是既有的 `notes.spec.ts:644`/`:654`「插入芯片」存量红；flaky 这次落在 `bypass.spec.ts:158`（基线那轮是 `settings.spec.ts:220`），重试即过，与本轮无关。
5. `node scripts/codex-shots.mjs` EXPECTED 18 → **19**（`codex-trash-accounts.png`），跑完逐名核对「19 帧全部为本次新拍」，交付内嵌截图。
6. 全程只跑 `*@e2e.dev` mock。

## 10. 执行结果（2026-10-12 交付）

### 10.1 后端

- 命令分片 `commands/codex_account_recycle_bin_commands.rs`（57 行，4 条）经 `commands/codex.rs` 的 `include!` 进编译，`keep_cmds.json` +4 条按字母序插入，`main.rs` 注册 4 条 → **三相等 75 = 75 = 75**（`cargo test --bin desko gate_tests` 2/2）。
- 模块侧确实**零改动**（§3 的账成立）。
- `empty_codex_recycle_bin` 的命令体是 `spawn_blocking` 里按传入 id 串行 `delete_recycled_account`，**首错即停**；闭包要写 `Ok::<(), String>(())`，否则 E0282 推不出错误类型。上游那条命令内部有 `yield_now`，desko 这层不重跑一次调度——单条删除本身就是拿锁的短操作。
- 内联单测 **3 个函数覆盖 §9.1 的四条判据**（`cargo test -p codex-core recycle` → 3 passed）：
  | 测试 | 盖到的判据 |
  |---|---|
  | `recycle_entry_ids_are_validated_before_any_path_is_built` | id 校验先于任何路径拼接（`empty` / 非法字符 / 非 uuid 文件名字干） |
  | `archived_account_round_trips_through_the_recycle_bin` | ①归档→列出找得到；③同 id 在册时 restore 被拒且快照仍在，剔掉活账号后 restore 成功、快照消失；④连删两次不报错 |
  | `listing_skips_foreign_files_and_rejects_identity_mismatch` | 目录不存在返空、非 `.json` 跳过、`summary.id` ≠ 文件名字干读不出 |
- 测试用 `test_support::env_lock()` 串起来：`cfg(test)` 的 `get_data_dir()` 是**进程级共享的同一个 temp 目录**，不锁就会互相看见对方的留底文件。

### 10.2 前端与设计稿的偏差

| 设计稿说 | 实际做 | 为什么 |
|---|---|---|
| 页条留一颗「清空回收站」 | **删掉**，清空改成两节各自节头一颗 `.thr-sec-act` | 一份清单两个清空入口是重复动作；而且页头那颗说不清它清的是哪一份 |
| 行内按钮 `:disabled="busyId === 本行 id"` | 一律 `:disabled="!!busyId"` | `run()` 的闸门是全局的：别的动作在途时，亮着的按钮点下去是**静默 no-op**，比灰掉更坏 |
| 快照行第二行摆邮箱 | 只在**有名字**时摆 | 没名字的留底标题已经是邮箱，第二行再摆一遍是复读（拍帧时看出来） |
| — | 时间串与「删除」之间补一个空格，两份留底同改 | `2026-10-12 09:46删除` 挤在一起；会话那一节是既有文案，一起改齐 |
| — | 错误块把两条错误源并成一行 `errorText` | 两份清单可能同时读不出，`recycledError \|\| trashError` 会吞掉第二条 |

页头 `.titlebar-count` 按 §6 改成「N 个账号 · M 条会话」；页条「刷新」一次重取两份（`reloadTrashBin()`）。

### 10.3 mock 与判据

- `state.codex.recycled` 存 `{ id, deleted_at, account }`——对齐后端 `{ summary, encrypted_account }` 的两段形状，`list` 那侧现算摘要，所以摘要列与快照列不可能各自漂移。
- `delete_codex_account` / `delete_codex_accounts` 改走同一个 `codexRecycle()`：**删除即留底**，与 §2 认定的真机写侧同形（这是本轮最关键的一条判据，不是补一个假数组）。
- restore 的「已在册即拒」按 `accounts.some(a => a.id === 快照.account.id)`；delete 幂等；empty 只删传入的那批 id。种子新增 `codex.recycled[]` 与 `codex.recycledFail`。
- `codex.spec.ts` 44 → **50 全绿**（账号回收站 6 条新用例：分区与页头 / 删除→留底→恢复回账号页 / 彻底删除与清空按 id / 批量删除逐条留底 / 读不到的错误块与重试 / 停在回收站不扫官方目录）。两条既有会话回收站用例的定位器随 §10.2 改动更新。
- `npx vue-tsc --noEmit` 0；`npx vitest run` **219**（`codexState` 20 → 23：读不到即复位、恢复重读账号列表、清空范围与空清单不发网络）。
- `node scripts/codex-shots.mjs`：**19 帧全部为本次新拍**，含新增 `codex-trash-accounts.png`。
- 真机一次都没点：恢复路径会把凭据写回活账号索引，全程 `*@e2e.dev`。
