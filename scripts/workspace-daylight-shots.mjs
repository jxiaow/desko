// 工作区采光交付矩阵。先启动 vite --mode e2e --port 1430，再执行：
// PW_CHANNEL=msedge node scripts/workspace-daylight-shots.mjs [输出目录]
// 1280×760 全量 48 张；1040×670 / 1920×1080 各 8 张，另拍设置与全屏小记。
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { contrast } from './lib/theme-tokens.mjs'

const output = process.argv[2] || '.tmp/daylight-20261020'
const source = readFileSync('src/services/theme.ts', 'utf8')
const accents = [...source.match(/export const WORKSPACE_ACCENTS = \[([\s\S]*?)\]/)[1].matchAll(/id: '([^']+)'/g)].map(match => match[1])
const bases = {
  paper: ['#fafafa', '#ffffff', '#f0f0f0', '#ffffff'],
  ink: ['#18191b', '#26282c', '#121315', '#393b40'],
}
const names = Object.keys(bases)
const seed = {
  settings: { codex_enabled: 'true' },
  notes: [{ title: '工作区采光验收', content_html: '<h2>保持内容的底色</h2><p>记录、阅读与书写使用清晰的文字和稳定的实底。外框与边缘承接环境光。</p>' }],
  entries: [{ name: '示例收藏', category: '工作', url: 'https://example.invalid' }],
  codex: { accounts: [{ email: 'synthetic@example.invalid', current: true, hourly: 80, weekly: 65 }] },
}
const report = { generatedAt: new Date().toISOString(), screenshots: [], buttons: [], palette: [] }
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })
try {
  for (const [width, height] of [[1280, 760], [1040, 670], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
    page.setDefaultTimeout(15000)
    let themeUrl = ''
    page.on('request', request => { if (new URL(request.url()).pathname === '/src/services/theme.ts') themeUrl = request.url() })
    await page.addInitScript(config => { window.__E2E_CONFIG__ = config }, seed)
    await page.goto('http://127.0.0.1:1430/')
    await page.locator('.unlock-input').fill('e2e-master-123')
    await page.locator('.unlock-btn').click()
    await page.locator('.workspace-main').waitFor()
    await page.locator('a.nav-item[href="/entries"]').click()
    await page.locator('.entry-card').waitFor()
    assert.ok(themeUrl)
    const directory = join(output, 'matrix', `${width}x${height}`)
    mkdirSync(directory, { recursive: true })
    async function choose(theme, accent, enabled) {
      await page.evaluate(async ([url, theme, accent, enabled]) => {
        const service = await import(url)
        await service.chooseTheme(theme)
        await service.chooseAccent(accent)
        await service.chooseBackgroundAtmosphere(enabled)
      }, [themeUrl, theme, accent, enabled])
      await page.waitForFunction(() => !document.documentElement.classList.contains('theme-anim'))
    }
    async function capture(file) {
      await page.mouse.move(width - 2, height - 2)
      await page.screenshot({ path: file, animations: 'disabled' })
      report.screenshots.push(file)
    }
    for (const theme of names) {
      for (const accent of width === 1280 ? accents : ['ink', 'graphite']) {
        await choose(theme, accent, false)
        const colors = await page.evaluate(() => {
          const root = getComputedStyle(document.documentElement)
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = 1
          const ctx = canvas.getContext('2d')
          const rgba = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) }
          const value = key => rgba(root.getPropertyValue(key).trim())
          // 创建入口的图标按钮有自己的淡染档；这里验收通用主操作的实底配方。
          const probe = document.createElement('button')
          probe.className = 'btn-primary'
          document.querySelector('.page-bar').append(probe)
          const button = getComputedStyle(probe)
          const result = {
            theme: document.documentElement.dataset.theme,
            base: ['--bg', '--panel-bg', '--workspace-frame', '--workspace-light'].map(key => value(key)),
            button: { background: rgba(button.backgroundColor), text: rgba(button.color) },
            accent: value('--accent'),
            edge: getComputedStyle(document.querySelector('.workspace-surface'), '::after').content,
          }
          probe.remove()
          return result
        })
        assert.equal(colors.theme, theme)
        const hexRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
        assert.deepEqual(colors.base, bases[theme].map(hexRgb), `${theme}/${accent}: 底色和框架色`)
        assert.equal(colors.edge, 'none', '关闭氛围时不生成边线')
        const ratio = contrast(colors.button.text, colors.button.background)
        assert.ok(ratio >= 4.5, `${theme}/${accent}: 主按钮对比度 ${ratio}`)
        report.buttons.push({ theme, accent, width, ...colors.button, ratio })
        if (width === 1280 && theme === 'paper') report.palette.push({ accent, rgb: colors.accent })
        await capture(join(directory, `${theme}-${accent}-off.png`))
        await page.evaluate(async url => (await import(url)).chooseBackgroundAtmosphere(true), themeUrl)
        assert.equal(await page.locator('.workspace-surface').evaluate(el => getComputedStyle(el, '::after').pointerEvents), 'none')
        await capture(join(directory, `${theme}-${accent}-on.png`))
      }
      console.log(`${width}×${height} ${theme}: 完成`)
    }
    if (width === 1280) {
      const specials = join(output, 'specials')
      mkdirSync(specials, { recursive: true })
      for (const theme of names) {
        await choose(theme, 'ink', true)
        await page.locator('button[title="设置"], button[data-tip="设置"]').first().click()
        const settings = page.locator('.settings-dialog')
        await settings.waitFor()
        assert.equal(await settings.locator('.theme-prev[data-accent="graphite"][data-atmosphere="off"]').count(), 2)
        await capture(join(specials, `${theme}-settings.png`))
        await settings.locator('.settings-pane:visible').evaluate(el => { el.scrollTop = el.scrollHeight })
        // 使用真实边界确认外观页最末一行可滚入视口。
        assert.ok(await settings.getByRole('switch', { name: '背景氛围' }).evaluate(el => {
          const r = el.closest('.setting-item').getBoundingClientRect()
          const pane = el.closest('.settings-pane').getBoundingClientRect()
          return r.bottom <= pane.bottom && r.top >= pane.top
        }))
        await page.keyboard.press('Escape')
      }
      await page.locator('a.nav-item[href="/notes"]').click()
      for (const theme of ['paper', 'ink']) {
        await choose(theme, 'teal', true)
        await page.locator('.memo').hover()
        await page.getByRole('button', { name: '全屏查看', exact: true }).click()
        await page.locator('.fs').waitFor()
        await capture(join(specials, `${theme}-reading.png`))
        await page.locator('.fs-head').getByRole('button', { name: '编辑', exact: true }).click()
        await capture(join(specials, `${theme}-writing.png`))
        await page.keyboard.press('Escape')
      }
      await page.locator('a.nav-item[href="/codex"]').click()
      await page.locator('.acc-row').waitFor()
      for (const theme of ['paper', 'ink']) {
        await choose(theme, 'indigo', true)
        await capture(join(specials, `${theme}-codex.png`))
      }
    }
    await page.close()
  }
  // 有彩色 OKLab 间距（中性的石墨/砂单独比较冷暖）。
  const oklab = rgb => {
    const [r, g, b] = rgb.map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4 })
    const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b)
    const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b)
    const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b)
    return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s]
  }
  const chromatic = report.palette.filter(item => !['graphite', 'sand'].includes(item.accent))
  const distances = chromatic.flatMap((a, i) => chromatic.slice(i + 1).map(b => ({ a: a.accent, b: b.accent, distance: Math.hypot(...oklab(a.rgb).map((value, j) => value - oklab(b.rgb)[j])) })))
  report.closestAccents = distances.sort((a, b) => a.distance - b.distance)[0]
  assert.ok(report.closestAccents.distance >= .04, JSON.stringify(report.closestAccents))
  for (const [size, expected] of [['1280x760', 48], ['1040x670', 8], ['1920x1080', 8]]) {
    assert.equal(report.screenshots.filter(file => file.includes(size)).length, expected, `${size} 截图数量`)
  }
  report.passed = true
} catch (error) {
  report.passed = false
  report.error = String(error)
  throw error
} finally {
  mkdirSync(output, { recursive: true })
  writeFileSync(join(output, 'matrix-report.json'), JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
