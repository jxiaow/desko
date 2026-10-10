import { test, expect, Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, openSettings, tipButton, visiblePane } from '../helpers'
import type { E2EConfig } from '../mocks/backend'

const ROOT: E2EConfig = { settings: { bypass_enabled: 'true' } }

/** 判定五态由 verdict 一格喂给 mock，探测细节要特例时走 probe 种子 */
function scenario(
  verdict: NonNullable<E2EConfig['bypass']>['verdict'],
  bypass: Omit<NonNullable<E2EConfig['bypass']>, 'verdict'> = {},
): E2EConfig {
  return { ...ROOT, bypass: { verdict, ...bypass } }
}

const DOMAIN = 'https://internal.example.com/admin'

async function gotoBypass(page: Page, config = scenario('needRoute')) {
  await bootUnlocked(page, config)
  await page.locator('a.nav-item[href="/bypass"]').click()
  await expect(page.locator('.probe-box')).toBeVisible()
}

/** 输入并探测：一页只有一颗「探测」钮，落库是弹窗里的下一步 */
async function probe(page: Page, raw = DOMAIN) {
  await page.locator('.probe-box input').fill(raw)
  await page.locator('.page-bar .btn-primary').click()
  await expect(page.locator('.concl-dialog')).toBeVisible()
}

/** 结论弹窗里的「加入清单」 */
async function record(page: Page) {
  await page.locator('.concl-dialog .btn-primary').click()
}

/** 悬停露出行上快捷钮（.ib 平时 opacity:0） */
async function rowBtn(page: Page, host: string, title: string) {
  const row = page.locator('.bp-row', { hasText: host })
  await row.hover()
  await tipButton(row, title).click()
}

