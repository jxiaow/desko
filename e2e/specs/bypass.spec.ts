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

/* ---------- 健康度反转骨架的定位档 ---------- */
/** 异常目标才升格成卡 */
const card = (page: Page, host?: string) =>
  host ? page.locator('.bp-card', { hasText: host }) : page.locator('.bp-card')
/** 直连可用的收成 chip */
const chip = (page: Page, name?: string) =>
  name ? page.locator('.chip', { hasText: name }) : page.locator('.chip')
/** 卡 + chip 才是整份清单：条数账要两档一起数 */
const rows = (page: Page) => page.locator('.bp-card, .chip')
const secHead = (page: Page, title: string) => page.locator('.sec-head').filter({ hasText: title })

/** 卡面动作常驻，不用悬停露出；全局 tooltip 把 title 摘成 data-tip 后仍能命中 */
async function cardBtn(page: Page, host: string, title: string) {
  await tipButton(card(page, host), title).click()
}

/** 低频动作住概览的 ⋯ 里：菜单现开现点 */
async function openHeroMenu(page: Page) {
  await page.locator('.hero-more').click()
  await expect(page.locator('.popover')).toBeVisible()
}

test.describe('网络直连', () => {
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
      .locator('.setting-item', { hasText: '网络直连' })
      .locator('.switch-slider')
      .click()
    await expectToast(page, '网络直连已开启')
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

    await expect(page.locator('.concl-title')).toHaveText('当前连接仍经过代理')
    await expect(page.locator('.concl-summary')).toContainText('目标可连接，出口仍由')
    await expect(page.locator('.concl-detail')).toContainText('需要添加持久路由，改用非代理接口')
    await expect(page.locator('.concl-target')).toHaveText('internal.example.com:443/admin')
    await expect(page.locator('.concl-facts div', { hasText: '出口路由' }).locator('dd')).toContainText(
      'vEthernet (TUN)（代理接口）',
    )
    await expect(page.locator('.concl-next')).toContainText('将目标设为直连（DIRECT）')
    await expect(page.locator('.concl-next')).toContainText('先加入清单')
    // 探测这一步没写库，清单还是空的
    await expect(rows(page)).toHaveCount(0)

    await record(page)
    await expectToast(page, '已加入清单')
    // 后端拿的是刚才那份缓存结论，加入清单不该再探一次
    expect(await e2e.count(page, 'bypass_save')).toBe(1)
    expect(await e2e.count(page, 'bypass_probe')).toBe(1)
    await expect(card(page, 'internal.example.com')).toBeVisible()
    // 已经落库的那份结论不再给第二次「加入清单」
    await expect(page.locator('.concl-dialog').getByRole('button', { name: '加入清单', exact: true })).toHaveCount(0)
    await expect(page.locator('.concl-dialog').getByRole('button', { name: '配置直连', exact: true })).toBeEnabled()
  })

  test('确认后清单变化会拒绝旧方案，重新查看后才能配置', async ({ page }) => {
    await gotoBypass(page, scenario('hostsOnly', {
      targets: [{ host: 'before.example.com', address: '10.20.0.1', verdict: 'hostsOnly' }],
    }))
    await page.getByRole('button', { name: '配置直连', exact: false }).click()
    await expect(page.getByRole('dialog', { name: '配置确认' })).toContainText('before.example.com')
    await page.evaluate(() => window.__E2E__!.seed({ bypass: {
      targets: [{ host: 'changed.example.com', address: '10.20.0.2', verdict: 'hostsOnly' }],
    } }))
    await page.getByRole('button', { name: '确认并配置', exact: true }).click()
    await expectToast(page, '网络或清单已变化，尚未写入更改')
    expect(await e2e.count(page, 'bypass_recheck')).toBe(0)
    const state = await e2e.snapshot(page)
    expect(state.bypass.targets.every((t: { applyState: string }) => t.applyState === 'none')).toBe(true)
    await page.getByRole('button', { name: '配置直连', exact: false }).click()
    await expect(page.getByRole('dialog', { name: '配置确认' })).toContainText('changed.example.com')
    await page.getByRole('button', { name: '确认并配置', exact: true }).click()
    await expect.poll(() => e2e.count(page, 'bypass_recheck')).toBe(1)
  })

  test('需配置 hosts：点「加入清单」才写库', async ({ page }) => {
    await gotoBypass(page, scenario('hostsOnly'))
    await probe(page)
    expect(await e2e.count(page, 'bypass_probe')).toBe(1)
    expect(await e2e.count(page, 'bypass_save')).toBe(0)
    await expect(page.locator('.concl-title')).toHaveText('需配置 hosts')
    await expect(page.locator('.concl-facts div', { hasText: 'hosts 记录' }).locator('dd')).toHaveText('无记录')

    await record(page)
    await expectToast(page, '已加入清单')
    expect(await e2e.count(page, 'bypass_save')).toBe(1)
    await expect(card(page, 'internal.example.com')).toBeVisible()
    await expect(page.locator('.concl-dialog').getByRole('button', { name: '配置直连', exact: true })).toBeEnabled()
  })

  test('IP 重探直接说明处理步骤，并从结论进入路由确认', async ({ page }) => {
    const ip = '10.0.0.243'
    await page.setViewportSize({ width: 1040, height: 670 })
    await gotoBypass(page, scenario('needRoute', {
      targets: [{ host: ip, input: ip, kind: 'ip', address: ip, verdict: 'needRoute' }],
      probe: { kind: 'ip', host: ip, address: ip, interfaceName: '0dcloud', source: '198.18.0.1', nextHop: '198.18.0.2', probeMs: 20, httpStatus: null },
    }))
    await cardBtn(page, ip, '重新探测')
    const dialog = page.getByRole('dialog', { name: '探测结论' })
    await expect(dialog.locator('.concl-title')).toHaveText('当前连接仍经过代理')
    await expect(dialog.locator('.concl-summary')).toContainText('目标可连接，出口仍由')
    await expect(dialog.locator('.concl-next')).toContainText('将目标设为直连（DIRECT）')
    await expect(dialog.locator('.concl-facts')).toBeHidden()
    await dialog.screenshot({ path: '.tmp/bypass-next-step.png' })
    await dialog.locator('.concl-technical summary').click()
    await expect(dialog.locator('.concl-facts div', { hasText: '系统解析' })).toHaveCount(0)
    await expect(dialog.locator('.concl-facts div', { hasText: 'hosts 记录' })).toHaveCount(0)
    await expect(dialog.locator('.concl-facts div', { hasText: '出口路由' })).toContainText('0dcloud（代理接口）')
    await dialog.getByRole('button', { name: '配置直连', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '配置确认' })).toContainText(ip)
    expect(await e2e.count(page, 'bypass_apply')).toBe(0)
    expect(await e2e.count(page, 'bypass_recheck')).toBe(1)
  })

  test('从结论进入批量配置前明确告知目标数量', async ({ page }) => {
    await gotoBypass(page, scenario('needRoute', {
      targets: [{ host: 'one.example.com', verdict: 'needRoute' }, { host: 'two.example.com', verdict: 'needRoute' }],
    }))
    await cardBtn(page, 'one.example.com', '重新探测')
    const dialog = page.getByRole('dialog', { name: '探测结论' })
    await expect(dialog.locator('.concl-scope')).toContainText('2 项待配置目标')
    await dialog.getByRole('button', { name: '配置直连 2', exact: true }).click()
    const plan = page.getByRole('dialog', { name: '配置确认' })
    await expect(plan).toContainText('one.example.com')
    await expect(plan).toContainText('two.example.com')
    expect(await e2e.count(page, 'bypass_apply')).toBe(0)
  })

  test('已直连：不给写入建议，也不出现在推荐位', async ({ page }) => {
    await gotoBypass(page, scenario('directOk', { probe: { pinned: null } }))
    await probe(page)
    await expect(page.locator('.concl-head .ok')).toHaveCount(1)
    await expect(page.locator('.concl-title')).toHaveText('直连已可用')
    await expect(page.locator('.concl-detail')).toContainText('无需新增 hosts 或路由配置')
    await expect(page.locator('.concl-detail')).not.toContainText('已固定')
    await expect(page.locator('.concl-facts div', { hasText: '出口路由' }).locator('dd')).toHaveText(
      '以太网 · 源地址 192.168.1.23 · 网关 192.168.1.1',
    )
    await expect(page.locator('.concl-pending')).toHaveCount(0)
  })

  test('过期结果不能保存或静默重探，保留输入供显式重试', async ({ page }) => {
    const startedAt = new Date('2026-10-13T08:00:00Z')
    await page.clock.install({ time: startedAt })
    await gotoBypass(page, scenario('hostsOnly'))
    await probe(page)
    await page.clock.setSystemTime(new Date(startedAt.getTime() + 11 * 60 * 1000))
    await record(page)
    await expectToast(page, '探测结果已过期或不存在，请重新探测')
    await expect(rows(page)).toHaveCount(0)
    expect(await e2e.count(page, 'bypass_probe')).toBe(1)
    await page.locator('.concl-dialog .dialog-close').click()
    await expect(page.locator('.probe-box input')).toHaveValue(DOMAIN)
    await page.locator('.page-bar .btn-primary').click()
    await expect(page.locator('.concl-dialog')).toBeVisible()
    await record(page)
    await expectToast(page, '已加入清单')
    expect(await e2e.count(page, 'bypass_probe')).toBe(2)
  })

  test('网段结论说明无需 DNS 和 hosts，不将未探测的服务描述成已连接', async ({ page }) => {
    await gotoBypass(page, scenario('directOk', { probe: { kind: 'cidr', host: '10.20.0.0/16' } }))
    await probe(page, '10.20.0.0/16')
    const facts = page.locator('.concl-facts')
    await expect(facts.locator('div', { hasText: '系统解析' })).toHaveCount(0)
    await expect(facts.locator('div', { hasText: '实际地址' })).toContainText('10.20.0.0/16')
    await expect(facts.locator('div', { hasText: 'hosts 记录' })).toHaveCount(0)
    await expect(facts.locator('div', { hasText: '连通性' })).toContainText('未检查网段内的具体服务')
  })

  test('不可达：先劝住，出口与连通性留空，加入位不给点', async ({ page }) => {
    await gotoBypass(page, scenario('unreachable'))
    await probe(page)
    await expect(page.locator('.concl-head .bad')).toHaveCount(1)
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
    await expect(page.locator('.concl-head .warn')).toHaveCount(1)
    await expect(page.locator('.concl-title')).toHaveText('出口路由无法判定')
    await expect(page.locator('.concl-facts div', { hasText: '出口路由' }).locator('dd')).toHaveText('未查询到出口路由')
    await expect(page.locator('.concl-pending')).toHaveCount(0)
  })

  test('带 CDN 特征：即使能固定也不推荐，只留一句警告', async ({ page }) => {
    await gotoBypass(page, scenario('hostsOnly', { probe: { cdn: true } }))
    await probe(page)
    await expect(page.locator('.concl-facts div', { hasText: '实际地址' }).locator('dd')).toContainText(
      '地址可能变化',
    )
    await expect(page.locator('.concl-pending li')).toHaveCount(1)
    await expect(page.locator('.concl-pending li').first()).toContainText(
      '不建议固定；确需固定时，请定期重新探测并更新配置',
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
    await expect(rows(page)).toHaveCount(0)
  })

  test('卡面展开念的是存下来的结论，不再跑网络', async ({ page }) => {
    await gotoBypass(
      page,
      scenario('needRoute', {
        targets: [
          { host: 'internal.example.com', address: '172.30.2.109', interfaceName: 'vEthernet (TUN)' },
          { host: '10.20.0.0/16', kind: 'cidr', verdict: 'directOk', address: '10.20.3.7' },
        ],
      }),
    )
    // 一条要写系统的进「需要处理」，直连可用的那条收成 chip
    await expect(rows(page)).toHaveCount(2)
    await expect(card(page)).toHaveCount(1)
    await expect(chip(page, '10.20.0.0/16')).toBeVisible()
    await card(page, 'internal.example.com').locator('.card-main').click()
    const detail = page.locator('.row-card')
    await expect(detail).toBeVisible()
    await expect(detail.locator('.row-note')).toContainText('请使用清单上方的「配置直连」')
    expect(await e2e.count(page, 'bypass_recheck')).toBe(0)

    await cardBtn(page, 'internal.example.com', '重新探测')
    expect(await e2e.count(page, 'bypass_recheck')).toBe(1)
    // 新结论开弹窗，那张卡不许被收走
    await expect(page.locator('.concl-dialog')).toBeVisible()
    await expect(page.locator('.row-card')).toBeVisible()
    await expect(page.locator('.concl-dialog .concl-title')).toHaveText('当前连接仍经过代理')
    await page.keyboard.press('Escape')
    await expect(page.locator('.concl-dialog')).toHaveCount(0)
    // 同 host 重探覆盖回原行，清单不会长出第二条
    await expect(rows(page)).toHaveCount(2)
  })

  test('移出清单走卡上 ⋯，确认框取消不动数据', async ({ page }) => {
    await gotoBypass(
      page,
      scenario('needRoute', {
        targets: [
          { host: 'internal.example.com' },
          { host: 'other.example.com', verdict: 'directOk' },
        ],
      }),
    )
    await cardBtn(page, 'internal.example.com', '更多操作')
    await page.locator('.popover .pop-item', { hasText: '移出清单' }).click()
    const confirm = page.locator('.confirm-dialog')
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText('「internal.example.com」将从网络直连清单移除。')
    await confirm.locator('button', { hasText: '取消' }).click()
    expect(await e2e.count(page, 'bypass_delete')).toBe(0)
    await expect(rows(page)).toHaveCount(2)

    await cardBtn(page, 'internal.example.com', '更多操作')
    await page.locator('.popover .pop-item', { hasText: '移出清单' }).click()
    await page.locator('.confirm-dialog .dialog-footer button', { hasText: '确定' }).click()
    await expectToast(page, '已移出清单')
    expect(await e2e.count(page, 'bypass_delete')).toBe(1)
    await expect(rows(page)).toHaveCount(1)
  })

  test('改原文重新探测：按新写法覆盖这一行，展开档不重复行首动作', async ({ page }) => {
    await gotoBypass(
      page,
      scenario('hostsOnly', {
        targets: [{ host: 'typo.example.con', input: 'typo.example.con', verdict: 'hostsOnly' }],
      }),
    )
    await card(page, 'typo.example.con').locator('.card-main').click()
    const detail = page.locator('.row-card')
    // 展开段只留「探测并保存修改」这一颗钮，重探仍归卡面管
    await expect(detail.locator('.action-btn')).toHaveCount(1)
    await expect(detail.locator('.action-btn')).toHaveText('探测并保存修改')
    await detail.locator('.row-edit input').fill('typo.example.com')
    await detail.locator('.row-edit .action-btn').click()
    expect(await e2e.count(page, 'bypass_edit')).toBe(1)
    await expect(page.locator('.concl-dialog')).toBeVisible()
    // 改写法是覆盖这一行，不是长出第二条
    await expect(rows(page)).toHaveCount(1)
    await expect(card(page, 'typo.example.com')).toBeVisible()
  })

  test('概览与筛选：条数说得出来，chip 区筛得动', async ({ page }) => {
    await gotoBypass(
      page,
      scenario('needRoute', {
        hosts: { managed: 2 },
        targets: [
          { host: 'gitlab.example.com' },
          { host: 'dead.example.com', verdict: 'unreachable', stale: true },
          { host: 'qa.example.com', verdict: 'directOk' },
          { host: 'api.example.com', verdict: 'directOk' },
        ],
      }),
    )
    await expect(page.locator('.hero .sub')).toContainText('hosts 管理记录 2 条')
    await expect(page.locator('.titlebar-count')).toHaveText('4 项')
    await expect(page.locator('.hero .n')).toHaveText('2')
    await expect(page.locator('.hero .of')).toHaveText('/ 4 直连可用')
    await expect(page.locator('.hero .btn-primary', { hasText: '配置直连' })).toHaveText('配置直连 1')
    await expect(secHead(page, '需要处理')).toContainText('2 项')
    await expect(chip(page)).toHaveCount(2)
    await expect(card(page, 'dead.example.com').locator('.badge')).toHaveText(['目标不可达', '固定地址不可用'])

    // 筛选只收 chip 那一排，异常卡常驻
    await page.locator('.bp-filter input').fill('qa')
    await expect(page.locator('.bp-filter input')).toHaveCSS('border-top-width', '0px')
    await expect(page.locator('.bp-filter input')).toHaveCSS('box-shadow', 'none')
    await expect(page.locator('.bp-filter')).not.toHaveCSS('box-shadow', 'none')
    await expect(chip(page)).toHaveCount(1)
    await expect(chip(page, 'qa.example.com')).toBeVisible()
    await expect(secHead(page, '直连可用')).toContainText('1 / 2 项')
    await expect(card(page)).toHaveCount(2)

    await page.locator('.bp-filter input').fill('nothing')
    await expect(chip(page)).toHaveCount(0)
    await expect(page.locator('.bp-nohit')).toContainText('没有与「nothing」匹配的目标')
    await expect(card(page)).toHaveCount(2)
  })

  test('托管区读不出来：概览那行改口并给出原因', async ({ page }) => {
    await gotoBypass(page, scenario('needRoute', { hosts: { error: 'hosts 中的直连管理区标记不完整' } }))
    await expect(page.locator('.hero .sub')).toContainText('无法读取本功能管理的 hosts 记录')
    await expect(page.locator('.hero .sub')).toContainText('hosts 中的直连管理区标记不完整')
    await expect(page.locator('.hero .sub')).toHaveClass(/bad/)
  })

  test('页栏只有一个动作：没有导入入口', async ({ page }) => {
    await gotoBypass(page)
    await expect(page.locator('.page-bar .btn-secondary')).toHaveCount(0)
    await expect(page.locator('.page-bar .btn-primary')).toHaveCount(1)
  })

  /* ---------- P2：写入链路。清单里挂着待写入项才有那颗钮 ---------- */
  const PENDING: NonNullable<E2EConfig['bypass']>['targets'] = [
    {
      host: 'xtbg.example.com',
      input: 'xtbg.example.com',
      kind: 'domain',
      address: '172.30.2.109',
      verdict: 'hostsOnly',
      interfaceName: 'vEthernet (TUN)',
      nextHop: '26.0.48.1',
    },
    {
      host: '172.33.0.0/16',
      input: '172.33.0.0/16',
      kind: 'cidr',
      verdict: 'needRoute',
      interfaceName: 'vEthernet (TUN)',
      nextHop: '26.0.48.1',
    },
  ]

  async function gotoPending(
    page: Page,
    apply: NonNullable<E2EConfig['bypass']>['apply'] = {},
    recheckDelayMs = 0,
  ) {
    await bootUnlocked(page, {
      ...ROOT,
      bypass: { verdict: 'needRoute', targets: PENDING, apply, recheckDelayMs },
    })
    await page.locator('a.nav-item[href="/bypass"]').click()
    await expect(rows(page)).toHaveCount(2)
  }

  const writeBtn = (page: Page) => page.locator('.hero .btn-primary', { hasText: '配置直连' })

  test('清单空时不给写入入口，有待写入项才出', async ({ page }) => {
    await gotoBypass(page)
    await expect(writeBtn(page)).toHaveCount(0)
    await gotoPending(page)
    await expect(writeBtn(page)).toHaveText('配置直连 2')
  })

  test('确认弹窗逐条念要动什么，全批干净落盘只给一行 toast', async ({ page }) => {
    await gotoPending(page)
    await writeBtn(page).click()
    const dialog = page.locator('.dialog', { hasText: '确认直连配置' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.lead')).toContainText('将为 2 个目标更新 hosts 或持久路由')
    await expect(dialog.locator('.plan-host')).toHaveText(['xtbg.example.com', '172.33.0.0/16'])
    await expect(dialog.locator('.plan-action').first()).toHaveText('hosts 固定 xtbg.example.com → 172.30.2.109')
    await expect(dialog.locator('.plan-action').nth(1)).toHaveText('持久路由 绑 26.0.48.1（接口 vEthernet (TUN)）')
    await expect(dialog.locator('.footer-hints')).toContainText('Windows 管理员授权')

    await dialog.locator('.btn-primary').click()
    await expect(dialog).toHaveCount(0)
    await expectToast(page, '已配置 2 项')
    expect(await e2e.count(page, 'bypass_apply')).toBe(1)
    // 写过的行从「需要处理」摘出去，不然那个数字永远降不下来
    await expect(secHead(page, '需要处理')).toHaveCount(0)
    await expect(writeBtn(page)).toHaveCount(0)
    await expect(page.locator('.hero .n')).toHaveText('2')
    await expect(chip(page)).toHaveCount(2)
  })

  test('UAC 上按取消不算失败：账与批次都不动', async ({ page }) => {
    await gotoPending(page, { cancel: true })
    await writeBtn(page).click()
    await page.locator('.dialog', { hasText: '确认直连配置' }).locator('.btn-primary').click()
    await expectToast(page, '已取消授权')
    await expect(writeBtn(page)).toHaveText('配置直连 2')
    await expect(secHead(page, '需要处理')).toContainText('2 项')
    await expect(chip(page)).toHaveCount(0)
  })

  test('判不出出口的那条不进批次：确认弹窗就地说明原因', async ({ page }) => {
    await gotoPending(page, { blocked: ['172.33.0.0/16'] })
    await writeBtn(page).click()
    const dialog = page.locator('.dialog', { hasText: '确认直连配置' })
    await expect(dialog.locator('.lead')).toContainText('将为 1 个目标更新 hosts 或持久路由')
    await expect(dialog.locator('.plan-blocked')).toHaveText('1 项暂不配置')
    await expect(dialog.locator('.plan-list li.blocked .plan-action')).toContainText(
      '未找到通往',
    )
  })

  test('有一条写不进：结果弹窗交逐条账，回滚干净了就不留批次', async ({ page }) => {
    await gotoPending(page, { failed: ['172.33.0.0/16'] })
    await writeBtn(page).click()
    await page.locator('.dialog', { hasText: '确认直连配置' }).locator('.btn-primary').click()
    const result = page.locator('.dialog', { hasText: '配置结果' })
    await expect(result).toBeVisible()
    await expect(result.locator('.lead')).toHaveText('成功 1 · 无需更改 0 · 失败 1（按操作计）')
    await expect(result).toContainText('本次更改已撤销')
    await expect(result).toContainText('路由添加命令已执行，但路由表里查不到该条')
    // 回滚成了就不能再念「已配置」，否则弹窗上下两段自己打起来
    await expect(result.locator('.plan-action')).toHaveText([
      'hosts 固定 · 已撤销',
      '系统路由 · 路由添加命令已执行，但路由表里查不到该条',
    ])
    // 系统已经退回没写过的样子，就没有可撤销的批次——留个按钮等于骗人再提一次权
    await expect(result.locator('.btn-secondary', { hasText: '撤销本次配置' })).toHaveCount(0)
    await expect(writeBtn(page)).toHaveText('配置直连 2')
    // 落盘后的复验按场景重判了判定：xtbg 这条改念路由
    await expect(card(page, 'xtbg.example.com').locator('.badge')).toHaveText(['需配置路由', '需检查'])
    await result.locator('.btn-primary', { hasText: '完成' }).click()
    await expect(chip(page)).toHaveCount(0)
    await expect(page.locator('.badge', { hasText: '已配置' })).toHaveCount(0)

    // 批次没留下：概览的 ⋯ 里也不该有撤销那一项
    await openHeroMenu(page)
    await expect(page.locator('.popover .pop-item', { hasText: '撤销上次配置' })).toHaveCount(0)
    await expect(page.locator('.popover .pop-item', { hasText: '复制直连清单' })).toHaveCount(1)
    await page.keyboard.press('Escape')
  })

  test('回滚自己没成：批次留着，撤销本次配置退回未写入', async ({ page }) => {
    await gotoPending(page, { failed: ['172.33.0.0/16'], rollbackFail: true })
    await writeBtn(page).click()
    await page.locator('.dialog', { hasText: '确认直连配置' }).locator('.btn-primary').click()
    const result = page.locator('.dialog', { hasText: '配置结果' })
    await expect(result).toContainText('自动撤销未完成')
    await expect(result).toContainText('写入 hosts 失败')
    // 回滚没成 = 写进去的还在系统里，这几行就得念「已配置」，批次也留着
    await expect(result.locator('.plan-action').first()).toHaveText('hosts 固定 · 已配置')
    await result.locator('.btn-secondary', { hasText: '撤销本次配置' }).click()
    await expect(page.locator('.confirm-dialog')).toContainText('移除本次新增的持久路由')
    await page.locator('.confirm-dialog .dialog-footer button', { hasText: '确定' }).click()
    await expectToast(page, '已撤销上次配置')
    expect(await e2e.count(page, 'bypass_revert')).toBe(1)
    await expect(page.locator('.badge', { hasText: '已配置' })).toHaveCount(0)
    await expect(writeBtn(page)).toHaveText('配置直连 2')
  })

  test('无需更改的那条算跳过，不重复计成功', async ({ page }) => {
    await gotoPending(page, { skipped: ['172.33.0.0/16'] })
    await writeBtn(page).click()
    await page.locator('.dialog', { hasText: '确认直连配置' }).locator('.btn-primary').click()
    // 全批没报错，不值得拦弹窗——账目在 toast 里分得清
    await expectToast(page, '已配置 1 项，1 项无需更改')
    await expect(page.locator('.dialog', { hasText: '配置结果' })).toHaveCount(0)
  })

  test('提权进程没回传：整批按未知处理，不落「已配置」', async ({ page }) => {
    await gotoPending(page, { lost: 'x' })
    await writeBtn(page).click()
    await page.locator('.dialog', { hasText: '确认直连配置' }).locator('.btn-primary').click()
    await expectToast(page, '提权进程未回传结果')
    await expect(chip(page)).toHaveCount(0)
    await expect(page.locator('.badge', { hasText: '已配置' })).toHaveCount(0)
    await expect(writeBtn(page)).toHaveText('配置直连 2')
  })

  test('等待授权有独立界面态，写入期间页栏不再收别的动作', async ({ page }) => {
    await gotoPending(page, { delayMs: 400 })
    await writeBtn(page).click()
    await page.locator('.dialog', { hasText: '确认直连配置' }).locator('.btn-primary').click()
    await expect(page.locator('.hero .btn-primary', { hasText: '正在配置' })).toBeVisible()
    await expect(page.locator('.hero .btn-secondary', { hasText: '检查全部' })).toBeDisabled()
    await expect(page.locator('.probe-box input')).toBeDisabled()
    await expect(card(page).first().getByRole('button', { name: '重新探测' })).toBeDisabled()
    await expect(card(page).first().getByRole('button', { name: '更多操作' })).toBeDisabled()
    await expectToast(page, '已配置')
  })

  test('概览 ⋯ 复制完整清单，写入后也可同步代理并撤销', async ({ page }) => {
    await gotoPending(page)
    await openHeroMenu(page)
    await expect(page.locator('.popover .pop-item', { hasText: '撤销上次配置' })).toHaveCount(0)
    await page.locator('.popover .pop-item', { hasText: '复制直连清单' }).click()
    await expectToast(page, '已复制 2 条目标')
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied.replace(/\r\n/g, '\n').split('\n').sort()).toEqual(['172.33.0.0/16', 'xtbg.example.com'])

    await writeBtn(page).click()
    await page.locator('.dialog', { hasText: '确认直连配置' }).locator('.btn-primary').click()
    await expectToast(page, '已配置 2 项')

    await openHeroMenu(page)
    await page.locator('.popover .pop-item', { hasText: '复制直连清单' }).click()
    await expectToast(page, '已复制 2 条目标')
    await openHeroMenu(page)
    await page.locator('.popover .pop-item', { hasText: '撤销上次配置' }).click()
    await page.locator('.confirm-dialog .dialog-footer button', { hasText: '确定' }).click()
    await expectToast(page, '已撤销上次配置')
    await expect(writeBtn(page)).toHaveText('配置直连 2')
  })

  test('写过的收成 chip，详情弹窗念的是「已配置」', async ({ page }) => {
    await bootUnlocked(page, {
      ...ROOT,
      bypass: {
        verdict: 'needRoute',
        targets: [{ host: 'xtbg.example.com', address: '172.30.2.1', verdict: 'hostsOnly', applyState: 'applied', applyBatch: 'b1' }],
      },
    })
    await page.locator('a.nav-item[href="/bypass"]').click()
    // 已经落盘的不再占「需要处理」那张卡
    await expect(card(page)).toHaveCount(0)
    await chip(page, 'xtbg.example.com').click()
    const dialog = page.locator('.detail-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.row-note').first()).toHaveText('hosts 或系统路由已配置。')
    await expect(dialog.locator('.detail-head .badge')).toHaveText(['需配置 hosts', '已配置'])
    await expect(writeBtn(page)).toHaveCount(0)
  })

  test('CDN 轮换特征常驻卡面', async ({ page }) => {
    await bootUnlocked(page, {
      ...ROOT,
      bypass: {
        verdict: 'hostsOnly',
        targets: [{ host: 'cdn.example.com', address: '1.2.3.4', verdict: 'hostsOnly', cdnLike: true }],
      },
    })
    await page.locator('a.nav-item[href="/bypass"]').click()
    await expect(card(page, 'cdn.example.com').locator('.badge')).toHaveText(['需配置 hosts', '地址可能变化'])
  })

  test('带 CDN 轮换的那条默认不进批次，同意固定当前 IP 后才写', async ({ page }) => {
    await bootUnlocked(page, {
      ...ROOT,
      bypass: {
        verdict: 'needRoute',
        targets: [
          { host: 'xtbg.example.com', input: 'xtbg.example.com', kind: 'domain', address: '172.30.2.109', verdict: 'hostsOnly', interfaceName: 'vEthernet (TUN)', nextHop: '26.0.48.1' },
          { host: 'cdn.example.com', input: 'cdn.example.com', kind: 'domain', address: '172.30.2.109', verdict: 'hostsOnly', cdnLike: true, interfaceName: 'vEthernet (TUN)', nextHop: '26.0.48.1' },
        ],
      },
    })
    await page.locator('a.nav-item[href="/bypass"]').click()
    await expect(rows(page)).toHaveCount(2)
    // 待写入照计两条（都还没落定），落盘批次只算能自动定的那一条
    await expect(writeBtn(page)).toHaveText('配置直连 2')

    await writeBtn(page).click()
    const dialog = page.locator('.dialog', { hasText: '确认直连配置' })
    await expect(dialog.locator('.lead')).toContainText('将为 1 个目标更新 hosts 或持久路由')
    await expect(dialog.locator('.plan-blocked')).toHaveText('1 项暂不配置')
    const cdnRow = dialog.locator('.plan-list li', { hasText: 'cdn.example.com' })
    await expect(cdnRow.locator('.plan-action')).toContainText('地址可能随 CDN 节点变化')

    await cdnRow.locator('.plan-cdn input').check()
    await expect(dialog.locator('.lead')).toContainText('将为 2 个目标更新 hosts 或持久路由')
    await expect(dialog.locator('.plan-blocked')).toHaveCount(0)
    await expect(cdnRow.locator('.plan-action')).toHaveText('hosts 固定 cdn.example.com → 172.30.2.109')
    await dialog.locator('.btn-primary').click()
    await expectToast(page, '已配置 2 项')
  })

  test('同意固定 CDN IP 仍没有直连出口时，展示处理指引并阻止整条配置', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 760 })
    await gotoBypass(page, scenario('needRoute', {
      targets: [{ host: 'cdn.example.com', address: '10.20.0.1', verdict: 'needRoute', cdnLike: true }],
      apply: { blocked: ['cdn.example.com'] },
    }))
    await writeBtn(page).click()
    const dialog = page.getByRole('dialog', { name: '配置确认' })
    const consent = dialog.getByRole('checkbox', { name: '同意固定当前 IP' })
    await expect(consent).toHaveAccessibleName('同意固定当前 IP（10.20.0.1）')
    await expect(dialog.getByRole('region', { name: '直连出口处理指引' })).toHaveCount(0)
    await consent.check()
    await expect(dialog.locator('.plan-action')).toContainText('10.20.0.1/32')
    const help = dialog.getByRole('region', { name: '直连出口处理指引' })
    await expect(help).toBeVisible()
    for (const text of ['未找到可用出口', 'Win + R', 'ncpa.cpl', '内网 VPN', '代理客户端', 'DIRECT', '检查全部', '配置直连']) {
      await expect(help).toContainText(text)
    }
    await expect(consent).toBeChecked()
    await expect(dialog.locator('.lead')).toContainText('暂无可配置的目标')
    await expect(dialog.getByRole('button', { name: '确认并配置' })).toBeDisabled()
    expect(await e2e.count(page, 'bypass_apply')).toBe(0)
    const state = await e2e.snapshot(page)
    expect(state.bypass.targets[0].applyState).toBe('none')
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await consent.uncheck()
    await expect(help).toHaveCount(0)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(revalidateBtn(page)).toBeVisible()
  })

  test('公网沿用默认网关，内网选择 VPN 后两项目标均可确认配置', async ({ page }) => {
    const lan = { interfaceIndex: 8, interfaceAlias: '以太网', gateway: '172.33.122.254', gatewayIsOnLink: false }
    const vpn = { interfaceIndex: 16, interfaceAlias: '本地连接', gateway: '26.0.48.1', gatewayIsOnLink: false }
    await gotoBypass(page, scenario('needRoute', {
      targets: [
        { host: '10.0.0.243/32', kind: 'cidr', verdict: 'needRoute' },
        { host: 'registry.npmmirror.com', address: '125.39.27.223', verdict: 'needRoute', cdnLike: true, interfaceName: '以太网', nextHop: '172.33.122.254' },
      ],
      apply: { blocked: ['10.0.0.243/32'], routeOptions: { '10.0.0.243/32': [lan, vpn], 'registry.npmmirror.com': [lan] } },
    }))
    await writeBtn(page).click()
    const dialog = page.getByRole('dialog', { name: '配置确认' })
    await expect(dialog.getByRole('button', { name: '确认并配置' })).toBeDisabled()
    const consent = dialog.getByRole('checkbox', { name: '同意固定当前 IP（125.39.27.223）' })
    await consent.check()
    await expect(dialog.locator('.lead')).toContainText('将为 1 个目标更新 hosts 或持久路由')
    await expect(dialog.locator('.plan-action').filter({ hasText: '持久路由 绑 172.33.122.254（接口 以太网）' })).toBeVisible()
    const privateTarget = dialog.locator('.plan-list li', { hasText: '10.0.0.243/32' })
    await expect(privateTarget.getByRole('combobox', { name: '直连出口' })).toBeVisible()
    await privateTarget.getByRole('combobox', { name: '直连出口' }).selectOption('16|26.0.48.1')
    await expect(dialog.locator('.lead')).toContainText('将为 2 个目标更新 hosts 或持久路由')
    await expect(privateTarget.locator('.plan-action')).toHaveText('持久路由 绑 26.0.48.1（接口 本地连接）')
    await expect(consent).toBeChecked()
    await expect(dialog.locator('.plan-blocked')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '确认并配置' })).toBeEnabled()
    await dialog.getByRole('button', { name: '确认并配置' }).click()
    await expectToast(page, '已配置 2 项')
    expect(await e2e.count(page, 'bypass_apply')).toBe(1)
    const state = await e2e.snapshot(page)
    expect(state.bypass.targets.every((t: any) => t.applyState === 'applied')).toBe(true)
  })

  // 用稳定的可访问名称定位，进度变化时仍能停止重验。
  const revalidateBtn = (page: Page) => page.locator('.hero .btn-secondary').filter({ hasText: /检查全部|停止检查/ })

  test('检查全部逐条串行，进度数得出来', async ({ page }) => {
    await gotoPending(page, {}, 250)
    const all = page.locator('.hero .btn-secondary', { hasText: '检查全部' })
    await expect(all).toBeVisible()
    await all.click()
    // 逐条：进度按已探完的条目走，第一颗还在飞的时候是 0/2
    await expect(page.locator('.hero .btn-secondary', { hasText: '停止检查 0/2' })).toBeVisible()
    await expect(page.locator('.hero .btn-secondary', { hasText: '停止检查 1/2' })).toBeVisible()
    await expectToast(page, '检查完成')
    expect(await e2e.count(page, 'bypass_recheck')).toBe(2)
  })

  test('重验途中再点一次就是停：下一颗不再探', async ({ page }) => {
    await gotoPending(page, {}, 400)
    await revalidateBtn(page).click()
    await expect(page.locator('.hero .btn-secondary', { hasText: '停止检查 0/2' })).toBeVisible()
    await revalidateBtn(page).click()
    await expectToast(page, '已停止检查，完成 0/2 项')
    expect(await e2e.count(page, 'bypass_recheck')).toBe(1)
  })

  test('域名的路由被阻止时，hosts 也不写入', async ({ page }) => {
    await gotoBypass(page, scenario('needRoute', {
      targets: [{ host: 'blocked.example.com', address: '10.20.0.1', verdict: 'needRoute' },
        { host: 'ready.example.com', address: '10.20.0.2', verdict: 'hostsOnly' }],
      apply: { blocked: ['blocked.example.com'] },
    }))
    await writeBtn(page).click()
    const dialog = page.getByRole('dialog', { name: '配置确认' })
    await expect(dialog.locator('.lead')).toContainText('将为 1 个目标更新 hosts 或持久路由')
    await expect(dialog.getByRole('region', { name: '直连出口处理指引' })).toBeVisible()
    await expect(dialog.locator('.plan-list li', { hasText: 'blocked.example.com' })).not.toContainText('hosts 固定')
    await dialog.getByRole('button', { name: '确认并配置' }).click()
    await expectToast(page, '已配置 1 项')
    await expect(card(page, 'blocked.example.com').locator('.badge')).toHaveText(['需配置路由'])
    const state = await e2e.snapshot(page)
    expect(state.bypass.targets.find((t: any) => t.host === 'blocked.example.com').applyState).toBe('none')
    expect(await e2e.count(page, 'bypass_recheck')).toBe(1)
  })

  test('改成已登记的目标失败后，两条记录都完整保留', async ({ page }) => {
    await gotoBypass(page, scenario('hostsOnly', { targets: [{ host: 'first.example.com' }, { host: 'second.example.com' }] }))
    await card(page, 'first.example.com').locator('.card-main').click()
    await page.locator('.row-edit input').fill('second.example.com')
    await page.locator('.row-edit .action-btn').click()
    await expectToast(page, '该目标已在清单中')
    await expect(rows(page)).toHaveCount(2)
    await expect(card(page, 'first.example.com')).toBeVisible()
    await expect(card(page, 'second.example.com')).toBeVisible()
  })

  test('移除最后一条已配置记录后，仍能撤销系统配置', async ({ page }) => {
    await gotoBypass(page, scenario('hostsOnly', { targets: [{ host: 'single.example.com', address: '10.20.0.1', verdict: 'hostsOnly' }] }))
    await writeBtn(page).click()
    await page.getByRole('dialog', { name: '配置确认' }).getByRole('button', { name: '确认并配置' }).click()
    await expectToast(page, '已配置 1 项')
    // 写完又验通了的那条收进 chip：移出清单改在详情弹窗里做
    await expect(chip(page, 'single.example.com')).toBeVisible()
    await chip(page, 'single.example.com').click()
    await page.locator('.detail-dialog').getByRole('button', { name: '移出清单' }).click()
    await expect(page.locator('.confirm-dialog')).toContainText('已配置的 hosts 和路由会保留')
    await page.locator('.confirm-dialog .dialog-footer button', { hasText: '确定' }).click()
    await expect(rows(page)).toHaveCount(0)
    // 清单空了但批次还在：概览只留 ⋯，撤销入口不丢
    await expect(page.locator('.hero')).toBeVisible()
    await expect(writeBtn(page)).toHaveCount(0)
    await openHeroMenu(page)
    await expect(page.locator('.popover .pop-item', { hasText: '复制直连清单' })).toHaveCount(0)
    await page.locator('.popover .pop-item', { hasText: '撤销上次配置' }).click()
    await page.locator('.confirm-dialog .dialog-footer button', { hasText: '确定' }).click()
    await expectToast(page, '已撤销上次配置')
    await expect(page.locator('.hero')).toHaveCount(0)
  })

  test('撤销失败保留批次和重试入口', async ({ page }) => {
    await gotoBypass(page, scenario('hostsOnly', { targets: [{ host: 'single.example.com', address: '10.20.0.1', verdict: 'hostsOnly' }], revertFail: '删除路由失败' }))
    await writeBtn(page).click()
    await page.getByRole('dialog', { name: '配置确认' }).getByRole('button', { name: '确认并配置' }).click()
    await expectToast(page, '已配置 1 项')
    await openHeroMenu(page)
    await page.locator('.popover .pop-item', { hasText: '撤销上次配置' }).click()
    await page.locator('.confirm-dialog .dialog-footer button', { hasText: '确定' }).click()
    await expectToast(page, '撤销未完成：删除路由失败')
    await openHeroMenu(page)
    await expect(page.locator('.popover .pop-item', { hasText: '撤销上次配置' })).toBeEnabled()
    expect((await e2e.snapshot(page)).bypass.targets[0].applyBatch).not.toBe('')
  })

  test('写入回执成功但复验不可达时，提示异常并保持失败状态', async ({ page }) => {
    await gotoBypass(page, scenario('hostsOnly', { targets: [{ host: 'single.example.com', address: '10.20.0.1', verdict: 'hostsOnly' }], recheckVerdict: 'unreachable' }))
    await writeBtn(page).click()
    await page.getByRole('dialog', { name: '配置确认' }).getByRole('button', { name: '确认并配置' }).click()
    await expectToast(page, '1 项尚未确认直连')
    await expect(card(page, 'single.example.com').locator('.badge')).toHaveText(['目标不可达', '需检查'])
    await cardBtn(page, 'single.example.com', '重新探测')
    await expect(page.getByRole('dialog', { name: '探测结论' })).toBeVisible()
    await expect(page.locator('.badge', { hasText: '需检查' })).toHaveCount(1)
  })

  test('取消 CDN 固定方案后，再打开需重新勾选', async ({ page }) => {
    await gotoBypass(page, scenario('hostsOnly', { targets: [{ host: 'cdn.example.com', address: '10.20.0.1', verdict: 'hostsOnly', cdnLike: true }] }))
    await writeBtn(page).click()
    let dialog = page.getByRole('dialog', { name: '配置确认' })
    await expect(dialog.getByRole('button', { name: '确认并配置' })).toBeDisabled()
    await dialog.locator('.plan-cdn input').check()
    await expect(dialog.getByRole('button', { name: '确认并配置' })).toBeEnabled()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await writeBtn(page).click()
    dialog = page.getByRole('dialog', { name: '配置确认' })
    await expect(dialog.locator('.plan-cdn input')).not.toBeChecked()
    await expect(dialog.getByRole('button', { name: '确认并配置' })).toBeDisabled()
  })

  test('探测过程中可以取消，目标保留且没有结论或新增记录', async ({ page }) => {
    await gotoBypass(page, scenario('hostsOnly', { probeDelayMs: 2000 }))
    await page.getByRole('textbox', { name: '待探测目标' }).fill(DOMAIN)
    await page.getByRole('button', { name: '开始探测', exact: true }).click()
    await expect(page.locator('.bp-probe-progress')).toContainText(DOMAIN)
    await page.getByRole('button', { name: '取消探测', exact: true }).click()
    await expectToast(page, '已取消探测')
    await expect(page.getByRole('textbox', { name: '待探测目标' })).toBeEnabled()
    await expect(page.getByRole('textbox', { name: '待探测目标' })).toHaveValue(DOMAIN)
    await expect(page.locator('.bp-probe-progress')).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '探测结论' })).toHaveCount(0)
    expect(await e2e.count(page, 'bypass_cancel_probe')).toBe(1)
    expect(await e2e.count(page, 'bypass_save')).toBe(0)
    expect((await e2e.snapshot(page)).bypass.targets).toHaveLength(0)
  })

  test('输入框回车只发起一次探测，也能立即取消', async ({ page }) => {
    await gotoBypass(page, scenario('hostsOnly', { probeDelayMs: 2000 }))
    const input = page.getByRole('textbox', { name: '待探测目标' })
    await input.fill(DOMAIN)
    await input.press('Enter')
    await expect(page.getByRole('button', { name: '取消探测', exact: true })).toBeVisible()
    expect(await e2e.count(page, 'bypass_probe')).toBe(1)
    await page.getByRole('button', { name: '取消探测', exact: true }).click()
    await expectToast(page, '已取消探测')
    await expect(input).toBeEnabled()
  })

  test('取消后可以立即开始新的探测，不受旧任务影响', async ({ page }) => {
    await gotoBypass(page, scenario('hostsOnly', { probeDelayMs: 900 }))
    await page.getByRole('textbox', { name: '待探测目标' }).fill('old.example.com')
    await page.getByRole('button', { name: '开始探测', exact: true }).click()
    await page.getByRole('button', { name: '取消探测', exact: true }).click()
    await expectToast(page, '已取消探测')
    await page.getByRole('textbox', { name: '待探测目标' }).fill('new.example.com')
    await page.getByRole('button', { name: '开始探测', exact: true }).click()
    await expect(page.locator('.concl-target')).toContainText('new.example.com')
    await expect(page.locator('.concl-target')).not.toContainText('old.example.com')
    expect(await e2e.count(page, 'bypass_probe')).toBe(2)
  })

  test('取消行重探不修改已登记的记录', async ({ page }) => {
    await gotoBypass(page, scenario('needRoute', { targets: [{ host: 'stored.example.com', verdict: 'hostsOnly' }], recheckDelayMs: 2000 }))
    const before = (await e2e.snapshot(page)).bypass.targets
    await cardBtn(page, 'stored.example.com', '重新探测')
    await expect(page.locator('.bp-probe-progress')).toContainText('stored.example.com')
    await page.getByRole('button', { name: '取消探测', exact: true }).click()
    await expectToast(page, '已取消探测')
    await expect(page.getByRole('dialog', { name: '探测结论' })).toHaveCount(0)
    expect((await e2e.snapshot(page)).bypass.targets).toEqual(before)
  })

  test('修改目标的探测可以取消，旧记录和编辑草稿都保留', async ({ page }) => {
    await gotoBypass(page, scenario('hostsOnly', { targets: [{ host: 'stored.example.com' }], probeDelayMs: 2000 }))
    const before = (await e2e.snapshot(page)).bypass.targets
    await card(page).locator('.card-main').click()
    await page.getByRole('textbox', { name: '该条目的原始输入' }).fill('changed.example.com')
    await page.getByRole('button', { name: '探测并保存修改' }).click()
    await page.getByRole('button', { name: '取消探测', exact: true }).click()
    await expectToast(page, '已取消探测')
    await expect(page.getByRole('textbox', { name: '该条目的原始输入' })).toHaveValue('changed.example.com')
    await expect(page.getByRole('dialog', { name: '探测结论' })).toHaveCount(0)
    expect((await e2e.snapshot(page)).bypass.targets).toEqual(before)
  })

  test('探测区与清单分区，概览给总账，窄窗口仍能操作', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await gotoPending(page)
    await expect(page.getByRole('region', { name: '目标探测' }).getByRole('button', { name: '开始探测' })).toBeVisible()
    await expect(page.locator('.hero')).toBeVisible()
    await expect(page.locator('.hero .of')).toHaveText('/ 2 直连可用')
    await expect(page.locator('.hero .sub')).toContainText('出口：vEthernet (TUN) 1')
    await expect(page.locator('.hero .sub')).toContainText('按网段路由 1')
    await expect(secHead(page, '需要处理')).toContainText('2 项')
    await expect(secHead(page, '直连可用')).toHaveCount(0)
    await expect(card(page, 'xtbg.example.com').locator('.l2 .mono')).toHaveText('172.30.2.109')
    await expect(card(page, 'xtbg.example.com').locator('.l2')).toContainText('出口 vEthernet (TUN)')
    await expect(card(page, '172.33.0.0/16').locator('.l2')).toContainText('按网段路由，无需 DNS 解析')
    await expect(page.locator('.page-note')).toContainText('清单显示上次探测结果')

    await page.setViewportSize({ width: 900, height: 720 })
    for (const button of ['配置直连 2', '检查全部']) {
      const element = page.locator('.hero').getByRole('button', { name: button, exact: true })
      await expect(element).toBeVisible()
      const box = await element.boundingBox()
      expect(box!.x + box!.width).toBeLessThanOrEqual(900)
    }
    const moreBox = await page.locator('.hero-more').boundingBox()
    expect(moreBox!.x + moreBox!.width).toBeLessThanOrEqual(900)
  })
})
