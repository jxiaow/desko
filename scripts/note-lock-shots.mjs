// 小记加密改造的验收截图（跑在 e2e 的 mock 后端上，不碰真实数据）。
// 用法：先起 vite --mode e2e --port 1430，再 node scripts/note-lock-shots.mjs
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const OUT = 'design/note-lock-shots'
mkdirSync(OUT, { recursive: true })

const PASS = 'note-pw-1234'
const NOTES = [
  { title: '周会纪要', content_html: '<p>尺度层不动，主题层只管颜色。</p>', category: '工作', pinned: true },
  { title: '薪酬沟通', content_html: '<h2>薪酬沟通</h2><p>三月调档与期权行权窗口。</p>', encrypted: true },
  { title: '私人备忘', content_html: '<p>体检结论复查安排 #健康</p>', encrypted: true },
]

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' })

/** 每张照片一套干净会话：config 决定口令是否已设、本会话是否已解开 */
async function open(name, config) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 1.5 })
  page.on('pageerror', (e) => console.log(`[${name}] pageerror: ${e.message}`))
  await page.addInitScript((cfg) => {
    window.__E2E_CONFIG__ = cfg
  }, { notes: NOTES, ...config })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.unlock-input')
  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await page.waitForSelector('.app-layout')
  // 整页跳转会重建 mock 会话，进小记走站内导航
  await page.locator('a.nav-item[href="/notes"]').click()
  await page.waitForSelector('.memo')
  // 过渡不拍完会抓到半透明帧
  await page.waitForTimeout(400)
  const shot = async (slug) => {
    await page.waitForTimeout(350)
    await page.screenshot({ path: `${OUT}/${name}-${slug}.png` })
  }
  const tip = (label) => page.locator(`button[title="${label}"], button[data-tip="${label}"]`)
  const memo = (text) => page.locator('.memo').filter({ hasText: text })
  return { page, shot, tip, memo }
}

// 1. 口令没解锁：两条锁卡，有真标题的那条露出标题，没有的只剩提示语
{
  const { page, shot } = await open('1-locked', { notePassphrase: PASS })
  await shot('list')
  await page.locator('.stream-bar button[aria-label="解锁全部加密小记"]').click()
  await shot('unlock-dialog')
  await page.locator('.note-lock-dialog input[type="password"]').fill(PASS)
  await page.locator('.note-lock-dialog button.btn-primary').click()
  // 2. 一把口令开全库：两条同时回来，解锁后不挂角标
  await shot('2-open')
}

// 3. 悬停已解锁的加密条：动作排补出「重新锁定」「解除加密」（后者是划掉的锁）
{
  const { shot, tip, memo } = await open('3-hover', { notePassphrase: PASS, noteOpen: true })
  const enc = memo('三月调档')
  await enc.hover()
  await tip('重新锁定').first().waitFor()
  await shot('encrypted-row')
  // 4. 普通条：动作全平铺，没有 ⋯
  const plain = memo('尺度层不动')
  await plain.hover()
  await tip('加密').first().waitFor()
  await shot('plain-row')
}

// 5. 首次给一条小记上加密：弹窗只要一次口令，之后加密不再逐条问
{
  const { page, shot, tip, memo } = await open('5-setup', {})
  const target = memo('尺度层不动')
  await target.hover()
  await tip('加密').first().click()
  await page.waitForSelector('.note-lock-dialog')
  await page.locator('.note-lock-dialog input[type="password"]').first().fill(PASS)
  await page.locator('.note-lock-dialog input[type="password"]').nth(1).fill(PASS)
  await shot('setup-dialog')
  await page.locator('.note-lock-dialog button.btn-primary').click()
  // 6. 设好之后：这条与库里另两条一起解锁，再加密别条不必再输
  await shot('after-setup')
  await page.waitForTimeout(200)
}

await browser.close()
console.log(`done → ${OUT}`)
