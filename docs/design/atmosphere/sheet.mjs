// 把 shots/ 里的帧拼成 4 行 × 2 列对拍表，便于一次看全（仅本轮自查用）
import { chromium } from '@playwright/test'
import { existsSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? 'docs/design/atmosphere')
const shots = path.join(root, 'shots')
const pairs = (process.argv[3] === 'bare' ? [
  ['atmo-J-bare-ink-base.png', 'atmo-K-bare-ink-chroma.png', 'J/K 墨·翡翠：现状（亮度轴）→ 换轴（彩度轴），两块卡面探针分别在主/辅光斑峰值上'],
  ['atmo-L-bare-slate-base.png', 'atmo-M-bare-slate-chroma.png', 'L/M 岩·群青：同一换轴，探针看卡面是否还浮得起'],
  ['atmo-N-bare-anchor.png', 'atmo-O-bare-anchor-cand.png', 'N/O 雪·陶橙 @1440×900：锚点 14%12%/95%95% → 26%14%/84%90%（虚线=720 阅读列与侧栏右界）'],
] : [
  ['atmo-A-dark-ink.png', 'atmo-I-dark-chroma.png', 'A 现状 / I 换轴：墨·翡翠，带完整外壳'],
  ['atmo-B-dark-str.png', 'atmo-I-dark-chroma.png', 'B 只提强度 / I 换轴：提强度那条基本看不出（ΔRGB 1–5）'],
  ['atmo-E-anchor-snow.png', 'atmo-F-anchor-cand.png', 'E/F 雪·陶橙 锚点（1040×670 默认窗，正文列几乎铺满内容区）'],
  ['atmo-G-dlg-slate.png', 'atmo-H-dlg-thru.png', 'G/H 岩·群青 弹窗：自带光场 → 透出窗外同一片'],
]).map(([a, b, label]) => [a, b, label, process.argv[3] === 'bare'])
for (const [a, b] of pairs) for (const f of [a, b]) if (!existsSync(path.join(shots, f))) { console.error(`缺帧 ${f}`); process.exit(1) }

const bare = process.argv[3] === 'bare'
const IMG = bare ? 1000 : 700
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#5a5a5a;font:600 15px system-ui;color:#fff;padding:18px}
.row{display:flex;gap:16px;align-items:flex-start;margin-bottom:18px}
.row figure{margin:0}.row figcaption{margin-bottom:6px;font-size:13px;font-weight:500;color:#eee}
img{width:${IMG}px;display:block;border:1px solid #000}
h2{font-size:14px;margin:0 0 8px;color:#ffd}
</style>
${pairs.map(([a, b, label]) => `<div class="row"><h2 style="width:100%">${label}</h2></div>
<div class="row"><figure><figcaption>现状</figcaption><img src="file:///${path.join(shots, a).replace(/\\/g, '/')}"></figure>
<figure><figcaption>${bare || a.includes('dlg') || a.includes('anchor') ? '建议' : '对照'}</figcaption><img src="file:///${path.join(shots, b).replace(/\\/g, '/')}"></figure></div>`).join('')}`

const tmp = path.join(root, '_sheet.html')
const { writeFileSync } = await import('node:fs')
writeFileSync(tmp, html, 'utf8')
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })
const page = await browser.newPage({ viewport: { width: IMG * 2 + 90, height: 1000 } })
await page.goto('file:///' + tmp.replace(/\\/g, '/'))
await page.waitForTimeout(400)
const out = process.argv[3] === 'bare' ? 'sheet-bare.png' : 'sheet.png'
await page.screenshot({ path: path.join(shots, out), fullPage: true })
await browser.close()
console.log('wrote', path.join(shots, out))
