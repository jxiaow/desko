// ink 明度阶梯求解器（V5.2 收编轮 P1）
// 用法：node scripts/ink-ladder.mjs
//
// 规则：
//   · 四层实色直接取 V5.2 的画布 / surface-soft / surface / surface-elevated
//   · 其余「比卡面亮」的槽保持与卡面的 ΔL*（白方向二分求解）
//   · 「比卡面暗」的槽（侧栏）在 画布→卡面 之间按同 ΔL* 求解
//   · 带色相的软底（danger/success/warning-soft）保色相：整族 RGB 等比缩放到目标 L*
//   · 半透明槽（chrome/frost）把实色换成新实色后按原 alpha 重写
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CSS = resolve(import.meta.dirname, '../src/styles/global.css')

function rgb(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) }
function hex(...v) { return '#' + v.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('') }
function mix(a, b, t) {
  const A = rgb(a), B = rgb(b)
  return hex(...A.map((v, i) => v + (B[i] - v) * t))
}
function lum(h) {
  return rgb(h).map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((acc, v, i) => acc + [0.2126, 0.7152, 0.0722][i] * v, 0)
}
function lab(h) { const Y = lum(h); return Y > 0.008856 ? 116 * Y ** (1 / 3) - 16 : 903.3 * Y }
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
/** 在 lo→hi 方向二分出目标 L* 的实色 */
function solve(lo, hi, target) {
  let a = 0, b = 1
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2
    lab(mix(lo, hi, m)) < target ? (a = m) : (b = m)
  }
  return mix(lo, hi, (a + b) / 2)
}
/** 保色相缩放到目标 L*（RGB 等比，暗向不变色相角） */
function scaleTo(h, target) {
  let a = 0, b = 3
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2
    lab(hex(...rgb(h).map((v) => Math.min(255, v * m)))) < target ? (a = m) : (b = m)
  }
  return hex(...rgb(h).map((v) => Math.min(255, Math.round(v * (a + b) / 2))))
}

// V5.2 给的四层
const CANVAS = '#181716'
const SOFT = '#1d1c1a'
const CARD = '#22211e'
const ELEV = '#282622'
const OLD_CARD = '#312f29'

/** 比卡面亮的实色槽：保持 ΔL* */
const LIGHTER = [
  ['--active', '#46423a'],
  ['--fill', '#3b382f'],
  ['--border-subtle', '#34322c'],
  ['--border', '#413e37'],
  ['--border-strong', '#565249'],
  ['--border-hover', '#565249'],
  ['--badge-cat-bg', '#34322c'],
  ['--badge-cat-border', '#413e37'],
]
/** 带色相的软底：保色相缩放到同 ΔL* */
const TINTED = [
  ['--danger-soft', '#3a2622'],
  ['--success-soft', '#223028'],
  ['--warning-soft', '#342c1c'],
]
/** 半透明槽：[名, 旧实色源, 新实色, 旧 alpha] */
const ALPHA = [
  ['--chrome-bg', '#23221e', SOFT, 0.86],
  ['--frost-bg', '#312f29', CARD, 0.88],
  ['--frost-border', '#413e37', null, null],
]

const out = []
out.push(`画布 ${CANVAS} L*${lab(CANVAS).toFixed(1)}`)
out.push(`--bg ${SOFT} L*${lab(SOFT).toFixed(1)}`)
out.push(`--panel-bg ${CARD} L*${lab(CARD).toFixed(1)}`)
out.push(`--hover ${ELEV} L*${lab(ELEV).toFixed(1)}`)
const sidebar = solve(CANVAS, CARD, lab(CARD) + (lab('#282621') - lab(OLD_CARD)))
out.push(`--sidebar-bg ${sidebar} L*${lab(sidebar).toFixed(1)}`)
out.push(`--sidebar-hover ${ELEV}`)
for (const [n, old] of LIGHTER) {
  out.push(`${n} ${solve(CARD, '#ffffff', lab(CARD) + (lab(old) - lab(OLD_CARD)))} ← ${old} Δ${(lab(old) - lab(OLD_CARD)).toFixed(1)}`)
}
for (const [n, old] of TINTED) {
  out.push(`${n} ${scaleTo(old, lab(CARD) + (lab(old) - lab(OLD_CARD)))} ← ${old}（保色相）`)
}
out.push(`--danger-border ${scaleTo('#5c352f', lab(CARD) + (lab('#5c352f') - lab(OLD_CARD)))}`)
for (const [n, , src, a] of ALPHA) {
  if (src) out.push(`${n} rgba(${rgb(src).join(',')}, ${a})`)
}
out.push(`--lock-wash-a ${SOFT} / --lock-wash-b ${CARD}（= 新 --bg / --panel-bg）`)

console.log(out.join('\n'))

// 复核账：字阶与 accent 在新卡面/新凹槽上的对比度
const TEXTS = [['--text', '#e6e4de'], ['--text-secondary', '#c7c4bd'], ['--text-muted', '#aeaba4'], ['--text-faint', '#9c9992']]
console.log('\n字阶对比度（新卡面 / 新凹槽 fill / 侧栏）')
for (const [n, h] of TEXTS) {
  console.log(`  ${n.padEnd(18)} ${h}  ${contrast(h, CARD).toFixed(2)}  ${contrast(h, solve(CARD, '#ffffff', lab(CARD) + (lab('#3b382f') - lab(OLD_CARD)))).toFixed(2)}  ${contrast(h, sidebar).toFixed(2)}`)
}
const css = readFileSync(CSS, 'utf8')
const inkAccents = [...css.matchAll(/\[data-theme="ink"\]\[data-accent="(\w+)"\]\s*\{\s*--accent:\s*(#\w{6})/g)]
console.log('\naccent 四档在新卡面上的对比度（要求 ≥4.5）')
for (const [, name, hexv] of inkAccents) console.log(`  ${name.padEnd(9)} ${hexv}  ${contrast(hexv, CARD).toFixed(2)}`)
