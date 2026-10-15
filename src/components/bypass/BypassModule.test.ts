import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import BypassModule from './BypassModule.vue'
import { bypassApi, type ApplyOutcome, type ApplyPlan, type BypassTarget, type ProbeReport } from '../../services/api/bypass'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'

vi.mock('../../services/api/bypass', async (original) => {
  const actual = await original<typeof import('../../services/api/bypass')>()
  return { ...actual, bypassApi: Object.fromEntries(Object.keys(actual.bypassApi).map((key) => [key, vi.fn()])) }
})

const target = (over: Partial<BypassTarget> = {}): BypassTarget => ({
  id: 'a', host: 'internal.example.com', input: 'internal.example.com', kind: 'domain',
  port: 443, path: '/', scheme: 'https', address: '10.20.0.1', interfaceName: '以太网',
  nextHop: '192.168.1.1', verdict: 'hostsOnly', stale: false, cdnLike: false, note: '需配置 hosts',
  applyState: 'none', applyBatch: '', createdAt: 100, updatedAt: 200, checkedAt: 200, ...over,
})
const report = (over: Partial<ProbeReport> = {}): ProbeReport => ({
  input: 'internal.example.com', target: { kind: 'domain', host: 'internal.example.com', port: 443, path: '/', scheme: 'https' },
  pinned: null, localAnswers: ['198.18.0.2'], hijacked: true, realIps: ['10.20.0.1'], cdnLike: false,
  chosen: '10.20.0.1', httpStatus: 200, probeMs: 30, egress: null, verdict: 'hostsOnly', recommend: true,
  stale: false, headline: '需配置 hosts', detail: '固定实际地址', pending: [], ...over,
})
const plan: ApplyPlan = { planKey: 'confirmed-plan', rows: [{ id: 'a', label: 'internal.example.com', action: 'hosts 固定', blocked: '' }], ready: 1, blocked: 0 }
const outcome = (over: Partial<ApplyOutcome> = {}): ApplyOutcome => ({
  batchId: 'b1', cancelled: false, rolledBack: false,
  items: [{ id: 'a', op: 'pin', ok: true, changed: true, error: '' }], error: '', ...over,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

let wrapper: VueWrapper
let clipboard: ReturnType<typeof vi.fn>
const button = (text: string) => wrapper.findAll('button').find((b) => b.text().includes(text))!
/** 异常目标才配一张卡：按卡上的名字找 */
const card = (host: string) => wrapper.findAll('.bp-card').find((c) => c.get('.row-host').text() === host)!
const chip = (name: string) => wrapper.findAll('.chip').find((c) => c.text().includes(name))!
const flag = (text: string) => wrapper.findAll('.badge').find((b) => b.text() === text)!
const boot = async (rows: BypassTarget[] = []) => {
  vi.mocked(bypassApi.list).mockResolvedValue(rows)
  wrapper = mount(BypassModule, { global: { stubs: { AppIcon: true, teleport: true } } })
  await flushPromises()
}
const openHeroMenu = async () => {
  await wrapper.get('.hero-more').trigger('click')
  await flushPromises()
}
const heroItem = (text: string) => wrapper.findAll('.pop-item').find((b) => b.text().includes(text))!
const startProbe = async () => {
  await wrapper.get('.probe-box input').setValue('internal.example.com')
  await button('开始探测').trigger('click')
  await flushPromises()
}
const openPlan = async () => {
  await button('配置直连').trigger('click')
  await flushPromises()
}
const expand = async (host: string) => {
  await card(host).get('.card-main').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
  clipboard = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } })
  vi.mocked(bypassApi.list).mockResolvedValue([])
  vi.mocked(bypassApi.status).mockResolvedValue({ managedHosts: 0, hostsError: '', total: 0, pending: 0, stale: 0 })
  vi.mocked(bypassApi.rollbackBatch).mockResolvedValue('')
  vi.mocked(bypassApi.probe).mockResolvedValue(report())
  vi.mocked(bypassApi.cancelProbe).mockResolvedValue(undefined)
  vi.mocked(bypassApi.save).mockResolvedValue(report())
  vi.mocked(bypassApi.recheck).mockResolvedValue(report())
  vi.mocked(bypassApi.plan).mockResolvedValue(plan)
  vi.mocked(bypassApi.apply).mockResolvedValue(outcome())
  vi.mocked(bypassApi.revert).mockResolvedValue(outcome({ rolledBack: true }))
})
afterEach(() => wrapper?.unmount())

