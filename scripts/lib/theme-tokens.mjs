// 主题令牌的共用读法：global.css 的分层块 + 外部交付物的 `槽名 = 值` 表。
// scripts/theme-intake.mjs（判决）与 scripts/theme-candidate-shots.mjs（真 app 覆盖出图）共用这一份，
// 免得两处各写一套正则、判据随之漂移。
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** accent 覆盖层允许动的族（与 check-theme-coverage.mjs 的白名单同源含义） */
export const ACCENT_SLOTS = new Set([
  '--accent', '--accent-hover', '--accent-active', '--accent-on',
  '--accent-soft', '--accent-light', '--accent-ring',
  '--text-brand', '--badge-ver-bg', '--badge-ver-text',
  '--brand-g1', '--brand-g2', '--brand-g3',
  '--lock-orb-1', '--lock-orb-2', '--selection', '--toast-info',
])

export const norm = (s) => s.replace(/\s+/g, ' ').trim()

export const THEME_TS_PATH = join(ROOT, 'src', 'services', 'theme.ts')

/** theme.ts 的 POLARITY 表 → Map(底色 → 'light'|'dark')。极性由底色决定，唯一登记处在那里。 */
export function readPolarity(tsPath = THEME_TS_PATH) {
  const ts = readFileSync(tsPath, 'utf8')
  const m = /export const POLARITY[\s\S]*?\n\}/.exec(ts)
  const out = new Map()
  if (m) for (const x of m[0].matchAll(/(\w+):\s*'([\w-]+)'/g)) out.set(x[1], x[2])
  return out
}

/** theme.ts 的 THEMES / ACCENTS 两表 → [{ id, name }]；截图脚本的组合矩阵从这里长出来，别再各抄一份 */
export function readThemeIds(tsPath = THEME_TS_PATH) {
  const ts = readFileSync(tsPath, 'utf8')
  const grab = (constName) => {
    const block = new RegExp(`export const ${constName}[\\s\\S]*?\\n\\]`).exec(ts)
    const rows = []
    if (block) for (const m of block[0].matchAll(/id: '([\w-]+)', name: '([^']+)'/g)) rows.push({ id: m[1], name: m[2] })
    return rows
  }
  return { themes: grab('THEMES'), accents: grab('ACCENTS'), polarity: readPolarity(tsPath) }
}

/** 全部可见组合 = 底色 × accent（accent 轴挂极性，所以底色新增不用加行）。
 *  id 用 `底色-accent` 当文件名/入参，name 用「纸·墨蓝」给人看。 */
export function themeCombos() {
  const { themes, accents } = readThemeIds()
  return themes.flatMap((t) =>
    accents.map((a) => ({ id: `${t.id}-${a.id}`, name: `${t.name}·${a.name}`, theme: t.id, accent: a.id })),
  )
}

/** 读取样式入口及相对路径 @import，让校验、清单与原型使用同一份材质定义。 */
export function readStyleSource(cssPath) {
  return readFileSync(cssPath, 'utf8').replace(/@import\s+['"](\.[^'"]+)['"]\s*;/g,
    (_, imported) => readStyleSource(resolve(dirname(cssPath), imported)))
}

/** global.css → { base: Map(底色 → Map(槽 → 值)), combo: Map("极性/accent" → Map(槽 → 值)), polarity } */
export function readGlobal(cssPath = join(ROOT, 'src', 'styles', 'global.css')) {
  const css = readStyleSource(cssPath).replace(/\/\*[\s\S]*?\*\//g, '')
  const base = new Map()
  const combo = new Map()
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = norm(m[1])
    const decls = new Map()
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls.set(d[1], d[2].trim())
    if (decls.size === 0) continue
    const c = /^\[data-base="([\w-]+)"\]\[data-accent="([\w-]+)"\]$/.exec(sel)
    if (c) { combo.set(`${c[1]}/${c[2]}`, decls); continue }
    const b = /^(?::root\s*,\s*)?\[data-theme="([\w-]+)"\]$/.exec(sel)
    if (b) {
      const prev = base.get(b[1]) ?? new Map()
      for (const [k, v] of decls) prev.set(k, v)
      base.set(b[1], prev)
    }
  }
  const polarity = readPolarity()
  /** 某套底色 + 某一档 accent 实际吃到的覆盖层 */
  const comboFor = (theme, accent) => combo.get(`${polarity.get(theme)}/${accent}`)
  return { base, combo, polarity, comboFor }
}

/** 外部交付物（`[data-theme="x"]` / `[data-base="x"]` 选择器行 + `槽名 = 值`）→ [{ selector, theme, base, accent, decls }] */
export function readArtifact(path) {
  const out = []
  let cur = null
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (/^\[data-(?:theme|base|accent)=/.test(line) && /\]$/.test(line)) {
      const theme = /\[data-theme="([\w-]+)"\]/.exec(line)?.[1] ?? null
      const pol = /\[data-base="([\w-]+)"\]/.exec(line)?.[1] ?? null
      const accent = /\[data-accent="([\w-]+)"\]/.exec(line)?.[1] ?? null
      cur = { selector: line, theme, base: pol, accent, decls: new Map() }
      out.push(cur)
      continue
    }
    const d = /^(--[\w-]+)\s*=\s*(.+)$/.exec(line)
    if (d && cur) cur.decls.set(d[1], d[2].trim())
  }
  return out
}

/* ---- 色值数学（判据用，不参与写入） ---- */
export const toRgb = (s) => {
  if (!s) return null
  const h = /^#([0-9a-f]{6})$/i.exec(s.trim())
  if (h) return [1, 3, 5].map((i) => parseInt(h[1].slice(i - 1, i + 1), 16))
  const r = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s)
  if (r) return [+r[1], +r[2], +r[3]]
  return null
}
const chan = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
export const relLum = (rgbA) => rgbA.map(chan).reduce((a, v, i) => a + [0.2126, 0.7152, 0.0722][i] * v, 0)
export const labL = (rgbA) => { const Y = relLum(rgbA); return Y > 0.008856 ? 116 * Y ** (1 / 3) - 16 : 903.3 * Y }
export const contrast = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
/** 完整 CIE L*a*b*（D65）。a* 负=带绿/青，b* 负=带蓝——冷灰只许走 b* 轴（清单第 10 节硬约束 10）。 */
export const lab = (rgbA) => {
  const [r, g, b] = rgbA.map(chan)
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505)
  const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b)
  const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089)
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}
