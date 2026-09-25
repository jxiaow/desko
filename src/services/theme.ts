/* 主题：颜色（和外设字体栈）会换，尺度（圆角/间距/字号）不动。
 *
 * 色槽定义在 global.css 的 [data-theme="…"] 块里，这里只负责
 * 把 data-theme 挂到 <html> 上、以及存取用户选的那一套。
 *
 * 读取用的是明文 meta 表，锁屏前也能拿到，所以 main.ts 可以在
 * 首次绘制之前 await 一次，避免"先闪 light-cool 再跳到用户主题"。
 * 库里可能还存着旧 ID（cool/white/classic/dark/dark-carbon/cyber-hacker，
 * 以及退役的 pure-canvas/nordic-sage/matte-obsidian），
 * 迁移只在读取时查一次表完成，不回写——用户下次切主题时自然落为新 ID。 */
import { settingsApi } from './api/settings'

export type ThemeId =
  | 'light-cool' | 'light-warm' | 'light-celadon'
  | 'aluminum-pro' | 'swiss-monochrome'
  | 'linear-dark' | 'jetbrains-dark'

/** 主题退役后留在库里的旧值 → 现在最接近的一套。必须是同步查表：
 *  main.ts 在首绘前 await readTheme，这里多一次 IO 就多一帧闪烁。 */
const LEGACY_MAP: Record<string, ThemeId> = {
  cool: 'light-cool',
  white: 'light-cool',
  classic: 'light-cool',
  dark: 'linear-dark',
  'dark-carbon': 'linear-dark',
  'cyber-hacker': 'linear-dark',
  // 2026-09 退役：与保留套 ΔE<3.5，肉眼几乎重复
  'pure-canvas': 'light-cool',
  'nordic-sage': 'light-celadon',
  'matte-obsidian': 'linear-dark',
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
  { id: 'light-cool', name: '冷灰', prev: { page: '#f7f8fa', sidebar: '#ffffff', card: '#ffffff', rowHover: '#eff3f8', edge: '#e2e5eb', accent: '#3a68b8', ink: '#111827' } },
  { id: 'light-warm', name: '暖纸墨', prev: { page: '#f8f6f2', sidebar: '#ffffff', card: '#ffffff', rowHover: '#f5efe6', edge: '#e8e2d8', accent: '#b45309', ink: '#241e19' } },
  { id: 'light-celadon', name: '青瓷', prev: { page: '#f4f7f5', sidebar: '#ebf0ed', card: '#ffffff', rowHover: '#f0f5f2', edge: '#dce3df', accent: '#216747', ink: '#0f1713' } },
  { id: 'aluminum-pro', name: '冷铝', prev: { page: '#eceef2', sidebar: '#f4f5f8', card: '#ffffff', rowHover: '#e5e8f0', edge: '#d7dbe2', accent: '#2563eb', ink: '#0a0d12' } },
  { id: 'swiss-monochrome', name: '瑞士黑白', prev: { page: '#fafafa', sidebar: '#ffffff', card: '#ffffff', rowHover: '#f3f4f6', edge: '#e5e7eb', accent: '#111827', ink: '#000000' } },
  { id: 'linear-dark', name: 'Linear 深空', prev: { page: '#111217', sidebar: '#14151a', card: '#181920', rowHover: '#22242e', edge: '#252834', accent: '#5b5ee6', ink: '#f1f3f8' } },
  { id: 'jetbrains-dark', name: 'JetBrains 炭黑', prev: { page: '#1e1f22', sidebar: '#1a1b1e', card: '#27282c', rowHover: '#313338', edge: '#34363c', accent: '#316dea', ink: '#dfe1e5' } },
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
