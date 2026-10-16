// 光场色的来路：把 materials.css 的两张手写 tint 表换成从 --accent 推导，逐组对账。
// 色值全部从 CSS 现读（不硬编码）；渐变按 CSS 预乘插值解析成 RGB；闸门取 e2e/specs/theme-composition.spec.ts 的门槛。
// 校正（2026-10-16 复核）：本脚本两处换算有误，数值账不得当验收依据——
//   ① 混合权重反了：CSS `color-mix(in srgb, tint 65%, --sunken)` 是 tint 占 65%，本脚本 mixSrgb/mix 的第 3 参是「走向 b 的比例」，传 65 得到的是 35% tint；
//   ② lab() 把线性绿通道直接当 Y（正确是 0.2126R+0.7152G+0.0722B），故 L*、ΔE76 失真；relLum/对比度那一路系数正确、不受影响。
// 色相相关结论（tint 与 accent 脱钩、srgb 掺带彩度底色会转色相）由 OKLab 导出，不受这两处影响。现行配方见 docs/design/themes/04-atmosphere-accent-source.md 第 16 节。
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const GLOBAL = readFileSync(ROOT + 'src/styles/global.css', 'utf8')
const MATERIALS = readFileSync(ROOT + 'src/styles/materials.css', 'utf8')

/* ---------- 解析 CSS ---------- */
function slots(css, headerRe, key = 1) {
  const out = new Map()
  for (const m of css.matchAll(headerRe)) {
    const body = css.slice(m.index, css.indexOf('}', m.index))
    const entry = Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((k) => [k[1], k[2].trim()]))
    if (!Object.values(entry).some((v) => /^#[0-9a-f]{6}$/i.test(v))) continue
    out.set(Array.isArray(key) ? key.map((i) => m[i]).join('|') : m[key], entry)
  }
  return out
}
const bases = slots(GLOBAL, /^(?::where\(:root\), )?\[data-theme="(\w+)"\] \{/gm)
const accents = slots(GLOBAL, /^\[data-base="(light|dark)"\]\[data-accent="(\w+)"\] \{/gm, [1, 2])
const tints = slots(MATERIALS, /\[data-accent="(\w+)"\][^{]*\{[^}]*--material-tint-primary/g)
tints.set('ink', Object.fromEntries([...MATERIALS.matchAll(/--material-tint-(primary|secondary):\s*([^;]+);/g)].slice(0, 2)
  .map((k) => [`material-tint-${k[1]}`, k[2].trim()])))

const hex = (s) => {
  const h = s.match(/#[0-9a-f]{6}/i)?.[0]
  if (!h) throw new Error(`非十六进制色值：${s}`)
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
}
const POLAR = { paper: 'light', snow: 'light', linen: 'light', mist: 'light', ink: 'dark', slate: 'dark', midnight: 'dark', moss: 'dark' }

/* ---------- 色彩数学 ---------- */
const toLin = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
const toSrgb = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)
const mul = (m, v) => m.map((r) => r.reduce((a, k, j) => a + k * v[j], 0))
const RGB2LMS = [[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]]
const LMS2LAB = [[0.2104542553, 0.793617785, -0.0040720468], [1.9779984951, -2.428592205, 0.4505937099], [0.0259040371, 0.7827717662, -0.808675766]]
const LAB2LMS = [[1, 0.3963377774, 0.2158037573], [1, -0.1055613458, -0.0638541728], [1, -0.0894841775, -1.291485548]]
const LMS2RGB = [[4.0767416613, -3.3077115904, 0.2309699287], [-1.2684380041, 2.6097574007, -0.3413193963], [-0.0041960865, -0.7034186145, 1.7076147009]]
const oklab = (c) => mul(LMS2LAB, mul(RGB2LMS, c.map(toLin)).map((v) => Math.cbrt(v)))
const oklch = (c) => { const [L, a, b] = oklab(c); return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180 / Math.PI) + 360) % 360 } }
const oklchToRgb = ({ L, C, h }) => { const r = (h * Math.PI) / 180
  return mul(LMS2RGB, mul(LAB2LMS, [L, C * Math.cos(r), C * Math.sin(r)]).map((v) => v ** 3)).map((v) => toSrgb(Math.min(1, Math.max(0, v)))) }
for (const c of [[255, 0, 0], [8, 118, 98], [170, 76, 12], [235, 236, 238]]) {
  const r = oklchToRgb(oklch(c)).map(Math.round)
  if (r.some((v, i) => Math.abs(v - c[i]) > 2)) throw new Error(`oklch 往返失真 ${c} → ${r}`)
}
const chan = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
const relLum = (c) => c.map(chan).reduce((a, v, i) => a + [0.2126, 0.7152, 0.0722][i] * v, 0)
const lab = (c) => { const l = c.map(toLin), X = 0.81893336 * l[0] + 0.36186668 * l[1] - 0.12885939 * l[2], Y = l[1], Z = -0.03565446 * l[0] - 0.70856476 * l[1] + 1.70286171 * l[2]
  const n = (v) => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116, fx = n(X / 0.95047), fy = n(Y), fz = n(Z / 1.08883)
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) } }
const L_ = (c) => lab(c).L
const dE = (a, b) => { const x = lab(a), y = lab(b); return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b) }
const contrast = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const hueGap = (h1, h2) => Math.abs(((h1 - h2 + 540) % 360) - 180)
const signedGap = (h1, h2) => ((h2 - h1 + 540) % 360) - 180
const mixSrgb = (a, b, p) => a.map((v, i) => v + (b[i] - v) * p)
const clamp8 = (c) => c.map((v) => Math.round(Math.min(255, Math.max(0, v))))

