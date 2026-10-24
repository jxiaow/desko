import { beforeEach, expect, it, vi } from 'vitest'
import { settingsApi } from './api/settings'
import { hudAmbient, hudEnabled, hudPinned, loadHudSettings, saveHudAmbient, saveHudEnabled, saveHudPinned } from './codexHud'

vi.mock('./api/settings', () => ({ settingsApi: { getSetting: vi.fn(), setSetting: vi.fn() } }))

beforeEach(() => {
  vi.resetAllMocks()
  hudEnabled.value = true
  hudPinned.value = false
  hudAmbient.value = true
  vi.mocked(settingsApi.getSetting).mockResolvedValue('bunny')
  vi.mocked(settingsApi.setSetting).mockResolvedValue(undefined)
})

it('a settings read that lands late cannot resurrect the toggle the user just turned off', async () => {
  let finish!: (value: string) => void
  vi.mocked(settingsApi.getSetting).mockImplementation((key: string) =>
    key === 'codex_hud_enabled'
      ? new Promise<string>((resolve) => { finish = resolve })
      : Promise.resolve('bunny'))
  vi.mocked(settingsApi.setSetting).mockResolvedValue(undefined)

  const load = loadHudSettings()
  const save = saveHudEnabled(false)
  finish('true')
  await Promise.all([load, save])

  expect(hudEnabled.value).toBe(false)
})

it('小动作开关写的是 codex_hud_ambient，写失败退回原值', async () => {
  await saveHudAmbient(false)
  expect(settingsApi.setSetting).toHaveBeenCalledWith('codex_hud_ambient', 'false')
  expect(hudAmbient.value).toBe(false)

  vi.mocked(settingsApi.setSetting).mockRejectedValueOnce(new Error('disk full'))
  await expect(saveHudAmbient(true)).rejects.toThrow('disk full')
  expect(hudAmbient.value).toBe(false)
})

it('没存过小动作时保持默认开，只有 false 才关', async () => {
  // 缺键在 Rust 侧读回空串，不是报错：按开处理，老档案不迁移
  vi.mocked(settingsApi.getSetting).mockImplementation((key: string) =>
    Promise.resolve(key === 'codex_hud_ambient' ? '' : 'bunny'))
  await loadHudSettings()
  expect(hudAmbient.value).toBe(true)

  vi.mocked(settingsApi.getSetting).mockImplementation((key: string) =>
    Promise.resolve(key === 'codex_hud_ambient' ? 'false' : 'bunny'))
  await loadHudSettings()
  expect(hudAmbient.value).toBe(false)
})

it('小动作的迟到读同样盖不掉用户刚关的那一下', async () => {
  let finish!: (value: string) => void
  vi.mocked(settingsApi.getSetting).mockImplementation((key: string) =>
    key === 'codex_hud_ambient'
      ? new Promise<string>((resolve) => { finish = resolve })
      : Promise.resolve('bunny'))

  const load = loadHudSettings()
  const save = saveHudAmbient(false)
  finish('true')
  await Promise.all([load, save])

  expect(hudAmbient.value).toBe(false)
})

it('未保存显示设置时默认开启，明确隐藏后不会被读回覆盖', async () => {
  vi.mocked(settingsApi.getSetting).mockResolvedValue('')
  await loadHudSettings()
  expect(hudEnabled.value).toBe(true)
  vi.mocked(settingsApi.getSetting).mockImplementation(async key => key === 'codex_hud_enabled' ? 'false' : '')
  await loadHudSettings()
  expect(hudEnabled.value).toBe(false)
})

it('固定展开持久化且写失败回滚', async () => {
  await saveHudPinned(true)
  expect(settingsApi.setSetting).toHaveBeenCalledWith('codex_hud_pinned', 'true')
  vi.mocked(settingsApi.setSetting).mockRejectedValueOnce(new Error('disk full'))
  await expect(saveHudPinned(false)).rejects.toThrow('disk full')
  expect(hudPinned.value).toBe(true)
  vi.mocked(settingsApi.getSetting).mockResolvedValue('')
  await loadHudSettings()
  expect(hudPinned.value).toBe(false)
})
