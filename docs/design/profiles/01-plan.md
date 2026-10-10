# 多档案（Profile）环境隔离方案（2026-10-09，rev2）

rev2 变更：折入自评审的 6 条修正——D2 全局收紧为 `OnceLock`（write-once）、明确 `boot()→recover_swap→Database::new` 顺序、点明 fileshare sidecar **零改动**、R5 默认共享目录改用相对锚点、迁移加 `migration-manifest.json` 支持降级逆向、F2 补边界测试；命令面去掉 `profiles_set_cloud_ns`（7→6，ns 建档后不可改）；6 项待确认全部按推荐拍板（见文末「已定」）。
rev1 变更：初稿。

一句话：把 desko 从「一台机器一份数据」升级为「一台机器多份互不相通的档案」，每个档案有独立的库、附件、口令与云命名空间；换机时可只带走某一个档案。形态经确认＝**同一台电脑内可切换多档案 + 每档案独立云命名空间（会同步但不混）**。

## 目标

1. 一个 desko 安装内可创建多个「档案」，各自完全隔离：独立 `data.db`、独立附件、独立主口令/备份口令/小记域密钥、独立设置。
2. 可在应用内切换档案；档案之间数据、密钥、云备份互不可见。
3. 每个档案有独立的云命名空间（坚果云 WebDAV 下的独立子目录），互不覆盖。
4. 换到另一台电脑时，只在那台机器上建一个指向「同一云命名空间」的档案并恢复，即可只带走这一个档案的数据；主力档案的数据不会被带过去。
5. 现有用户（单档案）零感知升级：老数据自动迁入一个「默认」档案，云端 `desko/` 目录不变、既有备份仍可恢复。

## 非目标（明确不做）

- **同时打开多个档案**（Chrome 那种多窗口/多进程并行）。本方案是「一次开一个，切换＝换档」，不含并行多开。
- 跨档案的数据合并 / 迁移单条记录 / 档案间互访。
- 云端的账号体系、设备指纹、多端冲突合并（沿用现有「共用 WebDAV 目录 + 备份口令」模型，只是把目录按档案分开）。
- 档案级不同主题以外的高级别权限（不做「只读档案」「受限档案」等）。

## 现状（实测，rev1 逐条核过）

**双根并存 —— 这是本方案必须先收拾的地基：**

