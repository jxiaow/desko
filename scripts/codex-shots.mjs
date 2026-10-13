// Codex 页交付出图：账号档（三行行内事实 × 两主题 / 批量 dock / 删除作业进行中 / 删除失败明细 / 重置明细 / 添加账号（登录·导入·粘贴）/ 切号在途可取消 / 待授权与配额失败 / API Key 改凭据）+ 会话档（折叠 / 展开 / 空态）+ 回收站（会话删除确认 / 会话留底清单 / 账号留底清单 / 空态）+ 用量档（两段柱与模型表 / 空态）+ 设置·Codex 面板
// 用法：先起 vite --mode e2e --port 1430，再 PW_CHANNEL=msedge node scripts/codex-shots.mjs
import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, rmSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const OUT = 'shots'
const EXPECTED = [
  'codex-list.png',
  'codex-list-ink.png',
  'codex-batch.png',
  'codex-delete-job.png',
  'codex-delete-failed.png',
  'codex-reset-confirm.png',
  'codex-auth.png',
  'codex-import.png',
  'codex-switching.png',
  'codex-pending-fields.png',
  'codex-edit-key.png',
  'codex-settings.png',
  'codex-sessions-collapsed.png',
  'codex-sessions-expanded.png',
  'codex-sessions-empty.png',
  'codex-trash-confirm.png',
  'codex-trash-list.png',
  'codex-trash-accounts.png',
  'codex-trash-empty.png',
  'codex-usage-chart.png',
  'codex-usage-empty.png',
]

const ACCOUNTS = [
  {
    email: 'main@e2e.dev', account_name: '主力', plan_type: 'pro', hourly: 82, weekly: 60, current: true,
    user_id: '9f6305d7-1111-2222-3333-444455556666', account_structure: 'personal',
    subscription_until: '2027-01-01T10:18:00', tags: ['工作'], login_provider: 'google',
  },
  {
    email: 'team@e2e.dev', account_name: '团队号', plan_type: 'team', hourly: 34, weekly: 71,
    organization_id: 'org-7c31a90b11', account_structure: 'team',
    subscription_until: '2027-03-06T09:00:00', tags: ['团队'], login_provider: 'github',
  },
  {
    email: 'back@e2e.dev', account_name: '备用', plan_type: 'plus', hourly: 12, weekly: 44,
    account_structure: 'personal', subscription_until: '1798761600', login_provider: 'password',
  },
  {
    email: 'key@e2e.dev', account_name: '托管密钥', auth_mode: 'apikey',
    api_provider_name: '自建网关', api_base_url: 'https://api.e2e.dev/v1', hourly: 66, weekly: 88,
  },
]

/** 只给「待授权 / 需重新登录 / 配额拉取失败 / 上次使用」这一帧用：把四种新状态摆同屏 */
const FIELD_ACCOUNTS = [
  { email: 'main@e2e.dev', account_name: '主力', plan_type: 'pro', current: true, hourly: 82, weekly: 60 },
  { email: 'pend@e2e.dev', account_name: '待授权的', plan_type: 'plus', auth_status: 'pending' },
  {
    email: 'reauth@e2e.dev', account_name: '要重登的', plan_type: 'plus', reauth: true,
    reauth_reason: '令牌已被撤销，请重新登录（悬停才出这一串）',
  },
  {
    email: 'bad@e2e.dev', account_name: '拉不到配额的', quota_error: '上游限流（429），稍后再刷新',
    used_days_ago: 3, tags: ['备用'],
  },
]

/** 会话档那一帧：两档项目、一条没标题的子代理，够把折叠头、行、详情三种形态都摆出来 */
const SESS = [
  { sessionId: 'sess-a1b2c3d4e5', title: '修全屏小记的排版', cwd: 'C:\\ws\\demo-notes', projectName: 'demo-notes', daysAgo: 0, input: 12300, cached: 11000, output: 1400, reasoning: 400, sizeBytes: 1536 },
  { sessionId: 'sess-f6g7h8i9j0', title: '查配额刷新链路', cwd: 'C:\\ws\\demo-notes', projectName: 'demo-notes', daysAgo: 2, input: 800, output: 120 },
  { sessionId: 'sess-k1l2m3n4o5', title: 'desko 侧栏图标盘点', cwd: 'C:\\ws\\demo-icons', daysAgo: 5, input: 45000, cached: 40000, output: 3200, reasoning: 900 },
  { sessionId: 'sess-p6q7r8s9t0', title: 'sess-p6q7r8s9t0', cwd: 'C:\\ws\\demo-notes', projectName: 'demo-notes', kind: 'subagent', daysAgo: 9, input: 2000, cached: 300, output: 300 },
]

