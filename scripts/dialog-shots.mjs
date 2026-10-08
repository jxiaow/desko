// 弹窗体系验收截图：同一视口、同一主题把全部弹窗/浮层/特殊态各拍一张，
// 专看跨弹窗的底栏/按钮档、分段控制器、输入件皮肤是否同一套语言。
// 用法：先起 vite --mode e2e --port 1430，再
//   node scripts/dialog-shots.mjs [themeId|all]
// 例：node scripts/dialog-shots.mjs ink-plum   |   node scripts/dialog-shots.mjs all
// 输出：design/dialog-check/<themeId>/
//   0-lock-screen 锁屏门面 · 1..15 弹窗与浮层（原有 15 张）
//   16/17 设置通用/关于 · 20..23 四页空状态 · 24/25 窄窗 800/720
// 每张都必须在本次运行里真的拍到：开跑先清空目录，收尾核对 EXPECTED 清单，
// 缺帧直接非零退出——上一轮的旧 PNG 留在原地会被当成这轮的结果。
import { chromium } from '@playwright/test'
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'

/** 与下面 shot() 的名字一一对应；改流程就同步改这张表 */
const EXPECTED = [
  '0-lock-screen',
  '1-entry-form', '9-entry-detail', '12-entry-menu', '13-entry-category',
  '14-entry-detail-notes', '15-entry-batch',
  '2-shortcut-form', '3-mfa-add', '4-confirm', '18-fileshare',
  '16-settings-general', '5-settings-appearance', '6-settings-security',
  '7-settings-backup', '11-settings-fileshare', '17-settings-about', '10-change-password',
  '8-note-editor', '24-narrow-800', '25-narrow-720',
  '20-empty-entries', '21-empty-notes', '22-empty-files', '23-empty-mfa',
]

// v2 双轴：2 底色 × 4 accent = 8 组
const COMBOS = [
  'paper-ink', 'paper-celadon', 'paper-clay', 'paper-plum',
  'ink-ink', 'ink-celadon', 'ink-clay', 'ink-plum',
]
const splitCombo = (c) => {
  const i = c.indexOf('-')
  return { theme: c.slice(0, i), accent: c.slice(i + 1) }
}
const arg = process.argv[2] || 'paper-ink'
const RUN = arg === 'all' ? COMBOS : [arg]

const seedFor = (combo, empty = false) => ({
  settings: { ...splitCombo(combo), mfa_enabled: 'true', fileshare_enabled: 'true' },
  entries: empty ? [] : [
    { name: 'GitHub', url: 'https://github.com', username: 'dev@example.com', password: 'Gh!tHub2024', notes: '代码托管平台', category: '开发' },
    { name: 'Gmail', url: 'https://mail.google.com', username: 'user@gmail.com', password: 'Gm@il#Secure', notes: '个人邮箱', category: '邮箱' },
    { name: '钉钉', url: 'https://www.dingtalk.com', username: 'user@company.com', password: 'Ding!Talk88', category: '办公' },
    { name: 'Figma', url: 'https://figma.com', username: 'design@studio.io', password: 'F1gma#Design', notes: '设计协作', category: '设计' },
    { name: '招商银行', url: 'https://cmbchina.com', username: '62148801', password: 'Bank@Pass123', category: '金融' },
    { name: '路由器', url: 'http://192.168.1.1', username: 'admin', password: 'admin123', notes: '光猫后台', category: '设备' },
    { name: '临时站点', url: 'https://example.com', username: 'temp', password: 'Temp#123456' },
    { name: 'Cloudflare', url: 'https://dash.cloudflare.com', username: 'ops@studio.io', password: 'Cf#2024ops', notes: 'DNS 面板', category: '开发' },
    { name: '京东企业购', url: 'https://b.jd.com', username: 'purchase@company.com', password: 'Jd$Buy2024', category: '办公' },
    { name: '语雀知识库', url: 'https://www.yuque.com', username: 'team@studio.io', password: 'Yu#eKnowledge', notes: '团队文档', category: '设计' },
    { name: 'NAS 后台', url: 'http://192.168.1.20:5000', username: 'admin', password: 'N@sAdmin01', category: '设备' },
    { name: 'Notion', url: 'https://www.notion.so', username: 'pm@studio.io', password: 'No!tion#PM', notes: '路线图', category: '办公' },
    { name: '支付宝商家', url: 'https://b.alipay.com', username: 'merchant@company.com', password: 'Ali#Pay88', category: '金融' },
  ],
  notes: empty ? [] : [
    { title: '会议纪要', content_html: '<h2>周会纪要</h2><p>尺度层不动，<strong>主题层只管颜色</strong>。</p>', category: '工作', pinned: true },
    { title: '代码片段', content_html: '<p>头像色由分类哈希决定：</p><pre><code>const hash = (s) =&gt; 31 * h + s.charCodeAt(i)</code></pre>', category: '开发' },
    { title: '灵感', content_html: '<p>暗色下靠高光描边分层，不靠阴影。</p><blockquote>近黑底要留一档高光边。</blockquote>', category: '设计' },
  ],
  fileShortcuts: empty ? [] : [
    { name: '项目资料', path: 'C:/e2e/project', shortcut_type: 'folder' },
    { name: '月度报告', path: 'C:/e2e/report.pdf', shortcut_type: 'file' },
    { name: '预算表', path: 'C:/e2e/budget.xlsx', shortcut_type: 'file' },
    { name: '需求文档', path: 'C:/e2e/spec.docx', shortcut_type: 'file' },
    { name: '压缩包', path: 'C:/e2e/archive.zip', shortcut_type: 'file' },
  ],
  mfaTokens: empty ? [] : [
    { issuer: 'GitHub', label: 'dev@example.com' },
    { issuer: 'Google', label: 'user@gmail.com' },
    { issuer: '公司 VPN', label: 'jin' },
  ],
  fileshare: { running: true, port: 8000, boundPort: 8000, shareDirs: ['D:\\share\\docs', 'D:\\share\\media'], hasPassword: true },
})

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })

