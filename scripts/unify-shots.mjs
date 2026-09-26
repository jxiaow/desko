// 五页风格统一验收截图：同一视口、同一主题把五个模块页各拍一张，
// 另拍一张收藏页滚动中段，专看吸顶栏磨砂有没有盖住滚过的内容。
// 用法：先起 vite --mode e2e --port 1430，再 node scripts/unify-shots.mjs [themeId]
// 输出：design/unify-shots/<page>.png + <page>-scrolled.png + contact-sheet.html
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const COMBO = process.argv[2] || 'paper-ink'
const { theme: THEME, accent: ACCENT } = { theme: COMBO.slice(0, COMBO.indexOf('-')), accent: COMBO.slice(COMBO.indexOf('-') + 1) }
const OUT = `design/unify-shots/${COMBO}`
mkdirSync(OUT, { recursive: true })

const SEED = {
  settings: { theme: THEME, accent: ACCENT, mfa_enabled: 'true', fileshare_enabled: 'true' },
  entries: [
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
  notes: [
    { title: '会议纪要', content_html: '<h2>周会纪要</h2><p>尺度层不动，<strong>主题层只管颜色</strong>。</p>', category: '工作', pinned: true },
    { title: '代码片段', content_html: '<p>头像色由分类哈希决定：</p><pre><code>const hash = (s) =&gt; 31 * h + s.charCodeAt(i)</code></pre>', category: '开发' },
    { title: '灵感', content_html: '<p>暗色下靠高光描边分层，不靠阴影。</p><blockquote>近黑底要留一档高光边。</blockquote>', category: '设计' },
  ],
  fileShortcuts: [
    { name: '项目资料', path: 'C:/e2e/project', shortcut_type: 'folder' },
    { name: '月度报告', path: 'C:/e2e/report.pdf', shortcut_type: 'file' },
    { name: '预算表', path: 'C:/e2e/budget.xlsx', shortcut_type: 'file' },
    { name: '需求文档', path: 'C:/e2e/spec.docx', shortcut_type: 'file' },
    { name: '压缩包', path: 'C:/e2e/archive.zip', shortcut_type: 'file' },
  ],
  mfaTokens: [
    { issuer: 'GitHub', label: 'dev@example.com' },
    { issuer: 'Google', label: 'user@gmail.com' },
    { issuer: '公司 VPN', label: 'jin' },
  ],
  fileshare: { running: true, port: 8000, boundPort: 8000, shareDirs: ['D:\\share\\docs', 'D:\\share\\media'], hasPassword: true },
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' })
const page = await browser.newPage({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 1.5 })
page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`))
await page.addInitScript((cfg) => { window.__E2E_CONFIG__ = cfg }, SEED)

const shot = async (name) => {
  await page.waitForTimeout(400) // 过渡/余晖：拍早了会抓半透明帧
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`${OUT}/${name}.png`)
}

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.unlock-input')
await page.locator('.unlock-input').fill('e2e-master-123')
await page.locator('.unlock-btn').click()
await page.waitForSelector('.app-layout')

const PAGES = [
  ['1-entries', '/entries'],
  ['2-notes', '/notes'],
  ['3-files', '/files'],
  ['4-mfa', '/mfa'],
  ['5-fileshare', '/fileshare'],
]
for (const [name, path] of PAGES) {
  await page.locator(`a.nav-item[href="${path}"]`).click()
  await shot(name)
}

// 滚动中段：验收吸顶栏的磨砂是否真的盖住滚过的行
// 用鼠标滚轮事件滚（与真人一致），直接设 scrollTop 会拍到合成器未跟上的残影
await page.locator('a.nav-item[href="/entries"]').click()
await page.waitForSelector('.entry-card')
await page.mouse.move(600, 400)
for (let i = 0; i < 9; i++) {
  await page.mouse.wheel(0, 40)
  await page.waitForTimeout(30)
}
await shot('6-entries-scrolled')

// 并排总览页，肉眼比对顶栏/行卡/胶囊用
writeFileSync(
  `${OUT}/contact-sheet.html`,
  `<!doctype html><meta charset="utf-8"><title>五页统一验收 · ${THEME}</title>
<style>body{background:#22242a;color:#ddd;font:13px system-ui;margin:24px}h1{font-size:16px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}figure{margin:0}
img{width:100%;border:1px solid #444}figcaption{margin-top:6px}</style>
<h1>五页风格统一验收（${THEME}，1040×670）</h1>
<div class="grid">${PAGES.map(([n]) => `<figure><img src="${n}.png"><figcaption>${n}</figcaption></figure>`).join('')}
<figure><img src="6-entries-scrolled.png"><figcaption>6-entries-scrolled（吸顶磨砂）</figcaption></figure></div>`
)

await page.close()
await browser.close()
console.log('done')
