# Toast 搬家：右下 → 内容区顶沿居中（2026-10-12）

## 问题

V5.2 起 toast 是右下角反色胶囊（`docs/design/v52/01-plan.md` §P4）。整窗 1040×670
里右下角属余光区，成功/提示只驻留 800ms，动作后基本捕不到——"很容易忽略"。

## 拍板（对拍稿 `01-top-center.src.html`，4 帧：纸/墨 × 成功/失败+信息）

- **只搬落点，胶囊本体一字不改**：`--toast-bg` 反色面、pill、6×14、12/500 字、三档字色、
  800/2400ms dwell 全部沿用。
- 落点 = **内容区（侧栏以右）水平居中**，标题栏下沿留 10px（窗口 top 52px）。
  居中参考系跟侧栏三态走：`App.vue` 把 `--toast-side`（56/208/0 + 1px 发丝线）喂给胶囊，
  展开/收起不脱靶。避开左上角模块名与右上六颗钮。
- 新增一枚 13px 图形帮第一眼定性：success=`check`、error=`alert`、info=`info`（AppIcon 档）。
- 与批量底栏（居中贴底 20px）分居上下两端，批量回执不撞栏。
- 入场/退场仍是 0.18s 淡入 + 8px 微位移（用独立 `translate` 属性，不与居中的
  `translateX(-50%)` 抢 transform）。

## 涉及文件

| 文件 | 改动 |
| --- | --- |
| `src/components/shared/ToastNotification.vue` | 落点 + 图标 |
| `src/App.vue` | `toastSide` computed，`.app-root` 挂 `--toast-side` |
| `e2e/specs/entries.spec.ts` | 「贴右下」用例改判顶沿居中（y=52、列居中 ±1px） |
| `scripts/toast-shots.mjs` | 3 号图改整窗（旧 clip 只拍底部 200px，已框不到胶囊） |

## 验收

- `vue-tsc` 干净；全量 e2e 241 绿（notes「插入芯片」两条为 HEAD 存量红，与本改动无关）。
- 真机帧（mock 流水线，纸/墨 × 图标轨/展开四帧）：胶囊顶沿居中、随侧栏宽度重新居中，
  墨底翻亮胶囊配方无漂移。
