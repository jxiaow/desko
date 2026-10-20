#!/usr/bin/env node
/*
 * 全局叠层普查（z-index 栈）
 *
 * 出过一次的事：.fs-drop-hint 的注释写着「压在弹窗之上、tooltip 之下」，
 * 可它的值是 9000，而气泡只有 1500 —— 契约和数字相反，肉眼对不出来。
 * 组件内部的局部叠层（-1/1/2/300 这类）只在自己那个 stacking context 里比大小，
 * 出不了事；出事的全是挂在 body 上、跨组件比较的那几档。
 *
 * 所以这个脚本只管「全局带」，做四件事：
 *   1. 数出 src 里每一条 z-index：文件:行、选择器、数值（--census 模式只打印清单）
 *   2. 全局带（>= GLOBAL_FLOOR）里出现没登记的选择器 → 报
 *   3. 登记过的选择器写成了别的值 / 两档抢同一个数值 / 表里的条目在代码里已经找不到 → 报
 *   4. 气泡 .app-tip 必须严格高于其余每一档（它不吃事件，理当永远最顶）
 *
 * 用法：
 *   node scripts/check-zindex-stack.mjs            校验，红即非零退出
 *   node scripts/check-zindex-stack.mjs --census   只打印全量清单，不校验
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/* 低于这条线的数值只在组件自己的 stacking context 里比较，不参与全局排序 */
const GLOBAL_FLOOR = 1000

/* 必须永远最顶的一档：全局悬停提示，pointer-events 不吃事件 */
const TOPMOST = '.app-tip'

/* 全局带登记表：z 是代码里必须写成这个值的档位，why 说清它凭什么占这格。
   group 是"允许同值"的唯一理由：同组意味着两者永不同时可见，跨组撞同一个数值就是事故。
   新增一档先想清楚它和谁比较，再把条目加进来——脚本不许表外有条目。 */
const LAYERS = [
  { sel: '.dialog-overlay', z: 1000, group: 'modal', why: '模态遮罩：全站唯一一档，SettingsDialog 的 scoped 同名规则与它同值同义' },
  { sel: '.pane-overlay', z: 1100, group: 'pane', why: '设置面板内的二级遮罩，必须盖住自己身处的弹窗' },
  { sel: '.quit-overlay', z: 1100, group: 'pane', why: '退出确认遮罩，与 pane-overlay 同档：都是压在弹窗上的一层薄遮罩，永不同时出现' },
  { sel: '.switch-guard', z: 1200, group: 'pane-top', why: '档案面板开关的确认罩，要盖住同面板的 pane-overlay' },
  { sel: '.popover.modal', z: 1500, group: 'pop', why: '弹窗内的下拉浮层：高于弹窗与面板浮层，仍低于通知' },
  { sel: '.toast', z: 2000, group: 'notice', why: '全局通知：压在包括弹窗内浮层在内的一切内容之上' },
  { sel: '.fs-drop-hint', z: 9000, group: 'drag', why: '原生拖入落点纱：拖拽期间弹窗还开着也得看得见，故高于全部常规浮层' },
  { sel: '.category-dropdown-teleported', z: 10000, group: 'teleport', why: 'teleport 到 body 的分类下拉：脱离 .dialog 的层叠上下文，只能靠远超常规档的值压住遮罩' },
  { sel: '.hover-blocker', z: 10000, group: 'teleport', why: '窗口恢复后的首击抑制罩：与分类下拉同值，两者不会同时可见' },
  { sel: '.app-tip', z: 10010, group: 'tip', why: '全局悬停提示：不吃事件，理当永远最顶' },
]

/* 注释按字符抹平、换行原样保留：整行删掉会让后面的行号集体前移，报出来的位置就不可信了 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))

/** .vue 只留 <style> 块，块外按行抹成空行，保证行号仍对得上原文件 */
function keepStyleBlocks(text) {
  if (!text.includes('<style')) return text
  const lines = text.split('\n')
  let depth = 0
  return lines
    .map((line) => {
      const opens = (line.match(/<style\b[^>]*>/g) || []).length
      const closes = (line.match(/<\/style>/g) || []).length
      if (opens && depth === 0 && !closes) { depth = 1; return line }
      const inside = depth === 1
      depth = Math.max(0, depth + opens - closes)
      return inside || depth > 0 ? line : ''
    })
    .join('\n')
}

