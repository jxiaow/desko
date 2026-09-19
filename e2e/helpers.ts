import type { Page, Locator } from '@playwright/test'
import type { E2EConfig } from './mocks/backend'

export const E2E_PASSWORD = 'e2e-master-123'

/** 安装 mock 配置并打开应用（每个 test 独立页面，backend 随页面新建） */
export async function startApp(
  page: Page,
  opts: { config?: E2EConfig; path?: string } = {},
): Promise<void> {
  await page.addInitScript(
    (config) => {
      ;(window as any).__E2E_CONFIG__ = config
    },
    opts.config ?? {},
  )
  await page.goto(opts.path ?? '/', { waitUntil: 'domcontentloaded' })
}

/** 通过 window.__E2E__ 桥访问 fake backend，做状态断言与操作 */
export const e2e = {
  snapshot: (page: Page): Promise<Record<string, any>> =>
    page.evaluate(() => (window as any).__E2E__.snapshot()),
  count: (page: Page, cmd: string): Promise<number> =>
    page.evaluate((c) => (window as any).__E2E__.count(c), cmd),
  emitEvent: (page: Page, event: string, payload?: unknown): Promise<void> =>
    page.evaluate(([e, p]) => (window as any).__E2E__.emitEvent(e, p), [event, payload]),
  hasListener: (page: Page, event: string): Promise<boolean> =>
    page.evaluate((e) => (window as any).__E2E__.hasListener(e), event),
  queueDialog: (page: Page, value: unknown): Promise<void> =>
    page.evaluate((v) => (window as any).__E2E__.queueDialog(v), value),
}

import { expect } from '@playwright/test'
import { AuthPage } from './pages/auth-page'

/** 启动并解锁到主界面（各视图 spec 的公共前置） */
export async function bootUnlocked(
  page: Page,
  config: E2EConfig = {},
  path = '/',
): Promise<AuthPage> {
  await startApp(page, { config, path })
  const auth = new AuthPage(page)
  await auth.unlock(E2E_PASSWORD)
  await auth.expectUnlocked()
  await expect
    .poll(() => e2e.hasListener(page, 'tray-lock'), { timeout: 30_000 })
    .toBe(true)
  return auth
}

/** 断言 toast 文案（toast 2500ms 自动消失，操作后应立即断言） */
export async function expectToast(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.locator('.toast')).toContainText(text as string)
}

/** 等 toast 消失，避免串味到下一条断言 */
export async function waitForToastGone(page: Page): Promise<void> {
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 5000 })
}

/** 按 .card-name / .shortcut-name 等文本精确定位卡片 */
export function cardByName(name: string): string {
  return `.entry-card:has(.card-name:text-is("${name}"))`
}

export async function hoverCard(page: Page, name: string): Promise<void> {
  const card = page.locator(cardByName(name))
  await card.hover()
}

/** 设置弹窗是左菜单 / 右内容，非默认面板要先点菜单项才有可见的可交互节点 */
const SETTINGS_TAB = {
  appearance: '外观',
  data: '数据存储',
  security: '安全',
  about: '关于',
} as const
export type SettingsTab = keyof typeof SETTINGS_TAB

/** 打开设置弹窗并停在指定面板，返回 dialog 定位器 */
export async function openSettings(
  page: Page,
  tab: SettingsTab = 'appearance',
): Promise<Locator> {
  await page.locator('button[title="设置"]').click()
  const dialog = page.locator('.settings-dialog')
  await expect(dialog).toBeVisible()
  await settingsTab(dialog, tab)
  return dialog
}

/** 切到指定面板（默认停在「外观」，其余面板要点菜单才露出来） */
export function settingsTab(dialog: Locator, tab: SettingsTab): Promise<void> {
  return dialog.locator('.nav-tab', { hasText: SETTINGS_TAB[tab] }).click()
}

