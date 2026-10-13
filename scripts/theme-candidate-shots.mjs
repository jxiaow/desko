// 候选配色实机对拍板：跑在 e2e mock 后端上的真 app，注入候选令牌块出图，再拼成同 accent 双底对比板。
// 为什么注入而不是直接渲染：候选底色还没进 global.css / theme.ts，取值校验会把它回落成 paper。
// 用法：先起 vite --mode e2e --port 1430，再
//   PW_CHANNEL=msedge node scripts/theme-candidate-shots.mjs "C:/Users/jxiaow/Downloads/code_artifact.txt"
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readArtifact, readGlobal, readThemeIds, ACCENT_SLOTS, toRgb, labL, ROOT } from './lib/theme-tokens.mjs'

const BASE_URL = 'http://127.0.0.1:1430'
const OUT = join(ROOT, 'design', 'polarity-shots')
const ARTIFACT = process.argv[2]
if (!ARTIFACT) {
  console.error('用法：node scripts/theme-candidate-shots.mjs <artifact.txt>')
  process.exit(2)
}

const SEED = {
  entries: [
    { name: 'GitHub', url: 'https://github.com', username: 'dev@example.com', password: 'Gh!tHub2024', notes: '代码托管平台，每月轮换口令', category: '开发' },
    { name: 'Gmail', url: 'https://mail.google.com', username: 'user@gmail.com', password: 'Gm@il#Secure', notes: '个人邮箱', category: '邮箱' },
    { name: '钉钉', url: 'https://www.dingtalk.com', username: 'user@company.com', password: 'Ding!Talk88', category: '办公' },
    { name: 'Figma', url: 'https://figma.com', username: 'design@studio.io', password: 'F1gma#Design', notes: '设计协作', category: '设计' },
    { name: '招商银行', url: 'https://cmbchina.com', username: '62148801', password: 'Bank@Pass123', category: '金融' },
    { name: '路由器', url: 'http://192.168.1.1', username: 'admin', password: 'admin123', notes: '光猫后台', category: '设备' },
    { name: '临时站点', url: 'https://example.com', username: 'temp', password: 'Temp#123456' },
  ],
  urlPaths: [{ entry_index: 0, path: '/settings/tokens', label: '访问令牌', notes: '每月轮换' }],
  notes: [
    { title: '会议纪要', content_html: '<h2>周会纪要</h2><p>尺度层不动，<strong>主题层只管颜色</strong>。</p><ul data-type="taskList"><li><label><input type="checkbox" checked><span>令牌化 global.css</span></label></li><li><label><input type="checkbox"><span>逐屏实机检查</span></label></li></ul>', category: '工作', pinned: true },
    { title: '代码片段', content_html: '<p>头像色由分类哈希决定：</p><pre><code class="language-ts"><span class="hljs-keyword">const</span> hash = (s: <span class="hljs-built_in">string</span>) =&gt; {\n  <span class="hljs-keyword">let</span> h = <span class="hljs-number">0</span>\n  <span class="hljs-comment">// 六色循环</span>\n  <span class="hljs-keyword">return</span> Math.abs(h) % <span class="hljs-number">6</span>\n}</code></pre>', category: '开发' },
  ],
  fileShortcuts: [{ name: '项目资料', path: 'C:/e2e/project', shortcut_type: 'folder' }, { name: '月度报告', path: 'C:/e2e/report.pdf', shortcut_type: 'file' }],
}

const global = readGlobal()
const artifact = readArtifact(ARTIFACT)
const newBases = new Map(artifact.filter((b) => b.theme && !b.accent).map((b) => [b.theme, b.decls]))
const polOf = (b) => b.base ?? global.polarity.get(b.theme) ?? null
const newAccents = new Map(artifact.filter((b) => b.accent).map((b) => [`${polOf(b)}/${b.accent}`, b.decls]))

/** 底色 → 极性：已发货的读 theme.ts 的 POLARITY，交付物里新提的按 --bg 的 L* 临时判一极 */
function polarityOf(base) {
  const known = global.polarity.get(base)
  if (known) return known
  const nb = newBases.get(base)
  const bg = nb && toRgb(nb.get('--bg'))
  return bg ? (labL(bg) < 25 ? 'dark' : 'light') : null
}

