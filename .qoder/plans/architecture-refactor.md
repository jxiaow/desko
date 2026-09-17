# Desko 架构规范化重构计划

## 总览

**8 个阶段**，每个阶段完成后 App 都处于可用状态。后端和前端两条线可以独立推进。

```
Phase 0 (准备)
  ├── Phase 1 (DB 拆分)
  │     └── Phase 2 (Service 层提取)
  │           └── Phase 3 (Commands 拆分)
  │
  ├── Phase 4 (Toast/Confirm → Pinia)
  │     └── Phase 5 (领域 Store)
  │           └── Phase 6 (Composable 清理)
  │                 └── Phase 7 (Router + Views + App.vue 瘦身)
  │                       └── Phase 8 (API 拆分 + 清理)
```

---

## Phase 0: 准备（零风险）

**目标**：安装依赖，创建目录骨架，验证构建通过。

### 前端
1. `npm install pinia vue-router@4`
2. 创建空目录：`src/stores/`, `src/router/`, `src/views/`, `src/components/{layout,entries,notes,files,shared,auth,settings}/`

### 后端
3. 创建空目录：`src-tauri/src/{commands/,services/,db/}`（各含 `mod.rs`）

### 验证
- `cargo build` 和 `npm run build` 均通过

---

## Phase 1: 后端 — 拆分 `db.rs` → Repository 模块

**目标**：870 行 `db.rs` 按领域拆分为 Repository 模块，不改逻辑。

| 源 (db.rs) | 目标 | 内容 |
|---|---|---|
| 所有 struct（Entry, Note, UrlPath, FileShortcut 等） | `db/models.rs` | 数据模型 |
| CREATE TABLE DDL | `db/schema.rs` | `pub fn run_schema(conn)` |
| Database struct + meta 操作 | `db/mod.rs` | 核心连接管理 |
| Entry CRUD 相关方法 | `db/entry_repo.rs` | `impl Database { ... }` |
| Note CRUD 相关方法 | `db/note_repo.rs` | `impl Database { ... }` |
| UrlPath CRUD 相关方法 | `db/url_path_repo.rs` | `impl Database { ... }` |
| FileShortcut CRUD 相关方法 | `db/file_repo.rs` | `impl Database { ... }` |
| export_sql, import_sql | `db/export.rs` | `impl Database { ... }` |
| 单元测试 | 各 repo 文件内 | `#[cfg(test)]` 跟随对应模块 |

**关键**：每个 repo 文件用独立的 `impl Database` 块扩展，Rust 原生支持，编译结果与单文件完全一致。

### 验证
- `cargo test` 全部通过
- App 正常 CRUD

---

## Phase 2: 后端 — 提取 Service 层

**目标**：从 commands.rs 分离业务逻辑（加密编排、校验）到 services/。

| 源 (commands.rs) | 目标 | 内容 |
|---|---|---|
| `get_master_key()` | `services/mod.rs` | 共享辅助函数 |
| setup/unlock/lock/change_password 逻辑 | `services/auth_service.rs` | 认证业务逻辑 |
| create/update entry 加密逻辑 | `services/entry_service.rs` | 条目业务逻辑 |
| note CRUD 逻辑 | `services/note_service.rs` | 笔记业务逻辑 |
| file shortcut 逻辑 | `services/file_service.rs` | 文件快捷方式逻辑 |
| SQL 校验 + 导入导出 | `services/data_service.rs` | 数据管理逻辑 |

### 关键约束：锁顺序

当前代码中 **master_key 先于 db 加锁**（避免死锁）。Service 层 **不能自己获取锁** — 它接收 `&Database` 和 `&[u8]`（key）。锁的获取仍在 command handler 层。

### Command handler 改造后模式
```rust
#[tauri::command]
pub fn create_entry(state: State<AppState>, input: CreateEntryInput) -> Result<EntryResponse, AppError> {
    let key = crate::services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".into()))?;
    crate::services::entry_service::create_entry(&db, &key, input)
}
```

### 验证（最高风险阶段）
- setup → unlock → 创建条目 → 查看密码 → lock → unlock → 验证密码可解密
- 修改主密码 → 验证所有条目仍可访问
- `cargo test` 通过

---

## Phase 3: 后端 — 拆分 `commands.rs` → 领域模块

**目标**：666 行 commands 按领域拆分为独立文件。

