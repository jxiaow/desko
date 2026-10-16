#!/usr/bin/env node
/*
 * 主题令牌清单导出 —— 给外部设计模型/新配色稿当输入用。
 *
 * 和 check-theme-coverage.mjs 的区别：那个管"有没有漏槽"，这个管"有哪些槽、
 * 当前是什么值、被谁在用"。数据全部从 src/styles/global.css 与 src/** 现场解析，
 * 不维护第二份清单，所以不会和代码飘。
 *
 * 用法：
 *   node scripts/theme-tokens-dump.mjs              # 打 stdout
 *   node scripts/theme-tokens-dump.mjs --out <path> # 写文件（LF）
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const CSS_PATH = join(ROOT, 'src', 'styles', 'global.css')
const MATERIAL_PATH = join(ROOT, 'src', 'styles', 'materials.css')

const { readPolarity, readThemeIds, readStyleSource } = await import('./lib/theme-tokens.mjs')

/* 底色/accent 名单一律从 theme.ts 现读：这里再抄一份，改轴时就漏一处 */
const { themes: THEME_INFOS, accents: ACCENT_INFOS } = readThemeIds()
const BASES = THEME_INFOS.map((t) => t.id)
const BASE_CN = Object.fromEntries(THEME_INFOS.map((t) => [t.id, t.name]))
const BASELINE = 'paper'
const POLARITIES = ['light', 'dark']
const POL_OF = Object.fromEntries(readPolarity())
const ACCENTS = ACCENT_INFOS.map((a) => a.id)
const cnOf = (id) => BASE_CN[id] ?? ACCENT_INFOS.find((a) => a.id === id)?.name ?? id
const basesOf = (pol) => BASES.filter((t) => POL_OF[t] === pol)

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

function parseDecls(body) {
  const out = []
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g
  let m
  while ((m = re.exec(body))) out.push({ name: m[1], value: m[2].trim() })
  return out
}

const BASE_RE = /^(?::root|:where\(:root\))(?:\s*,\s*\[data-theme="([\w-]+)"\])?$/
const ACCENT_RE = /^\[data-base="([\w-]+)"\]\[data-accent="([\w-]+)"\]$/

function collectBlocks(css) {
  const blocks = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const selector = m[1].trim().replace(/\s+/g, ' ')
    const base = BASE_RE.exec(selector)
    const accent = ACCENT_RE.exec(selector)
    if (base) blocks.push({ kind: 'base', theme: base[1] ?? 'root', selector, decls: parseDecls(m[2]) })
    else if (accent) blocks.push({ kind: 'accent', polarity: accent[1], accent: accent[2], selector, decls: parseDecls(m[2]) })
    else if (/^\[data-theme="[\w-]+"\]$/.test(selector)) {
      blocks.push({ kind: 'base', theme: /\[data-theme="([\w-]+)"\]/.exec(selector)[1], selector, decls: parseDecls(m[2]) })
    } else blocks.push({ kind: 'other', selector, decls: parseDecls(m[2]) })
  }
  return blocks
}

const rawCss = readFileSync(CSS_PATH, 'utf8')
const css = stripComments(rawCss).replace(/@import\s+['"][^'"]+['"]\s*;/g, '')
const blocks = collectBlocks(css)
const materialBlocks = collectBlocks(stripComments(readStyleSource(MATERIAL_PATH))).filter((b) => b.decls.length)

const baseSlots = new Map()
const comboSlots = new Map()
const others = []
for (const b of blocks) {
  if (b.kind === 'base' && b.theme !== 'root') {
    if (!baseSlots.has(b.theme)) baseSlots.set(b.theme, new Map())
    for (const d of b.decls) baseSlots.get(b.theme).set(d.name, d.value)
  } else if (b.kind === 'accent') {
    const key = `${b.polarity}/${b.accent}`
    if (!comboSlots.has(key)) comboSlots.set(key, new Map())
    for (const d of b.decls) comboSlots.get(key).set(d.name, d.value)
  } else others.push(b)
}

const slots = [...baseSlots.get(BASELINE).keys()]
const ACCENT_FAMILY = new Set(comboSlots.get(`${POLARITIES[0]}/${ACCENTS[0]}`)?.keys() ?? [])

/* ---- 消费点：谁在用这个槽 ---- */
const usages = new Map() // slot -> Map(file -> count)
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(vue|css|ts|js|mjs|html)$/.test(name)) out.push(p)
  }
  return out
}
for (const file of walk(join(ROOT, 'src'))) {
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*[,)]/g)) {
    if (!usages.has(m[1])) usages.set(m[1], new Map())
    const perFile = usages.get(m[1])
    perFile.set(rel, (perFile.get(rel) ?? 0) + 1)
  }
}

const where = (slot) => {
  const perFile = usages.get(slot)
  if (!perFile) return '_无人引用_'
  const ordered = [...perFile.entries()].sort((a, b) => b[1] - a[1])
  const total = ordered.reduce((s, [, n]) => s + n, 0)
  const shown = ordered.slice(0, 3).map(([f, n]) => `${f}${n > 1 ? ` ×${n}` : ''}`).join(', ')
  return ordered.length > 3 ? `${shown} +${ordered.length - 3}处 / 共 ${total}` : `${shown} / 共 ${total}`
}

