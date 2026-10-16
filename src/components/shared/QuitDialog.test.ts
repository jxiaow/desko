import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { listen } from '@tauri-apps/api/event'
import QuitDialog from './QuitDialog.vue'

const { invoke, flushSave, auth, off } = vi.hoisted(() => ({
  invoke: vi.fn(), flushSave: vi.fn(), auth: { appState: 'unlocked' }, off: vi.fn(),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('../../services/transport', () => ({ invoke }))
vi.mock('../../stores/notes', () => ({ useNotesStore: () => ({ flushNoteSave: flushSave }) }))
vi.mock('../../stores/auth', () => ({ useAuthStore: () => auth }))

let wrapper: VueWrapper
beforeEach(() => {
  vi.resetAllMocks()
  auth.appState = 'unlocked'
  vi.mocked(listen).mockResolvedValue(off)
})
afterEach(() => wrapper?.unmount())

async function open() {
  vi.mocked(listen).mock.calls[0][1]({ event: 'tray-quit', id: 1, payload: null })
  await flushPromises()
}

it('等待保存完成后才退出，重复确认与 Esc 不会中断正在退出的操作', async () => {
  let saved!: () => void
  flushSave.mockImplementation(() => new Promise<void>(resolve => { saved = resolve }))
  wrapper = mount(QuitDialog, { attachTo: document.body })
  await flushPromises()
  await open()
  await wrapper.get('.btn-danger').trigger('click')
  expect(invoke).not.toHaveBeenCalled()
  expect(wrapper.get('.btn-danger').attributes('disabled')).toBeDefined()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
  saved()
  await flushPromises()
  expect(flushSave).toHaveBeenCalledTimes(1)
  expect(invoke).toHaveBeenCalledExactlyOnceWith('quit_app')
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
})

it('保存失败时保留确认框与错误信息，重试成功后才退出', async () => {
  flushSave.mockRejectedValueOnce(new Error('无法写入小记')).mockResolvedValue(undefined)
  wrapper = mount(QuitDialog)
  await flushPromises()
  await open()
  await wrapper.get('.btn-danger').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('无法写入小记')
  expect(invoke).not.toHaveBeenCalled()
  await wrapper.get('.btn-danger').trigger('click')
  await flushPromises()
  expect(invoke).toHaveBeenCalledExactlyOnceWith('quit_app')
})

it('锁定时也能退出，不调用依赖解锁的小记保存', async () => {
  auth.appState = 'locked'
  wrapper = mount(QuitDialog)
  await flushPromises()
  await open()
  await wrapper.get('.btn-danger').trigger('click')
  await flushPromises()
  expect(flushSave).not.toHaveBeenCalled()
  expect(invoke).toHaveBeenCalledExactlyOnceWith('quit_app')
})

it('退出命令失败后恢复按钮，允许取消', async () => {
  invoke.mockRejectedValueOnce('窗口已失效')
  wrapper = mount(QuitDialog)
  await flushPromises()
  await open()
  await wrapper.get('.btn-danger').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('窗口已失效')
  await wrapper.get('.btn-secondary').trigger('click')
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
})

it('卸载发生在监听注册完成前，也会释放监听', async () => {
  let registered!: (value: () => void) => void
  vi.mocked(listen).mockImplementation(() => new Promise(resolve => { registered = resolve }))
  wrapper = mount(QuitDialog)
  wrapper.unmount()
  registered(off)
  await flushPromises()
  expect(off).toHaveBeenCalledTimes(1)
})