| 数据 | 现在的落点 | 解析方式 | 出处 |
|---|---|---|---|
| `data.db`、`data.db-wal/-shm` | `%APPDATA%\com.desko.app\` | Tauri `app.path().app_data_dir()`（identifier=`com.desko.app`） | `main.rs:52-63` |
| `backups\`、`restore-staging\` | `%APPDATA%\com.desko.app\` | 同上，`backups_dir(app_data_dir)` | `backup/mod.rs:22-28`；调用方 `commands/backup.rs:24`、`cloud.rs:14`、`auto_backup.rs:117` |
| `fileshare.json`、`fileshare.status.json` | `%APPDATA%\com.desko.app\` | 同上 | `commands/fileshare.rs:23-24,92-103` |
| `attachments\` | `%APPDATA%\desko\` | **硬编码 env `%APPDATA%\desko`，不走 app_data_dir** | `services/attachment_service.rs:7-12` |
| `favicons\` | `%APPDATA%\desko\` | 同上 | `services/favicon_service.rs:7-11` |
| `shared\` | `%APPDATA%\desko\` | **已核实**：局域网传输的默认共享目录（`fileshare.rs:221,259-260`，`dir`＝fileshare.json 所在目录），随 fileshare 配置走 → 归入档案根 | 磁盘实测存在 |

**云命名空间是写死的常量：** `cloud_service.rs:17-18` `PKG_DIR="desko/packages"`、`ATT_DIR="desko/attachments"`；同步记录 sidecar `backups\.sync-state.json`（`:15`，不进库，天然随档案目录走）。WebDAV 凭据 `{server,account,app_password}` 加密后存 `data.db` 的 meta 键 `cloud_cfg`（`:9,52-68`）——**即凭据本来就随库走，库一分档案，凭据自然分档案**。

**无任何档案/账号/设备概念**；设置＝`data.db` 的 meta KV，写入有白名单 `commands/settings.rs:14 ALLOWED_KEYS`。

**前端门禁：** `App.vue` 靠 `authStore.appState ∈ {setup, locked, unlocked}`（`stores/auth.ts:6-18`）三态渲染；设置弹窗页签 `general/appearance/fileshare/backup/security/about`（`SettingsDialog.vue:37 TAB_LABELS`）。档案在后端启动时就定死，前端**无需新增门禁态**（不做开机选择器，见「已定」3）。

## 决策记录

| # | 决策 | 理由 |
|---|---|---|
| **D1** | 引入**单一「档案根」**：所有数据（库、附件、图标、备份、staging、fileshare 配置）统一落在 `%APPDATA%\com.desko.app\profiles\<id>\` 下，废除 `%APPDATA%\desko` 这条硬编码旁根 | 双根是当前最大的隐性耦合；不统一就没法「一个目录搬走一个档案」。统一到 Tauri app_data_dir 之下，`%APPDATA%\desko` 迁移后清空删除 |
| **D2** | 新增 `src-tauri/src/paths.rs`：一个进程级全局 `PROFILE_ROOT`，用 **`OnceLock`（write-once）**——启动时 `boot()` 设一次，进程内永不改（切换靠重启，见 D3）。所有路径 helper 改成**无参函数读这个全局**：`attachments_dir()`/`favicons_dir()`/`data_db_path()`/`backups_dir()`/`staging_dir()`/`fileshare_config()`/`fileshare_status()`/`shared_dir()`/`cloud_base()` | 现在 helper 一半读 env、一半收 `app_data_dir` 参数，散在 commands 各处。收敛到单点后，「切档案」＝「换一个全局根」，其余代码零改动。用 `OnceLock` 而非 `RwLock` 是从类型上杜绝「运行时热改根」的诱惑——与 D3 一致。删掉 `commands/{backup,cloud,fileshare}.rs` 里三个 `app_data_dir(app)` 私有 helper |
| **D3** | **切换档案＝写回 `active` 后 `app.restart()` 重启**，不做进程内热切换（`app.restart()` 已核verify存在于 Tauri 2.10.3/2.11.5，`app.rs:546/588`，签名 `-> !`） | 库在 `setup()` 里开一次、`asset_protocol_scope` 白名单（`main.rs:77-87`）也在启动时定；热切换要就地换 `Database`、清所有内存密钥、还想收回旧档案的 asset 白名单（Tauri 不提供 revoke）→ 旧档案附件在重启前仍可读，是隔离漏洞。重启天然全清、零泄漏，代价只是一次可见的重启。切档本就强制锁定，内存态丢弃可接受 |
| **D4** | 老数据**一次性迁移**进 `default` 档案：整目录 `rename`（同卷原子），成功后才写 `profiles.json`；`profiles.json` 存在即跳过（幂等） | 迁移是「搬家」不是「兼容 shim」——搬完只存在档案布局一种形态，符合零兼容原则。同卷 rename 原子，断电重跑安全 |
| **D5** | 云命名空间按档案分：`default` 档案的远端基名保持 `desko`（既有云备份原地可恢复）；其余档案基名 `desko-<ns>`，`PKG="{base}/packages"`、`ATT="{base}/attachments"` | 不动 default 的远端＝老用户升级后云同步无缝续上；新档案各自独立子目录，永不覆盖 |
| **D6** | 每档案**加密完全独立**：主口令 salt/verify、备份口令、小记域密钥 NDK 全在各自 `data.db` 的 meta 里（现有机制原样，只是库分了档案） | 满足「工作 vs 个人」真正的隔离：拿不到某档案口令就读不了它，即使拿到它的备份包 |
| **D7** | 档案注册表 `profiles.json` 存在**档案根之上**（`%APPDATA%\com.desko.app\profiles.json`），字段 `{active, profiles:[{id,name,cloud_ns,created_at,last_used_at}]}`；`id` 用稳定 slug/uuid 作目录名，`name` 只是显示名（可改，不碰目录）；`cloud_ns` **建档时定死、事后不可改**（改 ns＝换云端目录，语义重、易误操作，要换就新建档案） | 注册表必须在任何档案之外，否则「选哪个档案」无处可读。改名只动 json，不搬目录。ns 不可改避免「同一档案先后同步到两个云端目录」的混乱 |
| **D8** | 启动**直接进 `active` 档案**（默认无摩擦）；档案的建/改/删/切全放设置弹窗新增的「档案」页签 | 单档案用户升级后手感不变；多档案是低频管理动作，收进设置即可。不做开机选择器（见「已定」3） |
| **D9** | `cloud_ns` **建档时**校验全局唯一 + 只允许 `[a-z0-9-]`（进远端路径，防注入与非法字符）；唯一性是**本机注册表内**的唯一，跨机指向同一 ns 正是「换机只带走某档案」的既定用法（目标 4） | 同机两档案撞同一 ns 会同步到同一远端目录互相覆盖，必须挡死；跨机同 ns 是特性不是冲突 |

## 存储布局（目标形态）

```
%APPDATA%\com.desko.app\               ← APP 根（Tauri app_data_dir，不再直接放数据）
  profiles.json                        ← 注册表（D7）
  migration-manifest.json              ← 老布局迁移的 {from,to} 清单，仅供降级逆向（D4/迁移流程）
  profiles\
    default\                           ← 迁移后的老数据（D4）
      data.db  data.db-wal  data.db-shm
      attachments\                     ← 从 %APPDATA%\desko\attachments 搬来（D1）
      favicons\                        ← 从 %APPDATA%\desko\favicons 搬来
      backups\  (含 .sync-state.json)
      restore-staging\
      fileshare.json  fileshare.status.json
      shared\                          ← 从 %APPDATA%\desko\shared 搬来（fileshare 默认共享目录）
    work\                              ← 新建档案，结构与 default 完全一致
      ...
