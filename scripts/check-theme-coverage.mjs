#!/usr/bin/env node
/*
 * 主题令牌覆盖检查
 *
 * 换主题时最怕的一种 bug：某套主题少填了一个槽位。
 * CSS 不会报错——那个槽位会静默地留着 :root 上 cool 的值，
 * 切过去就是一块"换了主题但没换颜色"的补丁，很难在满屏里找出来。
 *
 * 这个脚本做三件事：
 *   1. 四套主题的槽位名必须完全一致（以 cool 为基准）
 *   2. 主题块里不许出现 var() 引用（那是别名块的活）
 *   3. 全项目 var(--x) 用到了但没人定义的槽位
 *
 * 用法：node scripts/check-theme-coverage.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const CSS_PATH = join(ROOT, 'src', 'styles', 'global.css')

const THEMES = ['cool', 'classic', 'white', 'dark']
const BASELINE = 'cool'

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/* 抓 { ... } 里的 "--name: value;" 清单；主题块内没有嵌套花括号，正则够用 */
function parseDecls(body) {
  const out = []
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g
  let m
  while ((m = re.exec(body))) out.push({ name: m[1], value: m[2].trim() })
  return out
}

function collectBlocks(css) {
  const blocks = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const selector = m[1].trim().replace(/\s+/g, ' ')
    if (/^:root(\s*,\s*\[data-theme="[\w-]+"\])?$/.test(selector) ||
        /^\[data-theme="[\w-]+"\]$/.test(selector)) {
      blocks.push({ selector, decls: parseDecls(m[2]) })
    }
  }
  return blocks
}

const css = stripComments(readFileSync(CSS_PATH, 'utf8'))
const blocks = collectBlocks(css)

/* 按选择器归并：同一主题写两处会后者覆盖前者，也要能看出来 */
const bySlot = new Map()          // theme -> Map(slot -> [values])
const aliasDecls = []             // 纯 :root 块（别名块）
for (const b of blocks) {
  const theme = THEMES.find((t) => b.selector.includes(`"${t}"`))
  if (theme) {
    if (!bySlot.has(theme)) bySlot.set(theme, new Map())
    for (const d of b.decls) {
      const list = bySlot.get(theme).get(d.name) || []
      list.push(d.value)
      bySlot.get(theme).set(d.name, list)
    }
  } else {
    aliasDecls.push(...b.decls.map((d) => ({ ...d, selector: b.selector })))
  }
}

const problems = []
const slotSet = (t) => new Set(bySlot.get(t)?.keys() ?? [])
const canonical = [...slotSet(BASELINE)]

if (canonical.length === 0) {
  console.error(`没在 ${relative(ROOT, CSS_PATH)} 里找到 [data-theme="${BASELINE}"] 块。`)
  process.exit(1)
}

/* ---- 1. 键集对齐 ---- */
for (const t of THEMES) {
  const have = slotSet(t)
  const missing = canonical.filter((s) => !have.has(s))
  const extra = [...have].filter((s) => !canonical.includes(s))
  if (missing.length) {
    problems.push(`${t}: 少了 ${missing.length} 个槽位，切到这套主题时它们会留着 ${BASELINE} 的值\n        ${missing.join('\n        ')}`)
  }
  if (extra.length) {
    problems.push(`${t}: 多出 ${extra.length} 个别的主题没有的槽位（拼错了？还是该加进基准）\n        ${extra.join('\n        ')}`)
  }
  const dupes = [...(bySlot.get(t) || [])].filter(([, v]) => v.length > 1)
  if (dupes.length) {
    problems.push(`${t}: 同一个槽位写了两次，后一次生效\n        ${dupes.map(([k, v]) => `${k} = ${v.join('   ←   ')}`).join('\n        ')}`)
  }
}

/* ---- 2. 主题块里不许用 var()：那是别名块的职责，混用会让覆盖检查失效 ---- */
for (const t of THEMES) {
  for (const [slot, values] of bySlot.get(t) || []) {
    for (const v of values) {
      if (v.includes('var(')) {
        problems.push(`${t}: ${slot} 写成了 ${v}\n        主题块里只放具体色值；跟随别的槽位走的请放进 :root 别名块`)
      }
    }
  }
}

/* ---- 3. 别名块不许被主题重复定义（别名块在后面，会反过来盖掉主题） ---- */
for (const a of aliasDecls) {
  const alsoIn = THEMES.filter((t) => slotSet(t).has(a.name))
  if (alsoIn.length) {
    problems.push(`${a.name} 同时出现在别名块和 ${alsoIn.join(' / ')} 主题块里\n        别名块在文件后面，会把主题的值为盖掉；请只留一处`)
  }
}

/* ---- 4. 全项目引用了没人定义的槽位 ---- */
/* 定义集 = global.css 里出现过的所有 "--xxx:"，含尺度层、四套主题、别名块 */
const defined = new Set(css.match(/--[\w-]+(?=\s*:)/g) || [])

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
  if (!defined.has(slot)) {
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
console.log(`主题覆盖检查通过：${THEMES.length} 套主题 × ${canonical.length} 个槽位，全部对齐。`)
