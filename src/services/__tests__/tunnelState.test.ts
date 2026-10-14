import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { tunnelApi } from '../api/tunnel'

vi.mock('../api/tunnel', () => ({
  tunnelApi: {
    status: vi.fn(), binaryStatus: vi.fn(), provisionStatus: vi.fn(),
    loginStatus: vi.fn(), listServices: vi.fn(),
    authorizedDomain: vi.fn(),
  },
}))

const authorized = { state: 'authorized' as const, url: null, secondsLeft: 0, note: null }
const provision = {
  step: 'no-tunnel' as const, message: '', tunnelName: null, tunnelId: null,
  serviceCount: 0, unroutedCount: 0, authorized: true, nameTaken: false,
}

describe('穿透授权状态刷新', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    vi.mocked(tunnelApi.status).mockResolvedValue({ bound: false, alive: false, registered: false, running: false, pid: null, note: null })
    vi.mocked(tunnelApi.binaryStatus).mockResolvedValue({ installed: true, verified: true, expectedVersion: 'test', path: null, actualSha256: null })
    vi.mocked(tunnelApi.loginStatus).mockResolvedValue(authorized)
    vi.mocked(tunnelApi.provisionStatus).mockResolvedValue(provision)
    vi.mocked(tunnelApi.listServices).mockResolvedValue([])
  })

  it('服务列表还没返回时，已完成的授权立即显示', async () => {
    const s = await import('../tunnelState')
    let finish!: () => void
    vi.mocked(tunnelApi.listServices).mockImplementation(() => new Promise(resolve => { finish = () => resolve([]) }))
    const request = s.tnRefresh()
    await flushPromises()
    expect(s.tnLogin.value.state).toBe('authorized')
    expect(s.tnProvision.value?.authorized).toBe(true)
    expect(s.tnLoaded.value).toBe(true)
    finish()
    await request
  })

  it('先领取授权凭据，再读取接入进度，避免同一轮仍报未授权', async () => {
    const s = await import('../tunnelState')
    let finish!: () => void
    let arrived = false
    vi.mocked(tunnelApi.loginStatus).mockImplementation(() => new Promise(resolve => {
      finish = () => { arrived = true; resolve(authorized) }
    }))
    vi.mocked(tunnelApi.provisionStatus).mockImplementation(async () => ({ ...provision, authorized: arrived }))
    const request = s.tnRefresh()
    await flushPromises()
    expect(tunnelApi.provisionStatus).not.toHaveBeenCalled()
    finish()
    await request
    expect(s.tnProvision.value?.authorized).toBe(true)
  })

  it('授权状态读取失败，其余信息仍刷新并显示原因', async () => {
    const s = await import('../tunnelState')
    vi.mocked(tunnelApi.loginStatus).mockRejectedValue('授权读取失败')
    await s.tnRefresh()
    expect(s.tnProvision.value).toEqual(provision)
    expect(s.tnBinary.value?.installed).toBe(true)
    expect(s.tnPollError.value).toBe('授权读取失败')
  })

  it('聚焦补刷先完成时，较早请求不能把授权状态退回等待', async () => {
    const s = await import('../tunnelState')
    let finish!: () => void
    vi.mocked(tunnelApi.loginStatus).mockImplementationOnce(() => new Promise(resolve => {
      finish = () => resolve({ state: 'waiting', url: 'https://example.com', secondsLeft: 280, note: null })
    }))
    const old = s.tnRefresh()
    await s.tnRefresh()
    finish()
    await old
    expect(s.tnLogin.value.state).toBe('authorized')
  })

  it('下一轮轮询已开始但尚未返回时，前一轮慢查询仍能更新服务列表', async () => {
    const s = await import('../tunnelState')
    let finishFirst!: () => void
    let finishSecond!: () => void
    const row = { id: 'one', hostname: 'files.example.com', port: 8421, label: '', preset: '', routed: true, listening: false, hasPublicPassword: false, publicReadOnly: true }
    vi.mocked(tunnelApi.listServices)
      .mockImplementationOnce(() => new Promise(resolve => { finishFirst = () => resolve([row]) }))
      .mockImplementationOnce(() => new Promise(resolve => { finishSecond = () => resolve([]) }))
    const first = s.tnRefresh()
    const second = s.tnRefresh()
    finishFirst()
    await first
    expect(s.tnServices.value).toEqual([row])
    finishSecond()
    await second
    expect(s.tnServices.value).toEqual([])
  })

  it('主域名只读一次，失败可重试且不影响授权状态', async () => {
    const s = await import('../tunnelState')
    vi.mocked(tunnelApi.authorizedDomain).mockRejectedValueOnce('域名读取失败')
      .mockResolvedValue({ name: 'example.com', status: 'active' })
    s.tnLogin.value = authorized
    await s.tnLoadDomain()
    expect(s.tnDomainError.value).toBe('域名读取失败')
    expect(s.tnLogin.value.state).toBe('authorized')
    await s.tnLoadDomain()
    await s.tnLoadDomain()
    expect(tunnelApi.authorizedDomain).toHaveBeenCalledTimes(2)
    expect(s.tnDomain.value?.name).toBe('example.com')
    expect(s.tnDomainError.value).toBe('')
  })

  it('撤销后到达的旧域名请求不能恢复缓存；新授权可重新读取', async () => {
    const s = await import('../tunnelState')
    let finish!: () => void
    vi.mocked(tunnelApi.authorizedDomain).mockImplementationOnce(() => new Promise(resolve => {
      finish = () => resolve({ name: 'old.example.com', status: 'active' })
    })).mockResolvedValue({ name: 'new.example.com', status: 'active' })
    const old = s.tnLoadDomain()
    s.tnClearDomain()
    await s.tnLoadDomain()
    finish()
    await old
    expect(s.tnDomain.value?.name).toBe('new.example.com')
    expect(s.tnDomainLoading.value).toBe(false)
  })
})
