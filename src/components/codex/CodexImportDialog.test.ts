import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { useToastStore } from '../../stores/toast'
import CodexImportDialog from './CodexImportDialog.vue'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn().mockResolvedValue(['C:/synthetic/auth.json']) }))
const mockInvoke = vi.mocked(invoke)
let wrapper: VueWrapper | undefined
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mockInvoke.mockImplementation(async cmd => {
    if (cmd === 'get_codex_storage_paths') return { authPath: 'C:/synthetic/auth.json' }
    if (cmd === 'list_codex_accounts') return []
    if (cmd === 'get_current_codex_account') return null
    if (cmd === 'import_codex_from_json') return [{ email: 'synthetic@example.invalid' }]
    return { email: 'synthetic@example.invalid' }
  })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

for (const source of ['local', 'json', 'token']) {
  it(`${source} 来源成功导入统一报告完成，每个视图只提供一个底栏主操作`, async () => {
    wrapper = mount(CodexImportDialog)
    await flushPromises()
    await wrapper.get(`#codex-import-${source}`).trigger('click')
    if (source === 'json') await wrapper.get('#cx-paste').setValue('[{"synthetic":true}]')
    if (source === 'token') {
      await wrapper.get('#cx-token-name').setValue('synthetic')
      await wrapper.get('#cx-access-token').setValue('at-synthetic-token')
    }
    expect(wrapper.findAll('.btn-primary')).toHaveLength(1)
    expect(wrapper.get('.dialog-footer button').text()).toBe('取消')
    await wrapper.get('.dialog-footer .btn-primary').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('imported')).toHaveLength(1)
  })
}

it('文件部分失败保留来源与错误，不关闭窗口，成功导入仍刷新列表', async () => {
  mockInvoke.mockImplementation(async cmd => {
    if (cmd === 'import_codex_from_files') return {
      imported: [{ email: 'ok@example.invalid' }],
      failed: [{ email: 'C:/synthetic/bad.json', error: 'invalid JSON' }],
    }
    if (cmd === 'list_codex_accounts') return []
    return null
  })
  wrapper = mount(CodexImportDialog)
  await wrapper.get('#codex-import-file').trigger('click')
  await wrapper.get('.import-content button').trigger('click')
  await flushPromises()
  await wrapper.get('.dialog-footer .btn-primary').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('C:/synthetic/bad.json：invalid JSON')
  expect(wrapper.get('[role="alert"]').text()).toContain('已导入 1 条')
  expect(wrapper.emitted('imported')).toBeUndefined()
  expect(mockInvoke.mock.calls.some(([cmd]) => cmd === 'list_codex_accounts')).toBe(true)
})

it('失败后保留输入并允许重试，提交在途禁止切换来源', async () => {
  let fail!: (reason: Error) => void
  mockInvoke.mockImplementation(async cmd => cmd === 'import_codex_from_json'
    ? new Promise((_, reject) => { fail = reject }) : null)
  wrapper = mount(CodexImportDialog)
  await wrapper.get('#codex-import-json').trigger('click')
  await wrapper.get('#cx-paste').setValue('synthetic invalid JSON')
  await wrapper.get('.dialog-footer .btn-primary').trigger('click')
  expect(wrapper.findAll('[role="tab"]').every(tab => tab.attributes('disabled') !== undefined)).toBe(true)
  fail(new Error('synthetic failure'))
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('synthetic failure')
  expect((wrapper.get('#cx-paste').element as HTMLTextAreaElement).value).toBe('synthetic invalid JSON')
  expect(wrapper.get('.dialog-footer .btn-primary').attributes('disabled')).toBeUndefined()
})

it('本机导入期间卸载，迟到结果不显示邮箱或刷新列表', async () => {
  let finish!: (value: unknown) => void
  mockInvoke.mockImplementation(async cmd => cmd === 'import_codex_from_local'
    ? new Promise(resolve => { finish = resolve }) : null)
  wrapper = mount(CodexImportDialog)
  await wrapper.get('.dialog-footer .btn-primary').trigger('click')
  wrapper.unmount()
  wrapper = undefined
  finish({ email: 'private@example.invalid' })
  await flushPromises()
  expect(mockInvoke.mock.calls.some(([cmd]) => cmd === 'list_codex_accounts')).toBe(false)
  expect(useToastStore().toast.show).toBe(false)
})
