#!/usr/bin/env node
/*
 * 外部配色交付物 intake 校验（不写入项目，只出判决）
 *
 * 用法：node scripts/theme-intake.mjs <artifact.txt>
 *
 * 输入格式（外部模型按清单第 9/11 节交付的形状）：
 *   [data-theme="snow"]                 ← 底色块选择器
 *   --bg = #f6f4ee                      ← 槽名 = 值
 *   [data-base="light"][data-accent="rose"]
 *   ...
 * 以 # 开头的行是它的注释，忽略。accent 块也接受旧形状
 * [data-theme="paper"][data-accent=x]，按 POLARITY 表折算成极性。
 *
 * 校五件事：
 *   1. 底色块槽名与 global.css 的基准键集**逐字相等**（缺槽/多槽/改名都当场点名）
 *   2. accent 块只许动 accent 族 17 槽
 *   3. 极性完整性：2 极性 × N 档都要有块；新底色只需归入某一极
 *   4. 底色块不许 var()（accent 块允许，它按极性切、本就可以掺随底走的面）
 *   5. 判据：面族 L* 阶梯 + 字色/状态色/彩底字的 WCAG 对比度，对着清单第 5 节的底线核
 */
import { relative } from 'node:path'
import { readArtifact, readGlobal, ACCENT_SLOTS, toRgb, labL, lab, contrast, ROOT } from './lib/theme-tokens.mjs'

const ARTIFACT = process.argv[2]
if (!ARTIFACT) {
  console.error('用法：node scripts/theme-intake.mjs <artifact.txt>')
  process.exit(2)
}

/* ---- 基准：直接读 global.css，不维护第二份清单 ---- */
const global = readGlobal()
const canonical = [...global.base.get('paper').keys()]
const current = global.base
if (canonical.length === 0) { console.error('没从 global.css 里取到键集'); process.exit(2) }

/* ---- 解析交付物 ---- */
const blocks = readArtifact(ARTIFACT)
const baseBlocks = blocks.filter((b) => b.theme && !b.accent)
const accentBlocks = blocks.filter((b) => b.accent)
/** 交付物里 accent 块挂的是哪一极：新形状直接给 data-base，旧形状按底色 → POLARITY 折算 */
const polOf = (b) => b.base ?? global.polarity.get(b.theme) ?? null
const parseSel = (s) => ({ theme: /\[data-theme="([\w-]+)"\]/.exec(s)?.[1], accent: /\[data-accent="([\w-]+)"\]/.exec(s)?.[1] })

const problems = []
const warns = []

/* ---- 1/2/4 键集 ---- */
const newBases = []
for (const b of baseBlocks) {
  const { theme } = parseSel(b.selector)
  const names = [...b.decls.keys()]
  const missing = canonical.filter((s) => !b.decls.has(s))
  const extra = names.filter((s) => !canonical.includes(s))
  if (missing.length) problems.push(`${theme}: 缺 ${missing.length} 槽（切过去这些位置留着旧值不动）\n        ${missing.join('\n        ')}`)
  if (extra.length) problems.push(`${theme}: 出现基准键集里没有的槽名 ${extra.join(' / ')}\n        键名必须逐字照抄清单第 2 节`)
  for (const [s, v] of b.decls) if (v.includes('var(')) problems.push(`${theme}: ${s} 用了 var()：底色块只放具体色值`)
  /* 字体槽在底色层里是"抄一份常量"，不是设计项：写歪了等于把内置字体栈换掉 */
  for (const s of ['--font-ui', '--font-mono']) {
    const v = b.decls.get(s)
    const norm = (x) => x.replace(/\s+/g, ' ').trim()
    if (v && norm(v) !== norm(current.get('paper')?.get(s) ?? '')) problems.push(`${theme}: ${s} 与现值不一致，字体栈是常量（尺度层之外的例外），请照抄清单第 2 节`)
  }
  if (!global.base.has(theme)) newBases.push(theme)
  b.theme = theme
}
for (const b of accentBlocks) {
  const names = [...b.decls.keys()]
  const rogue = names.filter((s) => !ACCENT_SLOTS.has(s))
  const missing = [...ACCENT_SLOTS].filter((s) => !b.decls.has(s))
  if (rogue.length) problems.push(`${b.selector}: 动了 accent 族之外的槽 ${rogue.join(' / ')}`)
  if (missing.length) problems.push(`${b.selector}: accent 族缺 ${missing.length} 槽：${missing.join(', ')}`)
  if (!polOf(b)) problems.push(`${b.selector}: 认不出极性——写成 [data-base="light|dark"][data-accent=x]，或用已知底色名让 POLARITY 表折算`)
}

