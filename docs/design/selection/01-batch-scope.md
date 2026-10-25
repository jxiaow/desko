# 批量选择的作用域与计数诚实

- 日期：2026-10-25
- 状态：**已落码**（D1–D5 全部按推荐实施，验收见 §6 与 §9）
- 覆盖：网址收藏、小记、Codex 账号三处批量态；目标是「屏幕上写的条数 = 会被处理的条数」，并且破坏性动作在确认框里把看不见的部分说清楚。
- 不动：后端命令与表结构、批量端点、回收站、列表虚拟化。

## 1. 范围

收藏与小记的批量态共用同一套心智：勾选若干 → （可能换一次筛选）→ 全选 → 一次性处理。当前三处实现各说各话，最坏情况是**删掉屏幕上看不见的行**。本轮收口四件事：

1. 选中集与筛选结果的关系，以及「全选」「取消全选」各自作用于哪一批。
2. dock 计数与危险确认框的口径（含不在当前筛选里的条数）。
3. 条目消失后选中集的剪枝。
4. 收藏 dock 的常驻条件与页栏钮文案，向 10-20 小记定稿和 Codex 已有方言对齐。

不做：批量移动分类/加标签（属功能增强，另开）、点提示跳到隐藏选中项的 chip、跨分类选择的持久化与恢复、dock 折行或横向滚动。

## 2. 现状与核验

记 `S` = 选中集合，`V` = 当前筛选可见集合，`K = |S \ V|` = 选了但此刻看不见的条数。

| # | 问题 | 证据 | 级别 |
|---|---|---|---|
| 1 | **收藏的删除作用于 `S` 全集，而 `S` 跨筛选残留、`全选` 只追加 `V`**。换分类或搜索时 `selectedIds` 从不清空；「全选」把当前可见项 `add` 进集合；`doBatchDelete` 取整个集合送后端。典型路径「勾两条 → 换分类 → 全选 → 删除」删掉的是两批之和 | `useBatch.ts:14`、`:39-43`、`:49-63`；`entries.ts:33-46`（`filteredEntries` 由 `activeTab` + `searchKeyword` 决定） | P0 |
| 2 | **确认框只报总数，不报其中有几条不在本屏**，用户按屏幕上的行数理解这个数字 | `useBatch.ts:51`；小记同款 `notes.ts:930`；Codex 同款 `CodexModule.vue:362` | P0 |
| 3 | **小记的「全选」是替换**：`selectAllNotes` 用 `filteredNotes` 覆盖整个集合，先前跨视图攒的选中被静默丢掉；而删除/归档/置顶仍按替换后的集合执行，与收藏语义相反 | `notes.ts:908-910` 对 `useBatch.ts:39-43` | P0 |
| 4 | **「取消全选」在两个模块都清空整个 `S`**，在 B 分类点一下会把 A 分类攒的选中一起抹掉，与「全选只管本屏」不对称 | `useBatch.ts:45-47`；`notes.ts:912-914` | P1 |
| 5 | **条目消失后 `S` 不剪枝**。收藏单条删除走 `entriesStore.deleteEntry`，不碰 `selectedIds`，残 id 会进下一次批量删除的入参；小记只在 `doDeleteNote` 里手工 `delete` 一处 | `EntriesView.vue:82-93`；`notes.ts:595` | P1 |
| 6 | **收藏的 dock 只在有选中时出现**：进入待选态（页栏「选择条目」）后没有任何 dock，也就拿不到「全选」，必须先手动勾一颗。小记 10-20 已定稿「进入待选即常驻 dock，0 选显示提示」 | `EntriesModule.vue:398`；`docs/design/notes/05-reading-archive-batch.md:65`；e2e 现按旧契约断言 `entries.spec.ts:242-244` | P1 |
| 7 | **页栏批量钮文案漂移**：收藏仍是「退出选择」，小记按 10-20 定稿已改「完成选择」 | `EntriesModule.vue:271` 对 `NotesModule.vue:449`；`05-reading-archive-batch.md:210` | P2 |
| 8 | **筛选态下的钮名只有 Codex 做了**：`accountFiltersActive` 时写「全选筛选结果」，并有 e2e 固定「只增加当前可见账号」的契约；收藏与小记恒写「全选」，不区分作用范围 | `CodexModule.vue:743-744`；`codex-parity.spec.ts:120-126` | P2 |
| 9 | **dock 宽度没有余量可加**：800 最小窗上限 760px，小记零选态实测约 640px，10-20 是靠把置顶/收藏折进「更多」才收住的。计数段再挂长句会顶出胶囊 | `05-reading-archive-batch.md:65-69`、`:164`、`:289`；`global.css:2806-2819` | 约束 |

