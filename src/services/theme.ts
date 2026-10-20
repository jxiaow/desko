/* 主题：颜色（和外设字体栈）会换，尺度（圆角/间距/字号）不动。
 *
 * 外观由「底色 × accent × 背景氛围」独立组合：
 *   底色八套，每套交出完全相同的 96 槽；
 *   极性 light / dark 由底色决定（用户不能单设），只用来挂 accent；
 *   accent 十档，覆盖层按 [data-base][data-accent] 填 accent 族 17 槽。
 *   背景氛围独立开关，所有底色共用同一套材质规则。
 * 所以组合数 = 底色 8 × accent 10 × 氛围 2 = 160，但 accent 块只有 2×10=20 个——新增底色不必再配一轮 accent。
 * 这里负责把外观属性挂到 <html> 上，以及存取用户的选择。
 *
 * 读取用的是明文 meta 表，锁屏前也能拿到，所以 main.ts 可以在
 * 首次绘制之前 await 一次，避免"先闪纸色再跳到墨色"。
 * 库里可能还存着旧七套的 ID（light-cool/light-warm/…/jetbrains-dark，
 * 以及更早的 cool/white/classic/dark/dark-carbon/cyber-hacker），
 * 迁移只在读取时查一次表完成，不回写——用户下次切主题时自然落为新值。 */
import { reactive, readonly } from 'vue'
import { settingsApi } from './api/settings'

export type ThemeId = (typeof THEMES)[number]['id']
export type AccentId = (typeof ACCENTS)[number]['id'] | (typeof WORKSPACE_ACCENTS)[number]['id']
export type PolarityId = 'light' | 'dark'

export interface Appearance {
  theme: ThemeId
  accent: AccentId
  backgroundAtmosphere: boolean
}

/** 旧七套 + 更早的退役 ID → 底色。必须是同步查表：
 *  main.ts 在首绘前 await readAppearance，这里多一次 IO 就多一帧闪烁。 */
const LEGACY_THEME: Record<string, ThemeId> = {
  warmgray: 'paper',
  purewhite: 'snow',
  charcoal: 'ink',
  cool: 'paper',
  white: 'paper',
  classic: 'paper',
  'pure-canvas': 'paper',
  'nordic-sage': 'paper',
  'light-cool': 'paper',
  'light-warm': 'paper',
  'light-celadon': 'paper',
  'aluminum-pro': 'paper',
  'swiss-monochrome': 'paper',
  /* 暖砂在 2026-10 冷白轮被雪取代，存着砂的选择就近落到雪 */
  sand: 'snow',
  apricot: 'linen',
  seafoam: 'mist',
  dark: 'ink',
  'dark-carbon': 'ink',
  'cyber-hacker': 'ink',
  'matte-obsidian': 'ink',
  'linear-dark': 'ink',
  'jetbrains-dark': 'ink',
}

/** 旧 ID → 就近的 accent 档：暖纸墨落赭石、青瓷落苔绿、电光紫落紫罗，其余墨蓝。 */
const LEGACY_ACCENT: Record<string, AccentId> = {
  'light-warm': 'clay',
  'light-celadon': 'celadon',
  'nordic-sage': 'celadon',
  'linear-dark': 'plum',
}

/** 底色注册表；背景氛围独立开关，预览消费同一套颜色令牌。 */
export const THEMES = [
  { id: 'paper', name: '纸' },
  { id: 'snow', name: '雪' },
  { id: 'linen', name: '绢' },
  { id: 'mist', name: '雾' },
  { id: 'ink', name: '墨' },
  { id: 'slate', name: '岩' },
  { id: 'midnight', name: '夜' },
  { id: 'moss', name: '苔' },
] as const

/** 底色 → accent 覆盖层挂的那一极。新增底色只需在这里登记一行。 */
export const POLARITY: Record<ThemeId, PolarityId> = {
  paper: 'light',
  snow: 'light',
  linen: 'light',
  mist: 'light',
  ink: 'dark',
  slate: 'dark',
  midnight: 'dark',
  moss: 'dark',
}

export const ACCENTS = [
  { id: 'ink', name: '群青' },
  { id: 'celadon', name: '翡翠' },
  { id: 'clay', name: '陶橙' },
  { id: 'plum', name: '鸢紫' },
  { id: 'rose', name: '洋红' },
  { id: 'teal', name: '湖蓝' },
  { id: 'forest', name: '橄榄' },
  { id: 'amber', name: '琥珀' },
  { id: 'coral', name: '绯红' },
  { id: 'graphite', name: '石墨' },
] as const

/** 新布局只提供差异明确的配色；旧 ID 留给经典布局与已保存设置。 */
export const WORKSPACE_THEMES = THEMES.filter(t => ['paper', 'ink'].includes(t.id))
export const WORKSPACE_ACCENTS = [
  { id: 'ink', name: '蓝' },
  { id: 'celadon', name: '绿' },
  { id: 'clay', name: '橙' },
  { id: 'amber', name: '琥珀' },
  { id: 'plum', name: '紫' },
  { id: 'rose', name: '玫瑰' },
  { id: 'graphite', name: '灰' },
  { id: 'sage', name: '鼠尾草' },
  { id: 'sky', name: '雾蓝' },
  { id: 'lavender', name: '薰衣草' },
  { id: 'peach', name: '蜜桃' },
] as const
const WORKSPACE_THEME_MAP: Partial<Record<ThemeId, ThemeId>> = {
  snow: 'paper', linen: 'paper', mist: 'paper', slate: 'ink', midnight: 'ink', moss: 'ink',
}
const WORKSPACE_ACCENT_MAP: Partial<Record<AccentId, AccentId>> = {
  teal: 'celadon', forest: 'celadon', coral: 'clay',
}
const CLASSIC_ACCENT_MAP: Partial<Record<AccentId, AccentId>> = {
  sage: 'celadon', sky: 'ink', lavender: 'plum', peach: 'clay',
}
let workspaceLayout = false