/* ---- 常量层（尺度：主题不许动） ---- */
const scaleDecls = blocks.find((b) => b.kind === 'base' && b.theme === 'root').decls

/* ---- 别名层（派生槽：跟着源头走，外部稿不必给值） ---- */
const themeOwned = new Set([...baseSlots.values()].flatMap((m) => [...m.keys()]))
const aliasRows = []
for (const b of others) {
  for (const d of b.decls) {
    if (!themeOwned.has(d.name) && d.value.includes('var(')) aliasRows.push(d)
  }
}

const cell = (s) => s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()

/* ═══ 色值数学：把"现值"反推成可复制的推导式，供无项目访问权的设计模型复用 ═══ */
const parseColor = (s) => {
  const h = /^#([0-9a-f]{6})$/i.exec(s)
  if (h) return { rgb: [1, 3, 5].map((i) => parseInt(h[1].slice(i - 1, i + 1), 16)), a: 1 }
  const r = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,/]+\s*([\d.]+))?\s*\)/i.exec(s)
  if (r) return { rgb: [+r[1], +r[2], +r[3]], a: r[4] === undefined ? 1 : parseFloat(r[4]) }
  return null
}
const chanLin = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
const relLum = (rgbA) => rgbA.map(chanLin).reduce((acc, v, i) => acc + [0.2126, 0.7152, 0.0722][i] * v, 0)
const labL = (rgbA) => { const Y = relLum(rgbA); return Y > 0.008856 ? 116 * Y ** (1 / 3) - 16 : 903.3 * Y }
const contrast = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const clamp255 = (v) => Math.max(0, Math.min(255, v))
/** 主色 c 以 t 混入参照色 o：c + (o - c) * t，t ∈ [0,1] */
const mixToward = (c, o, t) => c.map((v, i) => clamp255(v + (o[i] - v) * t))
/** 主色等比缩放 k */
const scaleK = (c, k) => c.map((v) => clamp255(v * k))
/** 最小二乘解 t：让 mixToward(c,o,t) 尽量贴近 target */
function solveT(c, o, target) {
  let num = 0, den = 0
  for (let i = 0; i < 3; i++) { const d = o[i] - c[i]; num += d * (target[i] - c[i]); den += d * d }
  return den === 0 ? 0 : Math.max(0, Math.min(1, num / den))
}
function solveK(c, target) {
  let num = 0, den = 0
  for (let i = 0; i < 3; i++) { num += c[i] * target[i]; den += c[i] * c[i] }
  return den === 0 ? 0 : num / den
}
const errOf = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
/** 对「主色 → 派生色」找最贴近的一种配方，返回短表达式与残差（0-255 通道） */
function recipe(primary, target, surface) {
  if (!primary || !target) return { expr: '—', err: null }
  const near = (c, v) => errOf(c, v) <= 1
  if (target.a === 1 && primary.a === 1 && near(target.rgb, primary.rgb)) return { expr: '与主色同值', err: 0 }
  if (target.a < 1 && errOf(target.rgb, primary.rgb) <= 2) return { expr: `主色 α${Math.round(target.a * 100)}%`, err: 0 }
  if (target.a === 1 && near(target.rgb, [255, 255, 255])) return { expr: '纯白实色', err: 0 }
  if (target.a === 1 && (near(target.rgb, [23, 22, 20]) || near(target.rgb, [0, 0, 0]))) return { expr: '近黑实色', err: 0 }
  const cands = []
  const mw = solveT(primary.rgb, [255, 255, 255], target.rgb)
  cands.push({ expr: `主色 ${Math.round((1 - mw) * 100)}% + 白 ${Math.round(mw * 100)}%`, err: errOf(mixToward(primary.rgb, [255, 255, 255], mw), target.rgb) })
  const mk = solveK(primary.rgb, target.rgb)
  if (mk > 0 && mk < 1.6) cands.push({ expr: `主色 ×${mk.toFixed(2)}`, err: errOf(scaleK(primary.rgb, mk), target.rgb) })
  if (surface && !near(surface.rgb, [255, 255, 255])) {
    const ms = solveT(primary.rgb, surface.rgb, target.rgb)
    cands.push({ expr: `主色 + 面色 ${Math.round(ms * 100)}%`, err: errOf(mixToward(primary.rgb, surface.rgb, ms), target.rgb) })
  }
  cands.sort((a, b) => a.err - b.err)
  return cands[0]
}