/** 某个候选组合的覆盖 CSS：新底色整块（去 accent 族）+ 按极性搬来的 accent 族 */
function candidateCss(base, accent) {
  const pol = polarityOf(base)
  if (!pol) throw new Error(`没登记 ${base} 的极性：在交付物里给它归一极，或先补进 theme.ts 的 POLARITY`)
  const parts = []
  const nb = newBases.get(base)
  if (nb) {
    /* 底色块自带的 accent 族不进 CSS：accent 覆盖层一定会盖过来，照搬只得出假候选 */
    const body = [...nb].filter(([s]) => !ACCENT_SLOTS.has(s)).map(([s, v]) => `  ${s}: ${v};`).join('\n')
    parts.push(`[data-theme="${base}"] {\n${body}\n}`)
  }
  const src = global.combo.get(`${pol}/${accent}`) ?? newAccents.get(`${pol}/${accent}`)
  if (!src) throw new Error(`没有 ${pol}×${accent} 的 accent 值可搬`)
  const vals = new Map(src)
  parts.push(`[data-base="${pol}"][data-accent="${accent}"] {\n${[...vals].map(([s, v]) => `  ${s}: ${v};`).join('\n')}\n}`)
  return parts.join('\n')
}

/* ---- 对拍集合：交付物里有几个候选底色就拍几组，每组配同极最像的那张已发货底色当基准 ---- */
const { themes: THEMES_LIST, accents: ACCENTS_LIST } = readThemeIds()
const label = (id) => THEMES_LIST.find((t) => t.id === id)?.name ?? ACCENTS_LIST.find((a) => a.id === id)?.name ?? id
if (!newBases.size) { console.error('交付物里没有 [data-theme="x"] 底色块，没有可拍的候选'); process.exit(2) }
/** 与候选 --bg 最近的同极已发货底色：板子上的差值就是这份稿真正带来的新意 */
function referenceFor(cand) {
  const pol = polarityOf(cand)
  const q = toRgb(newBases.get(cand).get('--bg'))
  let best = null, minD = 1e9
  for (const [t, m] of global.base) {
    if (global.polarity.get(t) !== pol) continue
    const p = toRgb(m.get('--bg'))
    if (!p) continue
    const d = Math.hypot(...p.map((v, i) => v - q[i]))
    if (d < minD) { minD = d; best = t }
  }
  if (!best) throw new Error(`${cand} 归入 ${pol} 极，但 ${pol} 极还没有已发货底色可当基准`)
  console.log(`${cand}：${pol} 极，基准取最像的 ${best}（--bg RGB 距离 ${Math.round(minD)}）`)
  return best
}
const REFS = new Map([...newBases.keys()].map((c) => [c, referenceFor(c)]))
const COMBOS = []
/* 两个候选底色若共用同一张基准底，基准格只拍一次 */
const seen = new Set()
const pushCombo = (c) => { if (!seen.has(c.id)) { seen.add(c.id); COMBOS.push(c) } }
for (const [cand, ref] of REFS) {
  const pol = polarityOf(cand)
  const acc = ACCENTS_LIST.map((a) => a.id).filter((a) => global.combo.has(`${pol}/${a}`) || newAccents.has(`${pol}/${a}`))
  for (const a of acc) {
    pushCombo({ id: `${ref}-${a}`, name: `${label(ref)}·${label(a)}（基准）`, base: ref, accent: a, group: pol, role: 'ref' })
    pushCombo({ id: `${cand}-${a}`, name: `${label(cand)}·${label(a)}`, base: cand, accent: a, group: pol, role: 'cand' })
  }
}

/* 每格截三屏：密集行卡 / 新增弹窗 / 小记书写态（语法色与下陷面） */
const SCREENS = ['1-entries', '2-form', '3-editor']

/* 只重拼板（帧已拍过）：改板子布局时用，省掉整轮真 app 出图 */
const ONLY_BOARDS = process.argv.includes('--boards')

if (!ONLY_BOARDS) {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })
const written = []