## 3. 拍板建议

### D1 语义：`S` 跨筛选保留，两个钮都只管本屏（推荐）

- `全选` / `全选筛选结果` = 把 `V` **并入** `S`（收藏与 Codex 现状，小记由「替换」改为并入）。
- `取消全选` / `取消本屏` = 从 `S` 里**移除 `V`**，不再清空整个集合。
- 「完成」/ Escape / 页栏钮 = 清空 `S` 并退出待选态（现状不变）。
- 效果：`S` 可以跨筛选攒批（合法需求：把 A、B 两个分类里的垃圾一起清），但任何一颗钮的作用范围都等于屏幕上这一屏，且两钮对称。
- 备选（不推荐）：筛选条件一变就清空 `S`。实现最小，但直接砍掉跨分类攒批，并且用户刚勾的东西会被一次无关的搜索抹掉。

### D2 计数诚实：确认框说全，dock 不加长句（推荐）

- dock 计数继续 `已选 N 项 / N 条`，`N = |S|`，**不追加文字**（受 §2#9 宽度硬账约束）。
- 当 `K > 0` 时，给 `.dock-count` 挂 `data-tip`：`其中 K 条不在当前筛选结果里`（hover 补充，不占宽）。
- 破坏性确认框是主披露位：
  - `K = 0` 时文案**逐字不变**：`N 条记录将被删除，此操作不可撤销。`
  - `K > 0` 时：`N 条记录将被删除，其中 K 条不在当前筛选结果里，此操作不可撤销。`
  - 小记同理：`N 条小记将被删除，其中 K 条不在当前筛选结果里，此操作不可撤销。`
- 非破坏性批量（归档/置顶/收藏/导出/合并）在结果 toast 里带上口径：`已归档 5 条小记`（`K>0` 时追加 `· 含 2 条非本屏`），不加第二条钮。
- 备选：dock 计数直接写「已选 12 条 · 本屏 5」。可见性最强，但 800 窗下小记 dock 会顶破 760px，需要重做 dock 布局；本轮不取。

### D3 剪枝：`S` 只保留仍然存在的条目（推荐）

- 收藏：watch `entriesStore.entries`，剔除库里已不存在的 id。
- 小记：watch `notes`，同一处理（覆盖单条删除、批量删除、合并吞掉源条目三条路径）。
- Codex：watch `accounts`，剔除已删除/已回收的 id。
- 只在「条目从数据源消失」时剪枝，筛选变化**不**剪枝（否则等于回到 D1 的备选）。

### D4 收藏 dock 与小记定稿对齐（推荐）

- `isBatchMode`（待选态或已有选中）即渲染 dock；0 选态 `已选 0 项` + `.dock-hint`「点收藏选择」，只有「全选」「完成」可用，其余 disabled。
- 页栏钮 `退出选择` → `完成选择`，`选择条目` 保留。
- 需同步 `entries.spec.ts:237-258`（现在断言「没有选中就没有 dock」）与 `:248` 的 `aria-label`。

### D5 三页统一方言（推荐）

- 筛选生效时：`全选` → `全选筛选结果`；`取消全选` → `取消本屏`（同为 4 字，不增宽度）。
- 收藏的筛选口径 = `searchKeyword` 非空或 `activeTab !== 'all'`；小记 = `noteSearchKeyword` 非空、`activeTags` 非空或视图非「全部」（视图切换同样改变 `V`，必须算筛选；口径与既有 `hasActiveFilters`（`notes.ts:255-257`）一致，不另起一套）；Codex 沿用 `accountFiltersActive`（`CodexModule.vue:160`）。
- 结果为空时「全选筛选结果」disabled，dock 仍可「完成」退出。

## 4. 详细设计

### 4.1 共享口径

新增 `src/utils/selection.ts`，只放纯函数、不带文案、不引 store 依赖，三页共用：

