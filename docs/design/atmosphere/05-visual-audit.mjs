// 原生安装版另以窗口截图核对；本稿在同一 Vue 页面上用演示数据比较视觉方案。
// 默认重放历史方案；--applied 对比历史配方与当前生产源码，不注入候选规则。
import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { lab, labL, contrast } from '../../../scripts/lib/theme-tokens.mjs'

const here = new URL('./', import.meta.url)
const root = new URL('../../../', import.meta.url)
const applied = process.argv.includes('--applied')
const auditId = applied ? '06-spatial-applied' : '05-visual-audit'
const shots = new URL(`shots/${auditId}/`, here)
await mkdir(shots, { recursive: true })
const currentCss = await readFile(new URL('src/styles/materials.css', root), 'utf8')
const baselineCss = await readFile(new URL('03-accent-source-recalibrated.candidate.css', here), 'utf8')
const proposals = {
  current: { name: '当前实现', css: '' },
  strength: { name: '仅增加强度', css: `
    :root[data-base="light"] { --material-primary-strength: 34%; --material-secondary-strength: 25%; }
    :root[data-base="dark"] { --material-primary-strength: 36%; --material-secondary-strength: 28%; }
  ` },
  spatial: { name: '方案：分区柔光', css: `
    :root, .theme-scope {
      --material-field-primary-size: clamp(520px, 56vw, 1100px) clamp(400px, 72vh, 820px);
      --material-field-secondary-size: clamp(480px, 52vw, 1000px) clamp(360px, 64vh, 720px);
      --material-field-primary-position: max(18%, calc((100% - var(--content-max)) / 2 + 80px)) 8%;
      --material-field-secondary-position: min(91%, calc((100% + var(--content-max)) / 2 - 40px)) 91%;
      --material-floating-field:
        linear-gradient(color-mix(in srgb, var(--panel-bg) 60%, transparent), color-mix(in srgb, var(--panel-bg) 60%, transparent)),
        var(--material-field), var(--panel-bg);
      --editor-background-attachment: fixed;
      --material-field:
        var(--material-dither),
        radial-gradient(ellipse 48% 64% at 50% 50%, color-mix(in srgb, var(--panel-bg) 14%, transparent), transparent 90%),
        radial-gradient(ellipse var(--material-field-primary-size) at var(--material-field-primary-position), color-mix(in srgb, var(--material-color-primary) var(--material-primary-strength), transparent), transparent 100%),
        radial-gradient(ellipse var(--material-field-secondary-size) at var(--material-field-secondary-position), color-mix(in srgb, var(--material-color-secondary) var(--material-secondary-strength), transparent), transparent 100%);
      --material-lock-field:
        var(--material-dither),
        radial-gradient(ellipse 48% 64% at 50% 50%, color-mix(in srgb, var(--panel-bg) 14%, transparent), transparent 90%),
        radial-gradient(ellipse var(--material-field-primary-size) at var(--material-field-primary-position), color-mix(in srgb, var(--material-color-primary) var(--material-lock-primary-strength), transparent), transparent 100%),
        radial-gradient(ellipse var(--material-field-secondary-size) at var(--material-field-secondary-position), color-mix(in srgb, var(--material-color-secondary) var(--material-lock-secondary-strength), transparent), transparent 100%);
    }
    :root[data-base="light"], .theme-scope[data-base="light"] {
      --material-primary-strength: 30%; --material-secondary-strength: 22%;
      --material-lock-primary-strength: 34%; --material-lock-secondary-strength: 25%;
    }
    :root[data-base="dark"]:not([data-accent="graphite"]), .theme-scope[data-base="dark"]:not([data-accent="graphite"]) {
      --material-color-primary: color-mix(in oklch, oklch(from var(--accent) l calc(c * 2) h) 30%, oklch(from var(--sunken) l 0 none));
      --material-color-secondary: color-mix(in oklch, oklch(from var(--accent) l calc(c * 1.6) calc(h + var(--material-field-companion))) 24%, oklch(from var(--sunken) l 0 none));
      --material-primary-strength: 28%; --material-secondary-strength: 22%;
      --material-lock-primary-strength: 32%; --material-lock-secondary-strength: 25%;
    }
    .theme-scope {
      --material-field-primary-size: 56% 72%; --material-field-secondary-size: 52% 64%;
      --material-field-primary-position: 24% 8%; --material-field-secondary-position: 85% 91%;
    }
  ` },
}
const variants = applied ? {
  before: { name: '调整前', css: '' },
  after: { name: '调整后（实际源码）', css: '' },
} : proposals
if (!applied) await writeFile(new URL('05-spatial-proposal.css', here), proposals.spatial.css)
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 1 })
await page.emulateMedia({ reducedMotion: 'reduce' })
let themeUrl
page.on('request', r => { if (new URL(r.url()).pathname === '/src/services/theme.ts') themeUrl = r.url() })
await page.addInitScript(() => {
  window.__E2E_CONFIG__ = {
    settings: { theme: 'snow', accent: 'teal', background_atmosphere: 'true', codex_enabled: 'true' },
    codex: { accounts: [{ email: 'studio@example.com', plan_type: 'pro', weekly: 40, account_structure: 'personal', login_provider: 'password', subscription_until: '2026-11-10T16:18:00', quota: { hourly_window_present: false, weekly_window_present: true, reset_credits_available: 3, raw_data: { credits: { balance: 12000 } } } }] },
    entries: ['项目工作台', '代码仓库', '设计文件', '团队文档', '应用后台', '开发环境', '邮件服务', '产品看板', '知识库'].map((name, i) => ({ name, url: `https://example.com/${i + 1}`, username: 'studio@example.com', password: 'demo', category: ['开发', '设计', '办公'][i % 3] })),
    notes: [
      { content_html: '<h2>把注意力留给内容</h2><p>给日常工作留一点空间。柔光沿着窗口边缘展开，正文仍然清楚。</p><p>把记录放在案头，想到就写，写完就走。</p>', category: '工作', pinned: true },
      { content_html: '<p>周会要点：梳理本周进度，列出需要协作的三件事。</p><ul><li>完成界面视觉检查</li><li>整理下一轮交付</li></ul>', category: '工作' },
      { content_html: '<p>留一点空间，记录新的想法。 #灵感</p>', category: '灵感' },
    ],
  }
})
await page.goto('http://127.0.0.1:1430', { waitUntil: 'domcontentloaded' })
await page.locator('.unlock-input').fill('e2e-master-123')
await page.locator('.unlock-btn').click()
await page.locator('.app-layout').waitFor()
await page.evaluate(() => document.fonts.ready)
const productionStyle = await page.evaluate(() => {
  const style = document.querySelector('style[data-vite-dev-id$="/src/styles/global.css"]')
  if (!style?.textContent.includes('/* ═')) throw new Error('未找到材质层与全局样式边界')
  return style.textContent
})
const results = []
const cases = [
  { id: 'native-shape', title: '雪 × 湖蓝 · Codex · 常态窗口', theme: 'snow', accent: 'teal', scene: 'codex', width: 1040, height: 670 },
  { id: 'codex-light', title: '雪 × 湖蓝 · Codex', theme: 'snow', accent: 'teal', scene: 'codex', width: 1440, height: 900 },
  { id: 'codex-wide', title: '雪 × 湖蓝 · Codex · 宽窗', theme: 'snow', accent: 'teal', scene: 'codex', width: 1920, height: 1080 },
  { id: 'entries-warm', title: '纸 × 群青 · 密集列表', theme: 'paper', accent: 'ink', scene: 'entries', width: 1440, height: 900 },
  { id: 'codex-dark', title: '墨 × 翡翠 · Codex', theme: 'ink', accent: 'celadon', scene: 'codex', width: 1440, height: 900 },
  { id: 'codex-slate', title: '岩 × 群青 · Codex · 宽窗', theme: 'slate', accent: 'ink', scene: 'codex', width: 1920, height: 1080 },
  { id: 'notes-light', title: '绢 × 湖蓝 · 小记', theme: 'linen', accent: 'teal', scene: 'notes', width: 1440, height: 900 },
  { id: 'notes-dark', title: '墨 × 翡翠 · 小记', theme: 'ink', accent: 'celadon', scene: 'notes', width: 1440, height: 900 },
  { id: 'settings-light', title: '雪 × 湖蓝 · 设置', theme: 'snow', accent: 'teal', scene: 'settings', width: 1440, height: 900 },
  { id: 'settings-dark', title: '墨 × 翡翠 · 设置', theme: 'ink', accent: 'celadon', scene: 'settings', width: 1440, height: 900 },
  { id: 'editor-dark', title: '岩 × 群青 · 阅读', theme: 'slate', accent: 'ink', scene: 'editor', width: 1440, height: 900 },
  { id: 'lock-light', title: '雪 × 湖蓝 · 锁屏', theme: 'snow', accent: 'teal', scene: 'lock', width: 1440, height: 900 },
  { id: 'lock-dark', title: '墨 × 翡翠 · 锁屏', theme: 'ink', accent: 'celadon', scene: 'lock', width: 1440, height: 900 },
]
let scene = 'notes'
for (const c of cases) {
  await page.setViewportSize({ width: c.width, height: c.height })
  await page.evaluate(async ([url, theme, accent]) => {
    const t = await import(url)
    await t.chooseTheme(theme)
    await t.chooseAccent(accent)
    await t.chooseBackgroundAtmosphere(true)
  }, [themeUrl, c.theme, c.accent])
  await page.waitForFunction(() => !document.documentElement.classList.contains('theme-anim'))
  if (scene === 'settings' && c.scene !== 'settings') { await page.keyboard.press('Escape'); await page.locator('.settings-dialog').waitFor({ state: 'detached' }) }
  if (scene === 'editor' && c.scene !== 'editor') { await page.keyboard.press('Escape'); await page.locator('.fs').waitFor({ state: 'detached' }) }
  if (c.scene === 'settings') {
    if (scene !== 'settings') {
      await page.locator('button[title="设置"], button[data-tip="设置"]').first().click()
      await page.locator('.settings-dialog').waitFor()
    }
  } else if (c.scene === 'editor') {
    await page.locator('a.nav-item[href="/notes"]').click()
    const card = page.locator('.memo').first()
    await card.hover()
    await card.getByRole('button', { name: '全屏查看', exact: true }).click()
    await page.locator('.fs').waitFor()
  } else if (c.scene === 'lock') {
    if (scene !== 'lock') { await page.locator('button[title="锁定"], button[data-tip="锁定"]').click(); await page.locator('.unlock-input').waitFor() }
  } else {
    await page.locator(`a.nav-item[href="/${c.scene}"]`).click()
    await page.locator(c.scene === 'codex' ? '.acc-row' : c.scene === 'entries' ? '.entry-card' : '.memo').first().waitFor()
  }
  scene = c.scene
  await page.mouse.move(c.width - 3, c.height - 3)
  await page.waitForTimeout(250)
  const row = { ...c, images: {}, metrics: {} }
  for (const [id, v] of Object.entries(variants)) {
    await page.evaluate(({ css, materials, productionStyle }) => {
      const style = document.querySelector('style[data-vite-dev-id$="/src/styles/global.css"]')
      style.textContent = materials ? materials + productionStyle.slice(productionStyle.indexOf('/* ═')) : productionStyle
      document.getElementById('visual-audit-proposal')?.remove()
      if (css) { const s = document.createElement('style'); s.id = 'visual-audit-proposal'; s.textContent = css; document.head.append(s) }
    }, { css: v.css, materials: applied && id === 'after' ? null : baselineCss, productionStyle })
    const png = await page.screenshot({ path: fileURLToPath(new URL(`${c.id}-${id}.png`, shots)), animations: 'disabled' })
    const metric = await page.evaluate(async ({ png, width, height, scene }) => {
      const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode()
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0)
      const sample = (x, y) => {
        const d = ctx.getImageData(Math.round(x) - 3, Math.round(y) - 3, 7, 7).data
        const sum = [0, 0, 0]
        for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k] / 49
        return sum
      }
      const style = getComputedStyle(document.documentElement)
      const color = property => { ctx.fillStyle = style.getPropertyValue(property).trim(); ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) }
      const emptyPixels = [.15, .35, .55, .75, .9].map(x => sample(width * x, height * .84))
      const probe = document.createElement('span'); probe.style.transition = 'none'; document.body.append(probe)
      const resolved = name => { probe.style.backgroundColor = `var(${name})`; return getComputedStyle(probe).backgroundColor }
      const primary = resolved('--material-color-primary'), secondary = resolved('--material-color-secondary')
      probe.style.backgroundColor = 'oklch(from var(--sunken) l c h)'
      const baseOklch = getComputedStyle(probe).backgroundColor
      probe.remove()
      const material = document.querySelector(scene === 'lock' ? '.unlock-bg' : scene === 'settings' ? '.settings-dialog' : scene === 'editor' ? '.fs' : '.app-root')
      return { emptyPixels, sunken: color('--sunken'), baseOklch, panel: color('--panel-bg'), text: color('--text'), meta: color('--text-canvas-meta'), primary, secondary, background: getComputedStyle(material).backgroundImage }
    }, { png: png.toString('base64'), width: c.width, height: c.height, scene: c.scene })
    assert.ok(metric.background.includes('radial-gradient'))
    const delta = (a, b) => { const x = lab(a), y = lab(b); return Math.hypot(x.L-y.L,x.a-y.a,x.b-y.b) }
    row.images[id] = `${c.id}-${id}.png`
    row.metrics[id] = { ...metric, emptyDelta: metric.emptyPixels.map(p => delta(p, metric.sunken)), lightness: metric.emptyPixels.map(labL), metaMinContrast: Math.min(...metric.emptyPixels.map(p => contrast(metric.meta,p))), panelL: labL(metric.panel) }
  }
  await page.evaluate(productionStyle => {
    document.getElementById('visual-audit-proposal')?.remove()
    document.querySelector('style[data-vite-dev-id$="/src/styles/global.css"]').textContent = productionStyle
  }, productionStyle)
  results.push(row)
  console.log(c.id)
}
const version = browser.version()
await browser.close()
await writeFile(new URL(`${auditId}.json`, here), JSON.stringify({ version, sourceSha256: createHash('sha256').update(currentCss).digest('hex'), baselineSha256: createHash('sha256').update(baselineCss).digest('hex'), afterUsesProductionStyle: applied, results }, null, 2))
const payload = results.map(r => ({ ...r, metrics: undefined }))
const description = applied
  ? '对比调整前配方与当前源码的真实页面。调整后未叠加候选 CSS；所有截图使用演示数据。点击切换按钮查看差异，原尺寸模式保留截图像素尺寸。'
  : '比较调整前实现、只增加强度、分区柔光方案。所有画面来自同一应用，使用演示数据；重放历史配方并在浏览器中叠加候选规则。点击切换按钮查看差异，原尺寸模式保留截图像素尺寸。'