/* ---- 分组与语义：新模型只看名字猜不出这块颜色涂在哪儿 ---- */
const NOTE = {
  '--accent': '主强调色：主按钮底、链接、激活描边',
  '--accent-hover': '主强调色悬停（比 accent 深一档）',
  '--accent-active': '主强调色按下',
  '--accent-on': 'accent 底上的文字，恒为最亮/最暗一点',
  '--accent-soft': 'accent 的浅水洗底：选中行、浅色徽标',
  '--accent-light': '比 soft 再重一档的 accent 底',
  '--accent-ring': '焦点环 / 外发光',
  '--text-brand': 'accent 族的文字档（链接、激活标签）',
  '--badge-ver-bg': '版本胶囊徽标底',
  '--badge-ver-text': '版本胶囊徽标字',
  '--brand-g1': '品牌标渐变上端',
  '--brand-g2': '品牌标渐变中段（= accent）',
  '--brand-g3': '品牌标渐变下端',
  '--lock-orb-1': '历史光晕色槽（保留主题契约；当前材质由 accent 推导）',
  '--lock-orb-2': '历史光晕色槽（保留主题契约；当前材质由 accent 推导）',
  '--selection': '文本选区底色',
  '--toast-info': '信息 toast 的图标/文字色',

  '--bg': '窗体画布底（最外层面）',
  '--panel-bg': '卡片/面板/弹窗面（占窗面约七成，刻意非纯白）',
  '--chrome-bg': '标题栏一类的半透明吸顶底',
  '--sunken': '下陷面：输入槽、代码底、字母块、页栏铺底',
  '--fill': '中性填充：进度槽、占位块、次级底',
  '--hover': '行/卡片悬停底（必须与 --panel-bg 保持约 5 级差）',
  '--active': '行/项按下选中底',
  '--overlay': '遮罩层（弹窗背后的那层压暗）',

  '--text': '正文一级字',
  '--text-secondary': '二级字（说明、次要字段）',
  '--text-muted': '三级字（标签、时间戳）',
  '--text-faint': '四级字（占位、辅助）——深色下最低 5.8:1 底线',
  '--text-url': '裸链接字色',

  '--border': '发丝描边：卡片/输入/分隔，分层主力',
  '--border-strong': '重描边：需要压住的边界、--shadow 的 1px 环',
  '--border-subtle': '极浅描边（比 --border 更退）',
  '--border-hover': '悬停描边',

  '--badge-cat-bg': '分类胶囊徽标底',
  '--badge-cat-border': '分类胶囊徽标描边',
  '--badge-cat-text': '分类胶囊徽标字',

  '--shadow-xs': '最小投影',
  '--shadow-card': '行卡投影（轻量化轮起只留一丝贴地感）',
  '--shadow-sm': '小投影',
  '--shadow': '常规浮层投影（带 1px 描边环）',
  '--shadow-md': '中投影',
  '--shadow-lg': '大投影',
  '--shadow-pop': '弹层/菜单投影（最高一档常规浮面）',
  '--shadow-dock': '批量操作药丸投影（高于任何弹层）',

  '--danger': '危险/删除实色',
  '--danger-on': '危险底上的字',
  '--danger-hover': '危险悬停',
  '--danger-soft': '危险浅底',
  '--danger-border': '危险描边',
  '--success': '成功实色',
  '--success-soft': '成功浅底',
  '--warning': '警告实色',
  '--warning-soft': '警告浅底',

  '--sidebar-bg': '侧栏底（纸：比画布略深；墨：落在画布与卡面之间）',
  '--sidebar-hover': '侧栏项悬停底',

  '--brand-knob': '品牌标上的高光旋钮/最亮点',
  '--lock-wash-a': '锁屏渐变上端',
  '--lock-wash-b': '锁屏渐变下端',

  '--frost-bg': '毛玻璃底栏背景',
  '--frost-border': '毛玻璃底栏描边',

  '--tip-bg': '气泡提示底（深色主题下反转成亮底）',
  '--tip-fg': '气泡提示字',
  '--toast-bg': 'toast 底',
  '--toast-ok': 'toast 成功色',
  '--toast-err': 'toast 错误色',

  '--scrollbar': '滚动条滑块',
  '--scrollbar-hover': '滚动条悬停',

  '--cat-text': '头像色块上的字',
  '--cat-1': '分类色板 1（紫蓝）：头像/色相钉，六档同明度同彩度',
  '--cat-2': '分类色板 2（紫）',
  '--cat-3': '分类色板 3（玫红）',
  '--cat-4': '分类色板 4（褐）',
  '--cat-5': '分类色板 5（苔绿）',
  '--cat-6': '分类色板 6（青蓝）',

  '--ft-pdf': '文件类型图标色：PDF（红）',
  '--ft-doc': '文件类型图标色：文档（蓝）',
  '--ft-sheet': '文件类型图标色：表格（绿）',
  '--ft-deck': '文件类型图标色：演示（橙）',
  '--ft-arch': '文件类型图标色：压缩包（紫）',
  '--ft-code': '文件类型图标色：代码（黄）',
  '--ft-mark': '文件类型图标色：Markdown（中性灰蓝）',
  '--ft-img': '文件类型图标色：图片（品红）',
  '--ft-unk': '文件类型图标色：未知（灰）',

  '--code-fg': '代码块前景/底色字',
  '--code-kw': '语法色：关键字',
  '--code-str': '语法色：字符串',
  '--code-num': '语法色：数字',
  '--code-type': '语法色：类型名',
  '--code-fn': '语法色：函数名',
  '--code-var': '语法色：变量',
  '--code-com': '语法色：注释（最静档，但必须在 --sunken 上可读）',
  '--code-tag': '语法色：标签',
  '--code-pun': '语法色：标点',
  '--font-ui': '界面字族（两底色同值，内置 HarmonyOS Sans SC）',
  '--font-mono': '等宽字族（Consolas 优先，中文回落族必须接上）',
}
const GROUPS = [
  ['accent 族（17 槽，由覆盖层重填）', (s) => ACCENT_FAMILY.has(s)],
  ['面 / 底', (s) => ['--bg', '--panel-bg', '--chrome-bg', '--sunken', '--fill', '--hover', '--active', '--overlay'].includes(s)],
  ['文字', (s) => s.startsWith('--text')],
  ['描边', (s) => s.startsWith('--border')],
  ['徽标', (s) => s.startsWith('--badge-')],
  ['投影', (s) => s.startsWith('--shadow')],
  ['状态色', (s) => /^--(danger|success|warning)/.test(s)],
  ['侧栏', (s) => s.startsWith('--sidebar')],
  ['品牌 / 锁屏', (s) => /^--(brand|lock)/.test(s)],
  ['毛玻璃 / 浮层', (s) => /^--(frost|tip|toast)/.test(s)],
  ['滚动条 / 选区', (s) => s.startsWith('--scrollbar')],
  ['头像分类色', (s) => s.startsWith('--cat-')],
  ['文件类型色', (s) => s.startsWith('--ft-')],
  ['代码语法色', (s) => s.startsWith('--code-')],
  ['字体', (s) => s.startsWith('--font')],
]
const groupedSlots = () => {
  const taken = new Set()
  const out = []
  for (const [title, pred] of GROUPS) {
    const rows = slots.filter((s) => pred(s) && !taken.has(s))
    rows.forEach((s) => taken.add(s))
    if (rows.length) out.push({ title, rows })
  }
  const rest = slots.filter((s) => !taken.has(s))
  if (rest.length) out.push({ title: '其余', rows: rest })
  return out
}