/* ---------- 配方 ---------- */
const W = 1040, H = 670
const contentMax = Math.min(1120, Math.max(900, W - 800))
const anchors = [[Math.max(0.14, (1 - contentMax / W) / 2), 0.12], [Math.min(0.95, (1 + contentMax / W) / 2), 0.95]]
const diluteP = (base, accent) => (['paper', 'linen'].includes(base) && ['celadon', 'teal'].includes(accent) ? 55 : 65)
const diluteS = (base, accent) => (['paper', 'linen'].includes(base) && ['celadon', 'teal'].includes(accent) ? 50 : 60)
const strengths = (base, accent) => (POLAR[base] === 'dark' ? [21, 19] : accent === 'graphite' ? [26, 23] : [23, 16])
/** 现状 tint2 相对 tint1 的带符号色相偏移，量自现状表，作为推导常数 */
const COMPANION = Object.fromEntries([...tints.entries()].map(([k, v]) =>
  [k, signedGap(oklch(hex(v['material-tint-primary'])).h, oklch(hex(v['material-tint-secondary'])).h)]))

/** 现状：手写 tint → srgb 掺 sunken */
function currentColors(base, accent) {
  const sunken = hex(bases.get(base).sunken), t = tints.get(accent)
  return [mixSrgb(hex(t['material-tint-primary']), sunken, diluteP(base, accent) / 100),
    mixSrgb(hex(t['material-tint-secondary']), sunken, diluteS(base, accent) / 100)]
}
/** 提议：色相与彩度取自本极性 --accent，明度钉在底色（可加台阶），掺入路径色相锁定 */
function derivedColors(base, accent, pShare = diluteP(base, accent) / 100, sShare = diluteS(base, accent) / 100, step = 0) {
  const A = oklch(hex(accents.get(`${POLAR[base]}|${accent}`)['accent'])), N = oklch(hex(bases.get(base).sunken))
  const mk = (share, dH) => clamp8(oklchToRgb({ L: A.L * share + (N.L + step) * (1 - share), C: A.C * share, h: (A.h + dH + 360) % 360 }))
  return [mk(pShare, 0), mk(sShare, COMPANION[accent])]
}

function fieldFn(base, cols, [pStr, sStr]) {
  const b = bases.get(base), sunken = hex(b.sunken), panel = hex(b['panel-bg'])
  const layers = [
    { rx: 0.82 * W, ry: 0.9 * H, ax: anchors[1][0] * W, ay: anchors[1][1] * H, col: [...cols[1], sStr / 100] },
    { rx: 0.78 * W, ry: 0.85 * H, ax: anchors[0][0] * W, ay: anchors[0][1] * H, col: [...cols[0], pStr / 100] },
    { rx: 0.65 * W, ry: 0.75 * H, ax: 0.5 * W, ay: 0.52 * H, col: [...panel, 0.28] },
  ]
  return (x, y) => {
    let out = [...sunken]
    for (const l of layers) {
      const t = Math.min(1, Math.hypot((x - l.ax) / l.rx, (y - l.ay) / l.ry))
      const a = l.col[3] * (1 - t)
      if (a > 0) out = out.map((v, i) => v * (1 - a) + l.col[i] * a)
    }
    return out
  }
}

