import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { codexApi, type CodexAccount } from '../../services/api/codex'
import { refreshAccounts } from '../../services/codexState'
import { useToastStore } from '../../stores/toast'
import ResetCreditDialog from './ResetCreditDialog.vue'

vi.mock('../../services/api/codex', () => ({
  codexApi: { resetCredits: vi.fn(), consumeResetCredit: vi.fn() },
}))
vi.mock('../../services/codexState', () => ({ refreshAccounts: vi.fn() }))

const account = { id: 'one', email: 'account@example.com', quota: { reset_credits_available: 1 } } as CodexAccount
const available = { available_count: 1, credits: [], next_expires_at: null }

describe('额度重置确认', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    vi.mocked(codexApi.resetCredits).mockResolvedValue(available)
    vi.mocked(codexApi.consumeResetCredit).mockResolvedValue(undefined)
    vi.mocked(refreshAccounts).mockResolvedValue(undefined)
  })

  it('以新明细为准，没有可用次数时不能消耗列表里的旧次数', async () => {
    vi.mocked(codexApi.resetCredits).mockResolvedValue({ ...available, available_count: 0 })
    const wrapper = mount(ResetCreditDialog, { props: { account } })
    expect(wrapper.get('.btn-danger').attributes('disabled')).toBeDefined()
    await flushPromises()
    expect(wrapper.text()).toContain('当前没有可用的重置次数')
    await wrapper.get('.btn-danger').trigger('click')
    expect(codexApi.consumeResetCredit).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('明细失败时禁止重置，重试成功仍须点击确认；取消不执行', async () => {
    vi.mocked(codexApi.resetCredits).mockRejectedValueOnce('请求失败')
    const wrapper = mount(ResetCreditDialog, { props: { account } })
    await flushPromises()
    expect(wrapper.text()).toContain('请求失败')
    expect(wrapper.get('.btn-danger').attributes('disabled')).toBeDefined()
    await wrapper.get('.rc-error button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.btn-danger').text()).toBe('确认重置')
    expect(wrapper.get('.btn-danger').attributes('disabled')).toBeUndefined()
    expect(codexApi.consumeResetCredit).not.toHaveBeenCalled()
    await wrapper.get('.dialog-footer .btn-secondary').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(codexApi.consumeResetCredit).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('重置在途重复点击不会重复扣次，关闭与 Escape 等到操作结束', async () => {
    let finish!: () => void
    vi.mocked(codexApi.consumeResetCredit).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(ResetCreditDialog, { props: { account } })
    await flushPromises()
    await wrapper.get('.btn-danger').trigger('click')
    await wrapper.get('.btn-danger').trigger('click')
    await wrapper.get('.dialog-close').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(codexApi.consumeResetCredit).toHaveBeenCalledTimes(1)
    finish()
    await flushPromises()
    expect(refreshAccounts).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('锁定卸载弹窗后，迟到的重置结果不显示成功提示或重读账号', async () => {
    let finish!: () => void
    vi.mocked(codexApi.consumeResetCredit).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(ResetCreditDialog, { props: { account } })
    await flushPromises()
    await wrapper.get('.btn-danger').trigger('click')
    wrapper.unmount()
    finish()
    await flushPromises()
    expect(refreshAccounts).not.toHaveBeenCalled()
    expect(useToastStore().toast.show).toBe(false)
  })

  it('重置返回错误后先重读余次，不用旧快照再次扣次', async () => {
    vi.mocked(codexApi.resetCredits)
      .mockResolvedValueOnce(available)
      .mockResolvedValueOnce({ ...available, available_count: 0 })
    vi.mocked(codexApi.consumeResetCredit).mockRejectedValueOnce('响应中断')
    const wrapper = mount(ResetCreditDialog, { props: { account } })
    await flushPromises()
    await wrapper.get('.btn-danger').trigger('click')
    await flushPromises()
    expect(codexApi.resetCredits).toHaveBeenCalledTimes(2)
    expect(wrapper.get('.btn-danger').attributes('disabled')).toBeDefined()
    await wrapper.get('.btn-danger').trigger('click')
    expect(codexApi.consumeResetCredit).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