/* ---- 3 极性完整性：齐全 = global.css 现存的极性组合 ∪ 交付物新增的 ---- */
const have = new Set(global.combo.keys())
for (const b of accentBlocks) {
  const p = polOf(b)
  if (p) have.add(`${p}/${b.accent}`)
}
const shippedPolarities = [...new Set([...global.combo.keys()].map((k) => k.split('/')[0]))]
const shippedAccents = [...new Set([...global.combo.keys()].map((k) => k.split('/')[1]))]
const allPolarities = [...new Set([...shippedPolarities, ...accentBlocks.map(polOf).filter(Boolean)])]
const allAccents = [...new Set([...shippedAccents, ...accentBlocks.map((b) => b.accent)])]
const allBases = [...new Set([...global.base.keys(), ...baseBlocks.map((b) => b.theme)])]
for (const p of allPolarities) for (const a of allAccents) {
  if (!have.has(`${p}/${a}`)) problems.push(`缺 accent 块 [data-base="${p}"][data-accent="${a}"]——同一极的所有底色都会跟着缺这一档`)
}
/* 新底色不再要求配套 accent 块：它只需归入某一极。归不进（明暗判不出来）才是问题。 */
for (const t of newBases) {
  const b = baseBlocks.find((x) => x.theme === t)
  const bg = b && toRgb(b.decls.get('--bg'))
  const pol = bg ? (labL(bg) < 25 ? 'dark' : 'light') : null
  if (!pol) { problems.push(`新底色 ${t}: 无法从 --bg 判出极性（亮/暗），theme.ts 的 POLARITY 表没法登记`); continue }
  b.polarity = pol
  const rep = current.get([...current.keys()].find((k) => global.polarity.get(k) === pol))
  const repL = rep ? labL(toRgb(rep.get('--bg'))) : null
  if (repL !== null && Math.sign(labL(bg) - 50) !== Math.sign(repL - 50)) problems.push(`新底色 ${t}: 判为 ${pol} 极，但代表底 ${rep?.get('--bg')} 不在同一侧`)
  warns.push(`新底色 ${t} 归入 ${pol} 极：它会直接吃 ${pol}×${allAccents.join(`/${pol}×`)} 这 ${allAccents.length} 块现值，不需要另出 accent 稿。`)
}

/* ---- 色值数学（lib 提供，出图脚本同一份） ---- */
const parse = toRgb
const L = labL
const cr = contrast

/* ---- 5 判据 ----
 * 底线 = 现值基准（同极性的那套）实测，再加一道硬 floor：
 *   · 深色小字 ≥5.8（历史裁定）
 *   · 正文/说明 ≥4.5
 * 用绝对值（比如 faint ≥3.0）会拦下与现值同档的稿——纸底的 --text-faint 现值就只有 2.96。 */
const HARD_MIN = { '--text': 4.5, '--text-secondary': 4.5, '--text-muted': 4.5, '--text-faint': 0, '--text-url': 4.5, '--danger': 4.5, '--success': 4.5, '--warning': 4.5 }
const DARK_MIN = { '--text-muted': 5.8, '--text-faint': 5.8 }
const BASE_TOL = 0.15
/* 与现值的差距分两档：小落差只是"这一套底色面本身暗了一档"，提示即可；
 * 掉过 1.0 才是真回归，拦下。 */
