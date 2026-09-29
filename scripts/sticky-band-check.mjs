// 吸顶件色带守护：凡是 position:sticky 且铺了不透明底的横条，必须与 .app-root 画布逐像素重合。
// 做法：同区域拍两帧（有底 / 把底去掉露出画布）比对像素差。差值大 = 平铺底把光晕压掉一档 = 静止时看得见一条亮带。
// 用法：node scripts/sticky-band-check.mjs [--theme=ink] [--accent=clay] [--shots]
import { chromium } from '@playwright/test'

const THEME = process.env.THEME || (arg('theme') || 'paper')
const ACCENT = process.env.ACCENT || arg('accent') || 'celadon'
const SHOTS = process.argv.includes('--shots')
const LIMIT_PX = 3 // 允许 >2/255 的像素占比（文字与描边抗锯齿）

function arg(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit && hit.split('=')[1]
}

const SEED = {
  settings: { theme: THEME, accent: ACCENT, mfa_enabled: 'true', fileshare_enabled: 'true' },
  entries: [{ name: 'A', url: 'http://10.0.0.1/x', username: 'u', password: 'p', category: 'Jenkins' }],
  notes: Array.from({ length: 14 }, (_, i) => ({ title: `t${i}`, content_html: `<p>p${i}</p>`, category: '工作', pinned: i < 3 })),
  fileShortcuts: [{ name: 'f', path: 'C:/e2e/a.pdf', shortcut_type: 'file' }],
  mfaTokens: [{ issuer: 'GitHub', label: 'a@b.c' }],
  fileshare: { running: true, port: 8000, boundPort: 8000, shareDirs: ['D:\\s'], hasPassword: true },
}

const PAGES = ['/entries', '/notes', '/files', '/mfa', '/fileshare']

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })
const page = await browser.newPage({ viewport: { width: 1235, height: 777 }, deviceScaleFactor: 1 })
await page.addInitScript(cfg => { window.__E2E_CONFIG__ = cfg }, SEED)
await page.goto('http://127.0.0.1:1430/', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.unlock-input')
await page.locator('.unlock-input').fill('e2e-master-123')
await page.locator('.unlock-btn').click()
await page.waitForSelector('.app-layout')

const decoder = await browser.newPage()
await decoder.goto('about:blank')
const diff = (a, b, box) => decoder.evaluate(async ([ia, ib, r]) => {
  const load = src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/png;base64,' + src })
  const [A, B] = await Promise.all([load(ia), load(ib)])
  const c = document.createElement('canvas'); c.width = A.width; c.height = A.height
  const g = c.getContext('2d', { willReadFrequently: true })
  g.drawImage(A, 0, 0); const pa = g.getImageData(r.x, r.y, r.w, r.h).data
  g.clearRect(0, 0, c.width, c.height); g.drawImage(B, 0, 0); const pb = g.getImageData(r.x, r.y, r.w, r.h).data
  let max = 0, over = 0
  for (let i = 0; i < pa.length; i += 4) {
    over += Math.abs(pa[i] - pb[i]) > 2 || Math.abs(pa[i + 1] - pb[i + 1]) > 2 || Math.abs(pa[i + 2] - pb[i + 2]) > 2 ? 1 : 0
    max = Math.max(max, Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]))
  }
  return { max, overPct: +(100 * over / (pa.length / 4)).toFixed(2) }
}, [a, b, box])

const fails = []
for (const path of PAGES) {
  await page.locator(`a.nav-item[href="${path}"]`).click()
  await page.waitForTimeout(500)
  const sticks = await page.evaluate(() => {
    const out = []
    document.querySelectorAll('body *').forEach((e, i) => {
      const s = getComputedStyle(e), r = e.getBoundingClientRect()
      if (s.position !== 'sticky' || r.height < 18 || r.width < 300) return
      e.dataset.bandProbe = String(i)
      out.push({ key: String(i), cls: (e.className || e.tagName).toString().split(' ')[0], top: s.top })
    })
    return out
  })
  for (const s of sticks) {
    const el = page.locator(`[data-band-probe="${s.key}"]`)
    const rect = await el.boundingBox()
    const css = await el.evaluate(e => {
      const c = getComputedStyle(e)
      return { image: c.backgroundImage.slice(0, 20), color: c.backgroundColor, attach: c.backgroundAttachment }
    })
    const shot = async mode => {
      await el.evaluate((e, v) => {
        if (!e.dataset.bandCss) e.dataset.bandCss = e.style.cssText
        if (v === 'keep') return
        e.style.background = v === 'none' ? 'none' : v
      }, mode)
      await page.waitForTimeout(60)
      const buf = (await page.screenshot()).toString('base64')
      await el.evaluate(e => { e.style.cssText = e.dataset.bandCss; delete e.dataset.bandCss })
      return buf
    }
    const box = { x: Math.round(rect.x) + 4, y: Math.round(rect.y) + 4, w: Math.round(rect.width) - 8, h: Math.round(rect.height) - 8 }
    const now = await diff(await shot('keep'), await shot('none'), box)
    const flat = await diff(await shot('var(--bg)'), await shot('none'), box)
    const bad = now.overPct > LIMIT_PX
    console.log(`${path} .${s.cls} (top:${s.top})  img=${css.image}  attach=${css.attach.split(',')[0]}`)
    console.log(`   ${bad ? 'FAIL' : 'ok  '} 与画布差 ${now.max}/255、超阈像素 ${now.overPct}%（对照：铺平色 --bg 会是 ${flat.max}/255、${flat.overPct}%）`)
    if (bad) fails.push(`${path} .${s.cls}`)
  }
}

if (SHOTS) {
  const dir = `design/unify-shots/${THEME}-${ACCENT}`
  await page.locator('a.nav-item[href="/entries"]').click(); await page.waitForTimeout(400)
  await page.mouse.move(700, 500); await page.mouse.wheel(0, 500); await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/8-sticky-entries.png` })
  await page.locator('a.nav-item[href="/notes"]').click(); await page.waitForTimeout(400)
  await page.mouse.move(700, 500); await page.mouse.wheel(0, 500); await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/8-sticky-notes.png` })
  console.log(`shots → ${dir}/8-sticky-*.png`)
}

await browser.close()
if (fails.length) {
  console.log(`\n色带未收口：${fails.join('、')}`)
  process.exit(1)
}
