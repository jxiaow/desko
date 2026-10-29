import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { settingsApi } from '../api/settings'
import { initializeSidebar, setSidebarCollapsed, sidebarCollapsed } from '../sidebar'

vi.mock('../api/settings', () => ({ settingsApi: { getSetting: vi.fn(), setSetting: vi.fn() } }))
vi.mock('../runtime', () => ({ isWebRuntime: () => false }))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.mocked(settingsApi.setSetting).mockResolvedValue(undefined)
})

it.each([
  ['', false],
  ['false', false],
  ['true', true],
  ['invalid', false],
])('读取 %s 得到 %s，不写回设置', async (raw, expected) => {
  vi.mocked(settingsApi.getSetting).mockResolvedValue(raw)
  await initializeSidebar()
  expect(sidebarCollapsed.value).toBe(expected)
  expect(settingsApi.setSetting).not.toHaveBeenCalled()
})

it('切换后立即更新交互状态并按顺序持久化', async () => {
  vi.mocked(settingsApi.getSetting).mockResolvedValue('')
  await initializeSidebar()
  await setSidebarCollapsed(true)
  expect(sidebarCollapsed.value).toBe(true)
  expect(settingsApi.setSetting).toHaveBeenCalledWith('sidebar_collapsed', 'true')
  await setSidebarCollapsed(false)
  expect(sidebarCollapsed.value).toBe(false)
  expect(settingsApi.setSetting).toHaveBeenLastCalledWith('sidebar_collapsed', 'false')
})

it('保存失败保留当前交互状态，不阻断后续切换', async () => {
  vi.mocked(settingsApi.getSetting).mockResolvedValue('')
  vi.mocked(settingsApi.setSetting).mockRejectedValueOnce(new Error('db'))
  await initializeSidebar()
  await expect(setSidebarCollapsed(true)).resolves.toBeUndefined()
  expect(sidebarCollapsed.value).toBe(true)
  await setSidebarCollapsed(false)
  expect(sidebarCollapsed.value).toBe(false)
  expect(settingsApi.setSetting).toHaveBeenLastCalledWith('sidebar_collapsed', 'false')
})