const out = []
out.push('# desko 主题令牌清单（机器导出）', '')
out.push(`> 由 \`node scripts/theme-tokens-dump.mjs\` 从 \`src/styles/global.css\`、\`src/styles/materials.css\` 与 \`src/**\` 现场解析生成，请勿手改。`)
out.push(`> 底色槽位 **${slots.length}** 个，其中跟随 accent 的 **${ACCENT_FAMILY.size}** 个；底色 ${BASES.length} 套 × accent ${ACCENTS.length} 档 = ${BASES.length * ACCENTS.length} 个可见组合，但 accent 覆盖层只按**极性**写，共 ${POLARITIES.length * ACCENTS.length} 块。`, '')

out.push('## 1. 契约与读法（这份文件是自包含的，读它的人不需要项目访问权）', '')
out.push('**这份清单怎么用**：')
out.push(`- 第 2 节 = 全部键名逐字列出 + 现有 ${BASES.length} 套底色（${BASES.map(cnOf).join(' / ')}）的当前值，它是**参考系**：新配色必须落在同一套键名上，键名照抄、不许自创也不许省略。`)
out.push('- 第 3 节 = accent 族 17 槽在 ' + POLARITIES.length * ACCENTS.length + ' 个极性组合下的当前值。')
out.push('- 第 4 节 = 面族明度阶梯（每个面的 L\\*、相邻档差多少）；第 5 节 = 对比度实测（字色对四面、彩底上的字、语法色对底）——这两节是**判据**，不是风格建议。')
out.push('- 第 6 节 = 从现值反推出的推导公式：新加一档强调色只需要定 1 个主色，其余 16 槽按公式给。')
out.push('- 第 7 节 = 不许重设计的东西（别名层跟着源头走，尺度层恒定；材质层按氛围状态覆盖）。')
out.push('- 第 9 节 = 交付格式（填空模板，照抄键名回填即可）；第 10 节 = 历史踩过的坑；第 11 节 = 可直接粘贴的任务提示词。', '')
out.push('**硬契约**：')
out.push(`- 底色轴 \`[data-theme="${BASES.join('"|"')}"]\` 各填**完全相同的槽位名**，缺一个槽 = 切过去那块颜色不动。`)
out.push(`- 第二根轴是**极性** \`light\` / \`dark\`，由底色决定（${basesOf('light').map(cnOf).join('/')}=light，${basesOf('dark').map(cnOf).join('/')}=dark），用户不能单设。`)
out.push(`- accent 覆盖层 \`[data-base=x][data-accent=y]\` 只许动第 3 节列出的 ${ACCENT_FAMILY.size} 个槽，且 ${POLARITIES.length}×${ACCENTS.length}=${POLARITIES.length * ACCENTS.length} 块必须齐全——新增底色**不必**再配一轮 accent，只要在 theme.ts 的 POLARITY 表里登记它属于哪一极。`)
out.push('- 底色块内**只放具体色值**，不许出现 `var()`；accent 块允许 `color-mix()` 引用随底走的槽（如洗底掺 `var(--panel-bg)`）。引用别的槽仍是别名层的活。')
out.push('- 第 7 节的派生/尺度槽由 `var()` 指向源头，新配色**不要**给它单独给值，除非确实要断开。')
out.push('- 本项目侧的校验（不需要你执行）：`node scripts/check-theme-coverage.mjs`；行为回归：`npx playwright test e2e/specs/theme.spec.ts`。', '')

