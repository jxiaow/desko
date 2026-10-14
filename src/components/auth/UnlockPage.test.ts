import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { authApi } from '../../services/api/auth'
import UnlockPage from './UnlockPage.vue'

vi.mock('../../services/api/auth', () => ({ authApi: { unlock: vi.fn() } }))

describe('刷新后的主密码解锁', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('验证期间连续提交与 Enter 松键只执行一次解锁', async () => {
    let finish!: () => void
    vi.mocked(authApi.unlock).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(UnlockPage, { global: { stubs: { AmbientBackground: true, BrandLogo: true, AppIcon: true } } })
    await wrapper.get('input').setValue('test-master-password')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('input').trigger('keyup', { key: 'Enter' })
    await wrapper.get('form').trigger('submit')
    expect(authApi.unlock).toHaveBeenCalledOnce()
    expect(wrapper.get('.unlock-btn').attributes('disabled')).toBeDefined()
    finish()
    await flushPromises()
    expect(wrapper.emitted('unlockComplete')).toHaveLength(1)
    wrapper.unmount()
  })

  it('密码错误后结束等待，允许重新输入并解锁', async () => {
    vi.mocked(authApi.unlock).mockRejectedValueOnce('密码错误').mockResolvedValueOnce(undefined)
    const wrapper = mount(UnlockPage, { global: { stubs: { AmbientBackground: true, BrandLogo: true, AppIcon: true } } })
    const stack = wrapper.get('.lock-stack').element as HTMLElement
    stack.animate = vi.fn() as any
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('.unlock-error').text()).toBe('主密码错误，请重试')
    expect(wrapper.get('.unlock-btn').attributes('disabled')).toBeUndefined()
    await wrapper.get('input').setValue('correct-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(authApi.unlock).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('unlockComplete')).toHaveLength(1)
    wrapper.unmount()
  })
})