/** 回收站那一帧：一条昨天删的、一条三天前删的没标题留底，体积分档要能同时看见 */
const TRASH = [
  { sessionId: 'sess-t1t2t3t4t5', title: '查配额刷新链路', cwd: 'C:\\ws\\demo-notes', daysAgo: 1, sizeBytes: 2048 },
  { sessionId: 'sess-u6u7u8u9u0', title: 'sess-u6u7u8u9u0', cwd: 'C:\\ws\\demo-icons', daysAgo: 3, sizeBytes: 3 * 1024 * 1024 },
]

/** 账号留底那一帧：一条有名字、一条只认邮箱，档位徽标两种取值都摆上 */
const RECYCLED = [
  { email: 'old@e2e.dev', account_name: '旧手机上的号', plan_type: 'plus', hoursAgo: 6 },
  { email: 'gone@e2e.dev', hoursAgo: 30 },
]

const config = (theme, accounts = ACCOUNTS, sessions = [], trash = [], recycled = []) => ({
  settings: { codex_enabled: 'true', theme, accent: 'ink' },
  // 切号在途那几秒要能拍下来：真实后端写凭据也是这个量级
  codex: { accounts, switchDelayMs: 1500, sessions, trash, recycled },
})

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })
mkdirSync(OUT, { recursive: true })
// 缺帧对账：先删旧图，跑完数一遍
EXPECTED.forEach((f) => existsSync(`${OUT}/${f}`) && rmSync(`${OUT}/${f}`))