const XS = [60, 270, 480, 720, 980], YS = [180, 400, 520, 620]
const canvasPts = XS.slice(1).flatMap((x) => YS.map((y) => [x, y]))
const edgePts = [[310, 12], [270, 100], [980, 640]], centerPt = [640, 460]
function measure(base, accent, cols) {
  const b = bases.get(base), sunken = hex(b.sunken), panel = hex(b['panel-bg']), text = hex(b.text)
  const f = fieldFn(base, cols, strengths(base, accent))
  const dAvg = canvasPts.reduce((a, [x, y]) => a + dE(f(x, y), sunken), 0) / canvasPts.length
  let peak = 0, peakL = -99, minSep = 1e9
  for (let i = 0; i <= 24; i++) for (let j = 0; j <= 24; j++) {
    const c = f((i / 24) * W, (j / 24) * H), e = dE(c, sunken)
    if (e > peak) { peak = e; peakL = L_(c) - L_(sunken) }
    minSep = Math.min(minSep, dE(panel, c))
  }
  return { dAvg, edge: Math.max(...edgePts.map(([x, y]) => dE(f(x, y), sunken))), mid: dE(f(...centerPt), sunken),
    peak, peakL, minSep, textMin: Math.min(...canvasPts.map(([x, y]) => contrast(text, f(x, y)))) }
}
const fails = (g) => [g.dAvg < 1.5 && `留白 ${g.dAvg.toFixed(2)}`, g.dAvg > 8 && `留白超 ${g.dAvg.toFixed(2)}`,
  g.edge <= 2.5 && `边缘 ${g.edge.toFixed(2)}`, g.mid >= 10 && `中部 ${g.mid.toFixed(2)}`, g.textMin < 4.5 && `文字 ${g.textMin.toFixed(2)}`].filter(Boolean)

const ALL = [...tints.keys()], CHROMATIC = ALL.filter((a) => a !== 'graphite')
const LIGHT = ['paper', 'snow', 'linen', 'mist'], DARK = ['ink', 'slate', 'midnight', 'moss']

console.log('=== 账 1：氛围色与本极性强调色是不是同一族 ===')
for (const [accent, t] of tints) {
  const at = (c) => { const o = oklch(c); return `${L_(c).toFixed(0).padStart(3)}/${o.C.toFixed(3)}/${o.h.toFixed(0).padStart(3)}°` }
  const light = hex(accents.get(`light|${accent}`)['accent']), dark = hex(accents.get(`dark|${accent}`)['accent']), tint = hex(t['material-tint-primary'])
  console.log(`${accent.padEnd(9)} 亮 ${at(light)}  tint ${at(tint)}  ΔH ${hueGap(oklch(tint).h, oklch(light).h).toFixed(0).padStart(3)}°  暗 ${at(dark)}  ΔH ${hueGap(oklch(tint).h, oklch(dark).h).toFixed(0).padStart(3)}°`)
}

console.log('\n=== 账 2：掺 65% 底色后光场色相漂了多少（现状 srgb ／ 提议色相锁定） ===')
for (const accent of CHROMATIC) {
  const drift = [], pro = [], de = []
  for (const base of bases.keys()) {
    const [cur] = currentColors(base, accent), [pri] = derivedColors(base, accent)
    drift.push(hueGap(oklch(cur).h, oklch(hex(tints.get(accent)['material-tint-primary'])).h))
    pro.push(hueGap(oklch(pri).h, oklch(hex(accents.get(`${POLAR[base]}|${accent}`)['accent'])).h))
    de.push(dE(cur, pri))
  }
  console.log(`${accent.padEnd(9)} 现状漂移 ${Math.min(...drift).toFixed(0)}–${Math.max(...drift).toFixed(0)}°（跨 8 底）｜ 提议 ${Math.min(...pro).toFixed(0)}–${Math.max(...pro).toFixed(0)}° ｜ 与现状光场色 ΔE ${Math.min(...de).toFixed(1)}–${Math.max(...de).toFixed(1)}`)
}

console.log('\n=== 账 3：80 组闸门（现状配方 ／ 同参数直接替换） ===')
for (const mode of ['cur', 'pro']) {
  const bad = []
  for (const base of bases.keys()) for (const accent of ALL) {
    const g = measure(base, accent, mode === 'cur' ? currentColors(base, accent) : derivedColors(base, accent))
    const f = fails(g)
    if (f.length) bad.push(`${base}/${accent} ${f.join(' ')}`)
  }
  console.log(`  ${mode === 'cur' ? '现状' : '直接替换'}越闸 ${bad.length} 组${bad.length ? '：' + bad.slice(0, 4).join('；') : ''}`)
}

const minGapOf = (base, cols) => { const fs = CHROMATIC.map((a) => fieldFn(base, cols(base, a), strengths(base, a)))
  let m = 1e9
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) m = Math.min(m, dE(fs[i](200, 90), fs[j](200, 90)))
  return m }
