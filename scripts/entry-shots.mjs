// 收藏轮交付出图：卡面减负（URL 恒定一行 / 无子路径行 / 无备注）、hover 不抛勾选框、批量态仍可勾、滚动条 hover 不加粗
// 用法：先起 vite --mode e2e --port 1430，再 PW_CHANNEL=msedge node scripts/entry-shots.mjs
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const OUT = 'design/v52-entry-tweak'
mkdirSync(OUT, { recursive: true })

const ENTRIES = [
  { name: '内网工单系统', url: 'https://tickets.intranet.example.com/project/ops/queue?view=assignee&group=desktop-client&page=2', notes: '只在办公网可达，超时要重新登录', category: '办公' },
  { name: 'GitHub', url: 'https://github.com/desko/workbench/settings/tokens', notes: '代码托管平台', category: '开发' },
  { name: 'Gmail', url: 'https://mail.google.com', category: '邮箱' },
  { name: '设计资源库', url: 'https://figma.example.com/files/team/design-system/v52/tokens', notes: '令牌表在这里维护', category: '设计' },
]

// 三条子路径挂在第一张卡上：卡面不再显形，详情弹窗里仍在
const PATHS = [
  { entry_index: 0, path: '/project/ops/queue', label: '待办队列' },
  { entry_index: 0, path: '/project/ops/reports', label: '周报' },
  { entry_index: 0, path: '/project/ops/settings', label: '设置' },
]

// Playwright 默认带 --hide-scrollbars，会把自定义滚动条整条抹掉
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', ignoreDefaultArgs: ['--hide-scrollbars'] })

for (const theme of ['paper', 'ink']) {
  const page = await browser.newPage({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 2 })
  await page.addInitScript((cfg) => { window.__E2E_CONFIG__ = cfg }, { entries: ENTRIES, urlPaths: PATHS, settings: { theme, accent: 'ink' } })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.unlock-input')
  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await page.locator('a.nav-item[href="/entries"]').click()
  await page.waitForSelector('.entry-card')

  const shot = async (name, { element, ...opts } = {}) => {
    await page.waitForTimeout(340)
    const target = element ? page.locator(element) : page
    await target.screenshot({ path: `${OUT}/${theme}-${name}.png`, ...opts })
    console.log(`${theme}-${name}.png`)
  }

  const first = page.locator('.entry-card').first()
  const box = await first.boundingBox()
  const clip = { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 }

  // 1 静置：URL 恒定一行尾部省略，卡上没有子路径行、没有备注
  await page.mouse.move(520, 640)
  await shot('1-card-idle', { clip })

  // 2 hover：动作列显形，勾选框不再跟着冒出来（指针落在名字行，避开 URL 的原生 title）
  await page.mouse.move(box.x + box.width / 2, box.y + 16)
  await shot('2-card-hover', { clip })

  // 3 批量态：页条「选择」开待选，勾选框显形且可点
  await page.mouse.move(520, 640)
  await page.locator('.page-bar .bar-btn[aria-label="选择条目"]').click()
  await first.click({ position: { x: box.width / 2, y: 16 } })
  await shot('3-batch-checked', { clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height + 150 } })
  await page.locator('.page-bar .bar-btn[aria-label="退出选择"]').click()

  // 4 整页收口（含右缘滚动条）
  await page.locator('.content-inner').evaluate((el) => { el.scrollBehavior = 'auto'; el.scrollTop = 120 })
  await page.mouse.move(1036, 300)
  await shot('4-page-sb-hover')

  // 5 新增弹窗：六个字段一条轴，子路径压成一行入口
  await page.locator('.page-bar .btn-primary').click()
  await page.waitForSelector('.entry-form-dialog')
  await page.waitForTimeout(360)
  await shot('5-form-new', { element: '.entry-form-dialog' })

  // 5b 新增态的子路径弹窗：还没有条目，只有一行录入
  await page.locator('.paths-manage').click()
  await page.waitForSelector('.paths-dialog')
  await shot('5b-paths-empty', { element: '.paths-dialog' })
  await page.locator('.paths-dialog .add-path').fill('/builds/linux')
  await page.keyboard.press('Enter')
  await shot('5c-paths-draft', { element: '.paths-dialog' })
  await page.keyboard.press('Escape')
  await shot('5d-form-with-draft', { element: '.entry-form-dialog' })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(260)

  // 6 编辑弹窗：带三条子路径 + 备注，看平铺行的读法（挂在首条种子条目上）
  const rich = page.locator('.entry-card', { hasText: '内网工单系统' })
  await rich.click({ position: { x: 180, y: 16 } })
  await page.waitForSelector('.detail-dialog')
  await shot('6-detail', { element: '.detail-dialog' })
  await page.locator('.detail-dialog .btn-secondary:not(.danger)').click()
  await page.waitForSelector('.entry-form-dialog')
  await shot('7-form-edit', { element: '.entry-form-dialog' })

  // 8 密码自绘显隐钮：填值后点在显示，明文应落在同一颗 32px 字段里
  const pwd = page.locator('.entry-fields input[placeholder="登录密码"]')
  await pwd.fill('Tk#2026_ops')
  await page.locator('.entry-fields .pwd-act').click()
  await shot('8-pwd-reveal', { element: '.entry-fields .cred-row' })

  // 9 编辑态的子路径弹窗：库里三条路径 + 行动作（打开 / 复制 / 删除）
  await page.locator('.paths-manage').click()
  await page.waitForSelector('.paths-dialog')
  await shot('9-paths-manage', { element: '.paths-dialog' })
  await page.keyboard.press('Escape')
  await page.close()
}

await browser.close()