/** 从 z-index 命中处回退到最近的 { ，取规则头当选择器（尽力而为，够人读） */
function selectorFor(css, index) {
  const open = css.lastIndexOf('{', index)
  if (open < 0) return '(文件头)'
  const headStart = Math.max(
    css.lastIndexOf('}', open),
    css.lastIndexOf(';', open),
    css.lastIndexOf('{', open - 1),
  )
  // .vue 的 <style> 起始行会被保留，规则头里得把它甩掉
  return css
    .slice(headStart + 1, open)
    .replace(/<style\b[^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || '(无选择器)'
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'target' || name === '.git' || name === 'dist') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(vue|css)$/.test(name)) out.push(p)
  }
  return out
}

const found = []
for (const file of walk(join(ROOT, 'src'))) {
  const css = stripComments(keepStyleBlocks(readFileSync(file, 'utf8')))
  for (const m of css.matchAll(/z-index\s*:\s*([^;}\n]+)/g)) {
    const raw = m[1].trim()
    const value = Number(raw)
    found.push({
      where: `${relative(ROOT, file)}:${css.slice(0, m.index).split('\n').length}`,
      selector: selectorFor(css, m.index),
      raw,
      value,
      numeric: Number.isInteger(value),
    })
  }
}

if (process.argv.includes('--census')) {
  const rows = found
    .slice()
    .sort((a, b) => (b.numeric ? b.value : 1e9) - (a.numeric ? a.value : 1e9))
  console.log(`z-index 全量清单（${rows.length} 条，全局带线 = ${GLOBAL_FLOOR}）\n`)
  for (const r of rows) {
    const band = r.numeric && r.value >= GLOBAL_FLOOR ? '全局' : '局部'
    console.log(`  ${band}  ${String(r.raw).padEnd(8)} ${r.selector}\n        ${r.where}`)
  }
  process.exit(0)
}

const problems = []
const globals = found.filter((r) => r.numeric && r.value >= GLOBAL_FLOOR)

for (const r of found) {
  if (!r.numeric && !r.raw.startsWith('var(')) problems.push(`${r.where} 写成了 ${r.raw}，全局带只认整数`)
}

/* 1. 全局带每一档都要登记 */
const registered = new Map(LAYERS.map((l) => [l.sel, l]))
for (const r of globals) {
  const owner = registered.get(r.selector)
  if (!owner) {
    problems.push(`${r.where} ${r.selector} = ${r.value} 未登记\n        全局带（>= ${GLOBAL_FLOOR}）的每一档都要在 LAYERS 里说清凭什么占这格`)
  } else if (owner.z !== r.value) {
    problems.push(`${r.where} ${r.selector} 写成 ${r.value}，登记表里是 ${owner.z}`)
  }
}

/* 2. 登记过的档位不许在代码里失踪（防表腐烂） */
const seenSelectors = new Set(globals.map((r) => r.selector))
for (const l of LAYERS) {
  if (!seenSelectors.has(l.sel)) problems.push(`登记表里的 ${l.sel}（${l.z}）在 src 里找不到，条目该删了`)
}

/* 3. 跨组不许撞同一个数值（同组=声明过"永不同时可见"）；只按字典序报一次，别正反各刷一遍 */
for (const l of LAYERS) {
  const same = LAYERS.filter((o) => o.z === l.z && o.group !== l.group && o.sel > l.sel)
  for (const o of same) problems.push(`${l.sel}（组 ${l.group}）与 ${o.sel}（组 ${o.group}）同为 ${l.z}\n        同值只在同组内允许，同组的理由是这两档永不同时出现`)
}

/* 4. 气泡必须严格最顶 */
const tip = LAYERS.find((l) => l.sel === TOPMOST)
if (!tip) problems.push(`登记表里没有 ${TOPMOST}，"提示永远最顶"这条契约没人守`)
else {
  const above = globals.filter((r) => r.selector !== TOPMOST && r.value >= tip.z)
  if (above.length) {
    problems.push(`${TOPMOST} 登记为 ${tip.z}，却被这些档位压住或齐平：\n        ${above.map((r) => `${r.selector} = ${r.value}（${r.where}）`).join('\n        ')}`)
  }
}

if (problems.length) {
  console.log('全局叠层检查未通过\n')
  problems.forEach((p, i) => console.log(`${i + 1}. ${p}\n`))
  console.log(`共 ${problems.length} 处。`)
  process.exit(1)
}

const order = LAYERS.slice().sort((a, b) => a.z - b.z)
console.log(`全局叠层检查通过：${globals.length} 条全局带声明，${LAYERS.length} 档登记，自下而上 ${order.map((l) => `${l.z} ${l.sel}`).join(' → ')}`)
