import { beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { webAccessApi } from '../../services/api/webAccess'
import { useConfirmStore } from '../../stores/confirm'
import WebAccessPane from './WebAccessPane.vue'

vi.mock('../../services/api/webAccess', () => ({ webAccessApi: { status: vi.fn(), start: vi.fn(), stop: vi.fn() } }))
const stopped = { running: false, lan: false, port: 8420, urls: [] }
beforeEach(() => { setActivePinia(createPinia()); vi.resetAllMocks(); vi.mocked(webAccessApi.status).mockResolvedValue(stopped) })

it('LAN confirmation after pane unmount cannot start a server', async () => {
  const wrapper = mount(WebAccessPane)
  await wrapper.get('input[type=checkbox]').setValue(true)
  await wrapper.get('form').trigger('submit')
  expect(useConfirmStore().confirmDialog.show).toBe(true)
  wrapper.unmount()
  useConfirmStore().handleConfirm()
  await flushPromises()
  expect(webAccessApi.start).not.toHaveBeenCalled()
})

it('old status poll cannot overwrite a completed server start', async () => {
  let finish!: (value: typeof stopped) => void
  vi.mocked(webAccessApi.status).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  vi.mocked(webAccessApi.start).mockResolvedValue({ ...stopped, running: true, urls: ['http://127.0.0.1:8420'] })
  const wrapper = mount(WebAccessPane)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(wrapper.text()).toContain('服务运行中')
  expect(webAccessApi.start).toHaveBeenCalledWith({ port: 8420, lan: false, kind: 'app' })
  expect(wrapper.find('input[type=password]').exists()).toBe(false)
  finish(stopped)
  await flushPromises()
  expect(wrapper.text()).toContain('服务运行中')
  wrapper.unmount()
})


it('stopping the server needs confirmation; cancel does not revoke browser sessions', async () => {
  vi.mocked(webAccessApi.status).mockResolvedValue({ ...stopped, running: true })
  const wrapper = mount(WebAccessPane)
  await flushPromises()
  await wrapper.get('button').trigger('click')
  expect(useConfirmStore().confirmDialog.title).toBe('停止 Web 服务？')
  expect(useConfirmStore().confirmDialog.message).toContain('未保存的编辑可能丢失')
  expect(webAccessApi.stop).not.toHaveBeenCalled()
  useConfirmStore().clearConfirm()
  expect(webAccessApi.stop).not.toHaveBeenCalled()
  await wrapper.get('button').trigger('click')
  useConfirmStore().handleConfirm()
  await flushPromises()
  expect(webAccessApi.stop).toHaveBeenCalledTimes(1)
  wrapper.unmount()
})
