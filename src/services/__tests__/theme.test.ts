import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { settingsApi } from '../api/settings'
import { appearance, initializeAppearance } from '../theme'

vi.mock('../api/settings', () => ({ settingsApi: { getSetting: vi.fn(), setSetting: vi.fn() } }))

beforeEach(() => vi.clearAllMocks())
afterEach(() => { document.documentElement.removeAttribute('data-theme') })

it.each([
  ['warmgray', 'paper', 'light'],
  ['purewhite', 'snow', 'light'],
  ['charcoal', 'ink', 'dark'],
])('%s 恢复为 %s，保留强调色与氛围开关', async (legacy, theme, polarity) => {
  for (const enabled of [false, true]) {
    const settings: Record<string, string> = { theme: legacy, accent: 'plum', background_atmosphere: String(enabled) }
    vi.mocked(settingsApi.getSetting).mockImplementation(async key => settings[key] ?? '')

    await initializeAppearance()

    expect(appearance).toEqual({ theme, accent: 'plum', backgroundAtmosphere: enabled })
    expect(document.documentElement.dataset).toMatchObject({ theme, base: polarity, accent: 'plum', atmosphere: enabled ? 'on' : 'off' })
    expect(settingsApi.setSetting).not.toHaveBeenCalled()
  }
})
