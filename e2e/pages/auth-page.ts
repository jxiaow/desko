import { type Page, expect } from '@playwright/test'

export class AuthPage {
  constructor(readonly page: Page) {}

  // ---- UnlockPage ----
  get unlockInput() { return this.page.locator('.unlock-input') }
  get unlockButton() { return this.page.locator('.unlock-btn') }
  get unlockError() { return this.page.locator('.unlock-error') }

  async expectUnlockPage() {
    await expect(this.unlockInput).toBeVisible()
  }

  async unlock(password: string) {
    await this.unlockInput.fill(password)
    await this.unlockButton.click()
  }

  // ---- SetupPage ----
  get setupCard() { return this.page.locator('.auth-card') }
  get setupInputs() { return this.page.locator('.auth-input') }
  get setupButton() { return this.page.locator('.auth-btn') }
  get setupError() { return this.page.locator('.auth-error') }

  async expectSetupPage() {
    await expect(this.setupCard).toBeVisible()
  }

  async completeSetup(password: string, confirm: string) {
    await this.setupInputs.nth(0).fill(password)
    await this.setupInputs.nth(1).fill(confirm)
    await this.setupButton.click()
  }

  // ---- 主界面 ----
  get appLayout() { return this.page.locator('.app-layout') }

  async expectUnlocked() {
    await expect(this.appLayout).toBeVisible()
  }

  async lock() {
    await this.page.locator('button[title="锁定"]').click()
  }
}