%APPDATA%\desko\                       ← 迁移后清空删除
```

远端（坚果云 WebDAV）：

```
desko/packages, desko/attachments              ← default 档案（cloud_ns="" → base="desko"，不变）
desko-work/packages, desko-work/attachments    ← work 档案（cloud_ns="work" → base="desko-work"）
```

## 后端改动点（逐处 file:line）

**新增：**
```
src-tauri/src/paths.rs                     全局 PROFILE_ROOT + 所有无参路径 helper（D2）
src-tauri/src/services/profile_service.rs  注册表读写、resolve active、create/rename/delete/switch、迁移逻辑
src-tauri/src/commands/profiles.rs         #[tauri::command] 薄壳（命令面见下）
```

**改：**
- `main.rs:52-63` setup：**顺序必须是** `profile_service::boot()`（跑迁移＋解析 active＋设 `paths::PROFILE_ROOT`）→ `backup::recover_swap(&paths::profile_root(), &paths::attachments_dir())`（原 `main.rs:61` 挪到设根之后）→ `Database::new(&paths::data_db_path())`；`attachments_dir`/`favicons_dir`（`main.rs:78,83`）改调 `paths::*`。
- `services/attachment_service.rs:7-12`、`services/favicon_service.rs:7-11`：函数体改为 `paths::attachments_dir()` / `paths::favicons_dir()`（删 env 读取）。
- `backup/mod.rs:22-28`：`backups_dir`/`staging_dir` 去参改读 `paths::profile_root()`；`swap_live_files`/`recover_swap`/`restore` 里的 `app_data_dir` 形参全部换成 `paths::*`（连带 `db/mod.rs:126-141 swap_into_restored`）。
- `commands/backup.rs:24-25`、`cloud.rs:14-15`、`fileshare.rs:92-103`：删私有 `app_data_dir(app)`，改 `paths::profile_root()` / `paths::fileshare_config()` / `paths::fileshare_status()`。
- **fileshare sidecar 二进制零改动**：它是被主程序用 `--config <绝对路径> --status <绝对路径>` 喂的（`fileshare.rs:141-160 spawn_service`），自己不算数据目录；`config_path/status_path` 档案化后 sidecar 自动跟随。唯一要动的是默认共享目录改相对锚点（见 R5）。
- `services/auto_backup.rs:117-124,352-357`：`data_dir`/`attachments`/`backups` 全改 `paths::*`（重启切换后新进程自然读到新根）。
- `services/cloud_service.rs:17-18`：`PKG_DIR`/`ATT_DIR` 常量改为 `pkg_dir()`/`att_dir()` 函数，基名取 `paths::cloud_base()`（D5）。
- `main.rs:183-260 generate_handler!`：注册档案命令。
- `commands/settings.rs:14 ALLOWED_KEYS`：**不动**（档案不是 meta 设置，住 profiles.json）。

**命令面（`commands/profiles.rs`，6 个）：**
```
profiles_list      -> [{id,name,cloud_ns,created_at,last_used_at,active}]
profiles_active    -> {id,name,cloud_ns}          // 设置「档案」页签回显当前档案
profiles_create(name, cloud_ns?) -> {id}          // 建目录 + 空库 + 注册；ns 唯一性 + 字符集校验(D9)，落库后不可改
profiles_rename(id, name)                         // 只改显示名，不碰目录与 ns
profiles_delete(id)                               // 拒删 active / 最后一个；删目录 + 注销
profiles_switch(id)                               // 写回 active + last_used_at，然后 app.restart()(D3)
```

## 前端改动点

```
src/services/api/profiles.ts (+ index.ts re-export)   命令面封装
src/stores/profiles.ts                                 列表 + active 缓存
src/components/settings/ProfilesPanel.vue              新页签内容
src/components/settings/SettingsDialog.vue:37 TAB_LABELS  加 profiles:'档案'；nav-tab 按钮 + section（照 backup 页签写法）
```
- 「档案」页签：列表（name / cloud_ns / last_used / **当前**徽标）＋ 新建 / 重命名 / 删除 / **切换**。ns 只在新建时填，列表里只读展示（D7 不可改）。
- 切换走 desko 现有确认弹窗，文案明示「切换档案会重启 desko，未保存的输入会丢失」（D3）。
- 删除档案：强确认（要求输入档案名），文案明示「只删本地，云端 `<base>/` 目录不动，如需清理请手动」（已定 5）。
- 样式只用 `global.css` 既有令牌，控件落 28px `action-btn` 档，无入场动画，无 i18n（中文硬编码）。
- **不做顶栏 chip / 快速切换浮层**（已定 4）：切换动作只在设置「档案」页签，避免与菜单重复入口；当前档案名仅在列表里以「当前」徽标标示。

## 迁移流程（首次启动新版本，`profile_service::boot()` 内）

```
1. APP 根 = app.path().app_data_dir()
2. 若 APP根\profiles.json 已存在 → 读它，resolve active，设 PROFILE_ROOT，返回（幂等）
3. 否则（老布局）：
   a. mkdir APP根\profiles\default
   b. 同卷 rename 逐项搬入 default\，**每搬一项记一条 {from,to} 进内存清单**：
        data.db / data.db-wal / data.db-shm（存在才搬）
        backups\   restore-staging\   fileshare.json   fileshare.status.json
        %APPDATA%\desko\attachments → default\attachments
        %APPDATA%\desko\favicons    → default\favicons
        %APPDATA%\desko\shared      → default\shared（存在才搬）
   c. 全部成功 → 写 APP根\migration-manifest.json（{from,to} 全量清单，供降级逆向）
             → 写 profiles.json {active:"default", profiles:[{id:"default",name:"默认",cloud_ns:"",...}]}
   d. 清空的 %APPDATA%\desko 删除（删除动作也记进 manifest，逆向时重建）
   e. 设 PROFILE_ROOT = APP根\profiles\default
