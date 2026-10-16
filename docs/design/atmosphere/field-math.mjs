// 光场配方的解析解：把 materials.css 的 color-mix + radial-gradient 直接算成 RGB，
// 回答三本账——氛围把画布推离底色多远、把画布推到离卡面多近、正文文字对比还剩多少。
// 只算 srgb 插值（与浏览器 color-mix in srgb 同一条路），不含 1.2% dither。
// 校正（2026-10-16 复核）：本脚本两处换算有误，数值账不得当验收依据——
//   ① 混合权重反了：CSS `color-mix(in srgb, tint 65%, --sunken)` 是 tint 占 65%，本脚本 mixSrgb/mix 的第 3 参是「走向 b 的比例」，传 65 得到的是 35% tint；
//   ② lab() 把线性绿通道直接当 Y（正确是 0.2126R+0.7152G+0.0722B），故 L*、ΔE76 失真；relLum/对比度那一路系数正确、不受影响。
// 色相相关结论（tint 与 accent 脱钩、srgb 掺带彩度底色会转色相）由 OKLab 导出，不受这两处影响。现行配方见 docs/design/themes/04-atmosphere-accent-source.md 第 16 节。
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16))
const mix = (a, b, p) => a.map((v, i) => v + (b[i] - v) * p)
const over = (fg, bg) => fg.map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]))
const chan = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
const relLum = (c) => c.map(chan).reduce((a, v, i) => a + [0.2126, 0.7152, 0.0722][i] * v, 0)
const labL = (c) => { const Y = relLum(c); return Y > 0.008856 ? 116 * Y ** (1 / 3) - 16 : 903.3 * Y }
const contrast = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const chroma = (c) => { const r = c.map((v) => v / 255); return Math.max(...r) - Math.min(...r) }
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

const BASE = {
  ink: { sunken: '#181716', panel: '#22211e', text: '#e6e4de' },
  slate: { sunken: '#1f232b', panel: '#2b303a', text: '#edf0f6' },
  paper: { sunken: '#f1ede7', panel: '#fcfaf7', text: '#333230' },
  snow: { sunken: '#ebecee', panel: '#fefefe', text: '#1a1b1d' },
}
const TINT = {
  celadon: ['#20a87a', '#9fc77f'], clay: ['#d8792d', '#e4bd73'],
  teal: ['#25a7bc', '#7799cb'], ink: ['#4979df', '#71b7c8'],
}
const isDark = (t) => t === 'ink' || t === 'slate'
/** 真配方：深底 21/14、浅底 23/16，tint 先掺 65/60% 的 sunken */
const cur = (theme, accent) => ({ theme, accent, dilute: [65, 60],
  pStr: isDark(theme) ? 21 : 23, sStr: isDark(theme) ? 14 : 16 })

function makeField({ theme, accent, dilute, pStr, sStr, wash = 28, pCol, sCol, anchors = [[0.14, 0.12], [0.95, 0.95]] }) {
  const b = BASE[theme], sunken = hex(b.sunken), panel = hex(b.panel)
  const [tp, ts] = TINT[accent]
  const pc = pCol ?? mix(hex(tp), sunken, dilute[0] / 100), sc = sCol ?? mix(hex(ts), sunken, dilute[1] / 100)
  const L = [
    { rx: 0.65, ry: 0.75, ax: 0.5, ay: 0.52, col: [...panel, wash / 100] },
    { rx: 0.78, ry: 0.85, ax: anchors[0][0], ay: anchors[0][1], col: [...pc, pStr / 100] },
    { rx: 0.82, ry: 0.9, ax: anchors[1][0], ay: anchors[1][1], col: [...sc, sStr / 100] },
  ]
  return (fx, fy) => {
    let out = [...sunken, 1]
    for (const l of L) {
      const t = Math.min(1, Math.hypot((fx - l.ax) / l.rx, (fy - l.ay) / l.ry))
      const a = l.col[3] * (1 - t)
      if (a > 0) out = over([...l.col.slice(0, 3), a], out)
    }
    return out.slice(0, 3)
  }
}

/** 全窗 4% 网格扫一遍，取四本账的最坏值 */
function audit(name, cfg) {
  const b = BASE[cfg.theme], sunken = hex(b.sunken), panel = hex(b.panel), text = hex(b.text)
  const f = makeField(cfg)
  let peak = sunken, minSep = 1e9, minSepAt = null, minText = 1e9, minTextAt = null, maxL = -1e9, minL = 1e9
  for (let i = 0; i <= 25; i++) for (let j = 0; j <= 25; j++) {
    const c = f(i / 25, j / 25)
    if (d2(c, sunken) > d2(peak, sunken)) peak = c
    const sep = d2(panel, c)
    if (sep < minSep) { minSep = sep; minSepAt = [i / 25, j / 25] }
    const ct = contrast(text, c)
    if (ct < minText) { minText = ct; minTextAt = [i / 25, j / 25] }
    maxL = Math.max(maxL, labL(c)); minL = Math.min(minL, labL(c))
  }
  const at = (p) => `(${(p[0] * 100).toFixed(0)},${(p[1] * 100).toFixed(0)})`
  console.log(`\n${name}`)
  console.log(`  推离底色      ΔRGB ${d2(peak, sunken).toFixed(0)}  ΔL* ${(labL(peak) - labL(sunken)).toFixed(1)}  彩度 ${chroma(peak).toFixed(3)}`)
  console.log(`  画布 L* 跨度  ${minL.toFixed(1)} – ${maxL.toFixed(1)}（底色 ${labL(sunken).toFixed(1)}／卡面 ${labL(panel).toFixed(1)}）`)
  console.log(`  卡面最小分离  ΔRGB ${minSep.toFixed(0)} @${at(minSepAt)}`)
  console.log(`  正文最低对比  ${minText.toFixed(2)}:1 @${at(minTextAt)}`)
}

