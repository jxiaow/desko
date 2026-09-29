// 图标倒圆的共用几何：把 icons.ts 里的纯直线多边形按给定半径切角，矩形件抬 rx。
// scripts/icon-fillet.mjs（离线板）与真应用打样脚本共用这一份，避免两处算法漂移。
/** 把 d 里的 H/V 展平成绝对 L 点列，返回子路径数组 */
function toPolylines(d) {
  const subs = []
  let cur = []
  let cx = 0, cy = 0, sx = 0, sy = 0
  const tokens = d.match(/[MmLlHhVvZz]|-?\d*\.?\d+/g)
  if (!tokens) return null
  let closed = true
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (/[A-Za-z]/.test(t)) {
      if (t === 'M' || t === 'm') {
        if (cur.length) { subs.push({ pts: cur, closed }); cur = [] }
        const rel = t === 'm'
        const x = +tokens[++i], y = +tokens[++i]
        cx = rel ? cx + x : x; cy = rel ? cy + y : y
        sx = cx; sy = cy
        cur = [[cx, cy]]
        while (i + 2 < tokens.length && !/[A-Za-z]/.test(tokens[i + 1])) {
          const a = +tokens[++i], b = +tokens[++i]
          cx += a; cy += b
          cur.push([cx, cy])
        }
      } else if (t === 'L' || t === 'l') {
        const rel = t === 'l'
        while (i + 2 < tokens.length && !/[A-Za-z]/.test(tokens[i + 1]) || i + 2 === tokens.length) {
          const a = +tokens[++i], b = +tokens[++i]
          if (rel) { cx += a; cy += b } else { cx = a; cy = b }
          cur.push([cx, cy])
          if (i + 2 >= tokens.length || /[A-Za-z]/.test(tokens[i + 1])) break
        }
      } else if (t === 'H' || t === 'h') {
        const rel = t === 'h'
        do { const a = +tokens[++i]; cx = rel ? cx + a : a; cur.push([cx, cy]) } while (i + 1 < tokens.length && !/[A-Za-z]/.test(tokens[i + 1]))
      } else if (t === 'V' || t === 'v') {
        const rel = t === 'v'
        do { const a = +tokens[++i]; cy = rel ? cy + a : a; cur.push([cx, cy]) } while (i + 1 < tokens.length && !/[A-Za-z]/.test(tokens[i + 1]))
      } else if (t === 'Z' || t === 'z') {
        cx = sx; cy = sy
      } else {
        return null
      }
    } else return null
  }
  if (cur.length) subs.push({ pts: cur, closed })
  return subs
}

const f = (n) => (Math.round(n * 100) / 100).toString()

/** 顶点倒圆：把角切掉，用二次贝塞尔补一段弧 */
function fillet(pts, closed, r) {
  const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])
  const n = pts.length
  const out = []
  const idxs = closed ? pts.map((_, i) => i) : pts.slice(1, -1).map((_, i) => i + 1)
  const at = (i) => pts[((i % n) + n) % n]
  const prev = (i) => (closed ? at(i - 1) : (i === 0 ? null : pts[i - 1]))
  const next = (i) => (closed ? at(i + 1) : (i === n - 1 ? null : pts[i + 1]))
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 1; i < n; i++) d += ` L${f(pts[i][0])} ${f(pts[i][1])}`
  if (closed) d += ' Z'
  if (r <= 0 || idxs.length === 0) return d
  // 逐点重建
  let out_d = ''
  const seg = (a, b) => { const L = dist(a, b); return L === 0 ? 0 : r / L }
  const visited = new Set()
  const order = closed ? pts.map((_, i) => i) : pts.map((_, i) => i)
  for (const i of order) {
    const p = at(i), a = prev(i), b = next(i)
    if (!a || !b) { out_d += (i === 0 ? `M${f(p[0])} ${f(p[1])}` : ` L${f(p[0])} ${f(p[1])}`); continue }
    const la = dist(a, p), lb = dist(p, b)
    const rr = Math.min(r, la / 2.2, lb / 2.2)
    const qa = [p[0] + (a[0] - p[0]) * (rr / la), p[1] + (a[1] - p[1]) * (rr / la)]
    const qb = [p[0] + (b[0] - p[0]) * (rr / lb), p[1] + (b[1] - p[1]) * (rr / lb)]
    if (i === 0 && closed) out_d += `M${f(qa[0])} ${f(qa[1])}`
    else out_d += ` L${f(qa[0])} ${f(qa[1])}`
    out_d += ` Q${f(p[0])} ${f(p[1])} ${f(qb[0])} ${f(qb[1])}`
    visited.add(i)
  }
  out_d += closed ? ' Z' : ''
  return out_d
}

/** 重写一个 glyph 的 body：rect 抬 rx，纯直线 path 倒圆 */
function roundBody(body, r, rxTo) {
  let out = body.replace(/<rect([^>]*)\/>/g, (m, attrs) => {
    if (r <= 0) return m
    return /rx="/.test(attrs)
      ? m.replace(/rx="[\d.]+"/, `rx="${rxTo}"`)
      : `<rect${attrs} rx="${rxTo}"/>`
  })
  if (r > 0) {
    out = out.replace(/<path d="([^"]*)"([^>]*)\/>/g, (m, d, rest) => {
      if (/[CcAaQqSsTt]/.test(d)) return m
      const subs = toPolylines(d)
      if (!subs) return m
      const nd = subs.map((s) => fillet(s.pts, s.closed && s.pts.length > 2, r)).join(' ')
      return `<path d="${nd}"${rest}/>`
    })
  }
  return out
}

export { toPolylines, fillet, roundBody }
