/* 主题：颜色（和外设字体栈）会换，尺度（圆角/间距/字号）不动。
 *
 * 色槽定义在 global.css 的 [data-theme="…"] 块里，这里只负责
 * 把 data-theme 挂到 <html> 上、以及存取用户选的那一套。
 *
 * 读取用的是明文 meta 表，锁屏前也能拿到，所以 main.ts 可以在
 * 首次绘制之前 await 一次，避免"先闪 light-cool 再跳到用户主题"。
 * 库里可能还存着旧 ID（cool/white/classic/dark/dark-carbon/cyber-hacker），
 * 迁移只在读取时查一次表完成，不回写——用户下次切主题时自然落为新 ID。 */
import { settingsApi } from './api/settings'

export type ThemeId = 'light-cool' | 'light-warm' | 'linear-dark' | 'jetbrains-dark'

/** 主题退役后留在库里的旧值 → 现在最接近的一套。必须是同步查表：
 *  main.ts 在首绘前 await readTheme，这里多一次 IO 就多一帧闪烁。 */
const LEGACY_MAP: Record<string, ThemeId> = {
  cool: 'light-cool',
  white: 'light-cool',
  classic: 'light-cool',
  dark: 'linear-dark',
  'dark-carbon': 'linear-dark',
  'cyber-hacker': 'linear-dark',
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
  /** 微缩预览卡用的色，取自 global.css 对应主题块 */
  prev: ThemePreview
}

export const THEMES: ThemeInfo[] = [
  { id: 'light-cool', name: '冷灰', prev: { page: '#f8f8fa', sidebar: '#f1f1f5', card: '#ffffff', rowHover: '#f0f0f4', edge: '#e3e3ea', accent: '#5b57d9', ink: '#1a1b20' } },
  { id: 'light-warm', name: '暖纸墨', prev: { page: '#f5f2eb', sidebar: '#efeae0', card: '#faf8f5', rowHover: '#f0eae0', edge: '#e3ddd2', accent: '#d97706', ink: '#2e2925' } },
  { id: 'linear-dark', name: 'Linear 深空', prev: { page: '#090a0f', sidebar: '#0e1017', card: '#141721', rowHover: '#1c202e', edge: '#222738', accent: '#5e6ad2', ink: '#e8eaf2' } },
  { id: 'jetbrains-dark', name: 'JetBrains 炭黑', prev: { page: '#191a1c', sidebar: '#1e1f22', card: '#2b2d30', rowHover: '#35373b', edge: '#393b40', accent: '#3574f0', ink: '#e3e6ea' } },
]

export const DEFAULT_THEME: ThemeId = 'light-cool'

const isThemeId = (v: string): v is ThemeId => THEMES.some((t) => t.id === v)

export const applyTheme = (id: ThemeId) => {
  document.documentElement.setAttribute('data-theme', id)
}

/** 从设置里读主题；旧 ID 走迁移表，读不到或不认识都回落到默认，不抛错。 */
export const readTheme = async (): Promise<ThemeId> => {
  try {
    const raw = await settingsApi.getSetting('theme')
    if (isThemeId(raw)) return raw
    return LEGACY_MAP[raw] ?? DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
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

/** 立刻生效，再落盘。落盘失败（比如非 Tauri 环境）不影响本次生效。 */
export const chooseTheme = async (id: ThemeId): Promise<boolean> => {
  playThemeTransition()
  applyTheme(id)
  try {
    await settingsApi.setSetting('theme', id)
    return true
  } catch {
    return false
  }
}
