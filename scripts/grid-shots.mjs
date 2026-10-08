// V5.2 收编轮 P3 交付出图：浮岛网格（收藏页 + 文件页）× 两主题 × 静置/hover/焦点/批量/窄窗
// 用法：先起 vite --mode e2e --port 1430，再 PW_CHANNEL=msedge node scripts/grid-shots.mjs
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const OUT = 'design/v52-grid'
mkdirSync(OUT, { recursive: true })

const SEED = {
  entries: [
    { name: 'GitHub · desko', url: 'https://github.com/jiangxz/desko', username: 'dev@example.com', password: 'Gh!tHub2024', notes: '代码托管平台', category: '开发' },
    { name: 'Jenkins 内网构建', url: 'http://10.0.0.107:8080/view/QT/job/winqt_app', username: 'jin', password: 'Jk#2026', notes: '每晚 22:00 出包', category: '工作' },
    { name: 'Gmail', url: 'https://mail.google.com', username: 'user@gmail.com', password: 'Gm@il#Secure', category: '邮箱' },
    { name: 'Figma · 收藏页改版', url: 'https://figma.com/file/Ab12Cd', category: '设计', notes: '走查稿' },
    { name: 'MDN Flexbox', url: 'https://developer.mozilla.org/docs/Web/CSS/CSS_flexible_box', category: '开发' },
    { name: '语雀 · 客户端架构', url: 'https://yuque.antfin.com/xy-client/arch', username: 'jin', password: 'Yq#2026', category: '文档' },
    { name: '路由器后台', url: 'http://192.168.1.1', username: 'admin', password: 'admin123', category: '设备' },
    { name: 'Bilibili · 稍后再看', url: 'https://www.bilibili.com/list/medialist-later', category: '娱乐' },
    { name: '临时站点（无网址）', notes: '只存了备注的一格', category: '未分类' },
  ],
  urlPaths: [
    { entry_index: 1, path: '/job/winqt_app/lastSuccessfulBuild', label: '最新成功构建', notes: '取包直达' },
    { entry_index: 1, path: '/view/QT', label: 'QT 视图', notes: '' },
    { entry_index: 1, path: '/me/configure', label: '个人设置', notes: '' },
  ],
  notes: [],
  fileShortcuts: [
    { name: '项目资料', path: 'C:/work/desko/project', shortcut_type: 'folder' },
    { name: '月度报告', path: 'C:/work/reports/2026-09.pdf', shortcut_type: 'file' },
    { name: '预算表', path: 'C:/work/finance/budget.xlsx', shortcut_type: 'file' },
    { name: '需求文档', path: 'C:/work/spec/client-arch.docx', shortcut_type: 'file' },
    { name: '构建脚本', path: 'C:/work/tools/build.ps1', shortcut_type: 'file' },
    { name: '压缩包', path: 'C:/work/inbox/app-package.zip', shortcut_type: 'file' },
    { name: '主程序', path: 'C:/work/src/main.ts', shortcut_type: 'file' },
    { name: '截图', path: 'C:/work/shots/grid-ink.png', shortcut_type: 'file' },
  ],
  mfaTokens: [],
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })

for (const theme of ['paper', 'ink']) {
  const page = await browser.newPage({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => console.log(`[${theme}] pageerror: ${e.message}`))
  await page.addInitScript((cfg) => { window.__E2E_CONFIG__ = cfg }, { ...SEED, settings: { theme, accent: 'ink' } })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.unlock-input')
  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await page.waitForSelector('.grid-card')

  const shot = async (name) => {
    await page.waitForTimeout(320)
    await page.screenshot({ path: `${OUT}/${theme}-${name}.png` })
    console.log(`${theme}-${name}.png`)
  }

  await page.mouse.move(1020, 660)
  await shot('1-entries')

  // hover 抬影 + 动作列显形
  await page.locator('.grid-card').nth(1).hover()
  await shot('2-card-hover')

  // 键盘：焦点环 + ArrowDown 跨行 + C 复制回执
  await page.mouse.move(1020, 660)
  await page.locator('.grid-card').nth(0).focus()
  await page.keyboard.press('ArrowDown')
  await shot('3-keyboard-focus')
  await page.keyboard.press('c')
  await shot('4-key-copy-toast')

  // 批量态：勾选栏位让出、浸润选中、动作列让位
  await page.locator('.bar-btn').click()
  await page.locator('.grid-card').nth(0).hover()
  await page.locator('.grid-card').nth(0).locator('.card-check').click()
  await page.locator('.grid-card').nth(3).locator('.card-check').click()
  await shot('5-batch-select')

  // 窄窗：800 是 minWidth 档，看列数怎么退
  await page.setViewportSize({ width: 800, height: 600 })
  await page.locator('.bar-btn').click()
  await shot('6-narrow-800')

  // 文件页
  await page.locator('a.nav-item[href="/files"]').click()
  await page.waitForSelector('.shortcut-list .grid-card')
  await page.setViewportSize({ width: 1040, height: 670 })
  await page.mouse.move(1020, 660)
  await shot('7-files')
  await page.locator('.shortcut-list .grid-card').nth(1).hover()
  await shot('8-files-hover')

  await page.close()
}
await browser.close()
console.log('done')
