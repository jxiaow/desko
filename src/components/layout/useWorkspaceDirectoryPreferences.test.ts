import { beforeEach, expect, it, vi } from 'vitest'
import { settingsApi } from '../../services/api/settings'
import { isCodexWebRuntime } from '../../services/runtime'
import { useWorkspaceDirectoryPreferences } from './useWorkspaceDirectoryPreferences'

vi.mock('../../services/api/settings', () => ({ settingsApi: { getSetting: vi.fn(), setSetting: vi.fn() } }))
vi.mock('../../services/runtime', () => ({ isCodexWebRuntime: vi.fn(() => false) }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(isCodexWebRuntime).mockReturnValue(false)
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
  vi.mocked(settingsApi.getSetting).mockResolvedValue('')
  vi.mocked(settingsApi.setSetting).mockResolvedValue(undefined)
})

it.each(['', '{', 'null', '[]', 'false'])('无有效目录偏好 %s 时默认收起', async saved => {
  vi.mocked(settingsApi.getSetting).mockResolvedValue(saved)
  const preferences = useWorkspaceDirectoryPreferences()
  await preferences.restore()
  expect(preferences.open.value).toEqual({})
  expect(settingsApi.setSetting).not.toHaveBeenCalled()
})

it('仅恢复有目录的模块与布尔值，不在读取时回写', async () => {
  vi.mocked(settingsApi.getSetting).mockResolvedValue('{"notes":true,"entries":false,"codex":true,"unknown":true}')
  const preferences = useWorkspaceDirectoryPreferences()
  await preferences.restore()
  expect(preferences.open.value).toEqual({ notes: true, entries: false, codex: true })
  vi.mocked(settingsApi.getSetting).mockResolvedValue('{"notes":"true","entries":null}')
  await preferences.restore()
  expect(preferences.open.value).toEqual({})
  expect(settingsApi.setSetting).not.toHaveBeenCalled()
})

it('读取失败仍可打开并保存目录', async () => {
  vi.mocked(settingsApi.getSetting).mockRejectedValue(new Error('unavailable'))
  const preferences = useWorkspaceDirectoryPreferences()
  await preferences.restore()
  await preferences.setVisible('notes', true)
  expect(preferences.open.value.notes).toBe(true)
  expect(settingsApi.setSetting).toHaveBeenCalledWith('workspace_directory_open', '{"notes":true}')
})

it('快速开关串行保存，后续操作不会被较早的写入覆盖', async () => {
  let finishFirst!: () => void
  vi.mocked(settingsApi.setSetting).mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))
  const preferences = useWorkspaceDirectoryPreferences()
  const first = preferences.setVisible('notes', true)
  const second = preferences.setVisible('entries', true)
  const third = preferences.setVisible('notes', false)
  await vi.waitFor(() => expect(settingsApi.setSetting).toHaveBeenCalledTimes(1))
  expect(preferences.open.value).toEqual({ notes: false, entries: true })
  finishFirst()
  await Promise.all([first, second, third])
  expect(settingsApi.setSetting).toHaveBeenLastCalledWith('workspace_directory_open', '{"notes":false,"entries":true}')
  expect(settingsApi.setSetting).toHaveBeenCalledTimes(3)
})

it('一次保存失败不阻断后续保存，也不回滚当前展开状态', async () => {
  vi.mocked(settingsApi.setSetting).mockRejectedValueOnce(new Error('unavailable'))
  const preferences = useWorkspaceDirectoryPreferences()
  await expect(preferences.setVisible('notes', true)).rejects.toThrow('unavailable')
  expect(preferences.open.value.notes).toBe(true)
  await preferences.setVisible('entries', true)
  expect(settingsApi.setSetting).toHaveBeenLastCalledWith('workspace_directory_open', '{"notes":true,"entries":true}')
})

it('展开和固定状态分别恢复，不会把旧展开设置当成固定', async () => {
  vi.mocked(settingsApi.getSetting).mockImplementation(async key => key === 'workspace_directory_open' ? '{"notes":true}' : '{"entries":true}')
  const preferences = useWorkspaceDirectoryPreferences()
  await preferences.restore()
  expect(preferences.open.value).toEqual({ notes: true })
  expect(preferences.pinned.value).toEqual({ entries: true })
})

it('固定状态按模块保存，手动关闭不会清除固定状态', async () => {
  const preferences = useWorkspaceDirectoryPreferences()
  await preferences.setPinned('notes', true)
  await preferences.setVisible('notes', false)
  expect(preferences.pinned.value.notes).toBe(true)
  expect(settingsApi.setSetting).toHaveBeenCalledWith('workspace_directory_pinned', '{"notes":true}')
  await preferences.setPinned('entries', true)
  await preferences.setPinned('notes', false)
  expect(settingsApi.setSetting).toHaveBeenLastCalledWith('workspace_directory_pinned', '{"notes":false,"entries":true}')
})

it('固定保存失败不阻断随后取消固定或打开目录', async () => {
  const preferences = useWorkspaceDirectoryPreferences()
  vi.mocked(settingsApi.setSetting).mockRejectedValueOnce(new Error('unavailable'))
  await expect(preferences.setPinned('notes', true)).rejects.toThrow('unavailable')
  await preferences.setVisible('notes', true)
  await preferences.setPinned('notes', false)
  expect(preferences.pinned.value.notes).toBe(false)
  expect(settingsApi.setSetting).toHaveBeenLastCalledWith('workspace_directory_pinned', '{"notes":false}')
})

it('独立 Codex Web 在浏览器恢复与保存目录偏好，不调用受限的原生设置接口', async () => {
  vi.mocked(isCodexWebRuntime).mockReturnValue(true)
  localStorage.setItem('desko.codex.web.workspace_directory_open', '{"codex":true}')
  localStorage.setItem('desko.codex.web.workspace_directory_pinned', '{"codex":true}')
  const preferences = useWorkspaceDirectoryPreferences()
  await preferences.restore()
  expect(preferences.open.value).toEqual({ codex: true })
  expect(preferences.pinned.value).toEqual({ codex: true })
  await preferences.setVisible('codex', false)
  await preferences.setPinned('codex', false)
  expect(localStorage.getItem('desko.codex.web.workspace_directory_open')).toBe('{"codex":false}')
  expect(localStorage.getItem('desko.codex.web.workspace_directory_pinned')).toBe('{"codex":false}')
  expect(settingsApi.getSetting).not.toHaveBeenCalled()
  expect(settingsApi.setSetting).not.toHaveBeenCalled()
})