async function openApp(theme, cfg = config(theme)) {
  const page = await browser.newPage({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => console.log(`[${theme}] pageerror: ${e.message}`))
  await page.addInitScript((c) => { window.__E2E_CONFIG__ = c }, cfg)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.unlock-input')
  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await page.locator('a.nav-item[href="/codex"]').click()
  await page.waitForSelector('.acc-row')
  return page
}

const shot = async (page, name) => {
  await page.waitForTimeout(320)
  await page.screenshot({ path: `${OUT}/${name}` })
  console.log(`wrote ${name}`)
}

// 1/2 账号页：两主题，三行事实 + 配额块
for (const theme of ['paper', 'ink']) {
  const page = await openApp(theme)
  await page.mouse.move(1030, 660)
  await shot(page, theme === 'paper' ? 'codex-list.png' : 'codex-list-ink.png')
  if (theme === 'paper') {
    // 3 批量态：dock 里含「导出所选 JSON」
    await page.locator('.page-bar .bar-btn', { hasText: '选择' }).click()
    await page.locator('.acc-row').nth(0).locator('.acc-main').click()
    await page.locator('.acc-row').nth(1).locator('.acc-main').click()
    await shot(page, 'codex-batch.png')

    // 4/5 删除作业：逐条推进那一拍（进度条 + 已处理 X / N）与失败明细那一拍
    const jobCfg = (extra) => ({ ...config('paper'), codex: { ...config('paper').codex, ...extra } })
    const pickAll = async (p, n) => {
      await p.locator('.page-bar .bar-btn', { hasText: '选择' }).click()
      for (let i = 0; i < n; i++) await p.locator('.acc-row').nth(i).locator('.acc-main').click()
      await p.locator('.batch-dock .dock-btn', { hasText: '删除选中' }).click()
      await p.locator('.confirm-dialog .dialog-footer button', { hasText: '确定' }).click()
      await p.locator('.batch-delete-dialog').waitFor()
    }

    const jobPage = await openApp('paper', jobCfg({ deleteStepMs: 900 }))
    await pickAll(jobPage, 4)
    // 停在「删了一条、还剩三条」那一拍，进度条才看得出是条数不是百分比
    while ((await jobPage.locator('.bd-done').innerText()) === '0') await jobPage.waitForTimeout(120)
    await shot(jobPage, 'codex-delete-job.png')
    await jobPage.close()

    const failPage = await openApp('paper', jobCfg({ deleteFailEmails: ['back@e2e.dev'] }))
    await pickAll(failPage, 3)
    await failPage.locator('.batch-delete-dialog .bd-row').waitFor()
    await shot(failPage, 'codex-delete-failed.png')
    await failPage.close()

    // 4 重置 5 小时额度：弹窗里先摆可用次数与明细（只有还有次数的号才出这一项）
    await page.locator('.page-bar .bar-btn', { hasText: '退出选择' }).click()
    await page.locator('.acc-row[data-email="back@e2e.dev"] .acc-more').click()
    await page.locator('.popover .pop-item', { hasText: '重置 5 小时额度' }).click()
    const reset = page.locator('.reset-credit-dialog')
    await reset.waitFor()
    await reset.locator('.rc-row').first().waitFor()
    await shot(page, 'codex-reset-confirm.png')
    await reset.locator('.dialog-footer button', { hasText: '取消' }).click()
    await reset.waitFor({ state: 'detached' })

    // 5 切号在途：切换钮换成「取消」，上面挂着步进进度
    await page.locator('.acc-row[data-email="team@e2e.dev"] .action-btn.primary').click()
    await page.locator('.confirm-dialog .dialog-footer button', { hasText: '确定' }).click()
    await page.locator('.switch-line').waitFor()
    await page.locator('.acc-row[data-email="team@e2e.dev"] .action-btn', { hasText: '取消' }).waitFor()
    await shot(page, 'codex-switching.png')
    await page.locator('.acc-row[data-email="team@e2e.dev"] .action-btn', { hasText: '取消' }).click()
    await page.locator('.switch-line').waitFor({ state: 'detached' })

    // 6 待授权 / 配额拉取失败 / 上次使用：字段落地那一帧
    const fieldsPage = await openApp('paper', config('paper', FIELD_ACCOUNTS))
    await fieldsPage.mouse.move(1030, 660)
    await shot(fieldsPage, 'codex-pending-fields.png')
    await fieldsPage.close()

    // 7 API Key 行的编辑弹窗：元信息 + 更换凭据两块
    await page.locator('.acc-row[data-email="key@e2e.dev"] .acc-more').click()
    await page.locator('.popover .pop-item', { hasText: '名称与备注' }).click()
    const edit = page.locator('.edit-dialog')
    await edit.locator('.key-box').waitFor()
    // 定高弹窗的正文必须滚得到底：最后一格摸不到就是溢出事故
    await edit.locator('.dialog-body').evaluate((el) => { el.scrollTop = el.scrollHeight })
    await shot(page, 'codex-edit-key.png')
    await edit.locator('.dialog-footer button', { hasText: '取消' }).click()
    await edit.waitFor({ state: 'detached' })

    // 8/9 添加账号：浏览器登录 tab 与导入 tab（含粘贴框）
    await page.locator('.add-btn').click()
    const dialog = page.locator('.auth-dialog')
    await dialog.waitFor()
    await shot(page, 'codex-auth.png')
    await dialog.locator('.seg-btn', { hasText: '导入' }).click()
    await dialog.locator('.pathline').waitFor()
    await shot(page, 'codex-import.png')
    await dialog.locator('.dialog-close').click()

    // 10/11 会话档：首屏全折叠（合计量已在页上）→ 展开一组并点开一条（行上两位、详情六位）
    const sessPage = await openApp('paper', config('paper', ACCOUNTS, SESS))
    await sessPage.locator('.cx-tab', { hasText: '会话' }).click()
    await sessPage.locator('.sess-sum', { hasText: '累计' }).waitFor()
    await sessPage.locator('.grp-head').first().waitFor()
    await sessPage.mouse.move(1030, 660)
    await shot(sessPage, 'codex-sessions-collapsed.png')
    await sessPage.locator('.grp-head', { hasText: 'demo-notes' }).click()
    await sessPage.locator('.sess-row').first().waitFor()
    await sessPage.locator('.sess-row').first().click()
    await shot(sessPage, 'codex-sessions-expanded.png')
    await sessPage.close()

    // 12 会话档空态：官方目录还没会话，页脚注要说清这一档不代做什么
    const sessEmpty = await openApp('paper', config('paper', ACCOUNTS, [], []))
    await sessEmpty.locator('.cx-tab', { hasText: '会话' }).click()
    await sessEmpty.locator('.empty-state').waitFor()
    await sessEmpty.mouse.move(1030, 660)
    await shot(sessEmpty, 'codex-sessions-empty.png')
    await sessEmpty.close()

    // 13/14/15 会话回收站：删除确认框 → 留底清单 → 空态
    const trashPage = await openApp('paper', config('paper', ACCOUNTS, SESS, TRASH))
    await trashPage.locator('.cx-tab', { hasText: '会话' }).click()
    await trashPage.locator('.grp-head', { hasText: 'demo-icons' }).click()
    await trashPage.locator('.sess-row').first().click()
    await trashPage.locator('.sess-card .trash-btn').click()
    await trashPage.locator('.confirm-dialog').waitFor()
    await shot(trashPage, 'codex-trash-confirm.png')
    await trashPage.locator('.confirm-dialog .dialog-footer button', { hasText: '确定' }).click()
    await trashPage.locator('.toast', { hasText: '已将 1 条会话移到回收站' }).waitFor()
    await trashPage.locator('.cx-tab', { hasText: '回收站' }).click()
    await trashPage.locator('.thr-row').first().waitFor()
    await trashPage.mouse.move(1030, 660)
    await shot(trashPage, 'codex-trash-list.png')
    await trashPage.close()

    // 15 账号留底那一节排在会话上面：加密快照只出摘要那几列，恢复只写回 Desko 的列表
    const accTrash = await openApp('paper', config('paper', ACCOUNTS, SESS, TRASH, RECYCLED))
    await accTrash.locator('.cx-tab', { hasText: '回收站' }).click()
    await accTrash.locator('.thr-row[data-rid]').first().waitFor()
    await accTrash.mouse.move(1030, 660)
    await shot(accTrash, 'codex-trash-accounts.png')
    await accTrash.close()

    // 空回收站：清空的钮必须是死的，脚注讲清留底住在哪
    const trashEmpty = await openApp('paper', config('paper', ACCOUNTS, SESS, []))
    await trashEmpty.locator('.cx-tab', { hasText: '回收站' }).click()
    await trashEmpty.locator('.empty-state').waitFor()
    await trashEmpty.mouse.move(1030, 660)
    await shot(trashEmpty, 'codex-trash-empty.png')
    await trashEmpty.close()

    // 16/17 用量档：总量行 + 两段柱 + 模型表；空态要说清是窗口里没有记录
    const usagePage = await openApp('paper', config('paper', ACCOUNTS, SESS))
    await usagePage.locator('.cx-tab', { hasText: '用量' }).click()
    await usagePage.locator('.usg-sum').waitFor()
    await usagePage.locator('.usg-col').first().waitFor()
    await usagePage.mouse.move(1030, 660)
    await shot(usagePage, 'codex-usage-chart.png')
    await usagePage.close()

    const usageEmpty = await openApp('paper', config('paper', ACCOUNTS, []))
    await usageEmpty.locator('.cx-tab', { hasText: '用量' }).click()
    await usageEmpty.locator('.empty-title').waitFor()
    await usageEmpty.mouse.move(1030, 660)
    await shot(usageEmpty, 'codex-usage-empty.png')
    await usageEmpty.close()

    // 13 设置·Codex 面板：凭据路径 + 自动刷新与预警两档
    await page.locator('button[title="设置"]').click()
    const settings = page.locator('.settings-dialog')
    await settings.waitFor()
    await settings.locator('.nav-tab', { hasText: 'Codex 账号' }).click()
    const alert = settings.locator('.setting-item', { hasText: '配额预警' })
    await alert.scrollIntoViewIfNeeded()
    await shot(page, 'codex-settings.png')
  }
  await page.close()
}

await browser.close()

const missing = EXPECTED.filter((f) => !existsSync(`${OUT}/${f}`))
if (missing.length) {
  console.error(`缺帧：${missing.join(', ')}`)
  process.exit(1)
}
console.log(`${EXPECTED.length} 帧全部为本次新拍`)
