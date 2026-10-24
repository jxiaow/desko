import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fileshareApi } from '../api/fileshare'
import { settingsApi } from '../api/settings'
import { appearance, initializeAppearance, chooseTheme, chooseAccent } from '../theme'

vi.mock('../api/settings', () => ({ settingsApi: { getSetting: vi.fn(), setSetting: vi.fn() } }))
vi.mock('../api/fileshare', () => ({ fileshareApi: { setTheme: vi.fn().mockResolvedValue(undefined) } }))

/* 计时器全程走假的：主题戳与主题补间都是 setTimeout，真实计时器会跨用例生效，
   把后一条用例的调用计数搅乱。 */
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks() })
afterEach(() => { document.documentElement.removeAttribute('data-theme'); vi.useRealTimers() })

it.each(['', 'unknown'])('未保存或无效的氛围值 %s 使用纯色默认外观', async raw => {
  vi.mocked(settingsApi.getSetting).mockImplementation(async key => key === 'background_atmosphere' ? raw : '')

  await initializeAppearance()

  expect(appearance).toEqual({ theme: 'paper', accent: 'ink', backgroundAtmosphere: false })
  expect(document.documentElement.dataset.atmosphere).toBe('off')
  expect(settingsApi.setSetting).not.toHaveBeenCalled()
})

it.each([
  ['snow', 'teal', 'paper', 'teal'],
  ['mist', 'amber', 'paper', 'amber'],
  ['linen', 'rose', 'paper', 'rose'],
  ['slate', 'forest', 'ink', 'olive'],
  ['midnight', 'rose', 'ink', 'rose'],
  ['moss', 'coral', 'ink', 'brick'],
])('新布局恢复 %s/%s 时归并为 %s/%s，经典布局保留原选择', async (theme, accent, workspaceTheme, workspaceAccent) => {
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
  expect(appearance.accent).toBe('teal')
  expect(settingsApi.setSetting).toHaveBeenCalledWith('theme', 'ink')
  expect(settingsApi.setSetting).toHaveBeenCalledWith('accent', 'teal')

  await initializeAppearance()
  await chooseTheme('midnight')
  await chooseAccent('teal')
  expect(appearance.theme).toBe('midnight')
  expect(appearance.accent).toBe('teal')
})

it.each([
  ['sage', 'celadon'], ['sky', 'ink'], ['lavender', 'plum'], ['peach', 'clay'],
] as const)('退役强调色 %s 读取为 %s，迁移不回写设置', async (accent, classicAccent) => {
  vi.mocked(settingsApi.getSetting).mockImplementation(async key => key === 'accent' ? accent : '')
  await initializeAppearance({ workspaceLayout: true })
  expect(appearance.accent).toBe(classicAccent)
  expect(settingsApi.setSetting).not.toHaveBeenCalled()

  await initializeAppearance()
  expect(appearance.accent).toBe(classicAccent)
  expect(settingsApi.setSetting).not.toHaveBeenCalled()
})

it.each([
  ['indigo', 'plum'], ['brick', 'coral'], ['olive', 'forest'], ['sand', 'graphite'],
] as const)('工作区新增强调色 %s 在经典布局映射为 %s', async (accent, classicAccent) => {
  vi.mocked(settingsApi.getSetting).mockImplementation(async key => key === 'accent' ? accent : '')
  await initializeAppearance({ workspaceLayout: true })
  expect(appearance.accent).toBe(accent)
  expect(settingsApi.setSetting).not.toHaveBeenCalled()
  await initializeAppearance()
  expect(appearance.accent).toBe(classicAccent)
  expect(settingsApi.setSetting).not.toHaveBeenCalled()
  await chooseAccent(accent)
  expect(settingsApi.setSetting).toHaveBeenCalledWith('accent', classicAccent)
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

it('外观四值去抖抄给局域网传输网页端，同值不重复发', async () => {
  vi.mocked(settingsApi.getSetting).mockResolvedValue('')

  await initializeAppearance({ workspaceLayout: true })
  await chooseAccent('teal')
  expect(fileshareApi.setTheme).not.toHaveBeenCalled()

  await vi.advanceTimersByTimeAsync(400)
  expect(fileshareApi.setTheme).toHaveBeenCalledTimes(1)
  expect(fileshareApi.setTheme).toHaveBeenCalledWith('paper', 'light', 'teal', 'off')

  // 再点一次同一个强调色：值没变就不该再碰配置文件（每次写都让服务进程多轮询一次）
  await chooseAccent('teal')
  await vi.advanceTimersByTimeAsync(400)
  expect(fileshareApi.setTheme).toHaveBeenCalledTimes(1)

  await chooseTheme('ink')
  await vi.advanceTimersByTimeAsync(400)
  expect(fileshareApi.setTheme).toHaveBeenLastCalledWith('ink', 'dark', 'teal', 'off')
})

it('主题戳上报失败不打扰换主题', async () => {
  vi.mocked(settingsApi.getSetting).mockResolvedValue('')
  vi.mocked(fileshareApi.setTheme).mockRejectedValue(new Error('服务没起'))

  await initializeAppearance({ workspaceLayout: true })
  await vi.advanceTimersByTimeAsync(400)
  await chooseTheme('ink')

  expect(fileshareApi.setTheme).toHaveBeenCalled()
  expect(appearance.theme).toBe('ink')
  expect(document.documentElement.dataset.theme).toBe('ink')
})
