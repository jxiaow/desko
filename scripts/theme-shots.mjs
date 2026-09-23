// 四套主题 × 九个界面实机截图（跑在 e2e 的 mock 后端上，不碰真实数据）。
// 用法：先起 vite --mode e2e --port 1430，再 node scripts/theme-shots.mjs [themeId]
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const OUT = 'design/theme-shots'
mkdirSync(OUT, { recursive: true })

const SEED = {
  entries: [
    { name: 'GitHub', url: 'https://github.com', username: 'dev@example.com', password: 'Gh!tHub2024', notes: '代码托管平台', category: '开发' },
    { name: 'Gmail', url: 'https://mail.google.com', username: 'user@gmail.com', password: 'Gm@il#Secure', notes: '个人邮箱', category: '邮箱' },
    { name: '钉钉', url: 'https://www.dingtalk.com', username: 'user@company.com', password: 'Ding!Talk88', category: '办公' },
    { name: 'Figma', url: 'https://figma.com', username: 'design@studio.io', password: 'F1gma#Design', notes: '设计协作', category: '设计' },
    { name: '招商银行', url: 'https://cmbchina.com', username: '62148801', password: 'Bank@Pass123', category: '金融' },
    { name: '路由器', url: 'http://192.168.1.1', username: 'admin', password: 'admin123', notes: '光猫后台', category: '设备' },
    { name: '临时站点', url: 'https://example.com', username: 'temp', password: 'Temp#123456' },
  ],
  urlPaths: [{ entry_index: 0, path: '/settings/tokens', label: '访问令牌', notes: '每月轮换' }],
  notes: [
    {
      title: '会议纪要',
      content_html:
        '<h2>周会纪要</h2><p>尺度层不动，<strong>主题层只管颜色</strong>。</p>' +
        '<ul data-type="taskList"><li><label><input type="checkbox" checked><span>令牌化 global.css</span></label></li>' +
        '<li><label><input type="checkbox"><span>逐屏实机检查</span></label></li></ul>',
      category: '工作',
      pinned: true,
    },
    {
      title: '代码片段',
      content_html:
        '<p>头像色由分类哈希决定：</p><pre><code class="language-ts"><span class="hljs-keyword">const</span> hash = (s: <span class="hljs-built_in">string</span>) =&gt; {\n  <span class="hljs-keyword">let</span> h = <span class="hljs-number">0</span>\n  <span class="hljs-keyword">for</span> (<span class="hljs-keyword">let</span> i = <span class="hljs-number">0</span>; i &lt; s.length; i++) h = (h * <span class="hljs-number">31</span> + s.charCodeAt(i)) | <span class="hljs-number">0</span>\n  <span class="hljs-keyword">return</span> Math.abs(h) % <span class="hljs-number">6</span> <span class="hljs-comment">// 六色循环</span>\n}</code></pre>',
      category: '开发',
    },
    {
      title: '灵感',
      content_html: '<p>暗色下靠高光描边分层，不靠阴影。</p><blockquote>近黑底要留一档高光边。</blockquote>',
      category: '设计',
      starred: true,
    },
  ],
  fileShortcuts: [
    { name: '项目资料', path: 'C:/e2e/project', shortcut_type: 'folder' },
    { name: '月度报告', path: 'C:/e2e/report.pdf', shortcut_type: 'file' },
    { name: '预算表', path: 'C:/e2e/budget.xlsx', shortcut_type: 'file' },
    { name: '需求文档', path: 'C:/e2e/spec.docx', shortcut_type: 'file' },
    { name: '压缩包', path: 'C:/e2e/archive.zip', shortcut_type: 'file' },
    { name: '主程序', path: 'C:/e2e/main.ts', shortcut_type: 'file' },
    { name: '说明', path: 'C:/e2e/README.md', shortcut_type: 'file' },
    { name: '截图', path: 'C:/e2e/shot.png', shortcut_type: 'file' },
    { name: '演示稿', path: 'C:/e2e/deck.pptx', shortcut_type: 'file' },
  ],
}

const THEMES = [
  { id: 'light-cool', name: '冷灰' },
  { id: 'light-warm', name: '暖纸墨' },
  { id: 'linear-dark', name: 'Linear 深空' },
  { id: 'jetbrains-dark', name: 'JetBrains 炭黑' },
]

const only = process.argv[2]
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' })

for (const t of THEMES) {
  if (only && only !== t.id) continue
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 })
  page.on('pageerror', (e) => console.log(`[${t.id}] pageerror: ${e.message}`))
  await page.addInitScript((cfg) => {
    window.__E2E_CONFIG__ = cfg
  }, { ...SEED, settings: { theme: t.id } })

  // 弹层与 active 态都带过渡，拍早了会抓到半透明/残留帧
  const shot = async (name) => {
    await page.waitForTimeout(350)
    await page.screenshot({ path: `${OUT}/${t.id}-${name}.png` })
  }
  const tip = (label) => page.locator(`button[title="${label}"], button[data-tip="${label}"]`)

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.unlock-input')
  await shot('1-unlock')

  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await page.waitForSelector('.app-layout')
  await tip('切换侧边栏').click() // 展开侧栏，看 logo 与导航文字
  await page.waitForTimeout(500) // 侧栏宽度有过渡，不等会拍到半宽
  await shot('2-entries')

  const card = page.locator('.entry-card').first()
  await card.hover()
  // 行卡没有独立的"查看详情"钮：点名字区即开详情（整行热区）
  await card.locator('.ec-name').click()
  await page.waitForSelector('.detail-dialog')
  await shot('3-detail')
  await page.keyboard.press('Escape')
  await page.locator('.detail-dialog').waitFor({ state: 'detached' }).catch(() => {})

  await page.locator('.page-bar button.btn-primary').click()
  await page.waitForSelector('.dialog-overlay .dialog')
  await shot('4-form')
  await page.locator('.dialog-footer button.btn-secondary').click()

  await page.locator('a.nav-item[href="/notes"]').click()
  await page.waitForSelector('.memo')
  await page.waitForTimeout(400) // nav-item 的 active 底色有过渡，不等会拍到上一屏的余晖
  await shot('5-notes')

  const memo = page.locator('.memo').filter({ hasText: '头像色由分类哈希' })
  await memo.hover()
  await memo.locator('.memo-edit').click()
  await page.waitForSelector('.memo.editing .ProseMirror')
  await page.waitForTimeout(600)
  await shot('6-editor')
  await page.locator('.memo.editing button.eb.primary', { hasText: '完成' }).click()
  await page.waitForTimeout(300)

  await page.locator('a.nav-item[href="/files"]').click()
  await page.waitForSelector('.shortcut-row')
  await page.waitForTimeout(400)
  await shot('7-files')

  await tip('设置').click()
  await page.waitForSelector('.settings-dialog')
  // 设置弹窗是左菜单右内容，四个面板各拍一张
  for (const [id, label, slug] of [
    ['8a', '外观', 'appearance'],
    ['8b', '数据与备份', 'backup'],
    ['8c', '安全', 'security'],
    ['8d', '关于', 'about'],
  ]) {
    await page.locator('.nav-tab', { hasText: label }).click()
    await shot(`${id}-settings-${slug}`)
  }

  // 修改主密码：这个弹窗曾经没有 .form-group 样式，三个输入框是浏览器默认外观
  await page.locator('.nav-tab', { hasText: '安全' }).click()
  await page.getByText('修改主密码').click()
  await page.locator('.dialog h3', { hasText: '修改主密码' }).waitFor()
  await shot('9-chpwd')

  await page.close()
  console.log(`${t.id} ok`)
}

await browser.close()
