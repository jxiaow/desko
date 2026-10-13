// 内网穿透页出图：接入步 × 服务列表 × 弹窗，两主题。用法：先起 vite --mode e2e --port 1430，再 PW_CHANNEL=msedge node scripts/tunnel-shots.mjs
import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, rmSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const OUT = 'shots/tunnel'
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const ROOT = { settings: { tunnel_enabled: 'true' } }
const READY = { bound: true, installed: true, authorized: true, tunnelId: 'e2e-tunnel-0001', tunnelName: 'desko' }
/** desko 自己的那条：已指过来、端口在听 */
const FILESHARE = { hostname: 'files.example.com', port: 8421, label: '局域网传输', preset: 'fileshare', routed: true }
const MIXED = [
  FILESHARE,
  { hostname: 'docs.example.com', port: 9090, label: '文档站' },
  { hostname: 'dbg.example.com', port: 9229, label: '调试台', routed: true, listening: false },
]

const setupRow = (name) => `.tn-card.setup .row-${name}`
const svcRow = (host) => `.tn-card.services .svc-row:has-text("${host}")`
/** 行末那颗 ⋯：第一颗是复制，第二颗才是动作菜单 */
const dots = (host) => `${svcRow(host)} .acts .ib >> nth=1`

const scenes = [
  // 接入准备：缺哪一步就摊到哪一步，第 1 步到第 3 步各一张
  ['1-no-binary', { installed: false }],
  ['2-need-auth', { installed: true, authorized: false }],
  [
    '3-auth-waiting',
    { installed: true, authorized: false },
    async (page) => {
      await page.locator(`${setupRow('auth')} .row-btn`).click()
    },
  ],
  ['4-need-tunnel', { installed: true, authorized: true }],
  [
    '5-name-taken',
    { installed: true, authorized: true, nameTaken: true },
    async (page) => {
      await page.locator(`${setupRow('tunnel')} .row-btn`).click()
    },
  ],
  [
    '6-creds-missing',
    { bound: true, installed: true, authorized: true, tunnelId: 'e2e-tunnel-0001', credsMissing: true },
  ],

  // 服务列表：本页的主角。空态、混合态、全绿运行态
  ['7-ready-empty', READY],
  ['8-services-mixed', { ...READY, services: MIXED }],
  ['9-running-all-green', { ...READY, alive: true, registered: true, services: [FILESHARE, { ...MIXED[1], routed: true }] }],
  [
    '10-apply-fail',
    { ...READY, services: [FILESHARE, { hostname: 'dbg.example.com', port: 9229, label: '调试台' }], applyFail: 'zone not found' },
    async (page) => {
      await page.locator('.tn-card.services .foot-row .btn-primary').click()
    },
  ],

  // 弹窗：新增（两类各一）与改一条已登记的
  [
    '11-add-plain',
    { ...READY, services: [FILESHARE] },
    async (page) => {
      await page.locator('.tn-card.services .head-btn').click()
    },
  ],
  [
    '12-add-fileshare',
    { ...READY, services: [FILESHARE] },
    async (page) => {
      await page.locator('.tn-card.services .head-btn').click()
      await page.locator('.tunnel-service-dialog .seg button', { hasText: '局域网传输' }).click()
      await page.locator('.tunnel-service-dialog #tn-svc-host').fill('panel.example.com')
      await page.locator('.tunnel-service-dialog #tn-svc-port').fill('8421')
    },
  ],
  [
    '13-edit-host',
    { ...READY, services: [FILESHARE] },
    async (page) => {
      await page.locator(dots('files.example.com')).click()
      await page.locator('.popover .pop-item', { hasText: '改公网设置' }).click()
    },
  ],
  [
    '14-remove-confirm',
    { ...READY, services: [FILESHARE] },
    async (page) => {
      await page.locator(dots('files.example.com')).click()
      await page.locator('.popover .pop-item', { hasText: '移除这条' }).click()
    },
  ],

  // 页脚诊断条：默认只有一行，点开才是 SHA、出口检查与锁屏说明
  [
    '15-detail-split',
    { ...READY, alive: true, registered: true, external: 1, services: [FILESHARE] },
    async (page) => {
      await page.locator('.tn-foot .foot-btn').click()
      await page.locator('.tn-detail .tn-row:has-text("出口检查") .d-btn').click()
    },
  ],
  [
    '16-starting',
    { ...READY, alive: true, services: [{ ...FILESHARE, listening: false }] },
    async (page) => {
      await page.locator('.tn-foot .foot-btn').click()
    },
  ],
  [
    '17-revoke-confirm',
    { ...READY, services: [FILESHARE] },
    async (page) => {
      await page.locator('.tn-card.setup .row-btn', { hasText: '调整' }).click()
      await page.locator(`${setupRow('auth')} .row-btn`, { hasText: '撤销本机授权' }).click()
    },
  ],
  [
    '18-binary-unverified',
    { installed: true, authorized: true, sha: 'deadbeef0000' },
    async (page) => {
      await page.locator('.tn-foot .foot-btn').click()
    },
  ],

  // 两个"说清为什么"的态：授权进程那句原话、某一格读不到的那一句
  [
    '19-auth-early-exit',
    { installed: true, authorized: false, loginFail: '这个 zone 不在你的账号里' },
    async (page) => {
      await page.locator(`${setupRow('auth')} .row-btn`).click()
    },
  ],
  ['20-one-read-fails', { ...READY, services: MIXED, pollFail: '数据库被占用' }],
]
const EXPECTED = scenes.flatMap(([name]) => [`paper-${name}.png`, `ink-${name}.png`])

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })

for (const theme of ['paper', 'ink']) {
  for (const [name, tunnel, act] of scenes) {
    const page = await browser.newPage({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 2 })
    page.on('pageerror', (e) => console.log(`[${theme}/${name}] pageerror: ${e.message}`))
    // addInitScript 会被序列化到页面上下文执行，配置只能整体作参数传进去
    await page.addInitScript((c) => {
      window.__E2E_CONFIG__ = c
    }, { settings: { theme, accent: 'ink', tunnel_enabled: 'true' }, tunnel })
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.unlock-input')
    await page.locator('.unlock-input').fill('e2e-master-123')
    await page.locator('.unlock-btn').click()
    await page.locator('a.nav-item[href="/tunnel"]').click()
    await page.waitForSelector('.tn-card')
    if (act) await act(page)
    await page.mouse.move(1020, 660)
    await page.waitForTimeout(act ? 500 : 400)
    await page.screenshot({ path: `${OUT}/${theme}-${name}.png` })
    await page.close()
  }
}

await browser.close()
// 逐名核对：缺任何一帧都是没跑成，不能当交付
const missing = EXPECTED.filter((f) => !existsSync(`${OUT}/${f}`))
console.log(missing.length ? `缺帧: ${missing.join(', ')}` : `${EXPECTED.length} 帧全部为本次新拍`)
process.exit(missing.length ? 1 : 0)