export const DEFAULT_APPEARANCE: Appearance = { theme: 'paper', accent: 'ink', backgroundAtmosphere: false }
const state = reactive<Appearance>({ ...DEFAULT_APPEARANCE })
/** 全应用共享的当前外观；只能通过选择入口更新，避免状态和根属性各自变化。 */
export const appearance = readonly(state)

const isThemeId = (v: string): v is ThemeId => THEMES.some((t) => t.id === v)
const isAccentId = (v: string): v is AccentId => ACCENTS.some(a => a.id === v) || WORKSPACE_ACCENTS.some(a => a.id === v)

export const polarityOf = (theme: ThemeId): PolarityId => POLARITY[theme]
const applyAppearance = (ap: Appearance) => {
  Object.assign(state, ap)
  const root = document.documentElement
  root.setAttribute('data-theme', ap.theme)
  root.setAttribute('data-base', polarityOf(ap.theme))
  root.setAttribute('data-accent', ap.accent)
  root.setAttribute('data-atmosphere', ap.backgroundAtmosphere ? 'on' : 'off')
}

/** 从设置里读底色、accent 与背景氛围；旧 ID 走迁移表，读不到或不认识都回落到默认。 */
const readAppearance = async (): Promise<Appearance> => {
  let theme: ThemeId | null = null
  let accent: AccentId | null = null
  let backgroundAtmosphere = DEFAULT_APPEARANCE.backgroundAtmosphere
  try {
    const rawTheme = await settingsApi.getSetting('theme')
    theme = isThemeId(rawTheme) ? rawTheme : LEGACY_THEME[rawTheme] ?? null
    const rawAccent = await settingsApi.getSetting('accent')
    accent = isAccentId(rawAccent) ? rawAccent : LEGACY_ACCENT[rawTheme] ?? null
    const rawAtmosphere = await settingsApi.getSetting('background_atmosphere')
    if (rawAtmosphere === 'true' || rawAtmosphere === 'false') backgroundAtmosphere = rawAtmosphere === 'true'
  } catch {
    /* 回落默认 */
  }
  return { theme: theme ?? DEFAULT_APPEARANCE.theme, accent: accent ?? DEFAULT_APPEARANCE.accent, backgroundAtmosphere }
}

/** 仅在 bootstrap 首绘前恢复持久化外观；组件直接读取共享状态。 */
export const initializeAppearance = async (options: { workspaceLayout?: boolean } = {}) => {
  workspaceLayout = options.workspaceLayout ?? false
  const restored = await readAppearance()
  if (workspaceLayout) {
    restored.theme = WORKSPACE_THEME_MAP[restored.theme] ?? restored.theme
    restored.accent = WORKSPACE_ACCENT_MAP[restored.accent] ?? restored.accent
  } else {
    restored.accent = CLASSIC_ACCENT_MAP[restored.accent] ?? restored.accent
  }
  applyAppearance(restored)
}

/* 切换瞬间挂一次全局补间类（global.css 的 html.theme-anim），
   让新旧底色之间有 0.2s 过渡；类由这里摘除，冷启动首绘不经过。 */
let animTimer: number | null = null
const playThemeTransition = () => {
  const root = document.documentElement
  root.classList.add('theme-anim')
  if (animTimer !== null) window.clearTimeout(animTimer)
  animTimer = window.setTimeout(() => {
    root.classList.remove('theme-anim')
    animTimer = null
  }, 260)
}

const SETTING_KEYS: Record<keyof Appearance, string> = {
  theme: 'theme',
  accent: 'accent',
  backgroundAtmosphere: 'background_atmosphere',
}

/** 统一更新当前外观并落盘；保存失败仍保留本次生效的选择。 */
const chooseAppearance = async <K extends keyof Appearance>(key: K, value: Appearance[K]): Promise<boolean> => {
  if (key !== 'backgroundAtmosphere') playThemeTransition()
  applyAppearance({ ...state, [key]: value })
  try {
    await settingsApi.setSetting(SETTING_KEYS[key], String(value))
    return true
  } catch {
    return false
  }
}

export const chooseTheme = (id: ThemeId) => chooseAppearance('theme', workspaceLayout ? WORKSPACE_THEME_MAP[id] ?? id : id)
export const chooseAccent = (id: AccentId) => chooseAppearance('accent', (workspaceLayout ? WORKSPACE_ACCENT_MAP[id] : CLASSIC_ACCENT_MAP[id]) ?? id)
export const chooseBackgroundAtmosphere = (enabled: boolean) => chooseAppearance('backgroundAtmosphere', enabled)