```ts
/** K = |S \ V|：选了但此刻不在屏幕上的条数 */
export const hiddenCount = (selected: Set<string>, visible: readonly string[]) => {
  const show = new Set(visible)
  let n = 0
  selected.forEach(id => { if (!show.has(id)) n += 1 })
  return n
}

export const visibleCount = (selected: Set<string>, visible: readonly string[]) =>
  selected.size - hiddenCount(selected, visible)

export const unionVisible = (selected: Set<string>, visible: readonly string[]) =>
  new Set([...selected, ...visible])

export const minusVisible = (selected: Set<string>, visible: readonly string[]) => {
  const hide = new Set(visible)
  return new Set([...selected].filter(id => !hide.has(id)))
}

export const prune = (selected: Set<string>, existing: readonly string[]) => {
  const live = new Set(existing)
  return [...selected].every(id => live.has(id)) ? selected : new Set([...selected].filter(id => live.has(id)))
}
```

工具函数只给数字，不带量词和标点；「条 / 个 / 项」与各页句式由页面自己拼，避免一个通用文案函数被三页的量词差异拖脏。`K = 0` 时调用方直接不生成那段从句。

`useBatch`、`notes.ts`、`CodexModule` 各自改成调用它；不在本轮抽公共 `useSelection` 组合式函数——三页的可见集来源与动作集不同，抽一层壳只会把差异藏起来。

### 4.2 三页改动点

| 页 | 全选 | 取消全选 | 计数 | 危险确认 |
|---|---|---|---|---|
| 收藏 | `S = unionVisible(S, V)`；筛选态钮名「全选筛选结果」 | `S = minusVisible(S, V)`；筛选态钮名「取消本屏」 | `已选 \|S\| 项`，`K>0` 加 `data-tip` | `N 条记录将被删除，其中 K 条不在当前筛选结果里，此操作不可撤销。`（`K=0` 删掉中间那短句） |
| 小记 | 同上（**由替换改为并入**） | 同上 | `已选 \|S\| 条`，`K>0` 加 `data-tip` | `N 条小记将被删除，其中 K 条不在当前筛选结果里，此操作不可撤销。`（同上） |
| Codex | 现状已并入，仅补 `K>0` 的披露 | 无此钮，不加 | 同上 | 现有句子后另起一句：`其中 K 个不在当前筛选结果里。`（`K=0` 不出现） |

小记其余批量动作（`batchSetArchived`、`batchSetPinned`、`batchSetStarred`、导出、`mergeSelectedNotes`）继续按 `S` 全集执行，只把结果 toast 追加「· 含 K 条非本屏」。`unarchiveAllFiltered` 本来就以 `V` 为入参，不动。

### 4.3 dock 与样式

- 收藏 dock 复用 `global.css` 的 `.batch-dock` / `.dock-count` / `.dock-hint` / `.dock-sep`（:2806-2819），不新增类。
- 0 选态复用 10-20 小记已实测过的槽位：`已选 0 项` + `点收藏选择`，宽度与 `notes` 的「点小记选择」同量级，收藏 dock 只有 5 项，800 窗无压力。
- 提示机制是文档级委托（`src/utils/tooltip.ts:58-83` 把 `title` 摘成 `data-tip` 并按属性变化重取），所以 `.dock-count` 只要挂上 `data-tip` 就有气泡，不需要注册任何东西，也不引第二套提示。
- `K = 0` 时不写 `data-tip` 属性，避免 hover 弹一句废话。

### 4.4 时序

- 剪枝 watch 用 `flush: 'post'`，在数据刷新之后收敛，避免在同一次删除里先用旧列表算 `K` 再报数。
- `doBatchDelete` 成功才清空 `S`；失败保留 `S` 并沿用现有 `删除失败: …` toast，让人能原地重试。
- 小记进入批量前的 `flushNoteSave()` 失败保留编辑面（10-20 已定），本轮不改；保存失败与本轮作用域是两条独立的线。

## 5. 落点

