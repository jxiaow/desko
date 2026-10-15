import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { settingsApi } from '../../services/api/settings'
import WebSettingsDialog from './WebSettingsDialog.vue'

vi.mock('../../services/api/settings', () => ({ settingsApi: { setSetting: vi.fn(async () => {}) } }))

it('浏览器设置仅外观与退出，复用主题设置且退出只通知父级', async () => {
  setActivePinia(createPinia())
  const wrapper = mount(WebSettingsDialog)
  expect(wrapper.text()).not.toContain('备份')
  expect(wrapper.text()).not.toContain('档案')
  expect(wrapper.text()).toContain('不影响电脑上 Desko 的锁定状态')
  await wrapper.findAll('.web-theme').find(button => button.text() === '墨')!.trigger('click')
  await flushPromises()
  expect(settingsApi.setSetting).toHaveBeenCalledWith('theme', 'ink')
  await wrapper.get('.dialog-footer .btn-secondary').trigger('click')
  expect(wrapper.emitted('lock')).toHaveLength(1)
  wrapper.unmount()
})
