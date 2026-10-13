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

    await expect(page.locator('.concl-head .badge')).toContainText('缺少路由')
    await expect(page.locator('.concl-title')).toHaveText('缺少绑定的路由')
    await expect(page.locator('.concl-detail')).toContainText('仅固定 hosts 不足，需添加绑定该接口的持久路由')
    await expect(page.locator('.concl-target')).toHaveText('internal.example.com:443/admin')
    await expect(page.locator('.concl-facts div', { hasText: '出口路由' }).locator('dd')).toContainText(
      'vEthernet (TUN)（接管方网卡）',
    )
    await expect(page.locator('.concl-pending li').first()).toContainText(
      '写入后仍需将该域名加入代理客户端的直连名单',
    )
    await expect(page.locator('.concl-pending li').last()).toContainText('加入清单后可在页栏一并写入')
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
    await expect(page.locator('.concl-head .badge')).toContainText('仅缺 DNS 固定')
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
    await expect(page.locator('.concl-head .badge')).toHaveClass(/ok/)
    await expect(page.locator('.concl-title')).toHaveText('直连已可用')
    await expect(page.locator('.concl-facts div', { hasText: '出口路由' }).locator('dd')).toHaveText(
      '以太网 · 源地址 192.168.1.23 · 网关 192.168.1.1',
    )
    await expect(page.locator('.concl-pending')).toHaveCount(0)
  })

  test('不可达：先劝住，出口与连通性留空，加入位不给点', async ({ page }) => {
    await gotoBypass(page, scenario('unreachable'))
    await probe(page)
    await expect(page.locator('.concl-head .badge')).toHaveClass(/bad/)
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
    await expect(page.locator('.concl-head .badge')).toHaveClass(/warn/)
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
    await expect(card.locator('.row-note')).toContainText('可在页栏「写入落盘批次」一并落盘')
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
    await expect(confirm).toContainText('「internal.example.com」将从直连清单移除。')
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

  test('小账与筛选：条数说得出来，名字筛得动', async ({ page }) => {    await gotoBypass(
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
    await expect(page.locator('.titlebar-count')).toHaveText('3 项')
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
    await expect(page.locator('.bp-row')).toHaveCount(2)
  }

  const writeBtn = (page: Page) => page.locator('.page-bar .btn-secondary', { hasText: '写入落盘批次' })

  test('清单空时不给写入入口，有待写入项才出', async ({ page }) => {
    await gotoBypass(page)
    await expect(writeBtn(page)).toHaveCount(0)
    await gotoPending(page)
    await expect(writeBtn(page)).toHaveText('写入落盘批次 2')
  })

  test('确认弹窗逐条念要动什么，全批干净落盘只给一行 toast', async ({ page }) => {
    await gotoPending(page)
    await writeBtn(page).click()
    const dialog = page.locator('.dialog', { hasText: '写入前确认' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.lead')).toContainText('本批写入 2 项')
    await expect(dialog.locator('.plan-host')).toHaveText(['xtbg.example.com', '172.33.0.0/16'])
    await expect(dialog.locator('.plan-action').first()).toHaveText('hosts 固定 xtbg.example.com → 172.30.2.109')
    await expect(dialog.locator('.plan-action').nth(1)).toHaveText('持久路由 绑 26.0.48.1（接口 vEthernet (TUN)）')
    await expect(dialog.locator('.footer-hints')).toContainText('需要管理员权限，将弹出一次系统确认')

    await dialog.locator('.btn-primary').click()
    await expect(dialog).toHaveCount(0)
    await expectToast(page, '写入完成 2 项')
    expect(await e2e.count(page, 'bypass_apply')).toBe(1)
    // 写过的行从小账与页栏摘出去，不然那个数字永远降不下来
    await expect(page.locator('.bp-status')).not.toContainText('待写入')
    await expect(writeBtn(page)).toHaveCount(0)
    await expect(page.locator('.row-written')).toHaveCount(2)
  })

  test('UAC 上按取消不算失败：账与批次都不动', async ({ page }) => {
    await gotoPending(page, { cancel: true })
    await writeBtn(page).click()
    await page.locator('.dialog', { hasText: '写入前确认' }).locator('.btn-primary').click()
    await expectToast(page, '已取消授权')
    await expect(page.locator('.bp-status')).toContainText('待写入 2 条')
    await expect(page.locator('.row-written')).toHaveCount(0)
    await expect(page.locator('.page-bar .btn-secondary', { hasText: '写入落盘批次' })).toBeVisible()
  })

  test('判不出出口的那条不进批次：确认弹窗就地说明原因', async ({ page }) => {
    await gotoPending(page, { blocked: ['172.33.0.0/16'] })
    await writeBtn(page).click()
    const dialog = page.locator('.dialog', { hasText: '写入前确认' })
    await expect(dialog.locator('.lead')).toContainText('本批写入 1 项')
    await expect(dialog.locator('.plan-blocked')).toHaveText('1 条不写入')
    await expect(dialog.locator('.plan-list li.blocked .plan-action')).toContainText(
      '路由表里没有可绑定的非接管接口',
    )
  })

  test('有一条写不进：结果弹窗交逐条账，回滚干净了就不留批次', async ({ page }) => {
    await gotoPending(page, { failed: ['172.33.0.0/16'] })
    await writeBtn(page).click()
    await page.locator('.dialog', { hasText: '写入前确认' }).locator('.btn-primary').click()
    const result = page.locator('.dialog', { hasText: '写入结果' })
    await expect(result).toBeVisible()
    await expect(result.locator('.lead')).toHaveText('成功 1 · 跳过 0 · 失败 1')
    await expect(result).toContainText('已回滚到写入前的状态')
    await expect(result).toContainText('路由添加命令已执行，但路由表里查不到该条')
    // 回滚成了就不能再念「已写入」，否则弹窗上下两段自己打起来
    await expect(result.locator('.plan-action')).toHaveText([
      'hosts 固定 · 已回滚',
      '系统路由 · 路由添加命令已执行，但路由表里查不到该条',
    ])
    // 系统已经退回没写过的样子，就没有可撤销的批次——留个按钮等于骗人再提一次权
    await expect(result.locator('.btn-secondary', { hasText: '撤销本批' })).toHaveCount(0)
    await expect(page.locator('.bp-status')).toContainText('待写入 2 条')
    await expect(page.locator('.bp-row', { hasText: 'xtbg.example.com' }).locator('.row-stale')).toHaveText('写入失败')
    await result.locator('.btn-primary', { hasText: '完成' }).click()
    await expect(page.locator('.row-written')).toHaveCount(0)

    await rowBtn(page, 'xtbg.example.com', '更多操作')
    await expect(page.locator('.popover .pop-item', { hasText: '撤销上次写入' })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  test('回滚自己没成：批次留着，撤销本批退回未写入', async ({ page }) => {
    await gotoPending(page, { failed: ['172.33.0.0/16'], rollbackFail: true })
    await writeBtn(page).click()
    await page.locator('.dialog', { hasText: '写入前确认' }).locator('.btn-primary').click()
    const result = page.locator('.dialog', { hasText: '写入结果' })
    await expect(result).toContainText('回滚未完成')
    await expect(result).toContainText('写入 hosts 失败')
    // 回滚没成 = 写进去的还在系统里，这几行就得念「已写入」，批次也留着
    await expect(result.locator('.plan-action').first()).toHaveText('hosts 固定 · 已写入')
    await result.locator('.btn-secondary', { hasText: '撤销本批' }).click()
    await expect(page.locator('.confirm-dialog')).toContainText('并删掉那一批加过的持久路由')
    await page.locator('.confirm-dialog .dialog-footer button', { hasText: '确定' }).click()
    await expectToast(page, '已撤销上次写入')
    expect(await e2e.count(page, 'bypass_revert')).toBe(1)
    await expect(page.locator('.row-written')).toHaveCount(0)
    await expect(page.locator('.bp-status')).toContainText('待写入 2 条')
  })

  test('原本已就位的那条算跳过，不重复计成功', async ({ page }) => {
    await gotoPending(page, { skipped: ['172.33.0.0/16'] })
    await writeBtn(page).click()
    await page.locator('.dialog', { hasText: '写入前确认' }).locator('.btn-primary').click()
    // 全批没报错，不值得拦弹窗——账目在 toast 里分得清
    await expectToast(page, '写入完成 1 项，1 项原本已就位')
    await expect(page.locator('.dialog', { hasText: '写入结果' })).toHaveCount(0)
  })

  test('提权进程没回传：整批按未知处理，不落「已写入」', async ({ page }) => {
    await gotoPending(page, { lost: 'x' })
    await writeBtn(page).click()
    await page.locator('.dialog', { hasText: '写入前确认' }).locator('.btn-primary').click()
    await expectToast(page, '提权进程未回传结果')
    await expect(page.locator('.row-written')).toHaveCount(0)
    await expect(page.locator('.bp-status')).toContainText('待写入 2 条')
  })

  test('等待授权有独立界面态，写入期间页栏不再收别的动作', async ({ page }) => {
    await gotoPending(page, { delayMs: 400 })
    await writeBtn(page).click()
    await page.locator('.dialog', { hasText: '写入前确认' }).locator('.btn-primary').click()
    await expect(page.locator('.page-bar .btn-secondary', { hasText: '等待授权' })).toBeVisible()
    await expect(page.locator('.page-bar .btn-secondary', { hasText: '全量重验' })).toBeDisabled()
    await expectToast(page, '写入完成')
  })

  test('⋯ 菜单：撤销上次写入只在有回滚点时在位，复制给的是待写入清单', async ({ page }) => {
    await gotoPending(page)
    await rowBtn(page, 'xtbg.example.com', '更多操作')
    await expect(page.locator('.popover .pop-item', { hasText: '撤销上次写入' })).toHaveCount(0)
    await page.locator('.popover .pop-item', { hasText: '复制待写入清单' }).click()
    await expectToast(page, '已复制 2 条目标')
    // Windows 剪贴板读回来是 CRLF；清单顺序由 updated_at 决定。
    // 这里要钉的是「给出去的是哪几条」，不是先后与换行符形状
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied.replace(/\r\n/g, '\n').split('\n').sort()).toEqual([
      '172.33.0.0/16',
      'xtbg.example.com',
    ])

    // 落过一批以后，撤销那一项才出现
    await writeBtn(page).click()
    await page.locator('.dialog', { hasText: '写入前确认' }).locator('.btn-primary').click()
    await expectToast(page, '写入完成 2 项')
    await rowBtn(page, 'xtbg.example.com', '更多操作')
    await expect(page.locator('.popover .pop-item', { hasText: '撤销上次写入' })).toBeVisible()
    await page.locator('.popover .pop-item', { hasText: '撤销上次写入' }).click()
    await page.locator('.confirm-dialog .dialog-footer button', { hasText: '确定' }).click()
    await expectToast(page, '已撤销上次写入')
    await expect(page.locator('.bp-status')).toContainText('待写入 2 条')
  })

  test('写过的行展开念的是「已写入」，不再念「需要写入」', async ({ page }) => {
    await bootUnlocked(page, {
      ...ROOT,
      bypass: {
        verdict: 'needRoute',
        targets: [{ host: 'xtbg.example.com', address: '172.30.2.1', verdict: 'hostsOnly', applyState: 'applied', applyBatch: 'b1' }],
      },
    })
    await page.locator('a.nav-item[href="/bypass"]').click()
    await page.locator('.bp-row', { hasText: 'xtbg.example.com' }).locator('.row-main').click()
    await expect(page.locator('.row-note')).toContainText('已写入 hosts 或系统路由')
    await expect(page.locator('.bp-status')).not.toContainText('待写入')
  })

  test('CDN 轮换特征常驻行上', async ({ page }) => {
    await bootUnlocked(page, {
      ...ROOT,
      bypass: {
        verdict: 'hostsOnly',
        targets: [{ host: 'cdn.example.com', address: '1.2.3.4', verdict: 'hostsOnly', cdnLike: true }],
      },
    })
    await page.locator('a.nav-item[href="/bypass"]').click()
    await expect(page.locator('.bp-row .row-meta')).toContainText('CDN 轮换')
  })

  test('带 CDN 轮换的那条默认不进批次，勾上「仍要固定」才写', async ({ page }) => {
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
    await expect(page.locator('.bp-row')).toHaveCount(2)
    // 待写入照计两条（都还没落定），落盘批次只算能自动定的那一条
    await expect(page.locator('.bp-status')).toContainText('待写入 2 条')
    await expect(writeBtn(page)).toHaveText('写入落盘批次 1')

    await writeBtn(page).click()
    const dialog = page.locator('.dialog', { hasText: '写入前确认' })
    await expect(dialog.locator('.lead')).toContainText('本批写入 1 项')
    await expect(dialog.locator('.plan-blocked')).toHaveText('1 条不写入')
    const cdnRow = dialog.locator('.plan-list li', { hasText: 'cdn.example.com' })
    await expect(cdnRow.locator('.plan-action')).toContainText('带 CDN 轮换特征')

    await cdnRow.locator('.plan-cdn input').check()
    await expect(dialog.locator('.lead')).toContainText('本批写入 2 项')
    await expect(dialog.locator('.plan-blocked')).toHaveCount(0)
    await expect(cdnRow.locator('.plan-action')).toHaveText('hosts 固定 cdn.example.com → 172.30.2.109')
    await dialog.locator('.btn-primary').click()
    await expectToast(page, '写入完成 2 项')
  })

  // 页栏两颗次级钮：[0] 写入落盘批次、[1] 全量重验。钮面文字边跑边变，点的时候按位次认
  const revalidateBtn = (page: Page) => page.locator('.page-bar .btn-secondary').nth(1)

  test('全量重验逐条串行，进度数得出来', async ({ page }) => {
    await gotoPending(page, {}, 250)
    const all = page.locator('.page-bar .btn-secondary', { hasText: '全量重验' })
    await expect(all).toBeVisible()
    await all.click()
    // 逐条：进度按已探完的条目走，第一颗还在飞的时候是 0/2
    await expect(page.locator('.page-bar .btn-secondary', { hasText: '重验 0/2' })).toBeVisible()
    await expect(page.locator('.page-bar .btn-secondary', { hasText: '重验 1/2' })).toBeVisible()
    await expectToast(page, '重验完成')
    expect(await e2e.count(page, 'bypass_recheck')).toBe(2)
  })

  test('重验途中再点一次就是停：下一颗不再探', async ({ page }) => {
    await gotoPending(page, {}, 400)
    await revalidateBtn(page).click()
    await expect(page.locator('.page-bar .btn-secondary', { hasText: '重验 0/2' })).toBeVisible()
    await revalidateBtn(page).click()
    await expect(page.locator('.page-bar .btn-secondary', { hasText: '正在停止' })).toBeVisible()
    await expectToast(page, '重验完成')
    expect(await e2e.count(page, 'bypass_recheck')).toBe(1)
  })
})