| 层 | 文件 | 改动 |
|---|---|---|
| 共享口径 | `src/utils/selection.ts`（新增）+ `selection.test.ts` | §4.1 五个纯函数；`hiddenCount` 是唯一的差集来源 |
| 收藏批量 | `src/composables/useBatch.ts` | 全选/取消全选改并入与移除；`K` 计算与 `data-tip` 文案；确认文案补「其中 K 条…」；watch 剪枝；失败不清 `S` |
| 小记批量 | `src/stores/notes.ts` | `selectAllNotes` 改并入；`clearSelection` 改移除本屏；确认文案补「其中 K 条…」；结果 toast 追「· 含 K 条非本屏」；watch 剪枝 |
| 收藏页 | `src/components/entries/EntriesModule.vue` | dock 渲染条件 `isBatchMode`；0 选 `.dock-hint`；钮名随筛选切换；`data-tip`；页栏「退出选择」→「完成选择」 |
| 小记页 | `src/components/notes/NotesModule.vue` | 钮名随筛选切换；`K>0` 时 `data-tip`；视图口径纳入筛选判定 |
| Codex | `src/components/codex/CodexModule.vue` | 补「取消本屏」以外的两处披露：`data-tip` 与批量删除/导出确认文案 |
| 视图接线 | `src/views/EntriesView.vue` | 单条删除后由 watch 统一剪枝，删除此处对 `selectedIds` 的隐式依赖 |
| 样式 | `src/styles/global.css` | 仅在收藏 0 选 dock 需要时补 `.dock-hint` 复用，不新增档 |
| 单测 | `src/utils/selection.test.ts`（新增）、`src/composables/useBatch.test.ts`、`src/components/notes/NotesModule.test.ts` | §6.1 |
| e2e | `e2e/specs/entries.spec.ts`、`e2e/specs/notes.spec.ts`、`notes-reading.spec.ts`、`codex-parity.spec.ts` | §6.2；`entries.spec.ts:237-258` 的「无选中即无 dock」断言按 D4 反转 |

## 6. 验收

### 6.1 单测

- `selection.ts`：`unionVisible` 不吞隐藏项、`minusVisible` 只移本屏、`hiddenCount`/`visibleCount` 互补、`prune` 边界（空 `V`、`S ⊂ V`、`S ∩ V = ∅`），以及 `prune` 在无变化时返回原引用（避免无谓的重渲染）。
- `useBatch`：勾 2 条 → 换分类 → 全选 → `S` 为 2+可见数；「取消本屏」后隐藏项仍在；`K>0` 时确认文案含「其中 K 条不在当前筛选结果里」；条目从 `entries` 消失后 `S` 自动剪枝；删除失败保留 `S`。
- `NotesModule`：`selectAllNotes` 由替换改并入后，既有「全选得 2 条」用例仍成立；视图切换（全部↔归档）不清 `S`；`K>0` 计数 `data-tip` 存在、`K=0` 不存在。

### 6.2 e2e（mock 通道，不碰真账号）

- 收藏：SEED 三条各属一类（`entries.spec.ts:4-10`）。勾「GitHub」→ 搜索 `mail`（只留「Gmail」）→ 点「全选筛选结果」→ `已选 2 项` → 「删除选中」→ 确认框整句须为 `2 条记录将被删除，其中 1 条不在当前筛选结果里，此操作不可撤销。`（`confirmDialog` 用 `toHaveText`，只能写全句）→ 本屏删空，清掉搜索后 `.entry-card` 只剩「钉钉」，`e2e.snapshot` 的 `entries` 里 GitHub 与 Gmail 都不在（mock 的 `batch_delete_entries` 按 ids 过滤并返回条数，`backend.ts:1986-1992`）。筛选用搜索而不是分类 tab：分类 tab 被 Teleport 进目录，开过确认框后目录会收起，锚点不稳定；两者改的都是同一个 `V`。
- 收藏 0 选：点页栏「选择条目」即出现 dock，`已选 0 项 · 点收藏选择`，删除 disabled，「完成」可退。
- 小记：勾一条 → 切「归档」视图（`K=1`）→ 点「全选筛选结果」→ `已选 2 条`，「取消本屏」后回到 `已选 1 条` 且先前那条仍在 → 删除确认整句 `2 条小记将被删除，其中 1 条不在当前筛选结果里，此操作不可撤销。`（`notes.spec.ts:735`）。非破坏性批量的「· 含 K 条非本屏」由 `notes.test.ts` 断言，e2e 不重复。
- 无筛选路径必须逐字复现现有断言：`已选 2 项`、`2 条记录将被删除，此操作不可撤销。`
- Codex：`codex-parity.spec.ts:120` 「筛选结果的全选只增加当前可见账号」保持绿（并入语义未变）；新增 `:133` 「跨筛选攒批的批量删除确认说清藏了几个」——勾 1 个 → 搜索叠上标签筛选 → `data-tip` 为 `其中 1 个不在当前筛选结果里`、`已选 3 条` → 确认句含 `将选中的 3 个账号移入回收站？其中 1 个不在当前筛选结果里。`；清掉搜索后同一句回落到 `将选中的 3 个账号移入回收站？可恢复…` 且 `data-tip` 消失。全程只跑 mock 账号。

