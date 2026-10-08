// 真机微调轮交付出图：侧栏折叠钮图标 / 顶栏去排序筛选 / 展开态三行地板 / 细浮动胶囊滚动条
// 用法：先起 vite --mode e2e --port 1430，再 PW_CHANNEL=msedge node scripts/tweak-shots.mjs
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const OUT = 'design/v52-tweak'
mkdirSync(OUT, { recursive: true })

const NOTES = [
  { title: '会议纪要', content_html: '<p>第一条小记：周会纪要与待办 #产品 #上线计划</p><ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked><span></span></label><div><p>确认发布窗口</p></div></li><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>补齐回滚方案</p></div></li></ul>' },
  { title: '灵感', content_html: '<p>第二条小记：灵感片段 #产品，跑 `npm test` 之前先看一眼</p>' },
  { title: '清单', content_html: '<p>第三条小记：周末采购清单，牛奶、面包、咖啡豆、电池</p>' },
  { title: '读书记录', content_html: '<p>《系统的本质》——把复杂性摊开在桌面上，而不是藏进抽象里。中间一段值得抄下来：边界不是限制，边界是接口。</p>' },
  { title: '装修', content_html: '<p>厨房水槽换大单槽，台面留 60cm 备料区 #家</p>' },
  { title: '周会', content_html: '<p>周四 16:00 定版本范围，测试资源按人日排 #上线计划</p>' },
  { title: '工具', content_html: '<p>把截图流水线收进一个脚本：起服务、解锁、逐主题出图，别再手点 #工具</p>' },
  { title: '体检安排', content_html: '<p>预约口腔检查，顺带问下洗牙要不要提前一星期 #家</p>' },
  { title: '备份核对', content_html: '<p>云端附件密文只增不删，本地兜底留三份；GC 还没做 #工具</p>' },
]

// Playwright 默认带 --hide-scrollbars，会把自定义滚动条整条抹掉，必须摘掉这个 flag
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', ignoreDefaultArgs: ['--hide-scrollbars'] })

for (const theme of ['paper', 'ink']) {
  const page = await browser.newPage({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => console.log(`[${theme}] pageerror: ${e.message}`))

  await page.addInitScript((cfg) => { window.__E2E_CONFIG__ = cfg }, { notes: NOTES, settings: { theme, accent: 'ink' } })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.unlock-input')
  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await page.locator('a.nav-item[href="/notes"]').click()
  await page.waitForSelector('.composer .ProseMirror')

  const shot = async (name, opts) => {
    await page.waitForTimeout(320)
    await page.screenshot({ path: `${OUT}/${theme}-${name}.png`, ...opts })
    console.log(`${theme}-${name}.png`)
  }

  await page.mouse.move(1030, 660)

  // 1 顶栏：搜索框右边只剩「选择」与「展开侧栏」，排序筛选已撤
  await shot('1-bar', { clip: { x: 180, y: 42, width: 860, height: 60 } })

  // 2 展开态书写面：三行地板 + 芯片只剩待办/代码
  const pm = page.locator('.composer .ProseMirror')
  await pm.click()
  await page.waitForTimeout(360)
  await shot('2-composer', { clip: await pm.evaluate((el) => {
    const r = el.closest('.composer').getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  }) })

  // 3 滚动条（列表右缘特写）：滚到中段，thumb 悬在槽中
  await page.locator('.stream').evaluate((el) => { el.scrollBehavior = 'auto'; el.scrollTop = 240 })
  await page.mouse.move(600, 400)
  await shot('3-scroll-notes', { clip: { x: 940, y: 120, width: 100, height: 380 } })
  // 3b 同一位置 hover：内衬收窄、thumb 变粗变亮
  await page.mouse.move(1036, 300)
  await shot('3b-scroll-hover', { clip: { x: 940, y: 120, width: 100, height: 380 } })
  await page.mouse.move(600, 400)

  // 4 侧栏 rail 档顶列：toggle 与三个导航图标同框比大小
  await shot('4-rail', { clip: { x: 0, y: 6, width: 60, height: 270 } })
  await page.locator('.sidebar-toggle').click()
  await page.waitForTimeout(620)
  // 5 展开档顶行：toggle 18 与导航图标 18 同档
  await shot('5-expanded', { clip: { x: 0, y: 6, width: 210, height: 270 } })
  await page.locator('.sidebar-toggle').click()
  await page.waitForTimeout(620)

  // 5 弹窗里的滚动条：设置弹窗「外观」页签拉到出现滚动条
  await page.locator('.titlebar-btn[title="设置"]').first().click()
  await page.waitForSelector('.settings-dialog')
  await page.locator('.settings-dialog .settings-nav button', { hasText: '外观' }).first().click().catch(() => {})
  await page.waitForTimeout(200)
  await page.locator('.settings-pane:visible').first().evaluate((el) => { el.scrollBehavior = 'auto'; el.scrollTop = 200 })
  await shot('6-dialog', { clip: { x: 240, y: 60, width: 800, height: 560 } })
  await page.keyboard.press('Escape')

  // 6 整页收口图
  await shot('7-page')
  await page.close()
}

await browser.close()
