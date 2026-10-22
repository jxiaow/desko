import { beforeEach, expect, it, vi } from 'vitest'
import { settingsApi } from './api/settings'
import { hudEnabled, loadHudSettings, saveHudEnabled } from './codexHud'

vi.mock('./api/settings', () => ({ settingsApi: { getSetting: vi.fn(), setSetting: vi.fn() } }))

beforeEach(() => {
  vi.resetAllMocks()
  hudEnabled.value = false
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
