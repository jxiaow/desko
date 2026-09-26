#!/usr/bin/env node
/*
 * 主题令牌覆盖检查（2 底色 × 4 accent 双轴版）
 *
 * 换主题时最怕的一种 bug：某套配色少填了一个槽位。
 * CSS 不会报错——那个槽位会静默地留着缺省值，切过去就是一块
 * "换了主题但没换颜色"的补丁，很难在满屏里找出来。
 *
 * 双轴契约：
 *   · 底色层 [data-theme="paper"|"ink"] 交出完全相同的 96 个槽位名；
 *   · accent 族 17 槽由 [data-theme=x][data-accent=y] 覆盖层填，
 *     8 种组合一个不许少，槽位名只许落在 accent 白名单内；
 *   · theme.ts 里声明的 THEMES/ACCENTS id 必须和 CSS 里出现的属性值一一对应。
 *
 * 这个脚本做五件事：
 *   1. paper / ink 槽位名完全对齐（以 paper 为基准）
 *   2. 8 个 accent 组合齐全，组合之间槽位名一致且都在白名单内
 *   3. 主题块 / accent 块里不许出现 var() 引用（那是别名块的活）
 *   4. 别名块不许被主题/accent 块重复定义（顺序反转会互相盖值）
 *   5. 全项目 var(--x) 用到了但没人定义的槽位
 *
 * 用法：node scripts/check-theme-coverage.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const CSS_PATH = join(ROOT, 'src', 'styles', 'global.css')
const THEME_TS_PATH = join(ROOT, 'src', 'services', 'theme.ts')

const BASES = ['paper', 'ink']
const BASELINE = 'paper'
const ACCENTS = ['ink', 'celadon', 'clay', 'plum']

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

const BASE_RE = /^:root(?:\s*,\s*\[data-theme="([\w-]+)"\])?$/
const ACCENT_RE = /^\[data-theme="([\w-]+)"\]\[data-accent="([\w-]+)"\]$/

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
      blocks.push({ kind: 'accent', theme: accent[1], accent: accent[2], selector, decls: parseDecls(m[2]) })
    } else if (/^\[data-theme="[\w-]+"\]$/.test(selector)) {
      const t = /\[data-theme="([\w-]+)"\]/.exec(selector)[1]
      blocks.push({ kind: 'base', theme: t, selector, decls: parseDecls(m[2]) })
    } else {
      blocks.push({ kind: 'other', selector, decls: parseDecls(m[2]) })
    }
  }
  return blocks
}

const css = stripComments(readFileSync(CSS_PATH, 'utf8'))
const blocks = collectBlocks(css)

const problems = []

/* ---- 归并 ---- */
const baseSlots = new Map()   // theme -> Map(slot -> [values])
const comboSlots = new Map()  // "theme/accent" -> Map(slot -> [values])
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
    const key = `${b.theme}/${b.accent}`
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

/* ---- 2. accent 覆盖层：8 组合齐全 + 白名单 + 组合间对齐 ---- */
const comboKeys = ACCENTS.flatMap((a) => BASES.map((t) => `${t}/${a}`))
for (const key of comboKeys) {
  if (!comboSlots.has(key)) {
    problems.push(`缺 accent 组合 [data-theme="${key.split('/')[0]}"][data-accent="${key.split('/')[1]}"]，切到这组配色时 accent 族会留着底色层的缺省值`)
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

/* ---- 3. 主题/accent 块里不许用 var()：那是别名块的职责 ---- */
for (const [t, m] of baseSlots) {
  for (const [slot, values] of m) {
    for (const v of values) {
      if (v.includes('var(')) {
        problems.push(`${t}: ${slot} 写成了 ${v}\n        主题块里只放具体色值；跟随别的槽位走的请放进 :root 别名块`)
      }
    }
  }
}
for (const [key, m] of comboSlots) {
  for (const [slot, values] of m) {
    for (const v of values) {
      if (v.includes('var(')) {
        problems.push(`${key}: ${slot} 写成了 ${v}\n        accent 块里只放具体色值`)
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

/* ---- 5. theme.ts 声明的 id 必须与 CSS 属性值一一对应 ---- */
try {
  const ts = readFileSync(THEME_TS_PATH, 'utf8')
  const declaredThemes = [...ts.matchAll(/theme:\s*'([\w-]+)'/g)].map((m) => m[1])
  const declaredAccents = [...ts.matchAll(/\bid:\s*'([\w-]+)',\s*name:/g)].map((m) => m[1])
  const themesInTs = new Set([...declaredThemes, ...declaredAccents])
  for (const a of ACCENTS) if (!themesInTs.has(a)) problems.push(`theme.ts 里没有 accent '${a}' 的条目`)
  for (const t of BASES) if (!ts.includes(`'${t}'`)) problems.push(`theme.ts 里没有底色 '${t}' 的条目`)
} catch {
  problems.push(`读不到 ${relative(ROOT, THEME_TS_PATH)}，无法核对 theme.ts 与 CSS 的对应关系`)
}

/* ---- 6. 全项目引用了没人定义的槽位 ---- */
/* 定义集 = global.css 里出现过的所有 "--xxx:"，含尺度层、底色层、accent 层、别名块 */
const defined = new Set(css.match(/--[\w-]+(?=\s*:)/g) || [])
/* 组件局部变量：在 .vue 作用域里自定自用，不归全局主题管 */
const LOCAL_SLOTS = new Set(['--h', '--ftc'])

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
console.log(`主题覆盖检查通过：${BASES.length} 底色 × ${canonical.length} 槽位对齐，${comboSlots.size}/8 accent 组合 × ${comboCanonical.length} 槽在白名单内。`)
