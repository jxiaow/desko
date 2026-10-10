// 直连清单页出图：探测结论弹窗 × 清单行展开 × 两主题。
// 用法：先起 vite --mode e2e --port 1430，再 PW_CHANNEL=msedge node scripts/bypass-shots.mjs
import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, rmSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const OUT = 'shots/bypass'
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

/** 清单预置行：三态各一条，行展开与重探两帧共用 */
const listRows = [
  { host: 'gitlab.inc.example.net', input: 'gitlab.inc.example.net', address: '10.18.4.11', interfaceName: '以太网', nextHop: '192.168.1.1', verdict: 'directOk', note: '直连已可用' },
  { host: 'xtbg.xylink.com', input: 'http://xtbg.xylink.com:8443/agent', address: '172.30.2.109', interfaceName: 'vEthernet (TUN)', nextHop: '169.254.99.99', verdict: 'needRoute', note: '缺少绑定的路由' },
  { host: '172.33.0.0/16', input: '172.33.0.0/16', kind: 'cidr', address: '', interfaceName: '以太网', nextHop: '192.168.1.1', verdict: 'directOk', note: '路由已通，无需处理' },
  { host: 'registry.example-mirror.net', input: 'registry.example-mirror.net', address: '125.39.27.223', interfaceName: '以太网', nextHop: '192.168.1.1', verdict: 'hostsOnly', note: '仅缺 DNS 固定', stale: true },
]

/** 一帧要演什么：bypass 是判定形状，probe 是页栏动作，row 是点开的第几行 */
const scenes = [
  [
    // 页栏只有一颗「开始探测」：结论先摆出来，加入清单是弹窗里的下一步
    '1-dialog-record',
    {
      bypass: {
        verdict: 'needRoute',
        probe: { host: 'xtbg.xylink.com', address: '172.30.2.109', interfaceName: 'vEthernet (TUN)', source: '198.18.0.55', nextHop: '169.254.99.99' },
      },
      probe: { input: 'xtbg.xylink.com' },
    },
  ],
  [
    // 点了「加入清单」：按钮收起，行同时出现在清单里
    '2-dialog-recorded',
    {
      bypass: {
        verdict: 'hostsOnly',
        probe: { host: 'nones.inc.example.net', address: '10.18.6.44', interfaceName: '以太网', source: '192.168.1.23', nextHop: '192.168.1.1', localAnswers: ['10.18.6.44'] },
      },
      probe: { input: 'http://nones.inc.example.net:9090/login', thenRecord: true },
    },
  ],
  [
    // 不可达：加入那颗钮在位但按不动
    '3-dialog-unreachable',
    {
      bypass: {
        verdict: 'unreachable',
        probe: { host: 'old-build.inc.example.net', realIps: ['10.18.6.7', '10.18.6.8'] },
        targets: [{ host: 'xtbg.xylink.com', address: '172.30.2.109', interfaceName: 'vEthernet (TUN)', nextHop: '169.254.99.99', verdict: 'needRoute' }],
      },
      probe: { input: 'old-build.inc.example.net' },
    },
  ],
  [
    '4-rows-and-open',
    {
      bypass: { targets: listRows, hosts: { managed: 3 } },
      row: 1,
    },
  ],
  [
    // 行首「重新探测」开的是那只弹窗：结论不留页面，那一行也不许被收走
    '5-recheck-dialog',
    {
      bypass: { verdict: 'needRoute', probe: { host: 'xtbg.xylink.com', address: '172.30.2.109', interfaceName: 'vEthernet (TUN)', source: '198.18.0.55', nextHop: '169.254.99.99' }, targets: listRows },
      row: 1,
      recheck: true,
    },
  ],
  [
    '6-empty',
    { bypass: {} },
  ],
]
const EXPECTED = scenes.flatMap(([name]) => [`paper-${name}.png`, `ink-${name}.png`])

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })

for (const theme of ['paper', 'ink']) {
  for (const [name, scene] of scenes) {
    const page = await browser.newPage({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 2 })
    page.on('pageerror', (e) => console.log(`[${theme}/${name}] pageerror: ${e.message}`))
    // addInitScript 会被序列化到页面上下文执行，配置只能整体作参数传进去
    await page.addInitScript((c) => {
      window.__E2E_CONFIG__ = c
    }, { settings: { theme, accent: 'ink', bypass_enabled: 'true' }, ...scene })
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.unlock-input')
    await page.locator('.unlock-input').fill('e2e-master-123')
    await page.locator('.unlock-btn').click()
    await page.locator('a.nav-item[href="/bypass"]').click()
    await page.waitForSelector('.page-bar')
    if (scene.probe) {
      await page.locator('.probe-box input').fill(scene.probe.input)
      await page.locator('.page-bar .btn-primary').click()
      await page.waitForSelector('.concl-dialog')
      if (scene.probe.thenRecord) {
        await page.locator('.concl-dialog .btn-primary').click()
        await page.waitForTimeout(300)
      }
    }
    if (scene.row != null) {
      await page.locator('.bp-row .row-main').nth(scene.row).click()
      await page.waitForSelector('.row-card')
    }
    if (scene.recheck) {
      const row = page.locator('.bp-row').nth(scene.row)
      await row.hover()
      await row.locator('.ib[title="重新探测"]').click()
      await page.waitForSelector('.concl-dialog')
      if ((await page.locator('.row-card').count()) === 0) {
        console.log(`[${theme}/${name}] 越位：重探把那一行收走了`)
      }
    }
    await page.mouse.move(1020, 660)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/${theme}-${name}.png` })
    await page.close()
  }
}

await browser.close()
// 逐名核对：缺任何一帧都是没跑成，不能当交付
const missing = EXPECTED.filter((f) => !existsSync(`${OUT}/${f}`))
console.log(missing.length ? `缺帧: ${missing.join(', ')}` : `${EXPECTED.length} 帧全部为本次新拍`)
process.exit(missing.length ? 1 : 0)
