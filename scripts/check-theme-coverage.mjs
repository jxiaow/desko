#!/usr/bin/env node
/*
 * 主题令牌覆盖检查（底色轴 × accent 轴，accent 按极性挂 版）
 *
 * 换主题时最怕的一种 bug：某套配色少填了一个槽位。
 * CSS 不会报错——那个槽位会静默地留着缺省值，切过去就是一块
 * "换了主题但没换颜色"的补丁，很难在满屏里找出来。
 *
 * 三样两轴契约：
 *   · 底色层按 theme.ts 注册表 交出完全相同的 96 个槽位名；
 *   · 极性 light/dark 由底色决定，theme.ts 的 POLARITY 是唯一登记处；
 *   · accent 族 17 槽由 [data-base=x][data-accent=y] 覆盖层填，
 *     2×N 个组合一个不许少（同极的几套底色共用同一档），
 *     槽位名只许落在 accent 白名单内；
 *   · 底色/accent 名单从 theme.ts 现读，CSS 里缺哪一块就报哪一块。
 *
 * 这个脚本做七件事：
 *   1. 每套底色槽位名完全对齐（以 paper 为基准）
 *   2. 所有 accent 组合齐全，组合之间槽位名一致且都在白名单内
 *   3. 底色块里不许出现 var() 引用（那是别名块的活）；accent 块允许，
 *      因为它按极性切、本来就要能引用 var(--panel-bg) 这类随底走的槽
 *   4. 别名块不许被主题/accent 块重复定义（顺序反转会互相盖值）
 *   5. 全项目 var(--x) 用到了但没人定义的槽位
 *   6. theme.ts 的 POLARITY 必须覆盖每一套底色
 *   7. 氛围状态与面板/导航底色策略只由材质层定义，组件消费角色
 *
 * 用法：node scripts/check-theme-coverage.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { readThemeIds, readStyleSource } from './lib/theme-tokens.mjs'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const CSS_PATH = join(ROOT, 'src', 'styles', 'global.css')
const THEME_TS_PATH = join(ROOT, 'src', 'services', 'theme.ts')

/* 轴名单以 theme.ts 为唯一出处：这里再抄一份，换档时就会漏改一处 */
const { themes: THEME_INFOS, accents: ACCENT_INFOS } = readThemeIds(THEME_TS_PATH)
const BASES = THEME_INFOS.map((t) => t.id)
const BASELINE = 'paper'
const POLARITIES = ['light', 'dark']
const ACCENTS = ACCENT_INFOS.map((a) => a.id)

/* accent 覆盖层允许动的槽位族——新增跟随 accent 的槽位时先加进这里 */
const ACCENT_SLOTS = new Set([
  '--accent', '--accent-hover', '--accent-active', '--accent-on',
  '--accent-soft', '--accent-light', '--accent-ring',
  '--text-brand', '--badge-ver-bg', '--badge-ver-text',
  '--brand-g1', '--brand-g2', '--brand-g3',
  '--lock-orb-1', '--lock-orb-2', '--selection', '--toast-info',
])

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/* 抓 { ... } 里的 "--name: value;" 清单；这些块内没有嵌套花括号，正则够用 */
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
    if (base) {
      blocks.push({ kind: 'base', theme: base[1] ?? 'root', selector, decls: parseDecls(m[2]) })
    } else if (accent) {
      blocks.push({ kind: 'accent', polarity: accent[1], accent: accent[2], selector, decls: parseDecls(m[2]) })
    } else if (/^\[data-theme="[\w-]+"\]$/.test(selector)) {
      const t = /\[data-theme="([\w-]+)"\]/.exec(selector)[1]
      blocks.push({ kind: 'base', theme: t, selector, decls: parseDecls(m[2]) })
    } else {
      blocks.push({ kind: 'other', selector, decls: parseDecls(m[2]) })
    }
  }
  return blocks
}

const css = stripComments(readStyleSource(CSS_PATH))
const blocks = collectBlocks(css)

const problems = []

/* ---- 归并 ---- */
const baseSlots = new Map()   // theme -> Map(slot -> [values])
const comboSlots = new Map()  // "polarity/accent" -> Map(slot -> [values])
const aliasDecls = []         // 其余块（别名块、尺度层等）
for (const b of blocks) {
  if (b.kind === 'base' && b.theme !== 'root') {
    if (!baseSlots.has(b.theme)) baseSlots.set(b.theme, new Map())
    for (const d of b.decls) {
      const list = baseSlots.get(b.theme).get(d.name) || []
      list.push(d.value)
      baseSlots.get(b.theme).set(d.name, list)
    }
  } else if (b.kind === 'accent') {
    const key = `${b.polarity}/${b.accent}`
    if (!comboSlots.has(key)) comboSlots.set(key, new Map())
    for (const d of b.decls) {
      const list = comboSlots.get(key).get(d.name) || []
      list.push(d.value)
      comboSlots.get(key).set(d.name, list)
    }
  } else {
    aliasDecls.push(...b.decls.map((d) => ({ ...d, selector: b.selector })))
  }
}

