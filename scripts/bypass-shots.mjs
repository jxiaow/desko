// 网络直连页出图：健康度反转骨架（概览 → 需要处理的卡 → 直连可用的 chip）× 落盘链路 × 两主题。
// 用法：先起 npm run dev -- --mode e2e --port 1430，再 PW_CHANNEL=msedge node scripts/bypass-shots.mjs
import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, rmSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const OUT = 'shots/bypass'
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

/** 混排清单：三条异常升格成卡（不可达 / 固定地址异常 / 缺路由），两条直连可用收成 chip */
const mixedRows = [
  { host: 'gitlab.inc.example.net', input: 'gitlab.inc.example.net', address: '10.18.4.11', interfaceName: '以太网', nextHop: '192.168.1.1', verdict: 'directOk' },
  { host: 'xtbg.xylink.com', input: 'http://xtbg.xylink.com:8443/agent', address: '172.30.2.109', interfaceName: 'vEthernet (TUN)', nextHop: '169.254.99.99', verdict: 'needRoute', note: '缺少绑定的路由' },
  { host: '172.33.0.0/16', input: '172.33.0.0/16', kind: 'cidr', interfaceName: '以太网', nextHop: '192.168.1.1', verdict: 'directOk' },
  { host: 'registry.example-mirror.net', input: 'registry.example-mirror.net', address: '125.39.27.223', interfaceName: '以太网', nextHop: '192.168.1.1', verdict: 'hostsOnly', stale: true, applyState: 'applied' },
  { host: 'old-build.inc.example.net', input: 'old-build.inc.example.net', address: '10.18.6.7', verdict: 'unreachable' },
]

/** 落盘链路的账：两条能自动定，一条带 CDN 特征默认不进批次 */
const writeRows = [
  { host: 'xtbg.xylink.com', input: 'http://xtbg.xylink.com:8443/agent', address: '172.30.2.109', interfaceName: 'vEthernet (TUN)', nextHop: '169.254.99.99', verdict: 'needRoute' },
  { host: '172.33.0.0/16', input: '172.33.0.0/16', kind: 'cidr', interfaceName: '以太网', nextHop: '192.168.1.1', verdict: 'needRoute' },
  { host: 'registry.example-mirror.net', input: 'registry.example-mirror.net', address: '125.39.27.223', interfaceName: '以太网', nextHop: '192.168.1.1', verdict: 'hostsOnly', cdnLike: true },
]

/** 全绿清单：需要处理那一段不出，页面只剩概览与 chip 行 */
const cleanRows = [
  { host: 'gitlab.inc.example.net', input: 'gitlab.inc.example.net', address: '10.18.4.11', interfaceName: '以太网', nextHop: '192.168.1.1', verdict: 'directOk' },
  { host: 'nexus.inc.example.net', input: 'nexus.inc.example.net', address: '10.18.5.20', interfaceName: '以太网', nextHop: '192.168.1.1', verdict: 'directOk' },
  { host: '172.33.0.0/16', input: '172.33.0.0/16', kind: 'cidr', interfaceName: '以太网', nextHop: '192.168.1.1', verdict: 'directOk' },
]

/** 一帧要演什么：probe 是页栏探测，open 是展开哪张卡，chip 是点开哪枚，flow 是落盘走到哪一步 */
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
    // 点了「加入清单」：按钮收起，这条同时进「需要处理」那张卡
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
    // 不可达：加入那颗钮在位但按不动，清单里那条死地址仍挂在最前
    '3-dialog-unreachable',
    {
      bypass: {
        verdict: 'unreachable',
        probe: { host: 'old-build.inc.example.net', realIps: ['10.18.6.7', '10.18.6.8'] },
        targets: [{ host: 'old-build.inc.example.net', address: '10.18.6.7', verdict: 'unreachable' }],
      },
      probe: { input: 'old-build.inc.example.net' },
    },
  ],
  [
    // 主体帧：概览的大数字 + 出口分布，下面三张卡、一枚 chip 行
    '4-overview',
    { bypass: { targets: mixedRows, hosts: { managed: 3 } } },
  ],
  [
    // 就地展开：同一颗岛下面接凹底，念库里那句结论
    '5-card-open',
    { bypass: { targets: mixedRows, hosts: { managed: 3 } }, open: 'xtbg.xylink.com' },
  ],
  [
    // chip 点开的详情弹窗：直连可用的目标不占行，动作与结论都在这里
    '6-chip-detail',
    { bypass: { targets: mixedRows, hosts: { managed: 3 } }, chip: 'gitlab.inc.example.net' },
  ],
  [
    // 落盘第一步：确认弹窗逐条念要动什么，CDN 那条单独标出并给勾选位
    '7-plan',
    { bypass: { targets: writeRows, hosts: { managed: 3 } }, flow: 'plan' },
  ],
  [
    // 勾上「仍要固定」：那条改念要写什么，头栏的「不写入」计数收掉
    '8-plan-cdn',
    { bypass: { targets: writeRows, hosts: { managed: 3 } }, flow: 'plan-cdn' },
  ],
  [
    // 等待授权：helper 起来到用户答完 UAC 之间只能明说在等
    '9-awaiting',
    { bypass: { targets: writeRows, apply: { delayMs: 3000 } }, flow: 'awaiting' },
  ],
  [
    // 结果弹窗：逐条账 + 回滚没成才留的批次，底部才有「撤销本次配置」
    '10-result',
    { bypass: { targets: writeRows, apply: { failed: ['172.33.0.0/16'], rollbackFail: true } }, flow: 'result' },
  ],
  [
    // 写完并自动重验过：三条都收进 chip，需要处理那一段整块消失
    // 域名与网段混着会被 mock 的重探套上别人的地址，这里只留能对上形的
    '11-written',
    {
      bypass: {
        targets: [
          writeRows[0],
          { host: 'nones.inc.example.net', input: 'nones.inc.example.net', address: '172.30.2.109', interfaceName: 'vEthernet (TUN)', nextHop: '169.254.99.99', verdict: 'hostsOnly' },
        ],
      },
      flow: 'written',
    },
  ],
  [
    // 全绿：概览即 3 / 3，页面收成一屏干净
    '12-all-clean',
    { bypass: { targets: cleanRows, hosts: { managed: 3 } } },
  ],
  ['13-empty', { bypass: {} }],
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
    if (scene.open) {
      await page.locator('.bp-card', { hasText: scene.open }).locator('.card-main').click()
      await page.waitForSelector('.row-card')
    }
    if (scene.chip) {
      await page.locator('.chip', { hasText: scene.chip }).click()
      await page.waitForSelector('.detail-dialog')
    }
    if (scene.flow) {
      await page.locator('.hero .btn-primary').click()
      await page.waitForSelector('.dialog')
      if (scene.flow === 'plan-cdn') {
        await page.locator('.plan-cdn input').last().check()
        await page.waitForTimeout(250)
      }
      if (['awaiting', 'result', 'written'].includes(scene.flow)) {
        await page.locator('.dialog .btn-primary').click()
        if (scene.flow === 'awaiting') await page.waitForTimeout(600)
        if (scene.flow === 'result') await page.waitForSelector('.dialog:has-text("配置结果")')
        if (scene.flow === 'written') await page.waitForSelector('.chip')
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