const REGRESS = 1.0
const SURF = ['--sunken', '--sidebar-bg', '--bg', '--hover', '--panel-bg', '--fill', '--active']
/* 现值基准：槽色对各自卡面的对比度 */
const baselineRatio = (which, slot) => {
  const f = parse(current.get(which)?.get(slot)), panel = parse(current.get(which)?.get('--panel-bg'))
  return f && panel ? cr(f, panel) : null
}
const BASE = { light: 'paper', dark: 'ink' }
const report = []
for (const b of [...baseBlocks]) {
  const t = b.theme
  const g = (s) => parse(b.decls.get(s))
  const dark = g('--bg') && L(g('--bg')) < 25
  const refBase = BASE[dark ? 'dark' : 'light']
  const panel = g('--panel-bg'), sunken = g('--sunken')
  const ladder = SURF.filter((s) => g(s)).map((s) => `${s.replace('--', '')} ${L(g(s)).toFixed(1)}`).join(' → ')
  report.push(`\n### ${t}（${dark ? '深色' : '浅色'}，对着 ${refBase} 现值判）\n面族 L*：${ladder}`)
  /* 禁令一（清单第 5 节）：卡面不许纯白——255 把明适应顶到顶，旁边下陷面就显脏。
   * 上限 254 是雪底轮定的两档之一（纸 252 / 雪 254）。 */
  if (panel && !dark && panel.some((c) => c > 254)) {
    report.push(`✗ --panel-bg ${b.decls.get('--panel-bg')} 触及纯白`)
    problems.push(`${t}: --panel-bg ${b.decls.get('--panel-bg')} 每通道要 ≤254（纸底 252、雪底 254 是现有两档上限）——卡面贴纯白会把眼睛明适应顶到顶，下陷面发脏`)
  }
  /* 禁令二（清单第 10 节硬约束 10）：冷灰只许走 Lab 的 b\* 轴。
   * 判别"这一套底想当冷底"= --bg 的 b\* 为负；此时面族/描边/文字任一格 a\* 掉到 −1.0 以下
   * 就是掺了绿（写成 R<G<B 单调递增必然如此），实机读作"青涩"。
   * 被否的那版雪底：--border a*=−1.12、--text-muted −1.06。已发货的冷底（雪/岩）全族 a\* 在 ±0.6 内。 */
  if (g('--bg')) {
    const bgLab = lab(g('--bg'))
    if (bgLab.b < 0) {
      const GRAYS = [...SURF, '--border', '--border-strong', '--border-subtle', '--sidebar-hover', '--text', '--text-secondary', '--text-muted', '--text-faint']
      const off = GRAYS.map((s) => ({ s, v: g(s) })).filter((x) => x.v && lab(x.v).a <= -1.0)
        .map((x) => `${x.s.replace('--', '')} a*=${lab(x.v).a.toFixed(2)} b*=${lab(x.v).b.toFixed(2)}`)
      if (off.length) problems.push(`${t}: 冷底带了绿分量（a* ≤ −1.0）：${off.join(' / ')}——"冷"只走 b* 轴，a* 留在 0 附近，否则实机读作青涩`)
    }
  }
  /* 底色之间拉不拉得开是取舍不是律法（雪替砂的第一版就要了 Δ3.9 的近白档，
   * 结果实机看不出与纸底有别，v2 回头把面族推到 10.6；v3 用户改口要"白"，
   * 又回到 8.5——"白"与"拉得开"是同一架跷跷板，交稿方要哪一头得自己说清），所以只报数不拦。
   * v4 把雪底的冷度撤成中性、分层改由明度台阶主担，两头同时拿到（ΔRGB 10.7），
   * 代价是"雪=冷白"这条字面联想没了。锚点 = 面族七槽的平均 ΔRGB；现值 纸↔雪 10.7、墨↔岩 10.5。 */
  if (!current.has(t)) {
    const peers = [...current].filter(([x]) => global.polarity.get(x) === (dark ? 'dark' : 'light'))
    const dists = peers.map(([x, m]) => {
      const vs = SURF.map((s) => { const p = g(s), q = parse(m.get(s)); return p && q ? Math.hypot(...p.map((v, i) => v - q[i])) : NaN })
        .filter((v) => Number.isFinite(v))
      return { x, mean: vs.reduce((a, v) => a + v, 0) / vs.length }
    }).sort((a, b) => a.mean - b.mean)
    for (const d of dists) report.push(`· 面族平均 ΔRGB 对 ${d.x} ${d.mean.toFixed(1)}（现值同极底：纸↔雪 10.7，墨↔岩 10.5）`)
    const near = dists[0]
    if (near && near.mean < 8) {
      warns.push(`${t}: 与 ${near.x} 的面族平均 ΔRGB 只有 ${near.mean.toFixed(1)}，肉眼是同一张底挪半档。当新增方向要斟酌（每多一套底色就多 5 个组合的出图矩阵）；若这份稿是**替换**某套已发货底色，忽略这条。`)
    }
  }
  /* 面族结构：每面相对卡面的 ΔL* 要和参照底色同序同幅，否则分层逻辑变了。
   * 96 槽填满不等于阶梯对——fill/active 谁压谁、侧栏在画布哪一侧，都是这轮判的。 */
  const refPanel = parse(current.get(refBase)?.get('--panel-bg'))
  for (const s of [...SURF, '--border', '--border-strong']) {
    const v = g(s)
    if (!v || !panel || !refPanel) continue
    const d = L(v) - L(panel)
    const rv = parse(current.get(refBase)?.get(s))
    const rd = rv ? L(rv) - L(refPanel) : null
    if (rd === null) continue
    const flip = Math.sign(d) !== Math.sign(rd) && Math.abs(d) > 0.6 && Math.abs(rd) > 0.6
    report.push(`${flip ? '✗' : '·'} ${s} ΔL*(对卡面) ${d >= 0 ? '+' : ''}${d.toFixed(1)}（${refBase} ${rd >= 0 ? '+' : ''}${rd.toFixed(1)}）`)
    if (flip) problems.push(`${t}: ${s} 相对卡面跑到了${d > 0 ? '亮' : '暗'}侧（${refBase} 在${rd > 0 ? '亮' : '暗'}侧 ${rd.toFixed(1)}），面族分层逻辑变了`)
    else if (Math.abs(d - rd) > 2) warns.push(`${t}: ${s} 与卡面的 ΔL* 是 ${d.toFixed(1)}，${refBase} 现值 ${rd.toFixed(1)}，差 ${Math.abs(d - rd).toFixed(1)} 级（>2 会被眼睛看成不同的一档）`)
  }
  for (const slot of Object.keys(HARD_MIN)) {
    const f = g(slot)
    if (!f || !panel) continue
    const onPanel = cr(f, panel), onSunken = sunken ? cr(f, sunken) : null
    const refs = []
    const hard = dark ? Math.max(HARD_MIN[slot], DARK_MIN[slot] ?? 0) : HARD_MIN[slot]
    if (onPanel < hard) { report.push(`✗ ${slot} 卡面 ${onPanel.toFixed(2)}（硬底线 ${hard}）`); problems.push(`${t}: ${slot} 在卡面上只有 ${onPanel.toFixed(2)}:1，低于硬底线 ${hard}:1`); continue }
    const cur = baselineRatio(refBase, slot)
    if (cur !== null && onPanel < cur - BASE_TOL) {
      const delta = cur - onPanel
      const line = `${slot} 卡面 ${onPanel.toFixed(2)} / 下陷 ${onSunken?.toFixed(2)}，比 ${refBase} 现值 ${cur.toFixed(2)} 低 ${delta.toFixed(2)}`
      report.push(`${delta > REGRESS ? '✗' : '!'} ${line}`)
      ;(delta > REGRESS ? problems : warns).push(`${t}: ${line}`)
      continue
    }
    refs.push(cur !== null ? `现值 ${cur.toFixed(2)}` : '无现值')
    report.push(`· ${slot} 卡面 ${onPanel.toFixed(2)} / 下陷 ${onSunken?.toFixed(2)}（${refs.join('，')}，硬底线 ${hard || '—'}）`)
  }
  const prim = g('--accent')
  if (prim && panel) {
    const onPrim = cr(g('--accent-on') ?? [255, 255, 255], prim)
    report.push(`· 主色 ${b.decls.get('--accent')} 在卡面 ${cr(prim, panel).toFixed(2)}:1；主色上的字 ${onPrim.toFixed(2)}:1`)
    if (onPrim < 4.5) problems.push(`${t}: --accent-on 对 --accent 只有 ${onPrim.toFixed(2)}:1`)
  }
  /* 彩底/语法色：现纸底就没全过 4.5（cat-text 最低 4.40、语法色对下陷 4.69–4.99），
   * 所以按"不比同极性现值差"判，别用绝对 4.5 拦下一份和现状同档的稿。 */
  for (let i = 1; i <= 6; i++) {
    const chip = g(`--cat-${i}`), fg = g('--cat-text')
    if (!chip || !fg) continue
    const on = cr(fg, chip)
    const cur = (() => { const c = parse(current.get(refBase)?.get(`--cat-${i}`)), f = parse(current.get(refBase)?.get('--cat-text')); return c && f ? cr(f, c) : null })()
    if (cur !== null && on < cur - BASE_TOL) {
      const line = `${t}: --cat-text 对 --cat-${i} 只有 ${on.toFixed(2)}:1，${refBase} 现值 ${cur.toFixed(2)}:1`
      ;(cur - on > REGRESS ? problems : warns).push(line)
    }
  }
  for (const s of ['--code-kw', '--code-str', '--code-num', '--code-type', '--code-fn', '--code-var', '--code-com', '--code-tag', '--code-pun']) {
    const f = g(s)
    if (!f || !sunken) continue
    const on = cr(f, sunken)
    const cur = (() => { const c = parse(current.get(refBase)?.get('--sunken')), x = parse(current.get(refBase)?.get(s)); return c && x ? cr(x, c) : null })()
    if (cur !== null && on < cur - BASE_TOL) {
      const line = `${t}: 语法色 ${s} 对 --sunken 只有 ${on.toFixed(2)}:1，${refBase} 现值 ${cur.toFixed(2)}:1`
      ;(cur - on > REGRESS ? problems : warns).push(line)
    }
  }
  /* 与现值同族的面差：卡面 vs 下陷 */
  if (panel && sunken) {
    const d = Math.abs(L(panel) - L(sunken))
    report.push(`· 卡面↔下陷 ΔL* ${d.toFixed(1)}（分层还要靠描边：border ${g('--border') ? L(g('--border')).toFixed(1) : '—'}）`)
  }
}
/* accent 档：一块要喂同一极的全部底色，所以逐个底面判、取最差的那个。
 * 现档主色从 global.css 现取（现值表只认 accent 缺省值，逐档得读覆盖层）。 */
