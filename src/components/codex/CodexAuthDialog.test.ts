import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { useToastStore } from '../../stores/toast'
import CodexAuthDialog from './CodexAuthDialog.vue'
import { listen, type EventCallback } from '@tauri-apps/api/event'
import { accounts, clearCodexSession } from '../../services/codexState'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('../../utils/openExternal', () => ({ openExternal: vi.fn().mockResolvedValue(undefined) }))

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
    await wrapper.get('.auth-import-link').trigger('click')
    await flushPromises()
    await wrapper.get('#codex-import-token').trigger('click')
    await wrapper.get('#cx-token-name').setValue('私密账号')
    await wrapper.get('#cx-access-token').setValue('at-synthetic-token')
    await wrapper.get('.codex-import-dialog .dialog-footer .btn-primary').trigger('click')
    wrapper.unmount()
    finish({ email: 'private@example.com' })
    await flushPromises()
    expect(useToastStore().toast.show).toBe(false)
    expect(useToastStore().toast.message).toBe('')
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === 'list_codex_accounts')).toBe(false)
  })
})

describe('Codex 授权状态与键盘操作', () => {
  const handlers = new Map<string, EventCallback<unknown>>()
  const wrappers: ReturnType<typeof mount>[] = []
  const mockInvoke = vi.mocked(invoke)
  const fakeAccount = { id: 'existing', email: 'synthetic@example.invalid', account_name: '工作账号' }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    clearCodexSession()
    handlers.clear()
    vi.mocked(listen).mockImplementation(async (name, handler) => {
      handlers.set(String(name), handler as EventCallback<unknown>)
      return () => { handlers.delete(String(name)) }
    })
    mockInvoke.mockImplementation(async cmd => {
      if (cmd === 'codex_oauth_login_start') return { loginId: 'oauth-1', authUrl: 'https://auth.example.invalid/login' }
      if (cmd === 'codex_oauth_device_auth_start') return { loginId: 'device-1', userCode: 'TEST-CODE', verificationUrl: 'https://auth.example.invalid/activate' }
      if (cmd === 'codex_oauth_login_completed' || cmd === 'add_codex_account_with_api_key') return fakeAccount
      if (cmd === 'list_codex_accounts') return []
      if (cmd === 'is_codex_oauth_port_in_use') return false
      return null
    })
  })
  afterEach(() => {
    wrappers.forEach(wrapper => wrapper.unmount())
    wrappers.length = 0
    document.body.innerHTML = ''
  })
  async function open(props = {}) {
    const wrapper = mount(CodexAuthDialog, { props, attachTo: document.body })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
  }
  function event(name: string, payload: unknown) { handlers.get(name)?.({ event: name, id: 1, payload }) }

  it('OAuth 等待中切设备码会取消旧会话，反向切换也不串用载荷', async () => {
    const wrapper = await open()
    await wrapper.get('.dialog-footer .btn-primary').trigger('click')
    await flushPromises()
    const oldCompleted = handlers.get('codex-oauth-login-completed')!
    await wrapper.get('#codex-auth-device').trigger('click')
    await flushPromises()
    expect(mockInvoke).toHaveBeenCalledWith('codex_oauth_login_cancel', { loginId: 'oauth-1' })
    expect(wrapper.find('.code-label').exists()).toBe(false)
    expect(wrapper.find('.url').exists()).toBe(false)
    expect(wrapper.get('.dialog-footer .btn-primary').text()).toBe('取设备码')
    oldCompleted({ event: 'codex-oauth-login-completed', id: 1, payload: { loginId: 'oauth-1' } })
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === 'codex_oauth_login_completed')).toBe(false)
    await wrapper.get('.dialog-footer .btn-primary').trigger('click')
    await flushPromises()
    expect(wrapper.get('.code-label').text()).toBe('TEST-CODE')
    await wrapper.get('#codex-auth-oauth').trigger('click')
    await flushPromises()
    expect(mockInvoke).toHaveBeenCalledWith('codex_oauth_login_cancel', { loginId: 'device-1' })
    expect(wrapper.find('#codex-callback').exists()).toBe(false)
    expect(wrapper.get('.dialog-footer .btn-primary').text()).toBe('开始登录')
  })

  for (const mode of ['oauth', 'device']) {
    it(`${mode} 失败后持久显示错误并提供重试，旧复制动作失效`, async () => {
      const wrapper = await open()
      if (mode === 'device') { await wrapper.get('#codex-auth-device').trigger('click'); await flushPromises() }
      await wrapper.get('.dialog-footer .btn-primary').trigger('click')
      await flushPromises()
      const loginId = `${mode}-1`
      event(mode === 'oauth' ? 'codex-oauth-login-timeout' : 'codex-device-auth-error', { loginId, error: 'synthetic failure' })
      await flushPromises()
      expect(wrapper.get('[role="alert"]').text()).toMatch(/授权超时|synthetic failure/)
      expect(wrapper.get('.dialog-footer .btn-primary').text()).toBe(mode === 'oauth' ? '重新发起' : '重新取码')
      expect(wrapper.findAll('.auth-address button, .code-box button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
      await wrapper.get('.dialog-footer .btn-primary').trigger('click')
      await flushPromises()
      expect(mockInvoke).toHaveBeenCalledWith('codex_oauth_login_cancel', { loginId })
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('等待授权')
    })
  }

  it('重登只提供 OAuth 与设备码，显示目标身份且完成时携带原账号 ID', async () => {
    accounts.value = [fakeAccount as any]
    const wrapper = await open({ reauthAccountId: fakeAccount.id })
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('工作账号')
    expect(wrapper.text()).toContain(fakeAccount.email)
    expect(wrapper.find('#codex-auth-apikey').exists()).toBe(false)
    expect(wrapper.find('.auth-import-link').exists()).toBe(false)
    await wrapper.get('#codex-auth-device').trigger('click')
    await flushPromises()
    await wrapper.get('.dialog-footer .btn-primary').trigger('click')
    await flushPromises()
    event('codex-oauth-login-completed', { loginId: 'device-1' })
    event('codex-oauth-login-completed', { loginId: 'device-1' })
    await flushPromises()
    expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === 'codex_oauth_login_completed')).toHaveLength(1)
    expect(mockInvoke).toHaveBeenCalledWith('codex_oauth_login_completed', { loginId: 'device-1', reauthAccountId: fakeAccount.id })
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === 'add_codex_account_with_api_key')).toBe(false)
  })

  it('打开时移焦，Tab 循环限于弹窗，关闭后归还焦点', async () => {
    const previous = document.createElement('button')
    document.body.append(previous)
    previous.focus()
    const wrapper = await open()
    expect(wrapper.get('.auth-dialog').element.contains(document.activeElement)).toBe(true)
    const last = wrapper.get('.dialog-footer .btn-primary')
    ;(last.element as HTMLElement).focus()
    await last.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(wrapper.get('.dialog-close').element)
    await wrapper.get('.dialog-close').trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last.element)
    wrappers.pop()!.unmount()
    expect(document.activeElement).toBe(previous)
  })

  it('键盘发起登录后进入等待态，按钮替换不会使焦点逃出弹窗', async () => {
    const wrapper = await open()
    const submit = wrapper.get('.dialog-footer .btn-primary')
    ;(submit.element as HTMLElement).focus()
    await submit.trigger('click')
    await flushPromises()
    expect(wrapper.get('.auth-dialog').element.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(wrapper.get('.dialog-close').element)
  })

  it('发起请求尚未返回就卸载，会取消迟到会话且不继续监听或打开地址', async () => {
    let finish!: (value: unknown) => void
    mockInvoke.mockImplementation(async cmd => cmd === 'codex_oauth_login_start' ? new Promise(resolve => { finish = resolve }) : false)
    const wrapper = await open()
    await wrapper.get('.dialog-footer .btn-primary').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[role="tab"]').every(tab => tab.attributes('disabled') !== undefined)).toBe(true)
    wrappers.pop()!.unmount()
    finish({ loginId: 'late', authUrl: 'https://auth.example.invalid/late' })
    await flushPromises()
    expect(mockInvoke).toHaveBeenCalledWith('codex_oauth_login_cancel', { loginId: 'late' })
    expect(handlers.size).toBe(0)
    expect(useToastStore().toast.show).toBe(false)
  })

  it('完成授权期间卸载，迟到结果不会刷新账号或显示邮箱', async () => {
    const wrapper = await open()
    await wrapper.get('.dialog-footer .btn-primary').trigger('click')
    await flushPromises()
    let finish!: (value: unknown) => void
    mockInvoke.mockImplementation(async cmd => cmd === 'codex_oauth_login_completed' ? new Promise(resolve => { finish = resolve }) : false)
    event('codex-oauth-login-completed', { loginId: 'oauth-1' })
    await flushPromises()
    wrappers.pop()!.unmount()
    finish(fakeAccount)
    await flushPromises()
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === 'list_codex_accounts')).toBe(false)
    expect(useToastStore().toast.show).toBe(false)
  })
})
