import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { settingsApi } from '../../services/api/settings'
import WebSettingsDialog from './WebSettingsDialog.vue'
import { appearance, chooseTheme, chooseAccent, chooseBackgroundAtmosphere } from '../../services/theme'

vi.mock('../../services/api/settings', () => ({ settingsApi: { setSetting: vi.fn(async () => {}) } }))

it('浏览器设置复用主题设置且退出只通知父级', async () => {
  setActivePinia(createPinia())
  const wrapper = mount(WebSettingsDialog)
  expect(wrapper.text()).not.toContain('备份')
  expect(wrapper.text()).toContain('桌面主密码一致')
  expect(wrapper.text()).toContain('不影响电脑上 Desko 的锁定状态')
  await wrapper.findAll('.web-theme').find(button => button.text() === '墨')!.trigger('click')
  await flushPromises()
  expect(settingsApi.setSetting).toHaveBeenCalledWith('theme', 'ink')
  await wrapper.get('.dialog-footer .btn-secondary').trigger('click')
  expect(wrapper.emitted('lock')).toHaveLength(1)
  wrapper.unmount()
})

it.each(['purewhite', 'warmgray', 'charcoal'] as const)('%s 在浏览器设置中也能独立开关氛围，保留底色和强调色', async (theme) => {
  setActivePinia(createPinia())
  await chooseTheme(theme)
  await chooseAccent('rose')
  await chooseBackgroundAtmosphere(true)
  const wrapper = mount(WebSettingsDialog)
  const toggle = wrapper.get<HTMLInputElement>('.web-atmosphere input')
  expect(toggle.element.disabled).toBe(false)
  await toggle.setValue(false)
  await flushPromises()
  expect(appearance).toMatchObject({ theme, accent: 'rose', backgroundAtmosphere: false })
  expect(settingsApi.setSetting).toHaveBeenLastCalledWith('background_atmosphere', 'false')
  await toggle.setValue(true)
  await flushPromises()
  expect(appearance).toMatchObject({ theme, accent: 'rose', backgroundAtmosphere: true })
  expect(settingsApi.setSetting).toHaveBeenLastCalledWith('background_atmosphere', 'true')
  wrapper.unmount()
})
