/* 主题：颜色（和外设字体栈）会换，尺度（圆角/间距/字号）不动。
 *
 * 外观由「底色 × accent × 背景氛围」独立组合：
 *   底色十一套，每套交出完全相同的 96 槽；
 *   极性 light / dark 由底色决定（用户不能单设），只用来挂 accent；
 *   accent 十档，覆盖层按 [data-base][data-accent] 填 accent 族 17 槽。
 *   背景氛围独立开关，素色与冷暖底色共用同一套材质规则。
 * 所以组合数 = 底色 11 × accent 10 × 氛围 2 = 220，但 accent 块只有 2×10=20 个——新增底色不必再配一轮 accent。
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
export type AccentId = (typeof ACCENTS)[number]['id']
export type PolarityId = 'light' | 'dark'

export interface Appearance {
  theme: ThemeId
  accent: AccentId
  backgroundAtmosphere: boolean
}

/** 旧七套 + 更早的退役 ID → 底色。必须是同步查表：
 *  main.ts 在首绘前 await readAppearance，这里多一次 IO 就多一帧闪烁。 */
const LEGACY_THEME: Record<string, ThemeId> = {
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

/** 注册表只保存身份与底色分组；分组不限制背景氛围，预览消费同一套颜色令牌。 */
export const THEMES = [
  { id: 'paper', name: '纸', kind: 'atmosphere' },
  { id: 'snow', name: '雪', kind: 'atmosphere' },
  { id: 'linen', name: '绢', kind: 'atmosphere' },
  { id: 'mist', name: '雾', kind: 'atmosphere' },
  { id: 'ink', name: '墨', kind: 'atmosphere' },
  { id: 'slate', name: '岩', kind: 'atmosphere' },
  { id: 'midnight', name: '夜', kind: 'atmosphere' },
  { id: 'moss', name: '苔', kind: 'atmosphere' },
  { id: 'purewhite', name: '素白', kind: 'plain' },
  { id: 'warmgray', name: '暖灰', kind: 'plain' },
  { id: 'charcoal', name: '炭黑', kind: 'plain' },
] as const

/** 底色 → accent 覆盖层挂的那一极。新增底色只需在这里登记一行。 */
export const POLARITY: Record<ThemeId, PolarityId> = {
  purewhite: 'light',
  warmgray: 'light',
  charcoal: 'dark',
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
  { id: 'ink', name: '墨蓝' },
  { id: 'celadon', name: '青瓷' },
  { id: 'clay', name: '赭石' },
  { id: 'plum', name: '紫罗' },
  { id: 'rose', name: '暮瑰' },
  { id: 'teal', name: '碧青' },
  { id: 'forest', name: '松绿' },
  { id: 'amber', name: '琥珀' },
  { id: 'coral', name: '珊瑚' },
  { id: 'graphite', name: '石墨' },
] as const

export const DEFAULT_APPEARANCE: Appearance = { theme: 'paper', accent: 'ink', backgroundAtmosphere: true }
const state = reactive<Appearance>({ ...DEFAULT_APPEARANCE })
/** 全应用共享的当前外观；只能通过选择入口更新，避免状态和根属性各自变化。 */
export const appearance = readonly(state)

const isThemeId = (v: string): v is ThemeId => THEMES.some((t) => t.id === v)
const isAccentId = (v: string): v is AccentId => ACCENTS.some((a) => a.id === v)

export const polarityOf = (theme: ThemeId): PolarityId => POLARITY[theme]
export const isPlainTheme = (theme: ThemeId): boolean => THEMES.find(t => t.id === theme)?.kind === 'plain'
export const THEME_GROUPS = [
  { label: '素色', themes: THEMES.filter(theme => theme.kind === 'plain') },
  { label: '冷暖配色', themes: THEMES.filter(theme => theme.kind === 'atmosphere') },
]


const applyAppearance = (ap: Appearance) => {
  Object.assign(state, ap)
  const root = document.documentElement
  root.setAttribute('data-theme', ap.theme)
  root.setAttribute('data-palette', isPlainTheme(ap.theme) ? 'plain' : 'atmosphere')
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
    backgroundAtmosphere = await settingsApi.getSetting('background_atmosphere') !== 'false'
  } catch {
    /* 回落默认 */
  }
  return { theme: theme ?? DEFAULT_APPEARANCE.theme, accent: accent ?? DEFAULT_APPEARANCE.accent, backgroundAtmosphere }
}

/** 仅在 bootstrap 首绘前恢复持久化外观；组件直接读取共享状态。 */
export const initializeAppearance = async () => {
  applyAppearance(await readAppearance())
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

export const chooseTheme = (id: ThemeId) => chooseAppearance('theme', id)
export const chooseAccent = (id: AccentId) => chooseAppearance('accent', id)
export const chooseBackgroundAtmosphere = (enabled: boolean) => chooseAppearance('backgroundAtmosphere', enabled)
