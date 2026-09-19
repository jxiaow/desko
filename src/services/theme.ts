/* 主题：只有颜色会换，尺度（圆角/间距/字号）不动。
 *
 * 色槽定义在 global.css 的 [data-theme="…"] 块里，这里只负责
 * 把 data-theme 挂到 <html> 上、以及存取用户选的那一套。
 *
 * 读取用的是明文 meta 表，锁屏前也能拿到，所以 main.ts 可以在
 * 首次绘制之前 await 一次，避免"先闪 cool 再跳到用户主题"。 */
import { settingsApi } from './api/settings'

export type ThemeId = 'cool' | 'classic' | 'white' | 'dark'

export interface ThemeInfo {
  id: ThemeId
  name: string
  /** 选择器里那块迷你预览用的五个色，取自 global.css 对应主题块 */
  prev: { page: string; card: string; edge: string; accent: string; ink: string }
}

export const THEMES: ThemeInfo[] = [
  { id: 'cool', name: '冷灰', prev: { page: '#f8f8fa', card: '#ffffff', edge: '#e3e3ea', accent: '#5b57d9', ink: '#1a1b20' } },
  { id: 'white', name: '素白', prev: { page: '#ffffff', card: '#ffffff', edge: '#ebebeb', accent: '#4b47c4', ink: '#18181b' } },
  { id: 'dark', name: '夜墨', prev: { page: '#0c0c0f', card: '#151519', edge: '#26262e', accent: '#7b77f0', ink: '#eeeef3' } },
  { id: 'classic', name: '经典', prev: { page: '#fafbfc', card: '#ffffff', edge: '#e5e7eb', accent: '#6366f1', ink: '#111827' } },
]

export const DEFAULT_THEME: ThemeId = 'cool'

const isThemeId = (v: string): v is ThemeId => THEMES.some((t) => t.id === v)

export const applyTheme = (id: ThemeId) => {
  document.documentElement.setAttribute('data-theme', id)
}

/** 从设置里读主题；读不到或不认识都回落到默认，不抛错。 */
export const readTheme = async (): Promise<ThemeId> => {
  try {
    const raw = await settingsApi.getSetting('theme')
    return isThemeId(raw) ? raw : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/** 立刻生效，再落盘。落盘失败（比如非 Tauri 环境）不影响本次生效。 */
export const chooseTheme = async (id: ThemeId): Promise<boolean> => {
  applyTheme(id)
  try {
    await settingsApi.setSetting('theme', id)
    return true
  } catch {
    return false
  }
}
