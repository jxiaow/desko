import { test, expect, Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, openSettings, visiblePane } from '../helpers'

const ROOT = { settings: { tunnel_enabled: 'true' } }

/** 一条已登记、已指过来的服务：多数用例要从"准备已就绪"起步 */
const LIVE = { hostname: 'files.example.com', port: 8421, label: '局域网传输', preset: 'fileshare', routed: true }
const READY = { bound: true, installed: true, authorized: true, tunnelId: 'e2e-tunnel-0001', tunnelName: 'desko-a' }

async function gotoTunnel(page: Page, config = ROOT) {
  await bootUnlocked(page, config)
  await page.locator('a.nav-item[href="/tunnel"]').click()
  await expect(page.locator('.tn-card').first()).toBeVisible()
}

/** 状态机由 bound / alive / registered 三格组合出来，用例只喂这三格 */
function state(bound: boolean, alive: boolean, registered: boolean, extra = {}) {
  return { ...ROOT, tunnel: { bound, alive, registered, ...extra } }
}

/** 准备流走完后页面主角是服务列表，行按子域取 */
const svcRow = (page: Page, host: string) => page.locator('.tn-card.services .svc-row', { hasText: host })

async function openDetail(page: Page) {
  await page.locator('.tn-foot .foot-btn').click()
}

async function addService(page: Page, host: string, port: string, label = '') {
  await page.locator('.tn-card.services .head-btn').click()
  const dlg = page.locator('.tunnel-service-dialog')
  if (label) await dlg.locator('#tn-svc-name').fill(label)
  await dlg.locator('#tn-svc-host').fill(host)
  await dlg.locator('#tn-svc-port').fill(port)
  await dlg.locator('.dialog-footer .btn-primary').click()
}

