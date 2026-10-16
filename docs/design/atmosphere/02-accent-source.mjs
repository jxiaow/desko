// 从当前应用生成氛围推导候选与 1040 × 670 对拍；只写设计稿，不修改 src。
// node docs/design/atmosphere/02-accent-source.mjs [--prepare] [--recalibrated] [--shots-only]
import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const here = new URL('./', import.meta.url)
const root = new URL('../../../', import.meta.url)
const temp = new URL('tmp/atmosphere-review/', root)
const source = await readFile(new URL('02-accent-source.baseline.css', here), 'utf8')
const paletteStart = source.indexOf('/* 氛围色与强调色同源切换')
const paletteEnd = source.indexOf('/* 中性强调色主要靠明暗显形')
assert.ok(paletteStart > 0 && paletteEnd > paletteStart)
const companions = { ink: -48, celadon: -32, clay: 28, plum: 41, rose: 54, teal: 46, forest: -24, amber: -21, coral: 28, graphite: 48 }
const colorRules = Object.entries(companions).map(([accent, delta]) => `:root[data-accent="${accent}"], .theme-scope[data-accent="${accent}"] {
  --material-field-companion: ${delta};${accent === 'graphite' ? `
  --material-color-primary: color-mix(in srgb, #667080 65%, var(--sunken));
  --material-color-secondary: color-mix(in srgb, #aaa1b3 60%, var(--sunken));` : ''}
}`).join('\n')
const recalibrated = process.argv.includes('--recalibrated')
const prefix = recalibrated ? '03-accent-source-recalibrated' : '02-accent-source'
let candidate = source.slice(0, paletteStart) + '/* 辅光按强调色色相作相邻色旋转；石墨保留原配方。 */\n' + colorRules + '\n\n' + source.slice(paletteEnd)
candidate = candidate.replace(/  \/\* 强调色混入底色后再铺柔光[^]*?  --material-primary-strength:/, `  /* 明度按极性固定，色相与彩度从当前强调色推导。 */
  --material-field-l: 0.85;
  --material-field-k: 0.45;
  --material-field-k-secondary: 0.37;
  --material-field-companion: -48;
  --material-color-primary: oklch(from var(--accent) var(--material-field-l) calc(c * var(--material-field-k)) h);
  --material-color-secondary: oklch(from var(--accent) var(--material-field-l) calc(c * var(--material-field-k-secondary)) calc(h + var(--material-field-companion)));
  --material-primary-strength:`)
candidate = candidate.replace(':root[data-base="dark"], .theme-scope[data-base="dark"] {', `:root[data-base="dark"], .theme-scope[data-base="dark"] {
  --material-field-l: 0.24;
  --material-field-k: 0.55;
  --material-field-k-secondary: 0.45;`)
if (recalibrated) candidate = candidate.replaceAll('--material-field-k: 0.45;', '--material-field-k: 0.75;').replaceAll('--material-field-k: 0.55;', '--material-field-k: 0.65;').replaceAll('--material-field-k-secondary: 0.37;', '--material-field-k-secondary: 0.62;').replaceAll('--material-field-k-secondary: 0.45;', '--material-field-k-secondary: 0.53;')
assert.ok(!candidate.includes('--material-tint-') && !candidate.includes('55%, var(--sunken)'))
const applied = candidate === await readFile(new URL('src/styles/materials.css', root), 'utf8')
await writeFile(new URL(`${prefix}.candidate.css`, here), candidate)
if (!process.argv.includes('--shots-only')) {
await mkdir(temp, { recursive: true })

// 用相同测试与门槛检查浏览器中的候选；请求拦截仅替换本次测试页的材质样式。
const hook = `
import { readFileSync } from 'node:fs'
const candidateCss = readFileSync(new URL('../../docs/design/atmosphere/${prefix}.candidate.css', import.meta.url), 'utf8')
test.beforeEach(async ({ page }) => {
  await page.route('**/src/styles/global.css*', async route => {
    const response = await route.fetch()
    let body = await response.text()
    body = body.replace(/const __vite__css = ("(?:[^"\\\\]|\\\\.)*")/, (_, encoded) => {
      const css = JSON.parse(encoded)
      const start = css.indexOf('/* ═')
      if (start < 0) throw new Error('未找到全局样式边界')
      return 'const __vite__css = ' + JSON.stringify(candidateCss + '\\n' + css.slice(start))
    })
    await route.fulfill({ response, body })
  })
})
`
for (const name of ['theme-composition', 'theme', 'materials']) {
  const spec = (await readFile(new URL(`e2e/specs/${name}.spec.ts`, root), 'utf8')).replace("from '../helpers'", "from '../../e2e/helpers'")
  await writeFile(new URL(`candidate-${name}.spec.ts`, temp), spec + hook)
}
await writeFile(new URL('candidate.config.ts', temp), `import base from '../../playwright.config'
import { defineConfig } from '@playwright/test'
export default defineConfig({ ...base, testDir: '.', testMatch: 'candidate-*.spec.ts', outputDir: '../../test-results/atmosphere-candidate', retries: 0,
  projects: [{ name: 'candidate-edge', use: { channel: 'msedge' } }],
  webServer: undefined,
})\n`)

// 原分析稿保留；另建复算副本，修正 tint 占比、Lab、面板洗的渐变终点。
let math = await readFile(new URL('accent-derivation.mjs', here), 'utf8')
math = math.replace("import { readFileSync } from 'node:fs'", "import { readFileSync } from 'node:fs'\nimport { lab as referenceLab, labL } from './lib/theme-tokens.mjs'")
math = math.replace("new URL('../../../', import.meta.url)", "new URL('../', import.meta.url)")
math = math.replace("ROOT + 'src/styles/materials.css'", "ROOT + 'docs/design/atmosphere/02-accent-source.baseline.css'")
math = math.slice(0, math.indexOf('const lab =')) + 'const lab = referenceLab\nconst L_ = labL\n' + math.slice(math.indexOf('const dE ='))
math = math.replace('v + (b[i] - v) * p', 'v * p + b[i] * (1 - p)')
math = math.replace('col: [...panel, 0.28]', 'stop: 0.9, col: [...panel, 0.28]')
math = math.replace('(y - l.ay) / l.ry))', '(y - l.ay) / l.ry) / (l.stop ?? 1))')
await writeFile(new URL('scripts/.tmp-accent-derivation-corrected.mjs', root), math)
}
if (process.argv.includes('--prepare')) {
  console.log('候选 CSS、同门槛浏览器测试与独立复算副本已生成；src 未修改。')
  process.exit(0)
}

const shots = new URL(`shots/${prefix}/`, here)
await mkdir(shots, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 1 })
await page.emulateMedia({ reducedMotion: 'reduce' })
let themeUrl
page.on('request', request => {
  if (new URL(request.url()).pathname === '/src/services/theme.ts') themeUrl = request.url()
})
await page.addInitScript(() => {
  window.__E2E_CONFIG__ = { settings: { theme: 'paper', accent: 'ink', background_atmosphere: 'true' }, entries: [
    { name: 'GitHub', url: 'https://github.com', username: 'dev@example.com', category: '开发' },
    { name: 'Figma', url: 'https://figma.com', username: 'design@studio.io', category: '设计' },
    { name: '钉钉', url: 'https://www.dingtalk.com', username: 'user@company.com', category: '办公' },
    { name: '招商银行', url: 'https://cmbchina.com', username: 'finance@company.com', category: '金融' },
    { name: '路由器', url: 'http://192.168.1.1', username: 'admin', category: '设备' },
    { name: '语雀知识库', url: 'https://www.yuque.com', username: 'team@studio.io', category: '设计' },
    { name: 'Cloudflare', url: 'https://dash.cloudflare.com', username: 'ops@studio.io', category: '开发' },
    { name: 'Notion', url: 'https://www.notion.so', username: 'pm@studio.io', category: '办公' },
  ] }
})
await page.goto('http://127.0.0.1:1430', { waitUntil: 'domcontentloaded' })
await page.locator('.unlock-input').fill('e2e-master-123')
await page.locator('.unlock-btn').click()
await page.locator('.app-layout').waitFor()
await page.locator('a.nav-item[href="/entries"]').click()
await page.locator('.entry-card').first().waitFor()
await page.evaluate(() => document.fonts.ready)
await page.mouse.move(1020, 655)
const pairs = []
const colors = []
const selectTheme = async (theme, accent) => {
  await page.evaluate(async ([url, theme, accent]) => {
    const t = await import(url)
    await t.chooseTheme(theme)
    await t.chooseAccent(accent)
  }, [themeUrl, theme, accent])
  await page.waitForFunction(() => !document.documentElement.classList.contains('theme-anim'))
}
const compare = async (theme, accent, title, scene = 'list') => {
  await selectTheme(theme, accent)
  await page.mouse.move(1032, 662)
  await page.waitForTimeout(150)
  const name = `${theme}-${accent}-${scene}`
  const applicationCss = await page.evaluate(css => {
    const style = [...document.querySelectorAll('style')].find(el => el.textContent.includes('--material-color-primary:'))
    const original = style.textContent
    style.id = 'candidate-global'
    style.textContent = css + original.slice(original.indexOf('/* ═'))
    return original
  }, source)
  await page.screenshot({ path: fileURLToPath(new URL(`${name}-current.png`, shots)), animations: 'disabled' })
  await page.evaluate(css => {
    const style = document.getElementById('candidate-global')
    const original = style.textContent
    style.textContent = css + original.slice(original.indexOf('/* ═'))
  }, candidate)
  const sample = await page.evaluate(() => {
    const chip = document.createElement('i')
    document.body.append(chip)
    const root = getComputedStyle(document.documentElement)
    chip.style.transition = 'none'
    chip.style.backgroundColor = 'oklch(from var(--accent) l c h)'
    const accentColor = getComputedStyle(chip).backgroundColor
    chip.style.backgroundColor = 'var(--material-color-primary)'
    const primaryColor = getComputedStyle(chip).backgroundColor
    chip.style.backgroundColor = 'var(--material-color-secondary)'
    const secondaryColor = getComputedStyle(chip).backgroundColor
    chip.remove()
    return { accentColor, primaryColor, secondaryColor, field: getComputedStyle(document.querySelector('.app-root')).backgroundImage, strength: [root.getPropertyValue('--material-primary-strength').trim(), root.getPropertyValue('--material-secondary-strength').trim()] }
  })
  assert.notEqual(sample.field, 'none')
  await page.screenshot({ path: fileURLToPath(new URL(`${name}-derived.png`, shots)), animations: 'disabled' })
  await page.evaluate(css => { document.getElementById('candidate-global').textContent = css }, applicationCss)
  pairs.push({ title, name, scene })
  colors.push({ theme, accent, scene, ...sample })
}
for (const [theme, accent, title] of [
  ['paper', 'ink', '纸 × 群青'], ['snow', 'celadon', '雪 × 翡翠'], ['linen', 'teal', '绢 × 湖蓝'], ['mist', 'plum', '雾 × 鸢紫'],
  ['ink', 'celadon', '墨 × 翡翠'], ['slate', 'ink', '岩 × 群青'], ['midnight', 'rose', '夜 × 洋红'], ['moss', 'forest', '苔 × 橄榄'],
  ['snow', 'graphite', '雪 × 石墨（配方保留）'],
]) await compare(theme, accent, title)
await page.locator('button[title="设置"], button[data-tip="设置"]').first().click()
await page.locator('.settings-dialog').waitFor()
await compare('linen', 'teal', '绢 × 湖蓝 · 设置及缩略预览', 'settings')
await compare('slate', 'ink', '岩 × 群青 · 设置及缩略预览', 'settings')
await page.keyboard.press('Escape')
await page.locator('.settings-dialog').waitFor({ state: 'detached' })
await page.locator('button[title="锁定"], button[data-tip="锁定"]').click()
await page.locator('.unlock-input').waitFor()
for (const [theme, accent, title] of [['paper', 'ink', '纸 × 群青 · 锁屏'], ['linen', 'teal', '绢 × 湖蓝 · 锁屏'], ['ink', 'celadon', '墨 × 翡翠 · 锁屏']]) {
  await compare(theme, accent, title, 'lock')
}
const version = browser.version()
await browser.close()
await writeFile(new URL(`${prefix}.browser.json`, here), JSON.stringify({ version, colors }, null, 2))
const panels = await Promise.all(pairs.map(async ({ title, name, scene }) => {
  const images = await Promise.all(['current', 'derived'].map(async v => `data:image/png;base64,${(await readFile(new URL(`${name}-${v}.png`, shots))).toString('base64')}`))
  return `<section data-scene="${scene}"><h2>${title}</h2><div class="pair"><figure><figcaption>改动前 · 手写 tint</figcaption><img width="1040" height="670" src="${images[0]}" loading="lazy"></figure><figure><figcaption>${applied ? '应用后' : '候选'} · 从强调色推导</figcaption><img width="1040" height="670" src="${images[1]}" loading="lazy"></figure></div></section>`
}))
await writeFile(new URL(`${prefix}.html`, here), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>氛围色来源 · 现状与推导对拍</title><style>body{margin:32px;background:#e9e7e3;color:#292826;font:14px system-ui,sans-serif}main{max-width:2140px;margin:auto}h1{font-size:26px}header p{color:#66625c;line-height:1.7;max-width:1000px}nav{position:sticky;top:0;background:#e9e7e3;padding:12px 0;z-index:1;display:flex;gap:8px}button{font:inherit;padding:7px 16px;border:1px solid #c9c4bc;border-radius:30px;background:transparent;cursor:pointer}button[aria-pressed=true]{background:#292826;color:#fff}h2{font-size:16px;margin:28px 0 12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;min-width:0}figcaption{color:#66625c;margin-bottom:8px}img{display:block;width:100%;height:auto;border-radius:8px}section[hidden]{display:none}@media(max-width:700px){body{margin:16px}.pair{grid-template-columns:1fr}}</style><main><header><h1>氛围色来源：现状与推导${applied ? '（已应用配方）' : recalibrated ? '（复核候选）' : '（文档参数）'}</h1><p>同一应用、同一令牌、同一 1040 × 670 视口。浅底 L 0.85 / k ${recalibrated ? '0.75' : '0.45'}，深底 L 0.24 / k ${recalibrated ? '0.65' : '0.55'}；候选移除纸/绢冷青特例，石墨保留现状。覆盖量、光斑几何、噪点与浮层材质均取当前实现。${applied ? '本版配方与生产材质样式一致。' : '仅浏览器内替换候选样式，生产 CSS 尚未应用。'}</p></header><nav><button data-filter="all" aria-pressed="true">全部</button><button data-filter="list" aria-pressed="false">密集列表</button><button data-filter="settings" aria-pressed="false">浮层与预览</button><button data-filter="lock" aria-pressed="false">锁屏</button></nav>${panels.join('')}</main><script>for(const button of document.querySelectorAll('button'))button.addEventListener('click',()=>{for(const b of document.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b===button));for(const section of document.querySelectorAll('section'))section.hidden=button.dataset.filter!=='all'&&section.dataset.scene!==button.dataset.filter})</script></html>`)
console.log(JSON.stringify({ pairs: pairs.length, version, output: `docs/design/atmosphere/${prefix}.html` }))