function probe(group, cols) {
  const rows = []
  for (const base of group) for (const accent of CHROMATIC) rows.push({ base, accent, g: measure(base, accent, cols(base, accent)) })
  const bad = rows.filter((r) => fails(r.g).length)
  return `越闸 ${String(bad.length).padStart(2)}/36 留白 ${Math.min(...rows.map((r) => r.g.dAvg)).toFixed(1)}–${Math.max(...rows.map((r) => r.g.dAvg)).toFixed(1)}` +
    ` 边缘最低 ${Math.min(...rows.map((r) => r.g.edge)).toFixed(1)} 中部最高 ${Math.max(...rows.map((r) => r.g.mid)).toFixed(1)} 互差 ${Math.min(...group.map((b) => minGapOf(b, cols))).toFixed(1)}` +
    (bad.length ? ` 首失败 ${bad[0].base}/${bad[0].accent}（${fails(bad[0].g).join(' ')}）` : '')
}
console.log('\n=== 账 4：色相锁定 + 底色锚定时，占比与明度台阶给多少（石墨走特例） ===')
console.log('现状 tint 表   浅底', probe(LIGHT, (b, a) => currentColors(b, a)))
console.log('               深底', probe(DARK, (b, a) => currentColors(b, a)))
console.log('辅光相对主光的色相偏移（量自现状 tint2 表）：', Object.entries(COMPANION).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v.toFixed(0)}°`).join('  '))
for (const step of [0, 0.03, 0.05]) for (const p of [0.35, 0.45, 0.55, 0.65]) {
  const cols = (b, a) => derivedColors(b, a, p, p * 0.82, POLAR[b] === 'dark' ? step : -step)
  console.log(`\n占比 ${p.toFixed(2)} 台阶 ${step.toFixed(2)}（浅底压暗、深底抬亮 ${step.toFixed(2)}）`)
  console.log('  浅底', probe(LIGHT, cols))
  console.log('  深底', probe(DARK, cols))
}

/** 明度取强调色但钉进带宽：L = clamp(A.L, N.L ± near, N.L ± far)，彩度按占比取强调色 */
function bandedColors(base, accent, k, near, far, sK = k * 0.82) {
  const A = oklch(hex(accents.get(`${POLAR[base]}|${accent}`)['accent'])), N = oklch(hex(bases.get(base).sunken))
  const sign = POLAR[base] === 'dark' ? 1 : -1
  const [lo, hi] = sign > 0 ? [N.L + near, N.L + far] : [N.L - far, N.L - near]
  const mk = (share, dH) => clamp8(oklchToRgb({ L: Math.min(hi, Math.max(lo, A.L)), C: A.C * share, h: (A.h + dH + 360) % 360 }))
  return [mk(k, 0), mk(sK, COMPANION[accent])]
}
console.log('\n=== 账 5：明度带宽版（强调色明度钉进"底色 ± 带宽"，彩度仍按比例） ===')
for (const [near, far] of [[0.03, 0.09], [0.03, 0.12], [0.05, 0.14], [0.04, 0.10]]) for (const k of [0.35, 0.45, 0.55]) {
  const cols = (b, a) => bandedColors(b, a, k, near, far)
  console.log(`带宽 ${near.toFixed(2)}–${far.toFixed(2)} 彩度 ${k.toFixed(2)}   浅底`, probe(LIGHT, cols))
  console.log(`                        深底`, probe(DARK, cols))
}

/** 极简版：明度用每极一个标量（不跟底色走），色相与彩度取强调色 */
function pinnedColors(base, accent, l, k, sK = k * 0.82) {
  const A = oklch(hex(accents.get(`${POLAR[base]}|${accent}`)['accent']))
  const mk = (share, dH) => clamp8(oklchToRgb({ L: l, C: A.C * share, h: (A.h + dH + 360) % 360 }))
  return [mk(k, 0), mk(sK, COMPANION[accent])]
}
console.log('\n=== 账 6：明度钉成每极一个标量（CSS 一行可达） ===')
for (const [ll, ld] of [[0.85, 0.24], [0.86, 0.26], [0.88, 0.28], [0.83, 0.22]]) for (const k of [0.35, 0.45, 0.55, 0.65]) {
  const cols = (b, a) => pinnedColors(b, a, POLAR[b] === 'dark' ? ld : ll, k)
  console.log(`L 浅 ${ll} 深 ${ld} 彩度 ${k.toFixed(2)}   浅底`, probe(LIGHT, cols), '\n', ' '.repeat(28), '深底', probe(DARK, cols))
}

/* ---------- 推荐点逐底对账 ---------- */
const REC = { light: { l: 0.85, k: 0.45 }, dark: { l: 0.24, k: 0.55 } }
const recCols = (b, a) => pinnedColors(b, a, POLAR[b] === 'dark' ? REC.dark.l : REC.light.l, POLAR[b] === 'dark' ? REC.dark.k : REC.light.k)
console.log('\n=== 账 7：推荐点（浅 L 0.85 彩度 45%／深 L 0.24 彩度 55%）逐底 ===')
for (const base of bases.keys()) {
  const rows = CHROMATIC.map((a) => ({ a, g: measure(base, a, recCols(base, a)) }))
  const cur = CHROMATIC.map((a) => measure(base, a, currentColors(base, a)))
  console.log(`${base.padEnd(9)} 留白 ${Math.min(...rows.map((r) => r.g.dAvg)).toFixed(1)}–${Math.max(...rows.map((r) => r.g.dAvg)).toFixed(1)}（现状 ${Math.min(...cur.map((r) => r.dAvg)).toFixed(1)}–${Math.max(...cur.map((r) => r.dAvg)).toFixed(1)}）` +
    ` 边缘最低 ${Math.min(...rows.map((r) => r.g.edge)).toFixed(1)} 中部最高 ${Math.max(...rows.map((r) => r.g.mid)).toFixed(1)}` +
    ` 峰值 ΔL* ${Math.max(...rows.map((r) => r.g.peakL)).toFixed(1)} 卡面最小分离 ${Math.min(...rows.map((r) => r.g.minSep)).toFixed(1)} 文字最低 ${Math.min(...rows.map((r) => r.g.textMin)).toFixed(2)}` +
    ` 越闸 ${rows.filter((r) => fails(r.g).length).length}`)
}
console.log('\n光场色样本（推导值 oklch → 掺完后的 sRGB，对比现状手写 tint 掺 65%）：')
for (const [b, a] of [['paper', 'ink'], ['paper', 'rose'], ['snow', 'celadon'], ['linen', 'teal'], ['ink', 'celadon'], ['ink', 'amber'], ['slate', 'ink'], ['moss', 'forest']]) {
  const [pri] = recCols(b, a), [cur] = currentColors(b, a), o = oklch(pri)
  console.log(`  ${b}/${a.padEnd(8)} 提议 rgb(${pri})  h ${o.h.toFixed(0)}° C ${o.C.toFixed(3)} ｜ 现状 rgb(${cur.map(Math.round)})  h ${oklch(cur).h.toFixed(0)}° C ${oklch(cur).C.toFixed(3)} ｜ 强调色 h ${oklch(hex(accents.get(`${POLAR[b]}|${a}`)['accent'])).h.toFixed(0)}°`)
}




/* ---------- 账 8：合成 alpha 之后，光斑像素的色相离强调色多远 ---------- */
console.log('\n=== 账 8：画出来的光斑像素（含强度覆盖量）离本极性强调色色相多远 ===')
const PTS = [['主斑', 0.14 * W, 0.12 * H], ['留白', 200, 90], ['辅斑', 0.9 * W, 0.93 * H]]
for (const [label, colsOf] of [['现状', (b, a) => currentColors(b, a)], ['提议', recCols]]) {
  const rows = []
  for (const accent of CHROMATIC) for (const base of bases.keys()) {
    const f = fieldFn(base, colsOf(base, accent), strengths(base, accent))
    const A = oklch(hex(accents.get(`${POLAR[base]}|${accent}`)['accent']))
    for (const [tag, x, y] of PTS) {
      const o = oklch(f(x, y))
      rows.push({ tag, accent, base, gap: hueGap(o.h, A.h), C: o.C })
    }
  }
  for (const tag of ['主斑', '留白', '辅斑']) {
    const lit = rows.filter((r) => r.tag === tag && r.C >= 0.01)
    if (!lit.length) { console.log(`  ${label} ${tag}：无可辨彩度取样`); continue }
    const worst = lit.reduce((m, r) => (r.gap > m.gap ? r : m), lit[0])
    console.log(`  ${label.padEnd(2)} ${tag}：可辨 ${String(lit.length).padStart(2)}/72 中位 ${(lit.reduce((a, r) => a + r.gap, 0) / lit.length).toFixed(0).padStart(3)}° 最大 ${worst.gap.toFixed(0).padStart(3)}°（${worst.base}/${worst.accent}）`)
  }
}