out.push(`## 2. 底色层：全部槽位 × 现有 ${BASES.length} 套值`, '')
for (const g of groupedSlots()) {
  out.push(`### ${g.title}`, '')
  out.push('| 槽位 | ' + BASES.map((t) => `${t}（${BASE_CN[t]}）`).join(' | ') + ' | 涂在哪里 | 消费点 |')
  out.push('| --- | ' + BASES.map(() => '---').join(' | ') + ' | --- | --- |')
  for (const s of g.rows) {
    const mark = ACCENT_FAMILY.has(s) ? ' ⟨accent⟩' : ''
    out.push(`| \`${s}\`${mark} | ` + BASES.map((t) => cell(baseSlots.get(t).get(s) ?? '—')).join(' | ') + ` | ${cell(NOTE[s] ?? '—')} | ${cell(where(s))} |`)
  }
  out.push('')
}

out.push(`## 3. accent 族：17 槽 × ${POLARITIES.length} 极性 × ${ACCENTS.length} 档`, '')
out.push(`同一极的几套底色共用一块（例如${basesOf('light').map(cnOf).join('底和')}底吃到完全相同的 accent 值）；带 ⟨随底⟩ 的槽用了 \`var()\`/\`color-mix()\`，会跟着底色走。`, '')
const comboKeys = ACCENTS.flatMap((a) => POLARITIES.map((p) => `${p}/${a}`))
out.push('| 槽位 | ' + comboKeys.map((k) => k.replace('/', '×')).join(' | ') + ' |')
out.push('| --- | ' + comboKeys.map(() => '---').join(' | ') + ' |')
for (const s of [...ACCENT_FAMILY]) {
  out.push(`| \`${s}\` | ` + comboKeys.map((k) => {
    const v = comboSlots.get(k)?.get(s) ?? '—'
    return cell(v) + (/var\(|color-mix\(/.test(v) ? ' ⟨随底⟩' : '')
  }).join(' | ') + ' |')
}
out.push('')

out.push('## 4. 面族明度阶梯（实色层，换主题时这一族定生死）', '')
const SURFACES = ['--sunken', '--sidebar-bg', '--bg', '--hover', '--panel-bg', '--fill', '--active']
const P = (t, s) => parseColor(baseSlots.get(t).get(s))
const L = (t, s) => labL(P(t, s).rgb)
const sortedSurfaces = [...SURFACES].sort((a, b) => L('paper', b) - L('paper', a))
const paperL = SURFACES.map((s) => L('paper', s))
const paperGaps = sortedSurfaces.slice(1).map((s, i) => L('paper', sortedSurfaces[i]) - L('paper', s))
out.push('| 槽（按纸底 L\\* 从高到低排） | ' + BASES.map((t) => `${BASE_CN[t]}底值 | ${BASE_CN[t]} L\\*`).join(' | ') + ' | 说明 |')
out.push('| --- | ' + BASES.map(() => '--- | ---').join(' | ') + ' | --- |')
for (const s of sortedSurfaces) {
  out.push(`| \`${s}\` | ` + BASES.map((t) => `${cell(baseSlots.get(t).get(s))} | ${L(t, s).toFixed(1)}`).join(' | ') + ` | ${cell(NOTE[s] ?? '—')} |`)
}
out.push('')
const chan = (t, s) => P(t, s).rgb[0]
const gap = (t, a, b) => Math.abs(chan(t, a) - chan(t, b))
out.push('**从现值反推的阶梯规则（新底色请沿用，别自创一层）**：', '')
out.push(`- 纸：七档实色面全部挤在 L\\*${Math.min(...paperL).toFixed(1)}–${Math.max(...paperL).toFixed(1)} 这 ${(Math.max(...paperL) - Math.min(...paperL)).toFixed(1)} 的窄窗口内，排序后相邻档差只有 ${Math.min(...paperGaps).toFixed(1)}–${Math.max(...paperGaps).toFixed(1)}。**浅色下的"分层"不靠色块明暗，靠发丝描边**：\`--border\` 比卡面暗 RGB ${gap('paper', '--panel-bg', '--border')}、比画布暗 ${gap('paper', '--bg', '--border')}、比下陷面暗 ${gap('paper', '--sunken', '--border')}。卡面 ${L('paper', '--panel-bg').toFixed(1)} 最亮但**不用纯白**（255 会把眼睛适应点亮到顶，旁边 ${L('paper', '--sunken').toFixed(1)} 的下陷面就显脏）。`)
out.push(`- 纸：\`--hover\`（L\\*${L('paper', '--hover').toFixed(1)}）比卡面暗 ${Math.max(0, L('paper', '--panel-bg') - L('paper', '--hover')).toFixed(1)}、比画布还暗 ${Math.max(0, L('paper', '--bg') - L('paper', '--hover')).toFixed(1)}：行悬停是"略微压暗"而不是提亮，且只铺在卡面上（画布/页栏面上的控件悬停走另一档派生值 --hover-chrome，从字色反推 9%）。`)
out.push(`- 墨：方向整体反转（面朝"变亮"分层）：\`--sunken\` ${L('ink', '--sunken').toFixed(1)}（最底）→ 侧栏 ${L('ink', '--sidebar-bg').toFixed(1)} → 画布 ${L('ink', '--bg').toFixed(1)} → 卡面 ${L('ink', '--panel-bg').toFixed(1)} → 悬停 ${L('ink', '--hover').toFixed(1)} → 填充 ${L('ink', '--fill').toFixed(1)} → 按下 ${L('ink', '--active').toFixed(1)}。卡面比画布只亮 ΔL\\*${(L('ink', '--panel-bg') - L('ink', '--bg')).toFixed(1)}、比最底的下陷面亮 ΔL\\*${(L('ink', '--panel-bg') - L('ink', '--sunken')).toFixed(1)}，**分层主要由 \`--border\` 发丝描边主担**，墨底描边必须明显亮于卡面。`)
out.push('- 墨：比卡面亮的槽一律在"白方向"上按 ΔL\\* 求解（沿用旧差值）；带色相的软底（danger/success/warning-soft）保色相整族 RGB 等比缩放到同一 ΔL\\*。不要逐个手调色号——求解器见 `scripts/ink-ladder.mjs`。', '')

out.push('## 5. 对比度实测（这是判据，不是建议）', '')
const BG_FOR_TEXT = ['--panel-bg', '--sunken', '--bg', '--sidebar-bg']
const ratio = (t, s, slot) => {
  const f = P(t, slot)
  if (!f || f.a < 1) return '—'
  return BG_FOR_TEXT.map((b) => {
    const bg = P(t, b)
    return bg ? `${contrast(f.rgb, bg.rgb).toFixed(2)}` : '—'
  }).join(' / ')
}
out.push('字色对四面（卡面 / 下陷 / 画布 / 侧栏）的对比度：', '')
out.push(`| 槽 | ${BASES.map((t) => BASE_CN[t]).join(' | ')} | 底线 |`)
out.push('| --- | ' + BASES.map(() => '---').join(' | ') + ' | --- |')
const TEXT_MIN = { '--text': '≥4.5', '--text-secondary': '≥4.5', '--text-muted': '暗底 ≥5.8', '--text-faint': '暗底 ≥5.5（已被 5.8 卡过）', '--text-url': '≥4.5', '--danger': '≥4.5', '--success': '≥4.5', '--warning': '≥4.5', '--text-brand': '≥4.5' }
for (const s of Object.keys(TEXT_MIN)) out.push(`| \`${s}\` | ${BASES.map((t) => ratio(t, s, s)).join(' | ')} | ${TEXT_MIN[s]} |`)
out.push('')
out.push('彩底上的字（`*-on` 与分类/语法色）：', '')
out.push(`| 前景 | 底色 | ${BASES.map((t) => BASE_CN[t]).join(' | ')} | 判据 |`)
out.push('| --- | --- | ' + BASES.map(() => '---').join(' | ') + ' | --- |')
const pair = (label, fg, bg, need) => {
  const q = (t) => { const f = P(t, fg), b = P(t, bg); if (!f || !b) return '—'; return f.a < 1 ? 'α' : contrast(f.rgb, b.rgb).toFixed(2) }
  out.push(`| \`${fg}\` | \`${bg}\` ${label} | ${BASES.map((t) => q(t)).join(' | ')} | ${need} |`)
}
pair('主按钮字', '--accent-on', '--accent', '白/近黑取底色阶最亮(纸)最暗(墨)一点')
pair('危险按钮字', '--danger-on', '--danger', '同上')
for (let i = 1; i <= 6; i++) pair(`头像色板 ${i} 上的字`, '--cat-text', `--cat-${i}`, '色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度')
for (const s of ['--ft-pdf', '--ft-doc', '--ft-sheet', '--ft-code', '--ft-unk']) pair('文件图标色', s, '--panel-bg', '≥3:1（图形件）')
for (const s of ['--code-fg', '--code-kw', '--code-str', '--code-num', '--code-fn', '--code-com']) pair('代码语法色', s, '--sunken', '≥4.5:1；注释是最静档但仍要可读')
out.push('', '> 头像行只看色板本身对卡面：`--cat-text` 是色块上的字（纸底白字 / 墨底近黑字），不落在卡面上。', '')

out.push(`## 6. accent 族推导配方（把 ${comboKeys.length} 组合的现值反推成公式）`, '')
out.push('用途：**新加一档 accent 只要定一个主色**，其余 16 槽按这里的配方推导；新底色不吃新值——它只需登记进 POLARITY，复用所在极性的这一列。`+白/面色 n%` 指 `color-mix(in srgb, 主色 n%, 参照色)`，`×k` 指 RGB 等比缩放，`αn%` 指主色按 n% 不透明度叠在面上。', '')
out.push(`| 槽 | 亮极性（代表底：纸） | 暗极性（代表底：墨） |`)
out.push('| --- | --- | --- |')
const REP = { light: 'paper', dark: 'ink' }
for (const s of [...ACCENT_FAMILY]) {
  if (s === '--accent') continue
  const line = (p) => ACCENTS.map((a) => {
    const prim = parseColor(comboSlots.get(`${p}/${a}`).get('--accent'))
    const tgt = parseColor(comboSlots.get(`${p}/${a}`).get(s))
    const surf = parseColor(baseSlots.get(REP[p]).get('--panel-bg'))
    const r = recipe(prim, tgt, surf)
    return `${a}:${r.expr}${r.err && r.err > 4 ? `（残差${r.err}）` : ''}`
  }).join('；')
  out.push(`| \`${s}\` | ${line('light')} | ${line('dark')} |`)
}
out.push('')
out.push('读法：纸底的浅水洗底（`--accent-soft` / `--badge-ver-bg`）≈ 主色 10–12% 混白，`--accent-light` ≈ 18–22% 混白，`--accent-ring` 是主色 16% 透明；墨底整族改走半透明（soft 15–16%、light 26–28%、ring 32%、selection 30%），因为墨底上浮层要"透出底下的面"而不是叠一层不透明浅斑。`--accent-hover/active` 纸底是主色等比压暗（×0.82 / ×0.68 上下），墨底反过来提亮（×1.19 上下）。', '')
out.push('残差 >4 的格子说明那一档是手工微调过的，不是纯公式产物——新配色可以照公式给初值，再用第 5 节的判据回校。', '')

out.push('## 7. 不随主题变化的层（外部稿不必、也不应重新设计）', '')
out.push('### 7.1 别名/派生槽 —— `var()` 指向源头，切主题自动跟随', '')
out.push('| 槽位 | 定义 |')
out.push('| --- | --- |')
for (const d of aliasRows) out.push(`| \`${d.name}\` | ${cell(d.value)} |`)
out.push('')
out.push('### 7.2 尺度槽 —— 圆角/间距/字号/动效/布局恒定', '')
out.push('| 槽位 | 值 |')
out.push('| --- | --- |')
for (const d of scaleDecls) out.push(`| \`${d.name}\` | ${cell(d.value)} |`)
out.push('')
out.push('### 7.3 材质角色 —— 主题提供颜色，氛围开关决定表面策略', '')
out.push('以下按源码顺序列出默认定义与状态覆盖。默认定义用于根节点与主题预览的 `.theme-scope`，再叠加当前匹配的 `data-atmosphere` 块；同名槽在不同状态下的值有不同的适用条件。', '')
out.push('| 适用选择器 | 槽位 | 定义 |')
out.push('| --- | --- | --- |')
for (const b of materialBlocks) {
  for (const d of b.decls) out.push(`| \`${cell(b.selector)}\` | \`${d.name}\` | ${cell(d.value)} |`)
}
out.push('')

out.push('## 8. 新增一套主题要动的地方（本项目侧，供了解成本）', '')
out.push('1. `src/styles/global.css` —— 新底色块补满 ' + slots.length + ' 槽（accent 族那 17 槽填所在极性的缺省档即可）；新 accent 档补齐 ' + POLARITIES.length + ' 个极性块')
out.push('2. `src/services/theme.ts` —— `THEMES` / `ACCENTS` 数组加 ID 与名称，新底色在 `POLARITY` 表登记极性。类型与设置选项由注册表生成；预览直接读取 CSS 颜色与材质，不维护色值副本')
out.push('3. `scripts/check-theme-coverage.mjs` —— 名单从 `theme.ts` 现读，运行校验即可')
out.push('4. `e2e/specs/theme.spec.ts` —— `BASES` / `ACCENT_HEX` 锚点表（底色那两列存的是 `rgb(...)` 计算值，不是 hex；`ACCENT_HEX` 按极性键）')
out.push('5. 截图脚本参数名（`theme-shots.mjs` / `dialog-shots.mjs` / `design-audit.mjs` 等按组合名出图）')
out.push('')
out.push('**不需要动 Rust**：`src-tauri/src/commands/settings.rs` 与 `e2e/mocks/backend.ts` 的白名单是**键**白名单（`theme` / `accent` 已在列），新增色档不经过它；只有引入新设置键时才改那两处。', '')

out.push('## 9. 新配色填空模板', '')
out.push('一套**新底色**要填满下面全部 ' + slots.length + ' 个槽（带 ⟨accent⟩ 的 17 个也要给缺省值，它们是 `data-accent` 缺失时的兜底）；')
out.push('一套**新 accent** 只要给 17 个槽 × 亮/暗两极 = ' + ACCENT_FAMILY.size * POLARITIES.length + ' 个值，**不必**逐底色给。', '')
out.push('```text')
for (const g of groupedSlots()) {
  out.push(`# ${g.title}`)
  for (const s of g.rows) out.push(`${s} = ${ACCENT_FAMILY.has(s) ? '<accent 族，需给亮/暗两档>' : ''}`)
}
out.push('```', '')

out.push('## 10. 硬性对比度底线（历史裁定，别破）', '')
out.push('- 深色主题下小字对比 ≥5.8:1：`--text-muted` 是新卡面上的底线值，`--text-faint` 不得更低。')
out.push('- `--panel-bg` 与 `--sunken` 的差必须肉眼可分（纸底实测下限约 #fafafa），差 6 级就糊。')
out.push('- 改 `--panel-bg` 必须同步重切 `--hover`，保持约 5 级差，否则行悬停无反馈。')
out.push('- `--accent-on / --danger-on / --cat-text / --brand-knob` 是彩底色块上的字，取该底色阶的最亮（纸）/最暗（墨）一点，不跟随主色相。')
out.push('- 主题块内只放实色；需要跨主题自适应的派生值走 `--hover-chrome` 那类 `color-mix()` 配方写在别名块。', '')

out.push('## 11. 贴给外部模型的提示词（连同本文件一起贴过去即可，它不需要项目访问权）', '')
out.push('```text', '')
out.push('你为一个 Windows 桌面工作台 App 定一套新配色。这个 App 是本地个人工作台（收藏链接 / 小记 / 文件快捷方式 /')
out.push('局域网传输 / 验证码 / 终端 / 分流清单等模块平等并列），不是保险箱，也不是营销页。')
out.push('界面实况：左侧 208px 图标+文字导航栏；顶部 44px 标题栏；主区是密集列表或卡片网格，一行一行紧挨着，')
out.push('单屏常有 10–20 行；每张卡片右下角有 URL 与时间戳两行极小的辅助文字；卡上有小圆角徽标胶囊；')
out.push('有输入框、下拉、开关、分段控件；有弹窗（宽约 520px）与浮层菜单。屏幕长期亮着、用户是同一人反复长时间使用。')
out.push('', '')
out.push('【任务】只做二选一，不要混着给：')
out.push(`  A. 一档新强调色（推荐）：定 1 个主色 hex，按随附清单第 6 节的公式推导其余 16 槽，给亮极性/暗极性两份，共 ${ACCENT_FAMILY.size * POLARITIES.length} 行。**不要按底色逐套给**——同一极性下的几套底色吃的是同一份值。`)
out.push(`  B. 一套新底色：按第 9 节模板把 ${slots.length} 个槽逐个给值（带 ⟨accent⟩ 的 17 个也要给缺省值，取它所属极性的那一档）。`)
out.push('', '')
out.push('【输入】随附的清单文件是唯一事实来源，已含全部槽名、四套底色现值、每个槽涂在哪里、明度阶梯与对比度实测。')
out.push('你无法访问代码仓库，所以：**槽名必须逐字照抄**，不许自创、不许省略、不许改名、不许合并成一个 CSS 变量。')
out.push('', '')
out.push('【输出格式】只要一张表，一行一个：`槽名 = 值`。值用 #rrggbb 或 rgba(r, g, b, a)。')
out.push('不要输出 CSS、不要输出 JSON、不要写注释、不要解释你改了什么风格。表之后另起一段，只写两件事：')
out.push('  1) 面族明度阶梯的数值（画布/卡面/下陷/悬停各档的 L*，以及相邻差）；')
out.push('  2) 强调色主色 → 派生档的推导式（悬停、按下、浅水洗底、焦点环各是主色的百分之几）。')
out.push('', '')
out.push('【硬约束，破一条就返工】')
out.push('- 键集与清单逐字一致。少一个槽不会报错，但切过去那块颜色不动，等于成品有补丁。')
out.push('- 只给颜色。圆角/间距/字号/动效/布局都有独立体系（清单第 7 节），一律不许碰。')
out.push('- 值里不许出现 var() 或引用别的槽；需要自适应的派生值本项目自己处理。')
out.push('- 明度阶梯照第 4 节：浅色那套所有实色面挤在很窄的高 L* 窗口里、深色那套整体反转（面朝变亮分层），')
out.push('  两轴的分层都由发丝描边主担——所以描边槽必须明显区别于相邻面，别给成一模一样。')
out.push(`- 对比度底线照第 5 节的实测表对齐：深色底上小字 ≥5.8:1，浅色底上正文/说明文字 ≥4.5:1，`)
out.push('  注释一类的"最静"档也必须可读；彩底色块上的字取该色阶最亮或最暗的一点。')
out.push('- 不许整体转冷、不许近黑画布、不许半透明文字、不许给卡片纯白底（卡面每通道 ≤254：纸 252 / 雪 254 是现有两档）。')
out.push('- 要做冷底：冷度**只走 Lab 的 b\\* 轴，a\\* 留在 0 附近**（写成 R<G<B 单调递增会带绿分量，a\\* 负到 −1 上下，实机读作"青涩"）。')
out.push('  intake 对此有闸门：`--bg` 的 b\\* 为负即按冷底判，面族＋描边＋文字九槽任一 a\\* ≤ −1.0 直接退回。参照已发货的岩底：a\\* −0.6～+0.5、b\\* −3.1～−6.5。')
out.push('- 压深 `--sunken` 要连带重算吃在它上面的 `--code-*`（以及带色的 `--ft-*`）对比，按色相保比例压暗顶回 ≥4.5——只交七个面的阶梯不管侧槽是这类稿最常见的漏账。')
out.push('- 深底上的强调色要提明度、降彩度；直接拿浅色档的 hex 放到深底上会融进底色。')
out.push('- 交付前自查：把每个"字色 × 它要落的底色"组合按 WCAG 相对亮度算一遍，低于上面底线的自己重调，')
out.push('  不要把没算过的值交出来。')
out.push('```', '')



const text = out.join('\n') + '\n'
const outIdx = process.argv.indexOf('--out')
if (outIdx >= 0) {
  const p = process.argv[outIdx + 1]
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, text, 'utf8')
  console.log(`已写入 ${relative(ROOT, p)}（${slots.length} 底色槽 / ${ACCENT_FAMILY.size} accent 槽 / ${comboKeys.length} 组合）`)
} else {
  process.stdout.write(text)
}
