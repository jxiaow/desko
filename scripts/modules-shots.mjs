// 模块配置页签改造验收：满配侧栏 / 设置 10 页签 / 四个模块配置面板 / 关核心页 / 零模块空态。
// 用法：先起 vite --mode e2e --port 1430，再 node scripts/modules-shots.mjs [combo]
// 默认 paper-celadon；输出 design/modules-shots/<combo>/*.png
// 每张都必须本次真拍到：开跑先清目录，收尾按 EXPECTED 逐名核对，缺帧非零退出。
import { chromium } from '@playwright/test'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const EXPECTED = [
  '0-sidebar-full',
  '1-settings-modules',
  '1b-settings-modules-bottom',
  '1c-settings-profiles',
  '1d-settings-notes',
  '1e-settings-files',
  '1f-settings-fileshare',
  '1g-settings-codex',
  '1h-settings-appearance',
  '1i-settings-backup',
  '1j-settings-security',
  '1k-settings-about',
  '2-sidebar-core-off',
  '3-empty-modules',
]
const ALL_ON = {
  notes_enabled: 'true',
  entries_enabled: 'true',
  files_enabled: 'true',
  mfa_enabled: 'true',
  fileshare_enabled: 'true',
  tunnel_enabled: 'true',
  bypass_enabled: 'true',
  codex_enabled: 'true',
}

const seedFor = (theme, accent, extra = {}) => ({
  settings: { theme, accent, ...ALL_ON, ...extra },
  entries: [{ name: 'GitHub', url: 'https://github.com', username: 'dev', password: 'x' }],
  notes: [{ title: '纪要', content_html: '<p>正文</p>', category: '工作' }],
  notePassphrase: 'note-key-123',
  fileShortcuts: [{ name: '项目资料', path: 'C:/e2e/project', shortcut_type: 'folder' }],
  mfaTokens: [{ issuer: 'GitHub', label: 'dev@example.com' }],
  fileshare: { running: true, port: 8000, boundPort: 8000, shareDirs: ['D:\\share\\docs'], hasPassword: true },
})

const comboArg = process.argv[2] || 'paper-celadon'
const theme = comboArg.slice(0, comboArg.indexOf('-'))
const accent = comboArg.slice(comboArg.indexOf('-') + 1)
const out = `design/modules-shots/${comboArg}`
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })
const taken = new Set()

/** 每个种子开一个独立页面：解锁走 UI 流程，不直接 goto 子路由 */
async function open(seed, path = '/') {
  const page = await browser.newPage({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 2 })
  await page.addInitScript((cfg) => { window.__E2E_CONFIG__ = cfg }, seed)
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.unlock-input')
  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await page.waitForSelector('.app-layout')
  await page.waitForTimeout(400)
  return page
}

const shoot = async (page, name, locator) => {
  await (locator ?? page.locator('body')).screenshot({ path: `${out}/${name}.png` })
  taken.add(name)
  console.log(`${out}/${name}.png`)
}

const clickTab = async (page, label) => {
  await page.locator('.settings-dialog .nav-tab', { hasText: label }).click()
  await page.waitForTimeout(300)
}

// 0 满配：8 个模块全开。工作区布局的侧栏恒为 rail，没有展开钮，直接拍侧栏
let page = await open(seedFor(theme, accent))
await shoot(page, '0-sidebar-full', page.locator('.sidebar'))

// 1 设置「模块」页签：8 行 + 提示语
await page.locator('button[title="设置"], button[data-tip="设置"]').first().click()
await page.waitForSelector('.settings-dialog')
await clickTab(page, '模块')
await shoot(page, '1-settings-modules', page.locator('.settings-dialog'))
// 8 行超出弹窗定高，末两行（隧道 / Codex）滚到底才看得到
await page.locator('.settings-dialog .settings-pane:visible').evaluate((el) => { el.scrollTop = el.scrollHeight })
await page.waitForTimeout(250)
await shoot(page, '1b-settings-modules-bottom', page.locator('.settings-dialog'))

// 1c..1k 设置其余 9 个页签
await clickTab(page, '档案')
await shoot(page, '1c-settings-profiles', page.locator('.settings-dialog'))
await clickTab(page, '小记')
await shoot(page, '1d-settings-notes', page.locator('.settings-dialog'))
await clickTab(page, '文件快捷')
await shoot(page, '1e-settings-files', page.locator('.settings-dialog'))
await clickTab(page, '局域网传输')
await shoot(page, '1f-settings-fileshare', page.locator('.settings-dialog'))
await clickTab(page, 'Codex')
await shoot(page, '1g-settings-codex', page.locator('.settings-dialog'))
await clickTab(page, '外观')
await shoot(page, '1h-settings-appearance', page.locator('.settings-dialog'))
await clickTab(page, '数据与备份')
await shoot(page, '1i-settings-backup', page.locator('.settings-dialog'))
await clickTab(page, '安全')
await shoot(page, '1j-settings-security', page.locator('.settings-dialog'))
await clickTab(page, '关于')
await shoot(page, '1k-settings-about', page.locator('.settings-dialog'))
await page.close()

// 2 关掉一个核心页：小记不在，落地页顺位下移到网址收藏
page = await open(seedFor(theme, accent, { notes_enabled: 'false' }))
await shoot(page, '2-sidebar-core-off', page.locator('.sidebar'))
await page.close()

// 3 零模块态：唯一落脚点是模块选择器（0 选中）
const off = {}
for (const k of Object.keys(ALL_ON)) off[k] = 'false'
page = await open(seedFor(theme, accent, off))
await page.waitForSelector('.onb-page')
await page.waitForTimeout(200)
await shoot(page, '3-empty-modules')
await page.close()

await browser.close()
const missing = EXPECTED.filter((n) => !taken.has(n))
const extra = readdirSync(out).filter((f) => !EXPECTED.includes(f.replace(/\.png$/, '')))
if (missing.length || extra.length) {
  console.error('缺帧:', missing, '多余:', extra)
  process.exit(1)
}
console.log(`done: ${EXPECTED.length} 帧全部为本次新拍`)