const openSeeded = async (dir, seed, taken) => {
  const page = await browser.newPage({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 1.5 })
  // 每步限时 6 秒：选择器落空就当场炸，不等默认 30 秒再假装没事
  page.setDefaultTimeout(6000)
  page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`))
  await page.addInitScript((cfg) => { window.__E2E_CONFIG__ = cfg }, seed)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  let n = 0
  const shot = async (name) => {
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${dir}/${name}.png` })
    taken?.add(name)
    console.log(`${dir}/${name}.png (${++n})`)
  }
  return { page, shot }
}

const unlock = async (page) => {
  await page.waitForSelector('.unlock-input')
  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await page.waitForSelector('.app-layout')
}

for (const THEME of RUN) {
  const dir = `design/dialog-check/${THEME}`
  mkdirSync(dir, { recursive: true })
  // 清掉上一轮的帧：这次没拍到的名字必须是"缺文件"，而不是"旧图还在"
  for (const f of readdirSync(dir)) if (f.endsWith('.png')) rmSync(`${dir}/${f}`, { force: true, maxRetries: 2, retryDelay: 150 })
  const taken = new Set()

  // ---------- 有数据会话：锁屏 + 全部弹窗/浮层 + 设置全页签 + 窄窗 ----------
  const { page, shot } = await openSeeded(dir, seedFor(THEME), taken)

  // 0) 锁屏：全 App 注视最久的单屏，进门先拍
  await shot('0-lock-screen')
  await unlock(page)

  // 1) 收藏：新增弹窗
  await page.locator('a.nav-item[href="/entries"]').click(); await page.waitForTimeout(400)
  await page.locator('.page-bar button.btn-primary').click(); await shot('1-entry-form')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  // 2) 收藏：详情弹窗（非批量态点整行 = 详情）。
  //    选择器必须写死 .entry-card：`[class*=card]` 会先命中容器 .card-grid，点了个空处，
  //    详情弹窗永远不出现，而上一轮的 9-entry-detail.png 还留在目录里冒充结果。
  await page.locator('.entry-card').first().click()
  await page.locator('.detail-dialog').waitFor(); await shot('9-entry-detail')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  // 2b) 收藏页浮层：⋯ 动作单 / 分类下拉 / 详情（带备注条目）/ 批量底坞
  await page.locator('.entry-card').first().hover(); await page.waitForTimeout(200)
  await page.locator('.entry-card .ec-more').first().click()
  await page.mouse.move(520, 620); await shot('12-entry-menu')
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  await page.locator('.page-bar button.btn-primary').click(); await page.waitForTimeout(350)
  await page.locator('.entry-form-dialog input[placeholder="选择或输入新分类"]').click(); await shot('13-entry-category')
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  await page.locator('.entry-card', { hasText: 'GitHub' }).first().click()
  await page.locator('.detail-dialog').waitFor(); await shot('14-entry-detail-notes')
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  // 批量态：页条「选择」钮开待选，点卡即勾，底坞「完成」清空退出
  await page.locator('.page-bar .bar-btn[aria-label="选择条目"]').click(); await page.waitForTimeout(200)
  await page.locator('.entry-card').first().locator('.card-check').click(); await page.waitForTimeout(250)
  await page.locator('.entry-card').nth(1).click(); await shot('15-entry-batch')
  await page.locator('.batch-dock .dock-btn', { hasText: '完成' }).click(); await page.waitForTimeout(250)

  // 3) 文件：添加快捷方式
  await page.locator('a.nav-item[href="/files"]').click(); await page.waitForTimeout(400)
  await page.locator('.page-bar button.btn-primary').click(); await shot('2-shortcut-form')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  // 4) 验证码：添加弹窗 + 删除确认
  await page.locator('a.nav-item[href="/mfa"]').click(); await page.waitForTimeout(400)
  await page.locator('.page-bar button.btn-primary').click(); await shot('3-mfa-add')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  await page.locator('.mfa-card').first().hover(); await page.waitForTimeout(200)
  await page.locator('.mfa-card .ib.danger').first().click(); await shot('4-confirm')
  await page.locator('.confirm-dialog .dialog-footer button').first().click(); await page.waitForTimeout(200)

  // 4b) 局域网传输：整页（跑起来才有横幅 + 多目录芯片行）
  await page.locator('a.nav-item[href="/fileshare"]').click(); await shot('18-fileshare')

  // 5) 设置：六个页签全拍 + 修改主密码（嵌套弹窗）
  await page.locator('button[title="设置"], button[data-tip="设置"]').first().click()
  await page.locator('.settings-dialog').waitFor()
  await page.locator('.settings-dialog .nav-tab', { hasText: '通用' }).click(); await shot('16-settings-general')
  await page.locator('.settings-dialog .nav-tab', { hasText: '外观' }).click(); await shot('5-settings-appearance')
  await page.locator('.settings-dialog .nav-tab', { hasText: '安全' }).click(); await shot('6-settings-security')
  await page.locator('.settings-dialog .nav-tab', { hasText: '数据与备份' }).click(); await shot('7-settings-backup')
  await page.locator('.settings-dialog .nav-tab', { hasText: '局域网传输' }).click(); await shot('11-settings-fileshare')
  await page.locator('.settings-dialog .nav-tab', { hasText: '关于' }).click(); await shot('17-settings-about')
  await page.locator('.settings-dialog .nav-tab', { hasText: '安全' }).click()
  await page.locator('.settings-dialog .setting-item:has-text("修改主密码")').first().click()
  await page.waitForTimeout(500)
  await shot('10-change-password')
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  // 6) 小记：行内编辑器（编辑钮展开）。卡根类名是 .memo，动作钮 .ib.memo-edit
  await page.locator('a.nav-item[href="/notes"]').click(); await page.waitForTimeout(400)
  await page.locator('.memo').first().hover(); await page.waitForTimeout(200)
  await page.locator('.memo .memo-edit').first().click(); await shot('8-note-editor')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  // 7) 窄窗实测：800 / 720 两档，看侧栏与收藏页怎么变形
  await page.locator('a.nav-item[href="/entries"]').click(); await page.waitForTimeout(400)
  await page.setViewportSize({ width: 800, height: 620 }); await shot('24-narrow-800')
  await page.setViewportSize({ width: 720, height: 560 }); await shot('25-narrow-720')
  await page.close()

  // ---------- 空数据会话：四页空状态 ----------
  const { page: ep, shot: eshot } = await openSeeded(dir, seedFor(THEME, true), taken)
  await unlock(ep)
  for (const [href, name] of [
    ['/entries', '20-empty-entries'], ['/notes', '21-empty-notes'],
    ['/files', '22-empty-files'], ['/mfa', '23-empty-mfa'],
  ]) {
    await ep.locator(`a.nav-item[href="${href}"]`).click(); await eshot(name)
  }
  await ep.close()

  // ---------- 收尾对账：EXPECTED 与实际落盘逐名核对，缺一张就非零退出 ----------
  const missing = EXPECTED.filter(name => !existsSync(`${dir}/${name}.png`))
  if (missing.length) {
    console.error(`\n${dir} 缺帧 ${missing.length}/${EXPECTED.length}：${missing.join(', ')}`)
    process.exitCode = 1
  } else {
    console.log(`\n${dir}：${EXPECTED.length} 帧全部为本次新拍`)
  }
}

await browser.close()