/** 某一极下所有会被这块 accent 吃到的底色：已发货的 + 交付物里新提的 */
function basesOfPolarity(pol) {
  const out = []
  for (const [t, m] of current) if (global.polarity.get(t) === pol) out.push({ name: t, panel: parse(m.get('--panel-bg')) })
  for (const b of baseBlocks) if (b.polarity === pol && !global.base.has(b.theme)) {
    const p = parse(b.decls.get('--panel-bg'))
    if (p) out.push({ name: b.theme, panel: p, fresh: true })
  }
  return out
}
const accentMain = new Map()
for (const [key, m] of global.combo) {
  const v = m.get('--accent')
  if (v) accentMain.set(key, v)
}
for (const b of accentBlocks) {
  const v = b.decls.get('--accent')
  const p = polOf(b)
  if (p && v) accentMain.set(`${p}/${b.accent}`, v)
}
for (const b of accentBlocks) {
  const pol = polOf(b)
  const accent = b.accent
  const prim = parse(b.decls.get('--accent'))
  if (!pol || !prim) continue
  const onPrim = cr(parse(b.decls.get('--accent-on')) ?? [255, 255, 255], prim).toFixed(2)
  const faces = basesOfPolarity(pol).filter((f) => f.panel)
  let worst = null
  const perFace = faces.map((f) => {
    const c = cr(prim, f.panel)
    if (worst === null || c < worst.c) worst = { face: f.name, c }
    return `${f.name} ${c.toFixed(2)}:1`
  })
  let closest = null, minD = 1e9
  for (const [key, hexv] of accentMain) {
    const [p, x] = key.split('/')
    if (p !== pol || x === accent) continue
    const o = parse(hexv)
    if (!o) continue
    const d = Math.hypot(...o.map((v, i) => v - prim[i]))
    if (d < minD) { minD = d; closest = x }
  }
  report.push(`\n### accent ${pol}×${accent}：主色 ${b.decls.get('--accent')}｜主色对卡面 [${perFace.join('，')}]｜主色上的字 ${onPrim}:1｜${pol} 极最近邻档 ${closest ?? '—'}（RGB 距离 ${minD < 1e9 ? Math.round(minD) : '—'}）`)
  if (+onPrim < 4.5) problems.push(`${pol}×${accent}: --accent-on 对主色只有 ${onPrim}:1`)
  if (worst && worst.c < 3) problems.push(`${pol}×${accent}: 主色 ${b.decls.get('--accent')} 在 ${worst.face} 卡面上只有 ${worst.c.toFixed(2)}:1，主钮/下划线会糊`)
  if (minD < 40) warns.push(`${pol}×${accent}: 与 ${closest} 主色 RGB 距离只有 ${Math.round(minD)}，两档摆在一起分不出来`)
}