for (const c of ONLY_BOARDS ? [] : COMBOS) {
  const css = candidateCss(c.base, c.accent)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 })
  page.on('pageerror', (e) => console.log(`[${c.id}] pageerror: ${e.message}`))
  await page.addInitScript((cfg) => { window.__E2E_CONFIG__ = cfg }, { ...SEED, settings: { theme: 'paper', accent: 'ink' } })
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.unlock-input')
  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await page.waitForSelector('.app-layout')
  await page.locator('.sidebar-toggle').click()
  await page.waitForTimeout(500)
  // 落地页是小记，收藏要自己点过去
  await page.locator('a.nav-item[href="/entries"]').click()
  await page.waitForSelector('.entry-card')

  // 覆盖令牌 + 改挂属性：底色块和 accent 块都靠这两个属性选中
  await page.addStyleTag({ content: css })
  await page.evaluate(([base, pol, accent]) => {
    document.documentElement.setAttribute('data-theme', base)
    document.documentElement.setAttribute('data-base', pol)
    document.documentElement.setAttribute('data-accent', accent)
  }, [c.base, polarityOf(c.base), c.accent])
  await page.waitForTimeout(350)

  const shot = async (name) => {
    await page.waitForTimeout(350)
    const file = join(OUT, `${c.id}-${name}.png`)
    await page.screenshot({ path: file })
    written.push(`${c.id}-${name}.png`)
  }

  await shot('1-entries')

  await page.locator('.page-bar button.btn-primary').click()
  await page.waitForSelector('.dialog-overlay .dialog')
  await shot('2-form')
  await page.locator('.dialog-footer button.btn-secondary').click()
  await page.locator('.dialog-overlay').waitFor({ state: 'detached' }).catch(() => {})

  await page.locator('a.nav-item[href="/notes"]').click()
  await page.waitForSelector('.memo')
  const memo = page.locator('.memo').filter({ hasText: '头像色由分类哈希' })
  await memo.hover()
  await memo.locator('.memo-edit').click()
  await page.waitForSelector('.memo.editing .ProseMirror')
  await page.waitForTimeout(600)
  await shot('3-editor')

  await page.close()
  console.log(`${c.id} ok`)
}

const missing = SCREENS.flatMap((s) => COMBOS.map((c) => `${c.id}-${s}.png`)).filter((n) => !existsSync(join(OUT, n)))
if (missing.length) {
  console.error(`缺帧：${missing.join(', ')}`)
  await browser.close()
  process.exit(1)
}

/* ---- 拼板：每个 accent 一板两格（基准底 vs 候选底），外加弹窗与书写态两块细节板 ---- */
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 })
const board = (title, cells, screen) => `
<div class="board"><h1>${title}</h1>${cells.map((c) => `
  <section><h2>${c.name} <code>${c.id}-${screen}.png</code></h2><img src="${c.id}-${screen}.png"></section>`).join('')}
</div>`
const style = `<style>
body{margin:0;padding:0 0 40px;background:#5b5f66;font:13px system-ui}
.board{width:1500px}
h1{margin:0;padding:12px 18px;background:#1a1b20;color:#fff;font-size:16px;position:sticky;top:0}
h2{margin:0;padding:8px 18px;background:#2b2d33;color:#fff;font-size:13px;display:flex;gap:10px;align-items:baseline}
h2 code{color:#9aa3b3;font-size:11px}
img{display:block;width:100%}
section+section{border-top:3px solid #5b5f66}
</style>`

/* 一板一对：同一档 accent 在新底与基准底上的密集行卡；另加两块控件/书写细节板 */
const byId = new Map(COMBOS.map((c) => [c.id, c]))
const BOARDS = []
for (const [cand, ref] of REFS) {
  const cands = COMBOS.filter((c) => c.base === cand)
  for (const c of cands) {
    const r = byId.get(`${ref}-${c.accent}`)
    BOARDS.push([c.id, `${label(cand)} × ${label(c.accent)} 对拍 ${label(ref)}（洗底幅度 / 行悬停 / 选中行 / 徽标）`, [r, c], '1-entries'])
  }
  const refCell = byId.get(`${ref}-ink`)
  BOARDS.push([`${cand}-form`, `${label(cand)}：新增弹窗（主钮 / 输入框 / 分段控件 / 徽标），首格为 ${refCell.name}`, [refCell, ...cands], '2-form'])
  BOARDS.push([`${cand}-editor`, `${label(cand)}：小记书写态（语法色落在下陷面上），首格为 ${refCell.name}`, [refCell, ...cands], '3-editor'])
}

for (const [slug, title, cells, screen] of BOARDS) {
  const html = `<!doctype html><meta charset="utf-8">${style}${board(title, cells, screen)}`
  const file = join(OUT, `board-${slug}.html`)
  writeFileSync(file, html, 'utf8')
  await page.goto('file:///' + file.replace(/\\/g, '/'))
  await page.waitForTimeout(250)
  const name = `board-${slug}.png`
  await page.locator('.board').screenshot({ path: join(OUT, name) })
  console.log(`wrote board ${name}`)
}

await browser.close()
console.log(`${written.length} 帧 + ${BOARDS.length} 板 → ${OUT}`)