const slotSet = (m) => new Set(m?.keys() ?? [])
const canonical = [...slotSet(baseSlots.get(BASELINE))]

if (canonical.length === 0) {
  console.error(`没在 ${relative(ROOT, CSS_PATH)} 里找到 [data-theme="${BASELINE}"] 块。`)
  process.exit(1)
}

/* ---- 1. 底色层键集对齐 ---- */
for (const t of BASES) {
  const have = slotSet(baseSlots.get(t))
  const missing = canonical.filter((s) => !have.has(s))
  const extra = [...have].filter((s) => !canonical.includes(s))
  if (missing.length) {
    problems.push(`${t}: 少了 ${missing.length} 个槽位，切到这套底色时它们会留着 ${BASELINE} 的值\n        ${missing.join('\n        ')}`)
  }
  if (extra.length) {
    problems.push(`${t}: 多出 ${extra.length} 个别的底色没有的槽位（拼错了？还是该加进基准）\n        ${extra.join('\n        ')}`)
  }
  const dupes = [...(baseSlots.get(t) || [])].filter(([, v]) => v.length > 1)
  if (dupes.length) {
    problems.push(`${t}: 同一个槽位写了两次，后一次生效\n        ${dupes.map(([k, v]) => `${k} = ${v.join('   ←   ')}`).join('\n        ')}`)
  }
}
for (const t of baseSlots.keys()) {
  if (!BASES.includes(t)) problems.push(`CSS 里出现未知底色块 [data-theme="${t}"]，theme.ts/守护名单都没它`)
}

/* ---- 2. accent 覆盖层：2 极性 × N 档齐全 + 白名单 + 组合间对齐 ---- */
const comboKeys = ACCENTS.flatMap((a) => POLARITIES.map((p) => `${p}/${a}`))
for (const key of comboKeys) {
  if (!comboSlots.has(key)) {
    problems.push(`缺 accent 组合 [data-base="${key.split('/')[0]}"][data-accent="${key.split('/')[1]}"]，切到这组配色时 accent 族会留着底色层的缺省值`)
  }
}
for (const key of comboSlots.keys()) {
  if (!comboKeys.includes(key)) problems.push(`CSS 里出现未知 accent 组合 ${key}`)
}
const comboCanonical = [...slotSet(comboSlots.get(comboKeys.find((k) => comboSlots.has(k))))]
for (const key of comboSlots.keys()) {
  const have = slotSet(comboSlots.get(key))
  const missing = comboCanonical.filter((s) => !have.has(s))
  const extra = [...have].filter((s) => !comboCanonical.includes(s))
  if (missing.length) problems.push(`${key}: 少了 ${missing.length} 个 accent 槽位\n        ${missing.join('\n        ')}`)
  if (extra.length) problems.push(`${key}: 多出 ${extra.length} 个别的组合没有的槽位\n        ${extra.join('\n        ')}`)
  const rogue = [...have].filter((s) => !ACCENT_SLOTS.has(s))
  if (rogue.length) {
    problems.push(`${key}: 动了 accent 族之外的槽位 ${rogue.join(' / ')}\n        accent 覆盖层只许改白名单内的槽；要加请先扩 ACCENT_SLOTS`)
  }
  const dupes = [...comboSlots.get(key)].filter(([, v]) => v.length > 1)
  if (dupes.length) problems.push(`${key}: 同一个槽位写了两次\n        ${dupes.map(([k, v]) => `${k} = ${v.join('   ←   ')}`).join('\n        ')}`)
}
/* accent 族槽位必须在底色层有缺省值，否则 data-accent 缺失时整族悬空 */
for (const s of ACCENT_SLOTS) {
  for (const t of BASES) {
    if (!slotSet(baseSlots.get(t)).has(s)) {
      problems.push(`${t}: accent 族槽位 ${s} 没有底色缺省值（不带 data-accent 时悬空）`)
    }
  }
}

/* ---- 3. 底色块里不许用 var()：那是别名块的职责。
       accent 块允许，因为它按极性切、本来就该能引用随底走的槽（如洗底掺 var(--panel-bg)）。 ---- */
for (const [t, m] of baseSlots) {
  for (const [slot, values] of m) {
    for (const v of values) {
      if (v.includes('var(')) {
        problems.push(`${t}: ${slot} 写成了 ${v}\n        主题块里只放具体色值；跟随别的槽位走的请放进 :root 别名块`)
      }
    }
  }
}

/* ---- 4. 别名块 vs 主题/accent 块：同一槽位两处定义，按文件顺序互相盖 ---- */
const themeSlotOwner = (name) =>
  [...BASES].filter((t) => slotSet(baseSlots.get(t)).has(name))
