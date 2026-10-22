import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { getCurrentWindow } from '@tauri-apps/api/window'
import TitleBar from './TitleBar.vue'
import Sidebar from './Sidebar.vue'
import NoteFullscreen from '../notes/NoteFullscreen.vue'

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn(() => { throw new Error('no native window in browser') }) }))
vi.mock('vue-router', () => ({ useRoute: () => ({ meta: {}, path: '/notes' }) }))
vi.mock('../../modules/state', () => ({ enabledModules: [] }))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  const meta = document.createElement('meta')
  meta.name = 'desko-runtime'
  meta.content = 'web'
  document.head.append(meta)
})
afterEach(() => document.querySelectorAll('meta[name="desko-runtime"]').forEach(meta => meta.remove()))

describe('浏览器窗口控件', () => {
  it('标题栏隐藏原生窗口与备份控件，侧栏收起时退出入口才回到带子', async () => {
    const wrapper = mount(TitleBar, { props: { sidebarHidden: true }, global: { stubs: { AppIcon: true, BackupBadge: true } } })
    expect(wrapper.find('[title="最小化"]').exists()).toBe(false)
    expect(wrapper.find('[title="最大化"]').exists()).toBe(false)
    expect(wrapper.find('[title="关闭"]').exists()).toBe(false)
    expect(wrapper.find('backup-badge-stub').exists()).toBe(false)
    await wrapper.get('.titlebar-drag').trigger('mousedown')
    await wrapper.get('.titlebar-drag').trigger('dblclick')
    await wrapper.get('[title="退出浏览器访问"]').trigger('click')
    expect(wrapper.emitted('lock')).toHaveLength(1)
    expect(getCurrentWindow).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('侧栏在位时带子不带设置与退出，两份入口不并存', async () => {
    const wrapper = mount(TitleBar, { global: { stubs: { AppIcon: true, BackupBadge: true } } })
    expect(wrapper.find('[title="设置"]').exists()).toBe(false)
    expect(wrapper.find('[title="退出浏览器访问"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('轨底承担设置与退出', async () => {
    const sidebar = mount(Sidebar, { props: { collapsed: true }, global: { stubs: { AppIcon: true, RouterLink: true } } })
    await sidebar.get('.sidebar-foot button[title="设置"]').trigger('click')
    await sidebar.get('.sidebar-foot button[title="退出浏览器访问"]').trigger('click')
    expect(sidebar.emitted('openSettings')).toHaveLength(1)
    expect(sidebar.emitted('lock')).toHaveLength(1)
    sidebar.unmount()
  })
  it('侧栏和小记全屏的标题拖动不调用原生窗口', async () => {
    const sidebar = shallowMount(Sidebar, { props: { collapsed: false }, global: { stubs: { RouterLink: true } } })
    await sidebar.get('.sidebar-top').trigger('mousedown')
    await sidebar.get('.sidebar-top').trigger('dblclick')
    const fullscreen = shallowMount(NoteFullscreen, { props: { note: null, initialHtml: '', mode: 'view' }, global: { stubs: { Teleport: false } } })
    await fullscreen.get('.fs-head').trigger('mousedown')
    expect(getCurrentWindow).not.toHaveBeenCalled()
    sidebar.unmount()
    fullscreen.unmount()
  })
})
