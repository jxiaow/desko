import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { listen } from '@tauri-apps/api/event'
import { useAuthStore } from '../stores/auth'
import { useAutoLock } from './useAutoLock'

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('../services/api/settings', () => ({ settingsApi: { getSetting: vi.fn(async () => '1') } }))

afterEach(() => {
  vi.useRealTimers()
  document.querySelectorAll('meta[name="desko-runtime"]').forEach(meta => meta.remove())
})

it('浏览器不注册 tray-lock；闲置退出只走传入的浏览器退出函数', async () => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  const meta = document.createElement('meta')
  meta.name = 'desko-runtime'
  meta.content = 'web'
  document.head.append(meta)
  const auth = useAuthStore()
  auth.appState = 'unlocked'
  const logout = vi.fn(async () => { auth.appState = 'locked' })
  const evict = vi.fn()
  const wrapper = mount(defineComponent({ setup() { useAutoLock(logout, evict); return () => null } }))
  await vi.advanceTimersByTimeAsync(60_000)
  expect(listen).not.toHaveBeenCalled()
  expect(logout).toHaveBeenCalledExactlyOnceWith({ forced: true })
  wrapper.unmount()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(logout).toHaveBeenCalledTimes(1)
})