test.describe('直连清单', () => {
  test('开关默认关：没有侧栏入口，直达 /bypass 被带回小记页', async ({ page }) => {
    await bootUnlocked(page, {}, '/bypass')
    await expect(page).toHaveURL(/\/notes$/)
    await expect(page.locator('a.nav-item[href="/bypass"]')).toHaveCount(0)
    expect(await e2e.count(page, 'bypass_list')).toBe(0)
  })

  test('开关只开入口，进页面只读清单不探测', async ({ page }) => {
    await bootUnlocked(page)
    await expect(page.locator('a.nav-item[href="/bypass"]')).toHaveCount(0)
    const dialog = await openSettings(page, 'modules')
    await visiblePane(dialog)
      .locator('.setting-item', { hasText: '直连清单' })
      .locator('.switch-slider')
      .click()
    await expectToast(page, '直连清单已开启')
    await dialog.locator('.dialog-close').click()
    await expect(page.locator('a.nav-item[href="/bypass"]')).toHaveCount(1)
    await page.locator('a.nav-item[href="/bypass"]').click()
    await expect(page.locator('.empty-title')).toHaveText('清单为空')
    expect(await e2e.count(page, 'bypass_probe')).toBe(0)
  })

  test('缺路由：判定说清还差哪一步，加入清单不再跑第二次探测', async ({ page }) => {
    await gotoBypass(page)
    await probe(page)
    expect(await e2e.count(page, 'bypass_probe')).toBe(1)
    expect(await e2e.count(page, 'bypass_save')).toBe(0)

    await expect(page.locator('.concl-head .chip')).toContainText('缺少路由')
    await expect(page.locator('.concl-title')).toHaveText('缺少绑定的路由')
    await expect(page.locator('.concl-detail')).toContainText('仅固定 hosts 不足，需添加绑定该接口的持久路由')
    await expect(page.locator('.concl-target')).toHaveText('internal.example.com:443/admin')
    await expect(page.locator('.concl-facts div', { hasText: '出口路由' }).locator('dd')).toContainText(
      'vEthernet (TUN)（接管方网卡）',
    )
    await expect(page.locator('.concl-pending li').first()).toContainText(
      '写入后仍需将该域名加入代理客户端的直连名单',
    )
    await expect(page.locator('.concl-pending li').last()).toContainText('当前版本仅登记目标，不代为写入')
    // 探测这一步没写库，清单还是空的
    await expect(page.locator('.bp-row')).toHaveCount(0)

    await record(page)
    await expectToast(page, '已加入清单')
    // 后端拿的是刚才那份缓存结论，加入清单不该再探一次
    expect(await e2e.count(page, 'bypass_save')).toBe(1)
    expect(await e2e.count(page, 'bypass_probe')).toBe(1)
    await expect(page.locator('.bp-row', { hasText: 'internal.example.com' })).toBeVisible()
    // 已经落库的那份结论不再给第二次「加入清单」
    await expect(page.locator('.concl-dialog .btn-primary')).toHaveCount(0)
  })

  test('仅缺 DNS 固定：点「加入清单」才写库', async ({ page }) => {
    await gotoBypass(page, scenario('hostsOnly'))
    await probe(page)
    expect(await e2e.count(page, 'bypass_probe')).toBe(1)
    expect(await e2e.count(page, 'bypass_save')).toBe(0)
    await expect(page.locator('.concl-head .chip')).toContainText('仅缺 DNS 固定')
    await expect(page.locator('.concl-title')).toHaveText('仅缺 DNS 固定')
    await expect(page.locator('.concl-facts div', { hasText: 'hosts 记录' }).locator('dd')).toHaveText('无记录')

    await record(page)
    await expectToast(page, '已加入清单')
    expect(await e2e.count(page, 'bypass_save')).toBe(1)
    await expect(page.locator('.bp-row', { hasText: 'internal.example.com' })).toBeVisible()
    await expect(page.locator('.concl-dialog .btn-primary')).toHaveCount(0)
  })

  test('已直连：不给写入建议，也不出现在推荐位', async ({ page }) => {
    await gotoBypass(page, scenario('directOk'))
    await probe(page)
    await expect(page.locator('.concl-head .chip')).toHaveClass(/live/)
    await expect(page.locator('.concl-title')).toHaveText('直连已可用')
    await expect(page.locator('.concl-facts div', { hasText: '出口路由' }).locator('dd')).toHaveText(
      '以太网 · 源地址 192.168.1.23 · 网关 192.168.1.1',
    )
    await expect(page.locator('.concl-pending')).toHaveCount(0)
  })

  test('不可达：先劝住，出口与连通性留空，加入位不给点', async ({ page }) => {
    await gotoBypass(page, scenario('unreachable'))
    await probe(page)
    await expect(page.locator('.concl-head .chip')).toHaveClass(/bad/)
    await expect(page.locator('.concl-title')).toHaveText('目标不可达，暂不添加')
    await expect(page.locator('.concl-detail')).toContainText('http://internal.example.com:8080/')
    await expect(page.locator('.concl-facts div', { hasText: '出口路由' }).locator('dd')).toHaveText('未查询到出口路由')
    await expect(page.locator('.concl-facts div', { hasText: '连通性' }).locator('dd')).toHaveText('连接失败')
    await expect(page.locator('.concl-pending')).toHaveCount(0)
    // 死地址不进清单：加入那颗钮就在位，但按不动
    await expect(page.locator('.concl-dialog .btn-primary')).toBeDisabled()
    expect(await e2e.count(page, 'bypass_save')).toBe(0)
  })

  test('出口无法判定：第五档只登记，不给改系统的建议', async ({ page }) => {
    await gotoBypass(page, scenario('egressUnknown'))
    await probe(page)
    await expect(page.locator('.concl-head .chip')).toHaveClass(/warn/)
    await expect(page.locator('.concl-title')).toHaveText('出口路由无法判定')
    await expect(page.locator('.concl-facts div', { hasText: '出口路由' }).locator('dd')).toHaveText('未查询到出口路由')
    await expect(page.locator('.concl-pending')).toHaveCount(0)
  })

  test('带 CDN 特征：即使能固定也不推荐，只留一句警告', async ({ page }) => {
    await gotoBypass(page, scenario('hostsOnly', { probe: { cdn: true } }))
    await probe(page)
    await expect(page.locator('.concl-facts div', { hasText: '实际地址' }).locator('dd')).toContainText(
      '带 CDN 轮换特征',
    )
    await expect(page.locator('.concl-pending li')).toHaveCount(1)
    await expect(page.locator('.concl-pending li').first()).toContainText(
      '固定后会锁定在会失效的节点上，不建议写入',
    )
  })

  test('探测失败：错误进 toast，结论弹窗不残留', async ({ page }) => {
    await gotoBypass(page, scenario('needRoute', { probeFail: true }))
    await page.locator('.probe-box input').fill(DOMAIN)
    await page.locator('.page-bar .btn-primary').click()
    await expectToast(page, '无法获取实际地址')
    await expect(page.locator('.concl-dialog')).toHaveCount(0)
    // 命令面被调用过，但 mock 在出结论前就抛了，清单不会多一行
    expect(await e2e.count(page, 'bypass_probe')).toBe(1)
    expect(await e2e.count(page, 'bypass_save')).toBe(0)
    await expect(page.locator('.bp-row')).toHaveCount(0)
  })

  test('行展开念的是存下来的结论，不再跑网络', async ({ page }) => {
    await gotoBypass(
      page,
      scenario('needRoute', {
        targets: [
          { host: 'internal.example.com', address: '172.30.2.109', interfaceName: 'vEthernet (TUN)' },
          { host: '10.20.0.0/16', kind: 'cidr', verdict: 'directOk', address: '10.20.3.7' },
        ],
      }),
    )
    await expect(page.locator('.bp-row')).toHaveCount(2)
    await page.locator('.bp-row', { hasText: 'internal.example.com' }).locator('.row-main').click()
    const card = page.locator('.row-card')
    await expect(card).toBeVisible()
    await expect(card.locator('.row-note')).toContainText('当前版本仅登记目标，不代为写入')
    expect(await e2e.count(page, 'bypass_recheck')).toBe(0)

    await rowBtn(page, 'internal.example.com', '重新探测')
    expect(await e2e.count(page, 'bypass_recheck')).toBe(1)
    // 新结论开弹窗，那一行不许被收走
    await expect(page.locator('.concl-dialog')).toBeVisible()
    await expect(page.locator('.row-card')).toBeVisible()
    await expect(page.locator('.concl-dialog .concl-title')).toHaveText('缺少绑定的路由')
    await page.keyboard.press('Escape')
    await expect(page.locator('.concl-dialog')).toHaveCount(0)
    // 同 host 重探覆盖回原行，清单不会长出第二条
    await expect(page.locator('.bp-row')).toHaveCount(2)
  })

  test('删除走 ⋯ 菜单，确认框取消不动数据', async ({ page }) => {
    await gotoBypass(
      page,
      scenario('needRoute', {
        targets: [
          { host: 'internal.example.com' },
          { host: 'other.example.com', verdict: 'directOk' },
        ],
      }),
    )
    await rowBtn(page, 'internal.example.com', '更多操作')
    await page.locator('.popover .pop-item', { hasText: '删除' }).click()
    const confirm = page.locator('.confirm-dialog')
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText('确定将「internal.example.com」移出清单？')
    await confirm.locator('button', { hasText: '取消' }).click()
    expect(await e2e.count(page, 'bypass_delete')).toBe(0)
    await expect(page.locator('.bp-row')).toHaveCount(2)

    await rowBtn(page, 'internal.example.com', '更多操作')
    await page.locator('.popover .pop-item', { hasText: '删除' }).click()
    await page.locator('.confirm-dialog .dialog-footer button', { hasText: '确定' }).click()
    await expectToast(page, '已删除')
    expect(await e2e.count(page, 'bypass_delete')).toBe(1)
    await expect(page.locator('.bp-row')).toHaveCount(1)
  })

  test('改原文重新探测：按新写法覆盖这一行，行首快捷位不重复', async ({ page }) => {
    await gotoBypass(
      page,
      scenario('hostsOnly', {
        targets: [{ host: 'typo.example.con', input: 'typo.example.con', verdict: 'hostsOnly' }],
      }),
    )
    await page.locator('.bp-row', { hasText: 'typo.example.con' }).locator('.row-main').click()
    const card = page.locator('.row-card')
    // 展开档里不再摆第二颗行首快捷钮——重探那件事归 .ib 管
    await expect(card.locator('.ib')).toHaveCount(0)
    await card.locator('.row-edit input').fill('typo.example.com')
    await card.locator('.row-edit .action-btn').click()
    expect(await e2e.count(page, 'bypass_edit')).toBe(1)
    await expect(page.locator('.concl-dialog')).toBeVisible()
    // 改写法是覆盖这一行，不是长出第二条
    await expect(page.locator('.bp-row')).toHaveCount(1)
    await expect(page.locator('.bp-row', { hasText: 'typo.example.com' })).toBeVisible()
  })

  test('小账与筛选：条数说得出来，名字筛得动', async ({ page }) => {
    await gotoBypass(
      page,
      scenario('needRoute', {
        hosts: { managed: 2 },
        targets: [
          { host: 'gitlab.example.com' },
          { host: 'qa.example.com', verdict: 'hostsOnly' },
          { host: 'dead.example.com', verdict: 'unreachable', stale: true },
        ],
      }),
    )
    await expect(page.locator('.bp-status')).toContainText('hosts 托管区 2 条')
    await expect(page.locator('.bp-status')).toContainText('清单 3 条')
    await expect(page.locator('.bp-status')).toContainText('待写入 2 条')
    await expect(page.locator('.bp-status')).toContainText('固定地址失效 1 条')

    await page.locator('.bp-filter input').fill('qa')
    await expect(page.locator('.bp-row')).toHaveCount(1)
    await expect(page.locator('.bp-row', { hasText: 'qa.example.com' })).toBeVisible()

    await page.locator('.bp-filter input').fill('nothing')
    await expect(page.locator('.bp-row')).toHaveCount(0)
    await expect(page.locator('.bp-nohit')).toContainText('没有名称包含「nothing」的条目')
  })

  test('托管区读不出来：小账改口并给出原因', async ({ page }) => {
    await gotoBypass(page, scenario('needRoute', { hosts: { error: 'hosts 中的直连管理区标记不完整' } }))
    await expect(page.locator('.bp-status')).toContainText('hosts 托管区无法读取')
    await expect(page.locator('.bp-status-err')).toHaveText('hosts 中的直连管理区标记不完整')
  })

  test('页栏只有一个动作：没有导入入口', async ({ page }) => {
    await gotoBypass(page)
    await expect(page.locator('.page-bar .btn-secondary')).toHaveCount(0)
    await expect(page.locator('.page-bar .btn-primary')).toHaveCount(1)
  })
})
