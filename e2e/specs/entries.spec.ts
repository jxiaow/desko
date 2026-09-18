import { test, expect, Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, waitForToastGone, cardByName } from '../helpers'

const SEED = {
  entries: [
    { name: 'GitHub', url: 'https://github.com', username: 'user@example.com', password: 'Gh!tHub2024', notes: '代码托管平台', category: '开发' },
    { name: 'Gmail', url: 'https://mail.google.com', username: 'user@gmail.com', password: 'Gm@il#Secure', notes: '个人邮箱', category: '邮箱' },
    { name: '钉钉', url: 'https://www.dingtalk.com', username: 'user@company.com', password: 'Ding!Talk88', category: '办公' },
  ],
}

function entryCard(page: Page, name: string) {
  return page.locator(cardByName(name))
}

async function confirmDialog(page: Page, expectedMessage?: string) {
  const dialog = page.locator('.confirm-dialog')
  await expect(dialog).toBeVisible()
  if (expectedMessage) {
    await expect(dialog.locator('.dialog-body p')).toHaveText(expectedMessage)
  }
  await dialog.locator('button.btn-danger').click()
}

test.describe('Entries 网址收藏', () => {
  test('解锁后展示 seed 条目与分类 tabs', async ({ page }) => {
    await bootUnlocked(page, SEED)
    await expect(page.locator('.entry-card')).toHaveCount(3)
    await expect(entryCard(page, 'GitHub').locator('.card-name')).toBeVisible()
    await expect(entryCard(page, 'GitHub').locator('.card-category')).toHaveText('开发')
    // 未设分类才有未分类；这里 3 条各有分类。tabs：全部 + 分类，按聚合顺序
    const allTab = page.locator('.tabs .tab', { hasText: '全部' })
    await expect(allTab.locator('.tab-count')).toHaveText('3')
    await expect(allTab).toHaveClass(/active/)
  })

  test('搜索过滤与清除', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const search = page.locator('.search-box input')
    await search.fill('git')
    await expect(page.locator('.entry-card')).toHaveCount(1)
    await expect(entryCard(page, 'GitHub')).toBeVisible()

    await search.fill('不存在的关键字')
    await expect(page.locator('.empty-title')).toHaveText('未找到匹配结果')
    await expect(page.locator('.empty-desc')).toHaveText('试试其他关键词')

    await page.locator('button[title="清除搜索"]').click()
    await expect(page.locator('.entry-card')).toHaveCount(3)
  })

  test('按分类 tab 过滤', async ({ page }) => {
    await bootUnlocked(page, SEED)
    await page.locator('.tabs .tab', { hasText: '邮箱' }).click()
    await expect(page.locator('.entry-card')).toHaveCount(1)
    await expect(entryCard(page, 'Gmail')).toBeVisible()
    await page.locator('.tabs .tab', { hasText: '全部' }).click()
    await expect(page.locator('.entry-card')).toHaveCount(3)
  })

  test('新增条目：校验 + 创建成功', async ({ page }) => {
    await bootUnlocked(page, SEED)
    await page.locator('.toolbar-actions button.btn-primary').click()
    const dialog = page.locator('.dialog-overlay .dialog')
    await expect(dialog.locator('h3')).toHaveText('新增条目')

    // 名称为空直接保存 -> toast 名称必填
    await dialog.locator('.dialog-footer button.btn-primary').click()
    await expectToast(page, '名称必填')
    await waitForToastGone(page)

    await dialog.locator('input[placeholder="例如：OA系统"]').fill('Notion')
    await dialog.locator('input[placeholder="https://..."]').fill('https://www.notion.so')
    await dialog.locator('input[placeholder="登录用户名"]').fill('user@notion.so')
    await dialog.locator('input[placeholder="登录密码"]').fill('No@tion2024')
    await dialog.locator('textarea[placeholder="可选"]').fill('文档与笔记')
    await dialog.locator('.dialog-footer button.btn-primary').click()

    await expectToast(page, '已添加')
    await expect(page.locator('.entry-card')).toHaveCount(4)
    // 未填分类兜底为未分类，且新条目在最前（created_at 倒序）
    await expect(entryCard(page, 'Notion').locator('.card-category')).toHaveText('未分类')
    const snap = await e2e.snapshot(page)
    expect(snap.entries).toHaveLength(4)
    const created = snap.entries.find((e: any) => e.name === 'Notion')
    // EntryFormDialog 新增时分类缺省填「未分类」
    expect(created.category).toBe('未分类')
    expect(created.url).toBe('https://www.notion.so')
  })

  test('编辑条目名称', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const card = entryCard(page, 'GitHub')
    await card.hover()
    await card.locator('button[title="编辑"]').click()
    const dialog = page.locator('.dialog-overlay .dialog')
    await expect(dialog.locator('h3')).toHaveText('编辑条目')
    await dialog.locator('input[placeholder="例如：OA系统"]').fill('GitHub-Repo')
    await dialog.locator('.dialog-footer button.btn-primary').click()
    await expectToast(page, '已更新')
    await expect(entryCard(page, 'GitHub-Repo')).toBeVisible()
    const snap = await e2e.snapshot(page)
    const edited = snap.entries.find((e: any) => e.name === 'GitHub-Repo')
    expect(edited).toBeTruthy()
    // 密码留空则保持原值
    expect(edited.password).toBe('Gh!tHub2024')
  })

  test('单条删除走确认对话框', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const card = entryCard(page, '钉钉')
    await card.hover()
    await card.locator('button[title="删除"]').click()
    await confirmDialog(page, '确定删除「钉钉」？')
    await expectToast(page, '已删除')
    await expect(page.locator('.entry-card')).toHaveCount(2)
    const snap = await e2e.snapshot(page)
    expect(snap.entries.find((e: any) => e.name === '钉钉')).toBeUndefined()
  })

  test('批量选择与删除', async ({ page }) => {
    await bootUnlocked(page, SEED)
    await page.locator('.toolbar-actions button.btn-secondary').click()
    await expect(page.locator('.batch-bar')).toBeVisible()

    await entryCard(page, 'GitHub').locator('.card-checkbox').click()
    await entryCard(page, 'Gmail').locator('.card-checkbox').click()
    await expect(page.locator('.batch-info')).toHaveText('已选择 2 项')
    await expect(entryCard(page, 'GitHub')).toHaveClass(/selected/)

    await page.locator('button.batch-btn:text-is("取消全选")').click()
    await expect(page.locator('.batch-info')).toHaveText('已选择 0 项')

    await page.locator('button.batch-btn:text-is("全选")').click()
    await expect(page.locator('.batch-info')).toHaveText('已选择 3 项')
    await entryCard(page, '钉钉').locator('.card-checkbox').click() // 反选一个
    await expect(page.locator('.batch-info')).toHaveText('已选择 2 项')

    await page.locator('button.batch-btn.danger').click()
    await confirmDialog(page, '确定删除选中的 2 条记录吗？')
    await expectToast(page, '已删除 2 条记录')
    // 删除后自动退出批量模式
    await expect(page.locator('.batch-bar')).toHaveCount(0)
    await expect(page.locator('.entry-card')).toHaveCount(1)
    await expect(entryCard(page, '钉钉')).toBeVisible()
  })

  test('复制卡片并查看/复制密码', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const card = entryCard(page, 'GitHub')
    await card.hover()
    await card.locator('button[title="复制卡片"]').click()
    await expectToast(page, '已复制卡片')
    await expect(entryCard(page, 'GitHub 副本')).toBeVisible()
    expect((await e2e.snapshot(page)).entries).toHaveLength(4)

    // 复制卡片会用 getPassword 填充原条目密码缓存，此后详情页才有显示/复制密码按钮
    await expect.poll(() => e2e.count(page, 'get_password')).toBe(1)
    await card.hover()
    await card.locator('button[title="查看详情"]').click()
    const detail = page.locator('.detail-dialog')
    await expect(detail).toBeVisible()
    await expect(detail.locator('.detail-value.masked')).toHaveText('')

    await detail.locator('button[title="显示密码"]').click()
    await expect(
      detail.locator('.detail-row', { hasText: '密码' }).locator('.detail-value'),
    ).toHaveText('Gh!tHub2024')
    // 已缓存，不再请求 getPassword
    expect(await e2e.count(page, 'get_password')).toBe(1)

    await detail.locator('button[title="复制密码"]').click()
    await expectToast(page, '密码已复制，30秒后自动清除')
  })

  test('点击卡片网址走 shell open', async ({ page }) => {
    await bootUnlocked(page, SEED)
    await entryCard(page, 'Gmail').locator('a.card-url').click()
    await expect.poll(() => e2e.count(page, 'shell:open')).toBe(1)
  })
})