| 源 | 目标 |
|---|---|
| is_initialized, setup, unlock, lock, change_password | `commands/auth.rs` |
| list/create/update/delete/batch entries, get_password, test_data | `commands/entries.rs` |
| list/create/update/delete/batch notes | `commands/notes.rs` |
| list/create/update/delete url_paths | `commands/url_paths.rs` |
| list/create/update/delete file_shortcuts, open_file | `commands/file_shortcuts.rs` |
| get/set_setting | `commands/settings.rs` |
| export/import_sql, get_db_path | `commands/data.rs` |

### main.rs 更新
```rust
.invoke_handler(tauri::generate_handler![
    commands::auth::is_initialized,
    commands::auth::setup_master_password,
    commands::auth::unlock,
    // ... 所有 30+ 命令
])
```

### 验证
- `cargo build` 成功
- 命令数量前后一致（30+ 个）
- 功能遍历测试

---

## Phase 4: 前端 — Toast/Confirm → Pinia Store

**目标**：将最简单的两个 composable 转为 Pinia store，消除最广泛的 prop-drilling。

### 新建文件
- `src/stores/toast.ts` — 从 `useToast.ts` 转换
- `src/stores/confirm.ts` — 从 `useConfirm.ts` 转换

### main.ts 更新
```typescript
import { createPinia } from 'pinia'
app.use(createPinia())
```

### 组件迁移
所有 `emit('showToast', ...)` → `toastStore.showToast(...)`
所有 `emit('showConfirm', ...)` → `confirmStore.showConfirm(...)`

消除所有 `@show-toast` 和 `@show-confirm` 事件声明。

### 验证
- Toast 通知正常（复制密码、删除条目、保存设置、自动锁定）
- Confirm 对话框正常（删除条目、批量删除、删除笔记）

---

## Phase 5: 前端 — 领域状态 → Pinia Store

**目标**：将 auth/entries/notes/fileShortcuts 转为 Pinia store。

| Store | 来源 | 说明 |
|---|---|---|
| `stores/auth.ts` | `useAuth.ts` | 模块级单例 ref 自然映射为 store |
| `stores/entries.ts` | `useEntries.ts` | 函数级 ref → store state |
| `stores/notes.ts` | `useNotes.ts` | 内部注入 toast/confirm store 替代构造参数 |
| `stores/fileShortcuts.ts` | `useFileShortcuts.ts` | 模块级单例 ref 直接转换 |

### 关键：notes store 内部注入
```typescript
export const useNotesStore = defineStore('notes', () => {
  const toastStore = useToastStore()
  const confirmStore = useConfirmStore()
  // doDeleteNote 内部直接调用 store，不再需要外部传入
})
```

### 验证
- 全量回归：setup/unlock/CRUD entries/搜索过滤/标签/密码显示复制/notes CRUD/file shortcuts CRUD
- 自动锁定仍正常

---

## Phase 6: 前端 — Composable 变为纯逻辑 hook

**目标**：`usePassword`/`useBatch`/`useAutoLock` 从 Pinia store 读取状态，不再接收构造参数。

### usePassword.ts（重构后）
```typescript
export function usePassword() {
  const entriesStore = useEntriesStore()
  const toastStore = useToastStore()
  // 仍持有自己的临时状态（visiblePasswords, passwordCache）
  // 因为这是敏感临时状态，锁定需清除，不适合放全局 store
}
```

### useBatch.ts（重构后）
```typescript
export function useBatch() {
  const entriesStore = useEntriesStore()
  const toastStore = useToastStore()
  const confirmStore = useConfirmStore()
}
```

### useAutoLock.ts（重构后）
```typescript
export function useAutoLock() {
  const authStore = useAuthStore()
  const toastStore = useToastStore()
}
```

### 新增 useClipboard.ts
从 usePassword 中提取剪贴板相关逻辑。

### 验证
- Lock/unlock 循环：密码缓存清除、剪贴板清空
- 复制密码 30 秒自动清除
- 批量删除确认+执行
- 自动锁定触发

---

## Phase 7: 前端 — Vue Router + Views + App.vue 瘦身

**目标**：用 Vue Router 替代 `currentModule` ref + `v-if`。App.vue 从 277 行瘦身到 ~40 行。

### router/index.ts
```typescript
const routes = [
  { path: '/', redirect: '/entries' },
  { path: '/entries', component: () => import('../views/EntriesView.vue') },
  { path: '/notes', component: () => import('../views/NotesView.vue') },
  { path: '/files', component: () => import('../views/FilesView.vue') },
]
```