test.describe('内网穿透', () => {
  test('开关默认关：没有侧栏入口，直达 /tunnel 被带回小记页', async ({ page }) => {
    await bootUnlocked(page, {}, '/tunnel')
    await expect(page).toHaveURL(/\/notes$/)
    await expect(page.locator('a.nav-item[href="/tunnel"]')).toHaveCount(0)
    expect(await e2e.count(page, 'tunnel_status')).toBe(0)
  })

  test('开关只开入口，不自动拉起隧道', async ({ page }) => {
    await bootUnlocked(page)
    await expect(page.locator('a.nav-item[href="/tunnel"]')).toHaveCount(0)
    const dialog = await openSettings(page, 'modules')
    await visiblePane(dialog)
      .locator('.setting-item', { hasText: '内网穿透' })
      .locator('.switch-slider')
      .click()
    await expectToast(page, '内网穿透已开启')
    expect(await e2e.count(page, 'tunnel_start')).toBe(0)
    await dialog.locator('.dialog-close').click()
    await expect(page.locator('a.nav-item[href="/tunnel"]')).toHaveCount(1)
    await page.locator('a.nav-item[href="/tunnel"]').click()
    await expect(page.locator('.page-bar .chip').first()).toContainText('已停止')
  })

  test('没登记服务：启动钮按不住，原因写在按钮上', async ({ page }) => {
    await gotoTunnel(page, state(true, false, false, { ...READY }))
    const btn = page.locator('.page-bar .btn-primary')
    await expect(btn).toBeDisabled()
    await expect(btn).toHaveAttribute('title', '还没有登记要挂出去的本地服务')
    expect(await e2e.count(page, 'tunnel_start')).toBe(0)
  })

  test('已绑定但未获取程序：启动被拒，原因落在程序上', async ({ page }) => {
    await gotoTunnel(page, state(true, false, false, { ...READY, installed: false, services: [LIVE] }))
    await page.locator('.page-bar .btn-primary').click()
    await expectToast(page, '穿透程序未获取')
    await expect(page.locator('.page-bar .chip').first()).toContainText('已停止')
  })

  test('启动与停止：状态、页脚 PID、按钮文案三处同步', async ({ page }) => {
    await gotoTunnel(page, state(true, false, false, { ...READY, installed: true, services: [LIVE] }))
    await page.locator('.page-bar .btn-primary').click()
    await expectToast(page, '隧道已连上 Cloudflare 边缘')
    await expect(page.locator('.page-bar .chip').first()).toContainText('已连上边缘')
    await expect(page.locator('.tn-foot')).toContainText('PID 424242')
    await expect(page.locator('.page-bar .btn-primary')).toHaveText('停止隧道')
    await page.locator('.page-bar .btn-primary').click()
    await expectToast(page, '隧道已停止')
    await expect(page.locator('.page-bar .chip').first()).toContainText('已停止')
    await expect(page.locator('.tn-foot')).toContainText('无进程')
  })

  test('进程活着但没连上边缘：单独一档「启动中」，不冒充运行中', async ({ page }) => {
    await gotoTunnel(page, state(true, true, false, { ...READY, installed: true, services: [LIVE] }))
    await expect(page.locator('.page-bar .chip').first()).toContainText('启动中')
    await openDetail(page)
    await expect(page.locator('.tn-note.chip-warn')).toContainText('进程在跑，尚未连上 Cloudflare 边缘')
  })

  test('获取程序：内容不符与网络失败各说各话', async ({ page }) => {
    await gotoTunnel(page, { ...ROOT, tunnel: { installed: false, fetchFail: 'content' } })
    await page.locator('.tn-card.setup .row-bin .row-btn').click()
    await expectToast(page, '产物校验不符')
    await expect(page.locator('.tn-card.setup .row-bin')).toContainText('按固定版本下载')

    await bootUnlocked(page, { ...ROOT, tunnel: { installed: false, fetchFail: 'network' } })
    await page.locator('a.nav-item[href="/tunnel"]').click()
    await page.locator('.tn-card.setup .row-bin .row-btn').click()
    await expectToast(page, '下载失败（网络）')
  })

  test('详情：已校验的程序给得出实际哈希', async ({ page }) => {
    await gotoTunnel(page, { ...ROOT, tunnel: { installed: true, authorized: true, sha: '86aee4017b26' } })
    await openDetail(page)
    await expect(page.locator('.tn-detail .tn-row', { hasText: 'SHA-256' })).toContainText('86aee4017b26')
  })

  test('程序未校验：页脚与详情都如实说未校验', async ({ page }) => {
    await gotoTunnel(page, { ...ROOT, tunnel: { installed: true, authorized: true, sha: 'deadbeef0000' } })
    await expect(page.locator('.tn-foot')).toContainText('未校验')
    await openDetail(page)
    await expect(page.locator('.tn-detail .tn-row', { hasText: 'SHA-256' })).toContainText('未校验')
  })

  test.describe('服务列表', () => {
    test('空态只有一行添加：登记一条就上一行', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: READY })
      await expect(page.locator('.tn-card.services .tn-add')).toBeVisible()

      await addService(page, 'Desk.Example.com', '9090', '文档站')
      await expectToast(page, '已记下')
      const row = svcRow(page, 'desk.example.com')
      await expect(row).toContainText('127.0.0.1:9090')
      await expect(row).toContainText('文档站')
      // 输入框里的大小写不是最终值：子域按小写落库，DNS 与配置都按它走
      const snap = await e2e.snapshot(page)
      expect(snap.tunnel.services[0].hostname).toBe('desk.example.com')
      expect(snap.tunnel.services[0].routed).toBe(false)
    })

    test('没应用的条数写在页栏与卡尾，「应用」逐条指过来', async ({ page }) => {
      await gotoTunnel(page, {
        ...ROOT,
        tunnel: { ...READY, services: [{ hostname: 'a.example.com', port: 3001 }, { hostname: 'b.example.com', port: 3002 }] },
      })
      await expect(page.locator('.page-bar .chip').nth(1)).toContainText('2 项服务 · 2 条未应用')
      await page.locator('.tn-card.services .foot-row .btn-primary').click()
      await expectToast(page, '已就绪')
      await expect(page.locator('.page-bar .chip').nth(1)).toContainText('2 项服务')
      const snap = await e2e.snapshot(page)
      expect(snap.tunnel.services.every((s: { routed: boolean }) => s.routed)).toBe(true)
    })

    test('换端口或换子域后回到未应用：旧记录不能替新指向作证', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { ...READY, services: [LIVE] } })
      await svcRow(page, 'files.example.com').locator('.acts .action-btn').nth(1).click()
      await page.locator('.popover .pop-item', { hasText: '改公网设置' }).click()
      const dlg = page.locator('.tunnel-service-dialog')
      await dlg.locator('#tn-svc-port').fill('8500')
      await dlg.locator('.dialog-footer .btn-primary').click()
      await expect(svcRow(page, 'files.example.com')).toContainText('子域没指过来')
      expect(await e2e.count(page, 'tunnel_update_service')).toBe(1)
      // 只改基础字段不该碰到公网策略：口令与只读位各是各的命令
      expect(await e2e.count(page, 'tunnel_set_service_policy')).toBe(0)
    })

    test('公网设置：口令没设过时只翻开关被拒，补上口令同窗生效', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { ...READY, services: [LIVE] } })
      // 新建即「无口令」：行上必须把这个缺口说出来
      await expect(svcRow(page, 'files.example.com')).toContainText('公网没设口令')

      const openDialog = async () => {
        await svcRow(page, 'files.example.com').locator('.acts .action-btn').nth(1).click()
        await page.locator('.popover .pop-item', { hasText: '改公网设置' }).click()
      }
      const dlg = page.locator('.tunnel-service-dialog')
      await openDialog()
      await dlg.locator('.seg button', { hasText: '放开上传' }).click()
      await dlg.locator('.dialog-footer .btn-primary').click()
      await expectToast(page, '公网侧必须有口令')
      // 被拒后弹窗留人：口令就在下一格，填了就能同窗补上
      await expect(dlg).toBeVisible()
      await dlg.locator('#tn-svc-pw').fill('tr0ubador-9')
      await dlg.locator('.dialog-footer .btn-primary').click()
      await expectToast(page, '已记下')
      await expect(dlg).toHaveCount(0)
      let snap = await e2e.snapshot(page)
      expect(snap.tunnel.services[0].hasPassword).toBe(true)
      expect(snap.tunnel.services[0].readOnly).toBe(false)
      await expect(svcRow(page, 'files.example.com')).toContainText('公网可上传')

      // 只翻开关不填口令：开关落新值，口令保持原样
      await openDialog()
      await expect(dlg.locator('#tn-svc-pw')).toHaveValue('')
      await expect(dlg.locator('.seg button.on')).toHaveText('放开上传')
      await dlg.locator('.seg button', { hasText: '只读' }).click()
      await dlg.locator('.dialog-footer .btn-primary').click()
      snap = await e2e.snapshot(page)
      expect(snap.tunnel.services[0].readOnly).toBe(true)
      expect(snap.tunnel.services[0].hasPassword).toBe(true)
    })

    test('目标端口没在听：行上标事实，不假装通', async ({ page }) => {
      await gotoTunnel(page, {
        ...ROOT,
        tunnel: { ...READY, services: [{ ...LIVE, listening: false }] },
      })
      await expect(svcRow(page, 'files.example.com')).toContainText('目标端口没在听')
      await expect(page.locator('.tn-card.services .foot-row')).toContainText('1 条的目标端口此刻没在听')
    })

    test('子域撞车：第二次登记被拒并说清撞在哪', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { ...READY, services: [LIVE] } })
      await addService(page, 'files.example.com', '9099')
      await expectToast(page, '已经挂在')
      const snap = await e2e.snapshot(page)
      expect(snap.tunnel.services).toHaveLength(1)
    })

    test('端口不合法时保存按不住，不让它走到远端', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: READY })
      await page.locator('.tn-card.services .head-btn').click()
      const dlg = page.locator('.tunnel-service-dialog')
      await dlg.locator('#tn-svc-host').fill('a.example.com')
      const save = dlg.locator('.dialog-footer .btn-primary')
      await expect(save).toBeDisabled()
      await dlg.locator('#tn-svc-port').fill('99999')
      await expect(save).toBeDisabled()
      await dlg.locator('#tn-svc-port').fill('8421')
      await expect(save).toBeEnabled()
      expect(await e2e.count(page, 'tunnel_add_service')).toBe(0)
    })

    test('第三方那一条写清 desko 不在请求链路上', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: READY })
      await page.locator('.tn-card.services .head-btn').click()
      const dlg = page.locator('.tunnel-service-dialog')
      await expect(dlg.locator('.plain-note')).toContainText('由那台服务自己判断')
      await dlg.locator('.seg button', { hasText: '局域网传输' }).click()
      await expect(dlg.locator('.plain-note')).toHaveCount(0)
      await expect(dlg.locator('.port-line .port-btn')).toBeVisible()
    })

    test('应用失败：透出程序原话，已成的那条保留', async ({ page }) => {
      await gotoTunnel(page, {
        ...ROOT,
        tunnel: { ...READY, services: [LIVE, { hostname: 'dbg.example.com', port: 9229 }], applyFail: 'zone not found' },
      })
      await page.locator('.tn-card.services .foot-row .btn-primary').click()
      await expectToast(page, 'dbg.example.com 没能指到这条隧道')
      const snap = await e2e.snapshot(page)
      expect(snap.tunnel.services.find((s: { hostname: string }) => s.hostname === 'files.example.com').routed).toBe(true)
      expect(snap.tunnel.services.find((s: { hostname: string }) => s.hostname === 'dbg.example.com').routed).toBe(false)
    })

    test('删除说的是本机这一条，DNS 记录留在云上', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { ...READY, services: [LIVE] } })
      await svcRow(page, 'files.example.com').locator('.acts .action-btn').nth(1).click()
      await page.locator('.popover .pop-item', { hasText: '移除这条' }).click()
      await expect(page.locator('.confirm-dialog .dialog-body')).toContainText('那条 DNS 记录还在 Cloudflare 上')
      await page.locator('.confirm-dialog .btn-danger').click()
      await expectToast(page, '已移除')
      await expect(page.locator('.tn-card.services .svc-row')).toHaveCount(0)
    })

    test('行上没有起停开关：单条 hostname 拔不掉', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { ...READY, services: [LIVE] } })
      await expect(svcRow(page, 'files.example.com').locator('.switch, .toggle-btn, input[type=checkbox]')).toHaveCount(0)
    })

    test('复制的是 https 地址', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { ...READY, services: [LIVE] } })
      await svcRow(page, 'files.example.com').locator('.acts .action-btn').first().click()
      await expectToast(page, '已复制 https://files.example.com')
    })
  })

  test.describe('接入准备', () => {
    const row = (page: Page, name: 'bin' | 'auth' | 'tunnel') =>
      page.locator(`.tn-card.setup .row-${name}`)

    test('未授权：新建隧道按不住，原因写在按钮上而不是丢一句失败', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { installed: true, authorized: false } })
      await expect(row(page, 'auth')).toContainText('在浏览器里登录 Cloudflare')
      const create = row(page, 'tunnel').locator('.row-btn')
      await expect(create).toHaveCount(0)
      expect(await e2e.count(page, 'tunnel_ensure_tunnel')).toBe(0)
    })

    test('未授权：授权行没有撤销入口', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { installed: true, authorized: false } })
      await expect(row(page, 'auth').locator('.row-btn', { hasText: '撤销本机授权' })).toHaveCount(0)
    })

    test('已授权：撤销入口把状态回到未授权，但保留隧道记录', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { ...READY, services: [LIVE] } })
      // 三步齐了 setup 卡收成一行，先展开才能看到撤销入口
      await page.locator('.tn-card.setup .row-btn', { hasText: '调整' }).click()
      await row(page, 'auth').locator('.row-btn', { hasText: '撤销本机授权' }).click()
      await expect(page.locator('.confirm-dialog .dialog-body')).toContainText('Cloudflare 账号侧')
      await page.locator('.confirm-dialog .btn-danger').click()
      await expectToast(page, '本机授权已撤销')
      await expect(row(page, 'auth')).toContainText('在浏览器里登录 Cloudflare')
      const snap = await e2e.snapshot(page)
      expect(snap.tunnel.tunnelId).toBe('e2e-tunnel-0001')
    })

    test('授权进行中：给倒计时、给取消，不给第二个入口', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { installed: true, authorized: false } })
      await row(page, 'auth').locator('.row-btn').click()
      await expect(row(page, 'auth')).toContainText('等待浏览器里登录')
      await expect(row(page, 'auth')).toContainText('5:00')
      await expect(row(page, 'auth').locator('.row-btn')).toHaveText(['打开授权页', '取消'])
      expect(await e2e.count(page, 'tunnel_login_start')).toBe(1)

      await row(page, 'auth').locator('.row-btn', { hasText: '取消' }).click()
      await expect(row(page, 'auth')).toContainText('在浏览器里登录 Cloudflare')
      expect(await e2e.count(page, 'tunnel_login_cancel')).toBe(1)
    })

    test('建好一条就不再给第二次入口', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { installed: true, authorized: true } })
      await row(page, 'tunnel').locator('.tn-input').fill('desko-a')
      await row(page, 'tunnel').locator('.row-btn').click()
      await expectToast(page, '隧道已就位')
      expect(await e2e.count(page, 'tunnel_ensure_tunnel')).toBe(1)
      // 三步齐了整卡收起：还在的入口只剩「调整」，重复点建不出第二条
      await expect(page.locator('.tn-card.setup')).toContainText('desko-a')
      await expect(row(page, 'tunnel')).toHaveCount(0)
      await page.locator('.tn-card.setup .row-btn').click()
      await expect(row(page, 'tunnel').locator('.tn-input')).toHaveCount(0)
      await expect(row(page, 'tunnel').locator('.row-btn')).toHaveCount(0)
    })

    test('三步齐了整卡收成一行，「调整」再摊开', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { ...READY, services: [LIVE] } })
      await expect(page.locator('.tn-card.setup .tn-head')).toHaveCount(0)
      await expect(page.locator('.tn-card.setup .tn-row')).toHaveCount(1)
      await expect(page.locator('.tn-card.setup')).toContainText('desko-a')
      await page.locator('.tn-card.setup .row-btn').click()
      await expect(page.locator('.tn-card.setup .tn-row')).toHaveCount(3)
    })

    test('凭据缺失：说的是找回，不是重建', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { bound: true, installed: true, authorized: true, tunnelId: 'e2e-tunnel-0001', credsMissing: true } })
      await expect(row(page, 'tunnel')).toContainText('找回凭据')
      await row(page, 'tunnel').locator('.row-btn').click()
      await expectToast(page, '隧道已就位')
      const snap = await e2e.snapshot(page)
      expect(snap.tunnel.tunnelId).toBe('e2e-tunnel-0001')
      expect(snap.tunnel.creds).toBe(true)
    })

    test('同名隧道不属于本机：默认不认，接管才落到本机记录', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { installed: true, authorized: true, nameTaken: true } })
      await row(page, 'tunnel').locator('.row-btn').click()
      const warn = page.locator('.tn-card.setup .tn-note.chip-warn')
      await expect(warn).toContainText('本机没有它的记录')
      await warn.locator('.row-btn').click()
      const snap = await e2e.snapshot(page)
      expect(snap.tunnel.tunnelId).toBe('e2e-adopted-9f2c')
      expect(await e2e.count(page, 'tunnel_ensure_tunnel')).toBe(2)
    })

    test('劈流检查：本机在跑时把别处的处数单独报出来', async ({ page }) => {
      await gotoTunnel(page, {
        ...ROOT,
        tunnel: { ...READY, installed: true, registered: true, alive: true, services: [LIVE], external: 1 },
      })
      await openDetail(page)
      await page.locator('.tn-detail .tn-row', { hasText: '出口检查' }).locator('.d-btn').click()
      await expect(page.locator('.tn-detail .tn-row', { hasText: '出口检查' }).locator('.tn-value')).toContainText('另有 1 处也在跑这条隧道')
    })
  })
})
