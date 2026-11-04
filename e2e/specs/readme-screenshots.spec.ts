import { test, expect } from '@playwright/test'
import { bootUnlocked } from '../helpers'

// Opt in: PowerShell: $env:README_SCREENSHOTS="1"; $env:PW_CHANNEL="msedge"; npx playwright test readme-screenshots --workers=1
// Real UI, isolated demo backend. Never reads the user's desktop database.
test.skip(process.env.README_SCREENSHOTS !== '1', 'README screenshot generation is opt-in')
test.use({ viewport: { width: 1280, height: 800 }, timezoneId: 'Asia/Shanghai' })

const settings = Object.fromEntries(['notes', 'entries', 'files', 'mfa', 'fileshare', 'tunnel', 'bypass', 'codex'].map(id => [`${id}_enabled`, 'true']))
const notes = [
  { title: '把灵感留在手边', pinned: true, content_html: '<p>一个念头、一段摘录、一份待办。先记下来，再慢慢整理。</p><blockquote><p>给每天的工作，留一张干净的案头。</p></blockquote><p>#灵感 #日常</p>' },
  { title: '本周的小目标', content_html: '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>整理项目资料和常用链接</p></li><li data-type="taskItem" data-checked="false"><p>完成个人网站的首页设计</p></li><li data-type="taskItem" data-checked="false"><p>给周末留一点阅读时间</p></li></ul><p>#计划</p>' },
  { title: '项目启动 · 设计备忘', content_html: '<p>先让信息清楚，再让界面好看。</p><ul><li>首页只保留最常用的入口</li><li>颜色用于强调，而不是装饰</li><li>让每一次点击都有明确的反馈</li></ul><p>#工作 #设计</p>' },
  { title: '读到的一句话', starred: true, content_html: '<blockquote><p>把复杂的事情想清楚，把简单的事情做好。</p></blockquote><p>今天的提醒：先完成一个小步骤。</p><p>#阅读</p>' },
  { title: '开发常用命令', content_html: '<p>启动项目与检查构建，随时取用。</p><pre><code>npm install\nnpm run dev\nnpm run build</code></pre><p>#开发</p>' },
  { title: '周末出行清单', content_html: '<p>相机、充电器、一本书。</p><p>早上沿河散步，下午找一家安静的咖啡馆。没有排满的日程，也很好。</p><p>#生活</p>' },
]

for (const theme of ['paper', 'ink']) {
  test(`notes ${theme}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await bootUnlocked(page, { settings: { ...settings, theme }, notes: notes.map(note => ({ ...note, content_html: `<h2>${note.title}</h2>${note.content_html}` })) }, '/notes')
    await expect(page.getByText('把灵感留在手边', { exact: true }).first()).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `docs/images/notes-${theme}.png`, animations: 'disabled' })
  })
}

test('codex usage and sessions', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T10:00:00Z'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const titles = ['完善个人网站首页', '整理组件库与主题配色', '为搜索补充边界测试', '优化图片加载体验', '修复移动端导航', '编写项目使用说明']
  await bootUnlocked(page, { settings, codex: { sessions: titles.map((title, i) => ({
    sessionId: `demo-session-${i}`, title, cwd: i < 3 ? 'C:/Projects/portfolio' : 'C:/Projects/notebook',
    projectName: i < 3 ? 'portfolio' : 'notebook', daysAgo: 0, hoursAgo: i + 1,
    input: (6 - i) * 120000, cached: (6 - i) * 90000, output: (6 - i) * 16000,
    model: i % 2 ? 'gpt-5.4-mini' : 'gpt-5.4', turns: 8 + i * 3,
  })) } }, '/codex')
  await page.getByRole('button', { name: '用量', exact: true }).click()
  await expect(page.locator('.usg-model-row').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
  await page.screenshot({ path: 'docs/images/codex-usage.png', animations: 'disabled' })
  await page.getByRole('button', { name: '会话', exact: true }).click()
  await expect(page.locator('.sess-row')).toHaveCount(6)
  await page.mouse.move(0, 0)
  await page.screenshot({ path: 'docs/images/codex-sessions.png', animations: 'disabled' })
})

test('mfa', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T10:00:08Z'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await bootUnlocked(page, { settings, mfaTokens: [
    { issuer: 'GitHub', label: 'developer@example.com' },
    { issuer: 'Google', label: 'hello@example.com' },
    { issuer: 'Microsoft', label: 'work@example.com' },
    { issuer: 'Cloudflare', label: 'website@example.com' },
    { issuer: 'GitLab', label: 'team@example.com' },
    { issuer: 'Notion', label: 'notes@example.com' },
  ] }, '/mfa')
  await expect(page.locator('.mfa-card')).toHaveCount(6)
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
  await page.screenshot({ path: 'docs/images/mfa.png', animations: 'disabled' })
})