### App.vue（重构后 ~40 行）
```vue
<script setup>
// 只引入 store + 自动锁定
// 不再引入 8 个 composable，不管任何弹窗状态
</script>
<template>
  <TitleBar />
  <SetupPage v-if="setup" />
  <UnlockPage v-else-if="locked" />
  <div v-else class="app-layout">
    <Sidebar />
    <router-view />     <!-- 替代三个 v-if 模块 -->
  </div>
  <ToastNotification />
  <ConfirmDialog />
</template>
```

### Views
| View | 来源 | 说明 |
|---|---|---|
| `views/EntriesView.vue` | EntriesModule 内容 | 直接使用 entries store + usePassword + useBatch |
| `views/NotesView.vue` | NotesModule 内容 | 直接使用 notes store |
| `views/FilesView.vue` | FileShortcutsModule 内容 | 直接使用 fileShortcuts store |

### 组件目录重组
| 原位置 | 新位置 |
|---|---|
| TitleBar.vue | layout/TitleBar.vue |
| Sidebar.vue | layout/Sidebar.vue |
| SetupPage.vue | auth/SetupPage.vue |
| UnlockPage.vue | auth/UnlockPage.vue |
| EntriesModule.vue | entries/（拆分为 view + 子组件） |
| EntryFormDialog.vue | entries/EntryFormDialog.vue |
| DetailDialog.vue | entries/DetailDialog.vue |
| NotesModule.vue | notes/（拆分为 view + 子组件） |
| NoteEditor.vue | notes/NoteEditor.vue |
| FileShortcutsModule.vue | files/（拆分为 view + 子组件） |
| SettingsDialog.vue | settings/SettingsDialog.vue |
| ChangePasswordDialog.vue | settings/ChangePasswordDialog.vue |
| ConfirmDialog.vue | shared/ConfirmDialog.vue |
| ToastNotification.vue | shared/ToastNotification.vue |

### Sidebar 改用 router-link
```vue
<router-link to="/entries" :class="{ active: $route.path === '/entries' }">...</router-link>
```

### 验证
- 三个视图间导航正常
- Sidebar 高亮匹配当前路由
- Lock/unlock 门控正常
- Settings/ChangePassword 弹窗正常

---

## Phase 8: 前端 — API 拆分 + 清理

### API 按领域拆分
```
src/services/api/
├── index.ts          # re-export
├── auth.ts           # isInitialized, setup, unlock, lock, changePassword
├── entries.ts        # list, create, update, delete, batchDelete, getPassword
├── notes.ts          # list, create, update, delete, batchDelete
├── urlPaths.ts       # list, create, update, delete
├── fileShortcuts.ts  # list, create, update, delete, openFile
├── settings.ts       # getSetting, setSetting
└── data.ts           # exportSql, importSql, getDbPath, createTestData
```

### 清理旧文件
- 删除 `composables/useAuth.ts`, `useEntries.ts`, `useNotes.ts`, `useFileShortcuts.ts`, `useToast.ts`, `useConfirm.ts`
- 删除旧 `services/api.ts`
- 删除旧 `components/EntriesModule.vue`, `NotesModule.vue`, `FileShortcutsModule.vue`
- 更新测试导入路径

---

## 风险总览

| 阶段 | 风险 | 主要关注点 |
|---|---|---|
| 0 准备 | 无 | — |
| 1 DB 拆分 | 低 | 编译错误，回退简单 |
| 2 Service 提取 | **中** | 加密密钥流转，需重点测试 |
| 3 Commands 拆分 | 低 | 命令注册遗漏 |
| 4 Toast/Confirm | 低 | 事件连线断裂 |
| 5 领域 Store | **中** | 状态管理回退 |
| 6 Composable 清理 | 中 | 密码缓存锁定清除 |
| 7 Router + Views | **中高** | 组件层级重构 |
| 8 API 拆分 + 清理 | 低 | 导入路径 |

## 加密安全关键不变量

1. **主密钥生命周期**：unlock/setup 设置，lock 清除，`appState != 'unlocked'` 时不可访问
2. **锁顺序**：Rust 中 master_key 始终先于 db 加锁，Service 层不获取锁
3. **密码重加密**：change_master_password 在单事务中原子完成