4. default 的 cloud_ns="" → cloud base 仍是 "desko" → 既有云备份无缝续同步（D5）
```
迁移任一步失败：不写 profiles.json，下次启动重跑（rename 幂等：目标已存在则视为已搬）。
**降级路径**：迁移是纯 rename（无数据变换），照 `migration-manifest.json` 逆向 rename 即可完全复原到老布局——不额外拷贝 data.db，避免复制皇冠数据。手动步骤写进 F1 交付说明。

## 分期与验收

| 阶段 | 内容 | 验收判据 |
|---|---|---|
| **F1 地基** | `paths.rs` 全局根（`OnceLock`）+ 所有 helper 收敛（D2）+ 双根合一（D1）+ 迁移逻辑与 `migration-manifest.json`（D4）+ 单 `default` 档案跑通（**无档案 UI**） | 老用户升级后数据/附件/云同步全部照常；`%APPDATA%\desko` 已清空删除；`cargo build` + `tauri dev` 绿；断电重跑迁移不丢数据；**照 manifest 逆向 rename 能把布局完全复原回老版（降级验证）**；fileshare 默认共享目录改相对锚点后仍指向档案内 `shared`（R5） |
| **F2 多档案后端** | `profiles.json` 注册表 + `profile_service` create/rename/delete/switch + `commands/profiles.rs`（6 命令）+ 重启切换（D3）+ e2e mock | `profiles_create`→`switch`→重启后进入新空档案；旧档案数据仍在；单测覆盖边界：ns 撞名/非法字符拒绝、`switch` 未知 id 报错、`delete` active 报错、`delete` 唯一档案报错、`rename` active 档案只改显示名不动目录 |
| **F3 档案 UI** | 设置「档案」页签（列表/新建/重命名/删除/切换）+ 确认弹窗 + `profiles` store/api | 全流程可点；切换重启生效；文案符合 D3/删除口径；ns 建档后只读；`npm run build`（含 vue-tsc）绿；补 `e2e/specs/profiles.spec.ts` |
| **F4 云隔离核验** | `cloud_service` 按档案分命名空间（D5）走查 | 两档案分别同步到 `desko/` 与 `desko-work/`，互不覆盖；在「另一台机」建同 ns 档案恢复，只得到该档案数据（目标 4 走通） |

每期补 `e2e/mocks/backend.ts` 假实现。（原 F5「顶栏 chip / 开机选择器」按已定 3、4 取消。）

## 风险

- **R1 重启切换丢内存态**：小记书写态草稿等未落盘内容随重启丢失。缓解：切换前确认弹窗明示；切档本就强制锁定、清密钥，丢弃是既定语义。
- **R2 asset 白名单泄漏（选 D3 正是为规避）**：热切换无法 revoke 旧档案附件目录 → 旧档案图片在重启前仍可被 asset: 读到。重启方案下白名单每进程只含当前档案，无此问题。
- **R3 迁移断电 / 升级后想降级**：断电——同卷 `rename` 原子 + 「先搬后写 profiles.json」+ 幂等重跑，最坏回到「未迁移」重来，不会出现半迁移的库。降级——迁移是纯 rename，照 `migration-manifest.json` 逆向即可复原老布局；F1 验收含一次真实降级演练，手动步骤随交付说明给出。
- **R4 云 ns 撞名**：同机两档案同 ns → 同步到同一远端目录互相覆盖。D9 建档时强制唯一 + 字符集校验挡死（跨机同 ns 是特性，见 D9）。
- **R5 fileshare 共享目录里的绝对路径**：默认 `share_dirs` 存的是**绝对路径** `dir.join("shared")`（`fileshare.rs:260`），迁移后必失效。**修法（推荐）：把默认改成相对锚点 `"shared"`**——`normalize_share_dirs(raw, base_dir)` 支持相对解析（`fileshare-core/config.rs:41,100-106`），base_dir＝config 所在目录＝档案根，天然随档案走、一劳永逸。迁移时另把已存的、指向旧 `desko\shared` 的绝对条目重写为新档案内路径。
- **R6 single_instance 与 restart**：`app.restart()`（已核verify存在）先退再起，single-instance 锁随退出释放；重启后仍读 `profiles.json` 的 `active`，不依赖 argv，故不被旧参数带偏。F2 实测一次切换重启落点正确。

## 已定（原待确认，rev2 按推荐拍板）

1. **术语＝「档案」**。与"多档案"一致，且不与"工作环境/开发环境"歧义。
2. **切换＝重启生效**（D3）。不做进程内热切换（规避 R2 asset 白名单泄漏）。
3. **不做开机选择器**（D8）。启动直接进上次档案，切换只在设置「档案」页签。
4. **不做顶栏 chip / 快速切换浮层**。避免与设置里的切换动作重复入口；当前档案仅以列表「当前」徽标标示。
5. **删除档案只删本地，云端 `<base>/` 目录保留不动**（符合"云端只增、密文永不删"的既有决策），删除弹窗提示如需清理请手动。
6. **default 档案可改名、不可删**（保证至少一个档案）；`delete` 对 active 与唯一档案一律拒绝。