describe('网络直连交互', () => {
  it('加载失败显示重试入口，恢复后再展示清单', async () => {
    vi.mocked(bypassApi.list).mockRejectedValueOnce('数据库读取失败')
    wrapper = mount(BypassModule, { global: { stubs: { AppIcon: true, teleport: true } } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('数据库读取失败')
    expect(wrapper.find('.empty-title').text()).toBe('清单加载失败')
    vi.mocked(bypassApi.list).mockResolvedValue([target()])
    await button('重新加载').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.findAll('.bp-card')).toHaveLength(1)
  })

  it('直连可用的收成 chip，异常目标才升格成卡', async () => {
    await boot([
      target(),
      target({ id: 'b', host: 'ok.example.com', input: 'ok.example.com', verdict: 'directOk', note: '直连已可用' }),
    ])
    expect(wrapper.findAll('.bp-card')).toHaveLength(1)
    expect(wrapper.findAll('.chip')).toHaveLength(1)
    expect(chip('ok.example.com').find('.dot').exists()).toBe(true)
    expect(wrapper.get('.hero .big').text()).toContain('1')
    expect(wrapper.get('.hero .big').text()).toContain('2 直连可用')
    expect(card('internal.example.com').find('.badge.warn').text()).toBe('需配置 hosts')
  })

  it('概览按接口数出口，网段单独一档', async () => {
    vi.mocked(bypassApi.status).mockResolvedValue({ managedHosts: 5, hostsError: '', total: 4, pending: 1, stale: 0 })
    await boot([
      target(),
      target({ id: 'b', host: 'two.example.com', input: 'two.example.com', interfaceName: '以太网' }),
      target({ id: 'c', host: 'wlan.example.com', input: 'wlan.example.com', interfaceName: 'WLAN' }),
      target({ id: 'd', host: '10.20.0.0/16', input: '10.20.0.0/16', kind: 'cidr', interfaceName: '' }),
    ])
    const sub = wrapper.get('.hero .sub').text()
    expect(sub).toContain('出口：以太网 2')
    expect(sub).toContain('WLAN 1')
    expect(sub).toContain('按网段路由 1')
    expect(sub).toContain('hosts 管理记录 5 条')
  })

  it('托管区读不出来时概览改口并给出原因', async () => {
    vi.mocked(bypassApi.status).mockResolvedValue({
      managedHosts: 0, hostsError: 'hosts 中的直连管理区标记不完整', total: 1, pending: 1, stale: 0,
    })
    await boot([target()])
    expect(wrapper.get('.hero .sub').text()).toContain('无法读取本功能管理的 hosts 记录')
    expect(wrapper.get('.hero .sub').classes()).toContain('bad')
  })

  it('筛选只收 chip，异常卡常驻可见', async () => {
    await boot([
      target(),
      target({ id: 'b', host: 'aa.example.com', input: 'aa.example.com', verdict: 'directOk' }),
      target({ id: 'c', host: 'bb.example.com', input: 'bb.example.com', verdict: 'directOk' }),
    ])
    expect(wrapper.findAll('.chip')).toHaveLength(2)
    await wrapper.get('.bp-filter input').setValue('aa')
    expect(wrapper.findAll('.chip')).toHaveLength(1)
    expect(wrapper.findAll('.bp-card')).toHaveLength(1)
    await wrapper.get('.bp-filter input').setValue('nothing')
    expect(wrapper.findAll('.chip')).toHaveLength(0)
    expect(wrapper.get('.bp-nohit').text()).toContain('没有与「nothing」匹配的目标')
    expect(card('internal.example.com')).toBeDefined()
  })

  it('chip 开详情弹窗：badge 说过的不再念一遍，facts 与改原文都在', async () => {
    await boot([target({ id: 'b', host: 'ok.example.com', input: 'ok.example.com', verdict: 'directOk', note: '直连已可用', address: '203.0.113.9' })])
    await chip('ok.example.com').trigger('click')
    const dialog = wrapper.get('.detail-dialog')
    expect(dialog.get('.detail-target').text()).toBe('ok.example.com')
    expect(dialog.find('.row-note').exists()).toBe(false)
    expect(dialog.findAll('.detail-facts div')).toHaveLength(4)
    await dialog.get('.row-edit input').setValue('ok2.example.com')
    expect(button('探测并保存修改')).toBeDefined()
    await dialog.get('.dialog-close').trigger('click')
    expect(wrapper.find('.detail-dialog').exists()).toBe(false)
  })

  it('详情弹窗里重新探测：弹窗让位给结论，不叠两层', async () => {
    await boot([target({ id: 'b', host: 'ok.example.com', input: 'ok.example.com', verdict: 'directOk' })])
    await chip('ok.example.com').trigger('click')
    await button('重新探测').trigger('click')
    await flushPromises()
    expect(bypassApi.recheck).toHaveBeenCalledWith('b', expect.any(String))
    expect(wrapper.find('.detail-dialog').exists()).toBe(false)
    expect(wrapper.find('.concl-dialog').exists()).toBe(true)
  })

  it('IP 重新探测后说明代理问题，并能直接进入配置确认', async () => {
    const ip = '10.0.0.243'
    vi.mocked(bypassApi.recheck).mockResolvedValue(report({
      input: ip, target: { kind: 'ip', host: ip, port: 443, scheme: 'https', path: '/' },
      realIps: [ip], chosen: ip, localAnswers: [], hijacked: false, verdict: 'needRoute',
      httpStatus: null, probeMs: 20, headline: '需配置路由',
      egress: { ifIndex: 8, interface: '0dcloud', source: '198.18.0.1', nextHop: '198.18.0.2', isTaker: true },
    }))
    await boot([target({ host: ip, input: ip, kind: 'ip', verdict: 'needRoute' })])
    await wrapper.get('.card-acts button[title="重新探测"]').trigger('click')
    await flushPromises()
    const dialog = wrapper.get('.concl-dialog')
    expect(dialog.get('.concl-title').text()).toBe('当前连接仍经过代理')
    expect(dialog.text()).toContain('连接成功不代表已绕过代理')
    const configure = dialog.findAll('button').find(button => button.text() === '配置直连')
    expect(configure).toBeDefined()
    await configure!.trigger('click')
    await flushPromises()
    expect(bypassApi.plan).toHaveBeenCalledWith([], [])
    expect(bypassApi.apply).not.toHaveBeenCalled()
    expect(wrapper.find('.concl-dialog').exists()).toBe(false)
    expect(wrapper.find('[aria-label="配置确认"]').exists()).toBe(true)
  })

  it('配置方案失败保留探测结果，重试成功前不修改系统', async () => {
    await boot([target()])
    await wrapper.get('.card-acts button[title="重新探测"]').trigger('click')
    await flushPromises()
    vi.mocked(bypassApi.plan).mockRejectedValueOnce('路由方案生成失败')
    await wrapper.get('.concl-dialog .btn-primary').trigger('click')
    await flushPromises()
    expect(wrapper.find('.concl-dialog').exists()).toBe(true)
    expect(wrapper.find('[aria-label="配置确认"]').exists()).toBe(false)
    expect(bypassApi.apply).not.toHaveBeenCalled()
    expect(useToastStore().toast.message).toBe('路由方案生成失败')
  })

  it('复制代理直连目标只包含目标本身，便于添加客户端规则', async () => {
    const ip = '10.0.0.243'
    vi.mocked(bypassApi.recheck).mockResolvedValue(report({ input: ip,
      target: { kind: 'ip', host: ip, port: 443, scheme: 'https', path: '/' }, verdict: 'needRoute' }))
    await boot([target({ host: ip, input: ip, kind: 'ip', verdict: 'needRoute' })])
    await wrapper.get('.card-acts button[title="重新探测"]').trigger('click')
    await flushPromises()
    await button('复制直连目标').trigger('click')
    await flushPromises()
    expect(clipboard).toHaveBeenCalledWith(ip)
  })

  it('详情弹窗里移出清单：确认后才删', async () => {
    await boot([target({ id: 'b', host: 'ok.example.com', input: 'ok.example.com', verdict: 'directOk' })])
    await chip('ok.example.com').trigger('click')
    await button('移出清单').trigger('click')
    expect(wrapper.find('.detail-dialog').exists()).toBe(false)
    useConfirmStore().handleConfirm()
    await flushPromises()
    expect(bypassApi.remove).toHaveBeenCalledWith('b')
  })

  it('先探测再登记，保存期间关闭和重复提交不会重建弹窗', async () => {
    await boot()
    await startProbe()
    expect(bypassApi.save).not.toHaveBeenCalled()
    const saving = deferred<ProbeReport>()
    vi.mocked(bypassApi.save).mockReturnValue(saving.promise)
    await button('加入清单').trigger('click')
    await wrapper.get('.dialog-close').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.find('.concl-dialog').exists()).toBe(true)
    expect(button('加入清单').attributes('disabled')).toBeDefined()
    saving.resolve(report())
    await flushPromises()
    expect(bypassApi.save).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.concl-dialog .btn-primary').exists()).toBe(false)
  })

  it('同一目标再次探测明确显示更新清单', async () => {
    await boot([target({ applyState: 'applied', applyBatch: 'b1' })])
    await startProbe()
    expect(button('更新清单')).toBeDefined()
    await button('更新清单').trigger('click')
    await flushPromises()
    expect(useToastStore().toast.message).toBe('已更新清单')
  })

  it('保存过期报告失败后保留输入，不自动发起新的不可取消探测', async () => {
    vi.mocked(bypassApi.save).mockRejectedValue('探测结果已过期或不存在，请重新探测后再加入清单')
    await boot()
    await startProbe()
    await button('加入清单').trigger('click')
    await flushPromises()
    expect(bypassApi.probe).toHaveBeenCalledTimes(1)
    expect(wrapper.get('.probe-box input').element).toHaveProperty('value', 'internal.example.com')
    expect(wrapper.findAll('.bp-card')).toHaveLength(0)
    expect(useToastStore().toast.message).toContain('请重新探测')
    await wrapper.get('.dialog-close').trigger('click')
    await button('开始探测').trigger('click')
    await flushPromises()
    expect(bypassApi.probe).toHaveBeenCalledTimes(2)
  })

  it('配置后的连接检查失败不会误报为系统写入失败', async () => {
    await boot([target({ verdict: 'unreachable', note: '目标不可达', applyState: 'failed', applyBatch: 'b1' })])
    expect(card('internal.example.com').findAll('.badge').map((b) => b.text())).toEqual(['目标不可达', '需检查'])
    expect(flag('需检查').attributes('title')).toContain('连接检查未通过')
    await expand('internal.example.com')
    expect(wrapper.get('.row-card .row-note').text()).toContain('请重新探测查看原因')
    expect(wrapper.text()).not.toContain('写入失败')
  })

  it('不可达目标不能登记', async () => {
    vi.mocked(bypassApi.probe).mockResolvedValue(report({ verdict: 'unreachable' }))
    await boot()
    await startProbe()
    expect(button('加入清单').attributes('disabled')).toBeDefined()
    expect(bypassApi.save).not.toHaveBeenCalled()
  })

  it('探测期间锁住行操作和原始输入', async () => {
    const probing = deferred<ProbeReport>()
    vi.mocked(bypassApi.probe).mockReturnValue(probing.promise)
    await boot([target()])
    await expand('internal.example.com')
    await startProbe()
    expect(wrapper.get('.row-edit input').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.card-acts button[title="重新探测"]').attributes('disabled')).toBeDefined()
    await wrapper.get('.probe-box input').trigger('keyup', { key: 'Enter' })
    expect(bypassApi.probe).toHaveBeenCalledTimes(1)
    expect(bypassApi.recheck).not.toHaveBeenCalled()
    probing.resolve(report())
    await flushPromises()
  })

  it('写入锁一直保持到写入后的复验结束', async () => {
    const applying = deferred<ApplyOutcome>()
    const checking = deferred<ProbeReport>()
    vi.mocked(bypassApi.apply).mockReturnValue(applying.promise)
    vi.mocked(bypassApi.recheck).mockReturnValue(checking.promise)
    await boot([target()])
    await openPlan()
    await button('确认并配置').trigger('click')
    expect(wrapper.get('.probe-box input').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.hero-more').attributes('disabled')).toBeDefined()
    applying.resolve(outcome())
    await flushPromises()
    expect(bypassApi.recheck).toHaveBeenCalledTimes(1)
    expect(wrapper.get('.probe-box input').attributes('disabled')).toBeDefined()
    expect(button('停止检查 0/1').attributes('disabled')).toBeDefined()
    checking.resolve(report())
    await flushPromises()
    expect(wrapper.get('.probe-box input').attributes('disabled')).toBeUndefined()
  })

  it('方案变化拒绝配置时提示重新确认，且不发起配置后检查', async () => {
    vi.mocked(bypassApi.apply).mockRejectedValueOnce('网络或清单已变化，尚未写入更改。请重新打开“配置直连”查看最新方案')
    await boot([target()])
    await openPlan()
    await button('确认并配置').trigger('click')
    await flushPromises()
    expect(bypassApi.apply).toHaveBeenCalledWith([], [], 'confirmed-plan')
    expect(bypassApi.recheck).not.toHaveBeenCalled()
    expect(useToastStore().toast.message).toContain('重新打开“配置直连”')
    expect(wrapper.get('.probe-box input').attributes('disabled')).toBeUndefined()
    await openPlan()
    expect(bypassApi.plan).toHaveBeenCalledTimes(2)
  })

  it('取消授权不触发复验', async () => {
    vi.mocked(bypassApi.apply).mockResolvedValue(outcome({ cancelled: true, items: [] }))
    await boot([target()])
    await openPlan()
    await button('确认并配置').trigger('click')
    await flushPromises()
    expect(bypassApi.recheck).not.toHaveBeenCalled()
    expect(useToastStore().toast.message).toContain('已取消授权')
  })

  it('复制整份清单，包含已配置目标且不受筛选影响', async () => {
    await boot([target(), target({ id: 'b', host: 'ready.example.com', input: 'ready.example.com', verdict: 'directOk', applyState: 'applied' })])
    await wrapper.get('.bp-filter input').setValue('internal')
    expect(wrapper.findAll('.bp-card')).toHaveLength(1)
    expect(wrapper.findAll('.chip')).toHaveLength(0)
    await openHeroMenu()
    await heroItem('复制直连清单')!.trigger('click')
    expect(clipboard).toHaveBeenCalledWith('internal.example.com\nready.example.com')
  })

  it('清单为空仍然可以撤销残留系统配置', async () => {
    vi.mocked(bypassApi.rollbackBatch).mockResolvedValue('b1')
    await boot()
    await openHeroMenu()
    await heroItem('撤销上次配置')!.trigger('click')
    useConfirmStore().handleConfirm()
    await flushPromises()
    expect(bypassApi.revert).toHaveBeenCalledWith('b1')
  })

  it('撤销失败保留重试入口，不复验或宣称成功', async () => {
    vi.mocked(bypassApi.rollbackBatch).mockResolvedValue('b1')
    vi.mocked(bypassApi.revert).mockResolvedValue(outcome({ rolledBack: true, error: '无法删除路由' }))
    await boot([target({ applyState: 'applied', applyBatch: 'b1' })])
    await openHeroMenu()
    await heroItem('撤销上次配置')!.trigger('click')
    useConfirmStore().handleConfirm()
    await flushPromises()
    expect(useToastStore().toast.message).toContain('撤销未完成')
    expect(bypassApi.recheck).not.toHaveBeenCalled()
    await openHeroMenu()
    expect(heroItem('撤销上次配置')).toBeDefined()
  })

  it('成功撤销后复验整个清单，包含批次关联已经丢失的目标', async () => {
    vi.mocked(bypassApi.rollbackBatch).mockResolvedValue('b1')
    await boot([target({ applyBatch: 'b1' }), target({ id: 'b', host: 'older.example.com', applyBatch: '' })])
    await openHeroMenu()
    await heroItem('撤销上次配置')!.trigger('click')
    useConfirmStore().handleConfirm()
    await flushPromises()
    expect(vi.mocked(bypassApi.recheck).mock.calls.map(([id]) => id)).toEqual(['a', 'b'])
  })

  it('重算 CDN 方案时禁止确认，关闭后旧响应不会重开弹窗', async () => {
    await boot([target({ cdnLike: true })])
    await openPlan()
    const planning = deferred<ApplyPlan>()
    vi.mocked(bypassApi.plan).mockReturnValueOnce(planning.promise)
    await wrapper.get('.plan-cdn input').setValue(true)
    expect(button('确认并配置').attributes('disabled')).toBeDefined()
    await button('取消').trigger('click')
    planning.resolve({ ...plan, ready: 2 })
    await flushPromises()
    expect(wrapper.find('[aria-label="配置确认"]').exists()).toBe(false)
    await openPlan()
    expect(bypassApi.plan).toHaveBeenLastCalledWith([], [])
    expect((wrapper.get('.plan-cdn input').element as HTMLInputElement).checked).toBe(false)
  })

  it('重验停止会显示真实完成数，行操作不能同时发起', async () => {
    const checking = deferred<ProbeReport>()
    vi.mocked(bypassApi.recheck).mockReturnValue(checking.promise)
    await boot([target(), target({ id: 'b', host: 'other.example.com' })])
    await button('检查全部').trigger('click')
    expect(wrapper.get('.card-acts button[title="重新探测"]').attributes('disabled')).toBeDefined()
    await button('停止检查 0/2').trigger('click')
    checking.resolve(report())
    await flushPromises()
    expect(bypassApi.recheck).toHaveBeenCalledTimes(1)
    expect(useToastStore().toast.message).toBe('已停止检查，完成 0/2 项')
  })

  it('CDN 方案更新失败时恢复勾选状态，不提交未经确认的配置', async () => {
    await boot([target({ cdnLike: true })])
    vi.mocked(bypassApi.plan).mockResolvedValueOnce({ ...plan, ready: 0, blocked: 1 })
    await openPlan()
    vi.mocked(bypassApi.plan).mockRejectedValueOnce('方案读取失败')
    await wrapper.get('.plan-cdn input').setValue(true)
    await flushPromises()
    expect((wrapper.get('.plan-cdn input').element as HTMLInputElement).checked).toBe(false)
    expect(useToastStore().toast.message).toBe('方案读取失败')
    await button('确认并配置').trigger('click')
    await flushPromises()
    expect(bypassApi.apply).not.toHaveBeenCalled()
  })

  it('同意固定 CDN IP 后仍缺少直连出口时，说明检查位置和下一步，不允许写入', async () => {
    const gated: ApplyPlan = {
      planKey: 'confirmed-plan',
      rows: [{ id: 'a', label: 'internal.example.com', action: '', blocked: '地址可能随 CDN 节点变化' }],
      ready: 0, blocked: 1,
    }
    vi.mocked(bypassApi.plan).mockResolvedValueOnce(gated)
    await boot([target({ verdict: 'needRoute', cdnLike: true })])
    await openPlan()
    expect(wrapper.get('.plan-cdn').text()).toBe('同意固定当前 IP（10.20.0.1）')
    expect(wrapper.find('.plan-help').exists()).toBe(false)
    vi.mocked(bypassApi.plan).mockResolvedValueOnce({
      planKey: 'confirmed-plan',
      rows: [{ id: 'a', label: 'internal.example.com', action: '', blocked: '无法自动确定到 10.20.0.1/32 的直连出口，本项暂不配置', blockedReason: 'noDirectRoute' }],
      ready: 0, blocked: 1,
    })
    await wrapper.get('.plan-cdn input').setValue(true)
    await flushPromises()
    expect(bypassApi.plan).toHaveBeenLastCalledWith(['a'], [])
    const dialog = wrapper.get('[aria-label="配置确认"]')
    expect(dialog.get('.plan-action').text()).toContain('10.20.0.1/32')
    expect(dialog.get('.plan-cdn-hint').text()).toContain('仍需通过直连出口检查')
    const help = dialog.get('[aria-label="直连出口处理指引"]').text()
    for (const text of ['没有额外的“人工确认”操作', 'Win + R', 'ncpa.cpl', '内网 VPN', '代理客户端', 'DIRECT', '检查全部', '配置直连']) {
      expect(help).toContain(text)
    }
    expect(dialog.get('.footer-hints').text()).not.toContain('管理员授权')
    expect(button('确认并配置').attributes('disabled')).toBeDefined()
    await button('确认并配置').trigger('click')
    expect(bypassApi.apply).not.toHaveBeenCalled()
    vi.mocked(bypassApi.plan).mockResolvedValueOnce(gated)
    await wrapper.get('.plan-cdn input').setValue(false)
    await flushPromises()
    expect(wrapper.find('.plan-help').exists()).toBe(false)
  })

  it('缺少实际 IP 时只提示重新探测，不显示无关的出口处理指引', async () => {
    vi.mocked(bypassApi.plan).mockResolvedValueOnce({
      planKey: 'confirmed-plan',
      rows: [{ id: 'a', label: 'internal.example.com', action: '', blocked: '没有可固定的实际 IPv4 地址，请重新探测' }],
      ready: 0, blocked: 1,
    })
    await boot([target({ address: '' })])
    await openPlan()
    expect(wrapper.get('.plan-action').text()).toContain('请重新探测')
    expect(wrapper.find('.plan-help').exists()).toBe(false)
    expect(button('确认并配置').attributes('disabled')).toBeDefined()
  })

  it('选择内网出口后重新生成方案，更新完成才允许确认，并将所选出口传入配置', async () => {
    const option = { interfaceIndex: 16, interfaceAlias: '本地连接', gateway: '26.0.48.1', gatewayIsOnLink: false }
    const blocked: ApplyPlan = { planKey: 'confirmed-plan', rows: [{ id: 'a', label: 'internal.example.com', action: '', blocked: '请选择可访问该地址的网络', blockedReason: 'noDirectRoute', routeOptions: [option] }], ready: 0, blocked: 1 }
    vi.mocked(bypassApi.plan).mockResolvedValueOnce(blocked)
    await boot([target({ verdict: 'needRoute' })])
    await openPlan()
    expect(wrapper.get('.plan-route-hint').text()).toContain('局域网或 VPN')
    const planning = deferred<ApplyPlan>()
    vi.mocked(bypassApi.plan).mockReturnValueOnce(planning.promise)
    await wrapper.get('.plan-route select').setValue('16|26.0.48.1')
    expect(button('确认并配置').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.plan-route select').attributes('disabled')).toBeDefined()
    const overrides = [{ id: 'a', interfaceIndex: 16, gateway: '26.0.48.1' }]
    expect(bypassApi.plan).toHaveBeenLastCalledWith([], overrides)
    planning.resolve({ planKey: 'updated-plan', rows: [{ id: 'a', label: 'internal.example.com', action: '持久路由 绑 26.0.48.1（接口 本地连接）', blocked: '', routeOptions: [option] }], ready: 1, blocked: 0 })
    await flushPromises()
    expect(wrapper.find('.plan-help').exists()).toBe(false)
    expect(button('确认并配置').attributes('disabled')).toBeUndefined()
    expect((wrapper.get('.plan-route select').element as HTMLSelectElement).value).toBe('16|26.0.48.1')
    await button('确认并配置').trigger('click')
    await flushPromises()
    expect(bypassApi.apply).toHaveBeenCalledWith([], overrides, 'updated-plan')
  })

  it('出口方案更新失败时恢复上次选择，不放行未确认的出口', async () => {
    vi.mocked(bypassApi.plan).mockResolvedValueOnce({ planKey: 'confirmed-plan', rows: [{ id: 'a', label: 'internal.example.com', action: '', blocked: '请选择出口', routeOptions: [{ interfaceIndex: 16, interfaceAlias: 'VPN', gateway: '26.0.48.1', gatewayIsOnLink: false }] }], ready: 0, blocked: 1 })
    await boot([target({ verdict: 'needRoute' })])
    await openPlan()
    vi.mocked(bypassApi.plan).mockRejectedValueOnce('路由读取失败')
    await wrapper.get('.plan-route select').setValue('16|26.0.48.1')
    await flushPromises()
    expect((wrapper.get('.plan-route select').element as HTMLSelectElement).value).toBe('')
    expect(useToastStore().toast.message).toBe('路由读取失败')
    expect(button('确认并配置').attributes('disabled')).toBeDefined()
    expect(bypassApi.apply).not.toHaveBeenCalled()
  })

  it('离开页面后不再探测剩余条目', async () => {
    const checking = deferred<ProbeReport>()
    vi.mocked(bypassApi.recheck).mockReturnValue(checking.promise)
    await boot([target(), target({ id: 'b', host: 'other.example.com' })])
    await button('检查全部').trigger('click')
    wrapper.unmount()
    expect(bypassApi.cancelProbe).toHaveBeenCalledWith(vi.mocked(bypassApi.recheck).mock.calls[0][1])
    checking.resolve(report())
    await flushPromises()
    expect(bypassApi.recheck).toHaveBeenCalledTimes(1)
  })

  it('网段没有端口探测时不显示连接失败', async () => {
    vi.mocked(bypassApi.probe).mockResolvedValue(report({ target: { kind: 'cidr', host: '10.20.0.0/16', port: 0, path: '', scheme: 'http' }, probeMs: null, httpStatus: null }))
    await boot()
    await startProbe()
    const fact = wrapper.findAll('.concl-facts div').find((r) => r.text().includes('连通性'))!
    expect(fact.text()).toContain('按出口路由判断')
    expect(fact.text()).toContain('未检查网段内的具体服务')
    expect(fact.text()).not.toContain('连接失败')
  })

  it('取消正在探测的目标后释放输入，迟到结果不会打开结论', async () => {
    const probing = deferred<ProbeReport>()
    vi.mocked(bypassApi.probe).mockReturnValue(probing.promise)
    await boot()
    await startProbe()
    expect(wrapper.get('.bp-probe-progress').text()).toContain('internal.example.com')
    const requestId = vi.mocked(bypassApi.probe).mock.calls[0][1]
    await button('取消探测').trigger('click')
    await flushPromises()
    expect(bypassApi.cancelProbe).toHaveBeenCalledWith(requestId)
    expect(wrapper.get('.probe-box input').attributes('disabled')).toBeUndefined()
    expect(useToastStore().toast.message).toBe('已取消探测')
    probing.resolve(report())
    await flushPromises()
    expect(wrapper.find('.concl-dialog').exists()).toBe(false)
    expect(bypassApi.save).not.toHaveBeenCalled()
  })

  it('取消后可以重新探测，旧任务收尾不会打断新任务', async () => {
    const oldProbe = deferred<ProbeReport>()
    const newProbe = deferred<ProbeReport>()
    vi.mocked(bypassApi.probe).mockReturnValueOnce(oldProbe.promise).mockReturnValueOnce(newProbe.promise)
    await boot()
    await startProbe()
    await button('取消探测').trigger('click')
    await flushPromises()
    await startProbe()
    oldProbe.resolve(report({ headline: '旧结果' }))
    await flushPromises()
    expect(wrapper.find('.concl-dialog').exists()).toBe(false)
    expect(wrapper.get('.probe-box input').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.bp-probe-progress').exists()).toBe(true)
    newProbe.resolve(report({ headline: '新结果' }))
    await flushPromises()
    expect(wrapper.get('.concl-title').text()).toBe('新结果')
    expect(wrapper.find('.bp-probe-progress').exists()).toBe(false)
    expect(vi.mocked(bypassApi.probe).mock.calls[0][1]).not.toBe(vi.mocked(bypassApi.probe).mock.calls[1][1])
  })

  it('取消行重探保留原行，不打开迟到的结论', async () => {
    const checking = deferred<ProbeReport>()
    vi.mocked(bypassApi.recheck).mockReturnValue(checking.promise)
    await boot([target()])
    await wrapper.get('.card-acts button[title="重新探测"]').trigger('click')
    await button('取消探测').trigger('click')
    await flushPromises()
    checking.resolve(report({ headline: '迟到结果' }))
    await flushPromises()
    expect(wrapper.find('.concl-dialog').exists()).toBe(false)
    expect(wrapper.get('.row-host').text()).toBe('internal.example.com')
    expect(wrapper.findAll('.bp-card')).toHaveLength(1)
  })

  it('取消修改前的探测保留编辑草稿和旧目标', async () => {
    const editing = deferred<ProbeReport>()
    vi.mocked(bypassApi.edit).mockReturnValue(editing.promise)
    await boot([target()])
    await expand('internal.example.com')
    await wrapper.get('.row-edit input').setValue('new.example.com')
    await button('探测并保存修改').trigger('click')
    await button('取消探测').trigger('click')
    await flushPromises()
    editing.resolve(report({ input: 'new.example.com' }))
    await flushPromises()
    expect((wrapper.get('.row-edit input').element as HTMLInputElement).value).toBe('new.example.com')
    expect(wrapper.get('.row-host').text()).toBe('internal.example.com')
    expect(wrapper.find('.concl-dialog').exists()).toBe(false)
  })

  it('取消命令失败会显示错误，探测仍可正常完成', async () => {
    const probing = deferred<ProbeReport>()
    vi.mocked(bypassApi.probe).mockReturnValue(probing.promise)
    vi.mocked(bypassApi.cancelProbe).mockRejectedValueOnce('连接已断开')
    await boot()
    await startProbe()
    await button('取消探测').trigger('click')
    await flushPromises()
    expect(useToastStore().toast.message).toBe('取消失败：连接已断开')
    expect(wrapper.find('.bp-probe-progress').exists()).toBe(true)
    probing.resolve(report())
    await flushPromises()
    expect(wrapper.find('.concl-dialog').exists()).toBe(true)
    expect(wrapper.find('.bp-probe-progress').exists()).toBe(false)
  })

  it('取消命令尚未回传时探测完成，取消失败后仍能查看本次结论', async () => {
    const probing = deferred<ProbeReport>()
    const cancelling = deferred<void>()
    vi.mocked(bypassApi.probe).mockReturnValue(probing.promise)
    vi.mocked(bypassApi.cancelProbe).mockReturnValueOnce(cancelling.promise)
    await boot()
    await startProbe()
    await button('取消探测').trigger('click')
    probing.resolve(report({ headline: '有效的完成结果' }))
    await flushPromises()
    expect(wrapper.find('.concl-dialog').exists()).toBe(false)
    cancelling.reject('连接已断开')
    await flushPromises()
    expect(useToastStore().toast.message).toBe('取消失败：连接已断开')
    expect(wrapper.get('.concl-title').text()).toBe('有效的完成结果')
    expect(wrapper.find('.bp-probe-progress').exists()).toBe(false)
  })

  it('目标 URL 包含取消标记时，普通网络错误仍然可见', async () => {
    const error = '请求 https://example.com/__bypass_probe_cancelled__/ 失败'
    vi.mocked(bypassApi.probe).mockRejectedValueOnce(error)
    await boot()
    await startProbe()
    expect(useToastStore().toast.message).toBe(error)
    expect(wrapper.find('.bp-probe-progress').exists()).toBe(false)
  })
})
