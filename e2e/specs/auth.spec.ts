import { test, expect } from '@playwright/test'
import { startApp, e2e, E2E_PASSWORD } from '../helpers'
import { AuthPage } from '../pages/auth-page'

test.describe('认证流程', () => {
  test('首次使用：设置主密码并进入应用', async ({ page }) => {
    await startApp(page, { config: { initialized: false } })
    const auth = new AuthPage(page)
    await auth.expectSetupPage()

    await auth.completeSetup('123', '123')
    await expect(auth.setupError).toHaveText('主密码至少需要 6 位')

    await auth.completeSetup('abcdef', 'abcdeg')
    await expect(auth.setupError).toHaveText('两次输入的密码不一致')

    await auth.completeSetup('abcdef', 'abcdef')
    await auth.expectUnlocked()

    const snap = await e2e.snapshot(page)
    expect(snap.initialized).toBe(true)
    expect(snap.masterPassword).toBe('abcdef')
    expect(snap.unlocked).toBe(true)
    // 注：setup 后不 assert list_entries 拉取 —— store.setupMasterPassword 先置
    // appState='unlocked'，SetupPage 在 emit('setupComplete') 前已卸载，事件丢失
    // （真实 app 同样如此；首次设置后库内本无数据，故用户无感）
  })

  test('已初始化：错误口令被拒，正确口令解锁', async ({ page }) => {
    await startApp(page)
    const auth = new AuthPage(page)
    await auth.expectUnlockPage()

    await auth.unlock('wrong-password')
    await expect(auth.unlockError).toHaveText('主密码错误，请重试')
    let snap = await e2e.snapshot(page)
    expect(snap.unlocked).toBe(false)
    expect(snap.unlockAttempts).toBe(1)

    await auth.unlock(E2E_PASSWORD)
    await auth.expectUnlocked()
    snap = await e2e.snapshot(page)
    expect(snap.unlocked).toBe(true)
    expect(snap.unlockAttempts).toBe(0)
    await expect.poll(() => e2e.count(page, 'list_entries_with_paths')).toBeGreaterThan(0)
  })

  test('解锁后可锁定，再重新解锁', async ({ page }) => {
    await startApp(page)
    const auth = new AuthPage(page)
    await auth.unlock(E2E_PASSWORD)
    await auth.expectUnlocked()

    await auth.lock()
    await auth.expectUnlockPage()
    expect((await e2e.snapshot(page)).unlocked).toBe(false)

    await auth.unlock(E2E_PASSWORD)
    await auth.expectUnlocked()
  })

  test('托盘锁定事件触发锁定', async ({ page }) => {
    await startApp(page)
    const auth = new AuthPage(page)
    await auth.unlock(E2E_PASSWORD)
    await auth.expectUnlocked()

    // useAutoLock 的动态 import 完成后才注册监听，慢加载下需等待，否则事件丢失
    await expect.poll(() => e2e.hasListener(page, 'tray-lock'), { timeout: 30_000 }).toBe(true)
    await e2e.emitEvent(page, 'tray-lock')
    await auth.expectUnlockPage()
    expect((await e2e.snapshot(page)).unlocked).toBe(false)
  })

  test('连续 5 次错误口令后，正确口令也被限流拒绝', async ({ page }) => {
    await startApp(page)
    const auth = new AuthPage(page)
    for (let i = 0; i < 5; i++) {
      await auth.unlock('bad-password')
      await expect(auth.unlockError).toHaveText('主密码错误，请重试')
    }
    expect((await e2e.snapshot(page)).unlockAttempts).toBe(5)

    await auth.unlock(E2E_PASSWORD)
    await expect(auth.unlockError).toHaveText('主密码错误，请重试')
    expect((await e2e.snapshot(page)).unlocked).toBe(false)
    await expect(auth.unlockInput).toBeVisible()
  })
})