const buttons = Object.entries(variants).map(([id, v], i) => `<button data-v="${id}" aria-pressed="${i === 0}">${v.name}</button>`).join('')
await writeFile(new URL(`${auditId}.html`, here), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>氛围视觉复核与方案对比</title><style>body{margin:28px;background:#e8e7e4;color:#252627;font:14px system-ui,sans-serif}main{max-width:1920px;margin:auto}h1{font-size:25px;margin:0 0 12px}p{color:#636466;line-height:1.7}header{max-width:1000px}.toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:16px 0;position:sticky;top:0;z-index:1;background:#e8e7e4}select,button{font:inherit;background:#f7f7f5;border:1px solid #c6c7c5;padding:9px 14px;border-radius:6px;cursor:pointer}button[aria-pressed=true]{background:#272a2b;color:#fff}#stage{overflow:auto;border:1px solid #c6c7c5;background:#dadbd9}img{display:block;width:100%;height:auto}#stage.native img{width:auto;max-width:none}#caption{font-size:13px;margin:10px 0;color:#636466}a{color:inherit}</style><main><header><h1>氛围视觉复核${applied ? ' · 已落地' : ''}</h1><p>${description}</p></header><div class="toolbar"><select id="scene"></select>${buttons}<button id="size" aria-pressed="false">原尺寸</button></div><div id="stage"><img id="shot" alt="氛围方案截图"></div><p id="caption"></p></main><script>const cases=${JSON.stringify(payload)};let variant='${Object.keys(variants)[0]}';const scene=document.getElementById('scene'),stage=document.getElementById('stage');for(const c of cases){const o=document.createElement('option');o.value=c.id;o.textContent=c.title+' · '+c.width+' × '+c.height;scene.append(o)}function show(){const c=cases.find(c=>c.id===scene.value);document.getElementById('shot').src='shots/${auditId}/'+c.images[variant];document.getElementById('caption').textContent=c.title+' / '+document.querySelector('[data-v="'+variant+'"]').textContent+' / '+c.width+' × '+c.height}for(const b of document.querySelectorAll('[data-v]'))b.onclick=()=>{variant=b.dataset.v;for(const x of document.querySelectorAll('[data-v]'))x.setAttribute('aria-pressed',String(x===b));show()};scene.onchange=show;document.getElementById('size').onclick=e=>{stage.classList.toggle('native');e.target.setAttribute('aria-pressed',String(stage.classList.contains('native')))};show()</script></html>`)
console.log(JSON.stringify({ cases: results.length, variants: Object.keys(variants).length, output: `docs/design/atmosphere/${auditId}.html` }))