for (const a of aliasDecls) {
  const alsoIn = themeSlotOwner(a.name)
  if (alsoIn.length) {
    problems.push(`${a.name} 同时出现在别名块和 ${alsoIn.join(' / ')} 主题块里\n        别名块在文件后面，会把主题的值为盖掉；请只留一处`)
  }
}

/* ---- 5. theme.ts 的极性表必须覆盖每一套底色（轴名单本身就从 theme.ts 读） ---- */
try {
  const ts = readFileSync(THEME_TS_PATH, 'utf8')

  /* 极性登记表：每套底色都要说清自己吃哪一极的 accent */
  const pol = new RegExp(`export const POLARITY[\\s\\S]*?\\n\\}`).exec(ts)
  const polMap = new Map((pol ? [...pol[0].matchAll(/(\w+):\s*'([\w-]+)'/g)] : []).map((m) => [m[1], m[2]]))
  for (const t of BASES) {
    const p = polMap.get(t)
    if (!p) problems.push(`theme.ts 的 POLARITY 里没有底色 '${t}'，主题初始化会给它挂出空 data-base`)
    else if (!POLARITIES.includes(p)) problems.push(`theme.ts 里 ${t} 的极性 '${p}' 不是 ${POLARITIES.join('/')} 之一`)
  }
  for (const [t] of polMap) if (!BASES.includes(t)) problems.push(`theme.ts 的 POLARITY 里有未知底色 '${t}'，THEMES 里没有它`)
} catch {
  problems.push(`读不到 ${relative(ROOT, THEME_TS_PATH)}，无法核对 theme.ts 与 CSS 的对应关系`)
}

/* ---- 6. 全项目引用了没人定义的槽位 ---- */
/* 定义集包含样式入口导入的材质层、尺度层、底色层、accent 层与别名块。 */
const defined = new Set(css.match(/--[\w-]+(?=\s*:)/g) || [])
/* 组件局部变量：在 .vue / 页面作用域里自定自用，不归全局主题管
   --h / --ftc 由组件内联给；--toast-side 由 App.vue 按侧栏三态喂；--gc-hue 由收藏页按分类哈希给；
   --usage-* 由 CodexUsagePanel 按极性提供给图表子组件。 */
const LOCAL_SLOTS = new Set(['--h', '--ftc', '--toast-side', '--gc-hue', '--usage-fresh', '--usage-cached', '--usage-output'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'target' || name === '.git' || name === 'dist') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(vue|css|ts|js|mjs|html)$/.test(name)) out.push(p)
  }
  return out
}

const usedSlots = new Map() // slot -> Set(file:line)
for (const file of walk(join(ROOT, 'src'))) {
  const text = readFileSync(file, 'utf8')
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--[\w-]+)\s*[,)]/g)) {
      if (!usedSlots.has(m[1])) usedSlots.set(m[1], new Set())
      usedSlots.get(m[1]).add(`${relative(ROOT, file)}:${i + 1}`)
    }
  })

  // 材质策略只有一个入口：页面不判断氛围状态，面板与导航底色消费材质角色。
  if (file.endsWith('.css') || file.endsWith('.vue')) {
    const styles = file.endsWith('.vue')
      ? [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
      : text
    const clean = stripComments(styles)
    if (file !== join(ROOT, 'src', 'styles', 'materials.css') && /\[data-atmosphere\b/.test(clean)) {
      problems.push(`${relative(ROOT, file)} 在材质层之外判断背景氛围，请改为消费材质角色`)
    }
    if (file !== join(ROOT, 'src', 'styles', 'materials.css') && /background(?:-color|-image)?\s*:[^;{}]*var\(\s*--(?:panel-bg|sidebar-bg)\b/.test(clean)) {
      problems.push(`${relative(ROOT, file)} 直接使用物理背景槽，请改为 --bg-surface / --bg-sidebar 等材质角色`)
    }
  }
}

for (const [slot, where] of usedSlots) {
  if (!defined.has(slot) && !LOCAL_SLOTS.has(slot)) {
    problems.push(`未定义的槽位 ${slot}\n        ${[...where].slice(0, 6).join('\n        ')}`)
  }
}

/* ---- 报告 ---- */
const rel = relative(ROOT, CSS_PATH)
if (problems.length) {
  console.log(`${rel} —— 主题覆盖检查未通过\n`)
  problems.forEach((p, i) => console.log(`${i + 1}. ${p}\n`))
  console.log(`共 ${problems.length} 处。`)
  process.exit(1)
}
console.log(`主题覆盖检查通过：${BASES.length} 底色 × ${canonical.length} 槽位对齐，${comboSlots.size}/${comboKeys.length} accent 组合（${POLARITIES.length} 极性 × ${ACCENTS.length} 档）× ${comboCanonical.length} 槽在白名单内。`)
