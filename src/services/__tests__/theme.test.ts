import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { settingsApi } from '../api/settings'
import { appearance, initializeAppearance, chooseTheme, chooseAccent } from '../theme'

vi.mock('../api/settings', () => ({ settingsApi: { getSetting: vi.fn(), setSetting: vi.fn() } }))

beforeEach(() => vi.clearAllMocks())
afterEach(() => { document.documentElement.removeAttribute('data-theme') })

it.each(['', 'unknown'])('未保存或无效的氛围值 %s 使用纯色默认外观', async raw => {
  vi.mocked(settingsApi.getSetting).mockImplementation(async key => key === 'background_atmosphere' ? raw : '')

  await initializeAppearance()

  expect(appearance).toEqual({ theme: 'paper', accent: 'ink', backgroundAtmosphere: false })
  expect(document.documentElement.dataset.atmosphere).toBe('off')
  expect(settingsApi.setSetting).not.toHaveBeenCalled()
})

it.each([
  ['snow', 'teal', 'paper', 'celadon'],
  ['mist', 'amber', 'paper', 'amber'],
  ['linen', 'rose', 'paper', 'rose'],
  ['slate', 'forest', 'ink', 'celadon'],
  ['midnight', 'rose', 'ink', 'rose'],
  ['moss', 'coral', 'ink', 'clay'],
])('新布局恢复 %s/%s 时落到可见选项 %s/%s，经典布局保留原选择', async (theme, accent, workspaceTheme, workspaceAccent) => {
  const saved: Record<string, string> = { theme, accent, background_atmosphere: 'true' }
  vi.mocked(settingsApi.getSetting).mockImplementation(async key => saved[key] ?? '')

  await initializeAppearance({ workspaceLayout: true })
  expect(appearance).toEqual({ theme: workspaceTheme, accent: workspaceAccent, backgroundAtmosphere: true })
  expect(document.documentElement.dataset).toMatchObject({ theme: workspaceTheme, accent: workspaceAccent })
  expect(settingsApi.setSetting).not.toHaveBeenCalled()

  await initializeAppearance()
  expect(appearance).toEqual({ theme, accent, backgroundAtmosphere: true })
})

it('新布局的旧选择入口也保存可见选项，经典布局仍可选择全部配色', async () => {
  vi.mocked(settingsApi.getSetting).mockResolvedValue('')
  await initializeAppearance({ workspaceLayout: true })
  await chooseTheme('midnight')
  await chooseAccent('teal')
  expect(appearance.theme).toBe('ink')
  expect(appearance.accent).toBe('celadon')
  expect(settingsApi.setSetting).toHaveBeenCalledWith('theme', 'ink')
  expect(settingsApi.setSetting).toHaveBeenCalledWith('accent', 'celadon')

  await initializeAppearance()
  await chooseTheme('midnight')
  await chooseAccent('teal')
  expect(appearance.theme).toBe('midnight')
  expect(appearance.accent).toBe('teal')
})

it.each([
  ['sage', 'celadon'], ['sky', 'ink'], ['lavender', 'plum'], ['peach', 'clay'],
] as const)('清新强调色 %s 可以恢复和保存，经典布局使用相近的 %s', async (accent, classicAccent) => {
  vi.mocked(settingsApi.getSetting).mockImplementation(async key => key === 'accent' ? accent : '')
  await initializeAppearance({ workspaceLayout: true })
  expect(appearance.accent).toBe(accent)
  await chooseAccent(accent)
  expect(settingsApi.setSetting).toHaveBeenLastCalledWith('accent', accent)

  await initializeAppearance()
  expect(appearance.accent).toBe(classicAccent)
  await chooseAccent(accent)
  expect(settingsApi.setSetting).toHaveBeenLastCalledWith('accent', classicAccent)
})

it.each([
  ['warmgray', 'paper', 'light'],
  ['purewhite', 'snow', 'light'],
  ['charcoal', 'ink', 'dark'],
  ['apricot', 'linen', 'light'],
  ['seafoam', 'mist', 'light'],
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
