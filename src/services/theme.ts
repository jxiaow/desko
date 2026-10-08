/* 主题：颜色（和外设字体栈）会换，尺度（圆角/间距/字号）不动。
 *
 * v2 起是两轴结构：底色（paper 纸 / ink 墨）× accent（墨蓝/青瓷/赭石/紫罗）。
 * 色槽定义在 global.css：底色块填 96 槽，[data-accent] 覆盖层只填 accent 族 17 槽。
 * 这里负责把 data-theme / data-accent 两个属性挂到 <html> 上、以及存取用户的选择。
 *
 * 读取用的是明文 meta 表，锁屏前也能拿到，所以 main.ts 可以在
 * 首次绘制之前 await 一次，避免"先闪纸色再跳到墨色"。
 * 库里可能还存着旧七套的 ID（light-cool/light-warm/…/jetbrains-dark，
 * 以及更早的 cool/white/classic/dark/dark-carbon/cyber-hacker），
 * 迁移只在读取时查一次表完成，不回写——用户下次切主题时自然落为新值。 */
import { settingsApi } from './api/settings'

export type ThemeId = 'paper' | 'ink'
export type AccentId = 'ink' | 'celadon' | 'clay' | 'plum'

export interface Appearance {
  theme: ThemeId
  accent: AccentId
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

export interface ThemePreview {
  page: string
  sidebar: string
  card: string
  rowHover: string
  edge: string
  accent: string
  ink: string
}

export interface ThemeInfo {
  id: ThemeId
  name: string
  /** 微缩预览卡用的色，取自 global.css 对应底色块 */
  prev: ThemePreview
}

export interface AccentInfo {
  id: AccentId
  name: string
  /** 色丸展示色（纸底档） */
  dot: string
  /** 墨底档的展示色，主题预览卡跟着底色走 */
  dotInk: string
}

export const THEMES: ThemeInfo[] = [
  { id: 'paper', name: '纸', prev: { page: '#f8f8f7', sidebar: '#edecea', card: '#fcfcfc', rowHover: '#f7f7f7', edge: '#e6e6e4', accent: '#3d5a80', ink: '#333230' } },
  { id: 'ink', name: '墨', prev: { page: '#1d1c1a', sidebar: '#1a1917', card: '#22211e', rowHover: '#282622', edge: '#30302d', accent: '#89a8cd', ink: '#e6e4de' } },
]

export const ACCENTS: AccentInfo[] = [
  { id: 'ink', name: '墨蓝', dot: '#3d5a80', dotInk: '#89a8cd' },
  { id: 'celadon', name: '青瓷', dot: '#3d7355', dotInk: '#7fb89a' },
  { id: 'clay', name: '赭石', dot: '#9a5b33', dotInk: '#d09a6a' },
  { id: 'plum', name: '紫罗', dot: '#5f62b8', dotInk: '#9ba0e8' },
]

export const DEFAULT_APPEARANCE: Appearance = { theme: 'paper', accent: 'ink' }

const isThemeId = (v: string): v is ThemeId => THEMES.some((t) => t.id === v)
const isAccentId = (v: string): v is AccentId => ACCENTS.some((a) => a.id === v)

export const applyTheme = (ap: Appearance) => {
  const root = document.documentElement
  root.setAttribute('data-theme', ap.theme)
  root.setAttribute('data-accent', ap.accent)
}

/** 从设置里读底色 + accent；旧 ID 走迁移表，读不到或不认识都回落到默认，不抛错。 */
export const readAppearance = async (): Promise<Appearance> => {
  let theme: ThemeId | null = null
  let accent: AccentId | null = null
  try {
    const rawTheme = await settingsApi.getSetting('theme')
    theme = isThemeId(rawTheme) ? rawTheme : LEGACY_THEME[rawTheme] ?? null
    const rawAccent = await settingsApi.getSetting('accent')
    accent = isAccentId(rawAccent) ? rawAccent : LEGACY_ACCENT[rawTheme] ?? null
  } catch {
    /* 回落默认 */
  }
  return { theme: theme ?? DEFAULT_APPEARANCE.theme, accent: accent ?? DEFAULT_APPEARANCE.accent }
}

/* 兼容旧调用名：readTheme 返回完整外观 */
export const readTheme = readAppearance

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

const setSettingQuiet = async (key: string, value: string) => {
  try {
    await settingsApi.setSetting(key, value)
    return true
  } catch {
    return false
  }
}

/** 立刻生效，再落盘。落盘失败（比如非 Tauri 环境）不影响本次生效。 */
export const chooseTheme = async (id: ThemeId): Promise<boolean> => {
  playThemeTransition()
  const ap = { ...(current ?? DEFAULT_APPEARANCE), theme: id }
  applyTheme(ap)
  current = ap
  return setSettingQuiet('theme', id)
}

export const chooseAccent = async (id: AccentId): Promise<boolean> => {
  playThemeTransition()
  const ap = { ...(current ?? DEFAULT_APPEARANCE), accent: id }
  applyTheme(ap)
  current = ap
  return setSettingQuiet('accent', id)
}

/** 当前生效的外观快照：chooseTheme/chooseAccent 各自只改一轴，另一轴要跟着现值。 */
let current: Appearance | null = null
export const currentAppearance = (): Appearance => current ?? DEFAULT_APPEARANCE

/** bootstrap 挂完首绘外观后回填快照。 */
export const primeAppearance = (ap: Appearance) => {
  current = ap
  applyTheme(ap)
}
