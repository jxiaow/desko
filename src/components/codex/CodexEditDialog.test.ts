import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { codexApi, type CodexAccount } from '../../services/api/codex'
import { refreshAccounts } from '../../services/codexState'
import { useConfirmStore } from '../../stores/confirm'
import { useToastStore } from '../../stores/toast'
import CodexEditDialog from './CodexEditDialog.vue'

vi.mock('../../services/api/codex', () => ({
  codexApi: { updateApiKey: vi.fn(), setName: vi.fn(), setNote: vi.fn(), setTags: vi.fn() },
}))
vi.mock('../../services/codexState', () => ({ refreshAccounts: vi.fn() }))

const account = { id: 'one', email: 'account@example.com', auth_mode: 'apikey' } as CodexAccount

describe('更换密钥确认的生命周期', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
  })

  it('确认前锁定卸载弹窗，即使旧确认回调被调用也不能写凭据', async () => {
    const wrapper = mount(CodexEditDialog, { props: { account } })
    await wrapper.get('#cx-newkey').setValue('sk-synthetic')
    await wrapper.get('.dialog-footer .btn-primary').trigger('click')
    expect(useConfirmStore().confirmDialog.show).toBe(true)
    expect(codexApi.updateApiKey).not.toHaveBeenCalled()
    wrapper.unmount()
    useConfirmStore().handleConfirm()
    await flushPromises()
    expect(codexApi.updateApiKey).not.toHaveBeenCalled()
    expect(codexApi.setName).not.toHaveBeenCalled()
  })

  it('写凭据期间锁定卸载后，迟到的结果不继续写资料或显示邮箱', async () => {
    let finish!: (value: CodexAccount) => void
    vi.mocked(codexApi.updateApiKey).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(CodexEditDialog, { props: { account } })
    await wrapper.get('#cx-newkey').setValue('sk-synthetic')
    await wrapper.get('.dialog-footer .btn-primary').trigger('click')
    useConfirmStore().handleConfirm()
    expect(codexApi.updateApiKey).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    finish({ ...account, id: 'new' })
    await flushPromises()
    expect(codexApi.setName).not.toHaveBeenCalled()
    expect(refreshAccounts).not.toHaveBeenCalled()
    expect(useToastStore().toast.show).toBe(false)
  })
})