/* 洗底深度横向对账：一块浅极性 accent 要同时落在纸和雪上，
   某一档在某个底面上 ΔL* 明显比同极其余档浅，选中行就会在那套底上糊成一块。
   只判实色洗底——暗极性整族走半透明，ΔL* 由底色决定，横向比没有意义。 */
const washOf = (m) => {
  const raw = m.get('--accent-soft')
  if (!raw) return null
  const a = /rgba?\([^)]*?[,\s]([\d.]+)\s*\)/.exec(raw)
  if (a && parseFloat(a[1]) < 0.99) return null
  return parse(raw)
}
const allCombos = new Map(global.combo)
for (const b of accentBlocks) { const p = polOf(b); if (p) allCombos.set(`${p}/${b.accent}`, b.decls) }
for (const pol of [...new Set([...allCombos.keys()].map((k) => k.split('/')[0]))]) {
  const faces = basesOfPolarity(pol).filter((f) => f.panel)
  if (faces.length < 2) continue
  for (const f of faces) {
    const depths = []
    for (const [key, m] of allCombos) {
      if (key.split('/')[0] !== pol) continue
      const s = washOf(m)
      if (s) depths.push({ accent: key.split('/')[1], d: labL(s) - labL(f.panel) })
    }
    if (depths.length < 3) continue
    const abs = depths.map((x) => Math.abs(x.d)).sort((a, b) => a - b)
    const median = abs[Math.floor(abs.length / 2)]
    for (const x of depths) {
      if (Math.abs(x.d) < median - 0.4) warns.push(`${pol}×${x.accent}: --accent-soft 在 ${f.name} 卡面上只有 ΔL*${x.d.toFixed(1)}，同极其余档中位 ${median.toFixed(1)}——洗底在这套底上偏柔，选中行存在感不足`)
    }
  }
}

console.log(`交付物 ${relative(ROOT, ARTIFACT) ?? ARTIFACT}：${blocks.length} 块（底色 ${baseBlocks.length}／accent ${accentBlocks.length}）｜基准 ${canonical.length} 槽｜底色轴 ${allBases.join('/')}｜极性 ${allPolarities.join('/')}｜accent 轴 ${allAccents.join('/')}`)
console.log(report.join('\n'))
if (warns.length) { console.log('\n提示（不拦）：'); warns.forEach((w, i) => console.log(`${i + 1}. ${w}`)) }
if (problems.length) { console.log(`\n拦下 ${problems.length} 处：`); problems.forEach((p, i) => console.log(`${i + 1}. ${p}\n`)); process.exit(1) }
console.log('\n全部判据通过。')