console.log('=== 现状：这层氛围到底有多大 ===')
;[['墨·翡翠', 'ink', 'celadon'], ['岩·群青', 'slate', 'ink'], ['纸·湖蓝', 'paper', 'teal'], ['雪·陶橙', 'snow', 'clay']]
  .forEach(([n, t, a]) => audit(`${n}（现状）`, cur(t, a)))

console.log('\n=== 上一轮那两条：提强度 / 提掺入，离地有多远 ===')
audit('墨·翡翠（强度 21/14→23/19）', { ...cur('ink', 'celadon'), pStr: 23, sStr: 19 })
audit('纸·湖蓝（掺入 65/60→75/70）', { ...cur('paper', 'teal'), dilute: [75, 70] })

console.log('\n=== 换方向：tint 少掺 sunken（提彩度而非亮度），再叠强度 ===')
for (const d of [[45, 42], [30, 28]]) {
  audit(`墨·翡翠（掺入 ${d[0]}/${d[1]}，强度不动）`, { ...cur('ink', 'celadon'), dilute: d })
  audit(`墨·翡翠（掺入 ${d[0]}/${d[1]} + 强度 30/22）`, { theme: 'ink', accent: 'celadon', dilute: d, pStr: 30, sStr: 22 })
}
audit('岩·群青（掺入 45/42 + 强度 30/22）', { theme: 'slate', accent: 'ink', dilute: [45, 42], pStr: 30, sStr: 22 })
audit('纸·湖蓝（掺入 45/42，强度不动）', { ...cur('paper', 'teal'), dilute: [45, 42] })
audit('雪·陶橙（掺入 45/42 + 强度 30/22）', { theme: 'snow', accent: 'clay', dilute: [45, 42], pStr: 30, sStr: 22 })

/* ---- 深底的天花板：卡面 L* 就是画布能到的上限 ---- */
console.log('\n=== 深底余量：画布峰值 L* 必须低于卡面，否则层级倒挂 ===')
for (const t of ['ink', 'slate']) {
  const b = BASE[t]
  console.log(`${t}：底色 L* ${labL(hex(b.sunken)).toFixed(1)} → 卡面 L* ${labL(hex(b.panel)).toFixed(1)}（可用余量 ${(labL(hex(b.panel)) - labL(hex(b.sunken))).toFixed(1)}）`)
}

/** 在 accent 色相上找一个"亮度贴着底色、彩度拉满"的光场色：按 sRGB 通道等比压暗到目标 L* */
function deepTint(tintHex, targetL) {
  const c = hex(tintHex)
  let best = c
  for (let k = 1; k >= 0.02; k -= 0.005) {
    const s = c.map((v) => v * k)
    if (labL(s) <= targetL) { best = s; break }
  }
  return best.map((v) => Math.round(v))
}
console.log('\n=== 换轴：亮度不动、只出彩度（深底专用光场色） ===')
for (const [theme, accent] of [['ink', 'celadon'], ['slate', 'ink'], ['ink', 'clay']]) {
  const b = BASE[theme], sunken = hex(b.sunken), headroom = labL(hex(b.panel)) - labL(sunken)
  const [tp, ts] = TINT[accent]
  // 让画布峰值抬到卡面之下 1.5 L*：alpha 给到 45%，反推光场色应比底色亮多少
  const targetPeak = labL(hex(b.panel)) - 1.5
  const p = deepTint(tp, targetPeak), s = deepTint(ts, targetPeak)
  console.log(`\n${theme}·${accent}（余量 ${headroom.toFixed(1)} L*，光场色压到 L* ${targetPeak.toFixed(1)}）`)
  console.log(`  主 #${tp.slice(1)} → rgb(${p})  彩度 ${chroma(p).toFixed(3)}（原色彩度 ${chroma(hex(tp)).toFixed(3)}）`)
  audit(`${theme}·${accent}（深彩度 45/34）`, {
    theme, accent, dilute: [0, 0], pStr: 45, sStr: 34, pCol: p, sCol: s,
    anchors: [[0.14, 0.12], [0.95, 0.95]],
  })
}

