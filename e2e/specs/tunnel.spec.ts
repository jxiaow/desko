import { test, expect, Page } from '@playwright/test'
import { bootUnlocked, e2e, E2E_PASSWORD, expectToast, openSettings, visiblePane } from '../helpers'
import { AuthPage } from '../pages/auth-page'

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
  await dlg.locator('#tn-svc-host').fill(host.replace(/\.example\.com$/i, ''))
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
    await expect(btn).toHaveAttribute('title', '请先添加本地服务')
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
    await expectToast(page, '隧道已连接')
    await expect(page.locator('.page-bar .chip').first()).toContainText('已连接')
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

  test('运行中即使没有服务，也能停止隧道', async ({ page }) => {
    await gotoTunnel(page, state(true, true, true, { ...READY, services: [] }))
    const stop = page.getByRole('button', { name: '停止隧道', exact: true })
    await expect(stop).toBeEnabled()
    await stop.click()
    expect(await e2e.count(page, 'tunnel_stop')).toBe(1)
    await expect(page.locator('.page-bar .chip').first()).toContainText('已停止')
  })

  for (const width of [390, 768]) {
    test(`窄窗口保留完整服务信息，操作可见且弹窗支持键盘（${width}px）`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await gotoTunnel(page, { ...ROOT, tunnel: { ...READY, services: [LIVE] } })
      const row = svcRow(page, LIVE.hostname)
      await expect(row).toContainText('127.0.0.1:8421')
      await expect(row.getByRole('button', { name: '复制 局域网传输 的公网地址' })).toBeInViewport()
      expect(await page.locator('.tunnel-page').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      await page.locator('.services .head-btn').click()
      const dialog = page.getByRole('dialog', { name: '添加本地服务' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeInViewport()
      await page.keyboard.press('Shift+Tab')
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(page.locator('.services .head-btn')).toBeFocused()
    })
  }

  test('获取程序：内容不符与网络失败各说各话', async ({ page }) => {
    await gotoTunnel(page, { ...ROOT, tunnel: { installed: false, fetchFail: 'content' } })
    await page.locator('.tn-card.setup .row-bin .row-btn').click()
    await expectToast(page, '产物校验不符')
    await expect(page.locator('.tn-card.setup .row-bin')).toContainText('下载并校验 cloudflared')

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

  test('一个命令读失败：其余照读，页上留一句原因', async ({ page }) => {
    await gotoTunnel(page, { ...ROOT, tunnel: { ...READY, services: [LIVE], pollFail: '数据库被占用' } })
    await expect(page.locator('.poll-err span')).toHaveText('无法读取状态：数据库被占用')
    await expect(page.locator('.poll-err .foot-btn')).toHaveText('重试')
    // 剩下四格照常更新：整页不许冻在上一帧，用户得能看出是哪一格读不到
    await expect(page.locator('.tn-card.services')).toContainText('files.example.com')
    await expect(page.locator('.tn-card.setup')).toContainText('desko-a')
  })

  test.describe('服务列表', () => {
    for (const viewport of [{ width: 1040, height: 670 }, { width: 800, height: 600 }]) {
      test(`切换服务类型保持弹窗与字段位置（${viewport.width}×${viewport.height}）`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await gotoTunnel(page, { ...ROOT, tunnel: READY })
        await page.locator('.tn-card.services .head-btn').click()
        const dlg = page.locator('.tunnel-service-dialog')
        const empty = await dlg.boundingBox()
        await dlg.locator('.seg button', { hasText: '局域网传输' }).click()
        expect(await dlg.boundingBox()).toEqual(empty)
        await dlg.locator('.seg button').last().click()
        expect(await dlg.boundingBox()).toEqual(empty)
        await dlg.locator('#tn-svc-name').fill('文档服务')
        await dlg.locator('#tn-svc-host').fill('docs')
        await dlg.locator('#tn-svc-port').fill('9090')
        const selectors = ['.tunnel-service-dialog', '.dialog-header', '#tn-svc-name', '#tn-svc-host', '#tn-svc-port', '.dialog-footer']
        const before = await Promise.all(selectors.map(selector => page.locator(selector).boundingBox()))
        await dlg.locator('.seg button', { hasText: '局域网传输' }).click()
        const fileshare = await Promise.all(selectors.map(selector => page.locator(selector).boundingBox()))
        expect(fileshare).toEqual(before)
        await dlg.locator('.seg button').last().click()
        const thirdParty = await Promise.all(selectors.map(selector => page.locator(selector).boundingBox()))
        expect(thirdParty).toEqual(before)
        await expect(dlg.locator('#tn-svc-name')).toHaveValue('文档服务')
        await expect(dlg.locator('#tn-svc-host')).toHaveValue('docs')
        await expect(dlg.locator('#tn-svc-port')).toHaveValue('9090')
        await dlg.screenshot({ path: `.tmp/tunnel-dialog-${viewport.width}-${viewport.height}.png` })
      })
    }

    test('空态只有一行添加：登记一条就上一行', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: READY })
      await expect(page.locator('.tn-card.services .tn-add')).toBeVisible()

      await addService(page, 'Desk.Example.com', '9090', '文档站')
      await expectToast(page, '服务已保存')
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
      await svcRow(page, 'files.example.com').locator('.acts .ib').nth(1).click()
      await page.locator('.popover .pop-item', { hasText: '公网设置' }).click()
      const dlg = page.locator('.tunnel-service-dialog')
      await dlg.locator('#tn-svc-port').fill('8500')
      await dlg.locator('.dialog-footer .btn-primary').click()
      await expect(svcRow(page, 'files.example.com')).toContainText('域名待应用')
      expect(await e2e.count(page, 'tunnel_update_service')).toBe(1)
      // 只改基础字段不该碰到公网策略：口令与只读位各是各的命令
      expect(await e2e.count(page, 'tunnel_set_service_policy')).toBe(0)
    })

    test('公网设置：口令没设过时只翻开关被拒，补上口令同窗生效', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { ...READY, services: [LIVE] } })
      // 新建即「无口令」：行上必须把这个缺口说出来
      await expect(svcRow(page, 'files.example.com')).toContainText('公网未设口令')

      const openDialog = async () => {
        await svcRow(page, 'files.example.com').locator('.acts .ib').nth(1).click()
        await page.locator('.popover .pop-item', { hasText: '公网设置' }).click()
      }
      const dlg = page.locator('.tunnel-service-dialog')
      await openDialog()
      await dlg.locator('.seg button', { hasText: '允许上传' }).click()
      await dlg.locator('.dialog-footer .btn-primary').click()
      await expectToast(page, '公网侧必须有口令')
      // 被拒后弹窗留人：口令就在下一格，填了就能同窗补上
      await expect(dlg).toBeVisible()
      await dlg.locator('#tn-svc-pw').fill('tr0ubador-9')
      await dlg.locator('.dialog-footer .btn-primary').click()
      await expectToast(page, '服务已保存')
      await expect(dlg).toHaveCount(0)
      let snap = await e2e.snapshot(page)
      expect(snap.tunnel.services[0].hasPassword).toBe(true)
      expect(snap.tunnel.services[0].readOnly).toBe(false)
      await expect(svcRow(page, 'files.example.com')).toContainText('公网可上传')

      // 只翻开关不填口令：开关落新值，口令保持原样
      await openDialog()
      await expect(dlg.locator('#tn-svc-pw')).toHaveValue('')
      await expect(dlg.locator('.seg button.on')).toHaveText('允许上传')
      await dlg.locator('.seg button', { hasText: '只读' }).click()
      await dlg.locator('.dialog-footer .btn-primary').click()
      snap = await e2e.snapshot(page)
      expect(snap.tunnel.services[0].readOnly).toBe(true)
      expect(snap.tunnel.services[0].hasPassword).toBe(true)
    })

    test('目标端口未监听：行上标事实，不假装通', async ({ page }) => {
      await gotoTunnel(page, {
        ...ROOT,
        tunnel: { ...READY, services: [{ ...LIVE, listening: false }] },
      })
      await expect(svcRow(page, 'files.example.com')).toContainText('目标端口未监听')
      await expect(page.locator('.tn-card.services .foot-row')).toContainText('1 个服务端口未监听，暂无法访问')
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
      await dlg.locator('#tn-svc-host').fill('a')
      const save = dlg.locator('.dialog-footer .btn-primary')
      await expect(save).toBeDisabled()
      await dlg.locator('#tn-svc-port').fill('99999')
      await expect(save).toBeDisabled()
      await dlg.locator('#tn-svc-port').fill('8421')
      await expect(save).toBeEnabled()
      expect(await e2e.count(page, 'tunnel_add_service')).toBe(0)
    })

    test('服务类型说明与端口获取入口准确', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: READY })
      await page.locator('.tn-card.services .head-btn').click()
      const dlg = page.locator('.tunnel-service-dialog')
      await expect(dlg.locator('.service-note')).toHaveText('访问权限由原服务管理。')
      await expect(dlg.locator('.port-line .port-btn')).toBeHidden()
      await dlg.locator('.seg button', { hasText: '局域网传输' }).click()
      await expect(dlg.locator('.service-note')).toHaveText('保存后需在「公网设置」中设置口令。')
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
      await svcRow(page, 'files.example.com').locator('.acts .ib').nth(1).click()
      await page.locator('.popover .pop-item', { hasText: '移除服务' }).click()
      await expect(page.locator('.confirm-dialog .dialog-body')).toContainText('Cloudflare 的 DNS 记录会保留')
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
      await svcRow(page, 'files.example.com').locator('.acts .ib').first().click()
      await expectToast(page, '已复制 https://files.example.com')
    })
  })

  test.describe('接入准备', () => {
    const row = (page: Page, name: 'bin' | 'auth' | 'tunnel') =>
      page.locator(`.tn-card.setup .row-${name}`)

    test('未授权：新建隧道按不住，原因写在按钮上而不是丢一句失败', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { installed: true, authorized: false } })
      await expect(row(page, 'auth')).toContainText('通过浏览器授权')
      const create = row(page, 'tunnel').locator('.row-btn')
      await expect(create).toHaveCount(0)
      expect(await e2e.count(page, 'tunnel_ensure_tunnel')).toBe(0)
    })

    test('未授权：授权行没有撤销入口', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { installed: true, authorized: false } })
      await expect(row(page, 'auth').locator('.row-btn', { hasText: '撤销本机授权' })).toHaveCount(0)
      expect(await e2e.count(page, 'tunnel_authorized_domain')).toBe(0)
    })

    test('授权后自动展示主域名，新增服务只填前缀即可得到公网地址', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { installed: true, authorized: true, domain: 'demo.example.net' } })
      await expect(row(page, 'auth')).toContainText('demo.example.net')
      await page.locator('.tn-card.services .head-btn').click()
      const dlg = page.locator('.tunnel-service-dialog')
      await expect(dlg.locator('.domain-name')).toHaveText('demo.example.net')
      await dlg.locator('#tn-svc-host').fill('files')
      await dlg.locator('#tn-svc-port').fill('8421')
      await expect(dlg.locator('.host-preview')).toContainText('https://files.demo.example.net')
      await dlg.locator('.dialog-footer .btn-primary').click()
      await expectToast(page, '服务已保存')
      await expect(svcRow(page, 'files.demo.example.net')).toBeVisible()
      expect((await e2e.snapshot(page)).tunnel.services[0].hostname).toBe('files.demo.example.net')
      await page.locator('a.nav-item[href="/notes"]').click()
      await page.locator('a.nav-item[href="/tunnel"]').click()
      expect(await e2e.count(page, 'tunnel_authorized_domain')).toBe(1)
    })

    test('域名读取失败不撤回授权，提供重试并阻止生成不完整地址', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { installed: true, authorized: true, domainFail: '无法连接 Cloudflare' } })
      await expect(row(page, 'auth')).toContainText('本机已有授权凭据')
      await expect(page.locator('.tn-card.setup .tn-note.chip-warn .note-text')).toHaveText('无法读取主域名：无法连接 Cloudflare')
      await page.locator('.tn-card.setup .row-btn', { hasText: '重试读取主域名' }).click()
      await expect.poll(() => e2e.count(page, 'tunnel_authorized_domain')).toBe(2)
      await page.locator('.tn-card.services .head-btn').click()
      const dlg = page.locator('.tunnel-service-dialog')
      await dlg.locator('#tn-svc-host').fill('files')
      await dlg.locator('#tn-svc-port').fill('8421')
      await expect(dlg.locator('.dialog-footer .btn-primary')).toBeDisabled()
      expect(await e2e.count(page, 'tunnel_add_service')).toBe(0)
    })

    test('已授权：撤销入口把状态回到未授权，但保留隧道记录', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { ...READY, services: [LIVE] } })
      // 三步齐了 setup 卡收成一行，先展开才能看到撤销入口
      await page.locator('.tn-card.setup .row-btn', { hasText: '调整' }).click()
      await row(page, 'auth').locator('.row-btn', { hasText: '撤销本机授权' }).click()
      await expect(page.locator('.confirm-dialog .dialog-body')).toContainText('彻底吊销授权需前往 Cloudflare 控制台')
      await page.locator('.confirm-dialog .btn-danger').click()
      await expectToast(page, '本机授权已撤销')
      await expect(row(page, 'auth')).toContainText('通过浏览器授权')
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
      await expect(row(page, 'auth')).toContainText('通过浏览器授权')
      expect(await e2e.count(page, 'tunnel_login_cancel')).toBe(1)
    })

    test('浏览器授权后刷新页面，主密码解锁后识别授权且其他页面仍可操作', async ({ page }) => {
      await gotoTunnel(page, { ...ROOT, tunnel: { installed: true, authorized: false } })
      await row(page, 'auth').locator('.row-btn').click()
      await expect(row(page, 'auth')).toContainText('等待浏览器里登录')
      // 模拟浏览器完成授权后，后端已有凭据；WebView 刷新不会重新发起登录。
      await page.addInitScript(() => {
        const config = (window as any).__E2E_CONFIG__
        config.tunnel.authorized = true
      })
      await page.reload()
      const auth = new AuthPage(page)
      await auth.expectUnlockPage()
      await auth.unlockInput.fill(E2E_PASSWORD)
      await auth.unlockInput.press('Enter')
      await auth.expectUnlocked()
      await expect(row(page, 'auth')).toContainText('本机已有授权凭据')
      await expect(row(page, 'auth')).toContainText('example.com')
      expect(await e2e.count(page, 'unlock')).toBe(1)
      expect(await e2e.count(page, 'tunnel_login_start')).toBe(0)
      await page.locator('a.nav-item[href="/notes"]').click()
      await expect(page).toHaveURL(/\/notes$/)
      await page.locator('a.nav-item[href="/tunnel"]').click()
      await expect(row(page, 'auth')).toContainText('本机已有授权凭据')
    })

    test('授权早退没落凭据：那句原因摊在行下，不是只把按钮退回「去授权」', async ({ page }) => {
      await gotoTunnel(page, {
        ...ROOT,
        tunnel: { installed: true, authorized: false, loginFail: '这个 zone 不在你的账号里' },
      })
      await row(page, 'auth').locator('.row-btn').click()
      await expect(page.locator('.tn-card.setup .tn-note.chip-warn')).toContainText('这个 zone 不在你的账号里')
      // 失败不吞掉重试的入口：按钮退回「去授权」，用户当场能再来一轮
      await expect(row(page, 'auth').locator('.row-btn', { hasText: '去授权' })).toHaveCount(1)
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
