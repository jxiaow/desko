import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { tnRefresh, tnProvision, tnLoadDomain, tnClearDomain } from '../../services/tunnelState'
import TunnelModule from './TunnelModule.vue'

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }))
vi.mock('../../services/tunnelState', async () => {
  const { ref } = await import('vue')
  return {
    tnLoaded: ref(false), tnStatus: ref(null), tnBinary: ref(null), tnProvision: ref(null),
    tnLogin: ref({ state: 'idle', url: null, secondsLeft: 0, note: null }),
    tnPollError: ref(''), tnServices: ref([]), tnRefresh: vi.fn(),
    tnDomain: ref(null), tnDomainLoading: ref(false), tnDomainError: ref(''),
    tnLoadDomain: vi.fn(), tnClearDomain: vi.fn(),
  }
})

describe('授权后返回穿透页面', () => {
  let wrapper: VueWrapper | undefined
  let onFocusChanged: ReturnType<typeof vi.fn>
  const unlisten = vi.fn()

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    tnProvision.value = null
    vi.useFakeTimers()
    vi.mocked(tnRefresh).mockImplementation(() => new Promise(() => {}))
    onFocusChanged = vi.fn().mockResolvedValue(unlisten)
    vi.mocked(getCurrentWindow).mockReturnValue({ onFocusChanged } as any)
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('首轮状态未返回时也监听窗口返回，聚焦立即补刷', async () => {
    wrapper = mount(TunnelModule)
    await flushPromises()
    expect(onFocusChanged).toHaveBeenCalledOnce()
    onFocusChanged.mock.calls[0][0]({ payload: true })
    expect(tnRefresh).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3000)
    expect(tnRefresh).toHaveBeenCalledTimes(3)
  })

  it('原生聚焦监听不可用时，WebView 聚焦仍会补刷；卸载后停止', async () => {
    onFocusChanged.mockRejectedValue('不可用')
    wrapper = mount(TunnelModule)
    await flushPromises()
    window.dispatchEvent(new Event('focus'))
    expect(tnRefresh).toHaveBeenCalledTimes(2)
    wrapper.unmount()
    wrapper = undefined
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(tnRefresh).toHaveBeenCalledTimes(2)
  })

  it('卸载后才注册完成的原生监听立即清理', async () => {
    let finish!: (listener: () => void) => void
    onFocusChanged.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    vi.mocked(tnRefresh).mockResolvedValue(undefined)
    wrapper = mount(TunnelModule)
    await flushPromises()
    wrapper.unmount()
    wrapper = undefined
    finish(unlisten)
    await flushPromises()
    expect(unlisten).toHaveBeenCalledOnce()
  })

  it('识别授权后自动读取主域名，普通轮询不重复读取，撤销后清理', async () => {
    wrapper = mount(TunnelModule)
    tnProvision.value = { step: 'no-tunnel', message: '', tunnelId: null, tunnelName: null, serviceCount: 0, unroutedCount: 0, authorized: true, nameTaken: false }
    await flushPromises()
    expect(tnLoadDomain).toHaveBeenCalledOnce()
    tnProvision.value = { ...tnProvision.value, message: '再次轮询' }
    await flushPromises()
    expect(tnLoadDomain).toHaveBeenCalledOnce()
    tnProvision.value = { ...tnProvision.value, authorized: false }
    await flushPromises()
    expect(tnClearDomain).toHaveBeenCalledOnce()
  })
})