### 6.3 视觉与回归

- 纸/墨 × 800×670 / 1040×670 拍收藏 dock（0 选、本屏有选、跨筛选攒选）与确认框；与 10-20 小记 dock 帧对拍，确认胶囊不溢出。
- `vue-tsc --noEmit`、`vitest run`、`entries.spec.ts`、`notes.spec.ts`、`notes-reading.spec.ts`、`codex-parity.spec.ts`。
- 现存量红（490c639 记入的 40 条 e2e 锚点与 23 条单测）不属于本轮，不得混入本轮验收结论。

## 7. 交付顺序

1. `selection.ts` + 单测（口径先定，页面后接）。
2. 收藏：`useBatch` → `EntriesModule` dock/钮名 → `entries.spec.ts` 迁移与新增用例。
3. 小记：`notes.ts` → `NotesModule` → `notes.spec.ts` / `notes-reading.spec.ts`。
4. Codex 两处披露。
5. 剪枝 watch 与失败保留 `S`。
6. 拍帧 + 全量回归。

## 8. 决策记录

- [x] D1 `S` 跨筛选保留，「全选」并入本屏、「取消全选」移除本屏
- [x] D2 dock 不加长句，`K>0` 的披露放 `data-tip` + 破坏性确认框；`K=0` 文案逐字不变
- [x] D3 条目消失即剪枝 `S`，筛选变化不剪枝
- [x] D4 收藏 dock 进入待选即常驻，0 选显示「点收藏选择」；页栏钮改「完成选择」
- [x] D5 三页统一「全选筛选结果 / 取消本屏」方言，小记把视图切换计入筛选口径

## 9. 实施与验证记录（2026-10-25）

落点与 §5 一致，另有三处按实现需要收窄：`NoteExportController.vue` 多收一个 `hidden` 入参（导出结果的「· 含 K 条非本屏」要在导出侧拼），`EntriesModule.vue` 的筛选口径 `filtersActive` 就地计算而不从视图透传，`EntriesView.vue` 只接 `hiddenSelected` prop——单条删除路径本来就没碰 `selectedIds`，残 id 由 `useBatch` 的剪枝 watch 统一收口。小记的 `offScreenSuffix` 必须在改数据**之前**取可见集，否则刚归档的那几条会反过来被判成非本屏。

单测：`selection.test.ts` 16、`useBatch.test.ts` 26、`notes.test.ts` 46、`NotesModule.test.ts` 29 全绿。全量 `vitest run` = 801 passed / 23 failed，失败集中在 `App.web`、`bypass/BypassModule`、`settings/WebAccessPane`、`settings/WebSettingsDialog` 四个文件，与 §6.3 记入的 490c639 存量红同一批（`window.matchMedia` 未打桩、主题档数断言落后），不属于本轮。`vue-tsc --noEmit` 退出 0。

e2e（mock 通道）：`entries.spec.ts` 16/16、`notes.spec.ts` 63 passed + 1 flaky（「中文标点与组合输入」首轮卡在 `.unlock-input` 超时，重试即绿，属并发飘）、`notes-reading.spec.ts` 7/7、`codex-parity.spec.ts` 17/17。`notes-reading` 里 `取消全选` 与 dock 不溢出的断言仍绿，即 `K=0` 路径逐字未动。

视觉硬账（800×670，纸）：dock 实宽 收藏 0 选 465 / 本屏有选 403 / 跨筛选攒选 455，小记跨视图攒选 594；右沿最远 697，`scrollWidth` 与实宽齐平（胶囊不折、不滚）。`data-tip` 只是属性，宽度零增长。纸墨 × 800/1040 共 28 帧落在 `.tmp/batch-scope-20261025/`，含 `已选 3 项` + 气泡「其中 2 项不在当前筛选结果里」与 `3 条记录将被删除，其中 2 条不在当前筛选结果里，此操作不可撤销。` 两态。

未做（§1 已列为不做）：点提示跳到隐藏选中项的 chip、跨分类选中持久化、dock 折行或横滚。
