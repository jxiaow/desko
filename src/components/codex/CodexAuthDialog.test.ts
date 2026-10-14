import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { useToastStore } from '../../stores/toast'
import CodexAuthDialog from './CodexAuthDialog.vue'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

describe('Codex Token 导入的弹窗生命周期', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('导入期间锁屏卸载弹窗，迟到的结果不得显示账号邮箱或重读账号', async () => {
    let finish!: (value: unknown) => void
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'import_codex_access_token_account') return new Promise(resolve => { finish = resolve })
      return false
    })
    const wrapper = mount(CodexAuthDialog)
    await flushPromises()
    await wrapper.findAll('.seg-btn')[3].trigger('click')
    await wrapper.get('#cx-token-name').setValue('私密账号')
    await wrapper.get('#cx-access-token').setValue('at-synthetic-token')
    await wrapper.get('.token-import > button').trigger('click')
    wrapper.unmount()
    finish({ email: 'private@example.com' })
    await flushPromises()
    expect(useToastStore().toast.show).toBe(false)
    expect(useToastStore().toast.message).toBe('')
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === 'list_codex_accounts')).toBe(false)
  })
})
