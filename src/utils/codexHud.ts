import type { CodexAccount } from '../services/api/codex'
import { codexAdditionalQuotaWindows, codexCredits, codexQuotaWindows } from './codexQuota'

export type CodexHudSkin = 'bunny' | 'penguin' | 'snail'

export interface CodexHudWindow {
  label: string
  percentage: number
  unlimited?: boolean
}

export interface CodexHudState {
  skin: CodexHudSkin
  theme: { theme: string; base: 'light' | 'dark'; accent: string; atmosphere: boolean }
  primary: CodexHudWindow | null
  secondary: CodexHudWindow | null
  placeholder: string | null
  severe: boolean
  stale: boolean
  placeholderAlert: boolean
  today: { tokens: number; costUsd: number | null } | null
  updatedAt: number | null
}

export interface CodexHudEventPayload {
  state: CodexHudState
  reveal: boolean
  /** 允许绕锚点小范围走动；缺省按允许处理 */
  walk?: boolean
}

export const HUD_SKINS = [
  { id: 'bunny', name: '兔子', desc: '双耳显示两档额度' },
  { id: 'penguin', name: '企鹅', desc: '肚皮显示主额度' },
  { id: 'snail', name: '蜗牛', desc: '螺壳显示主额度' },
] as const

export const DEFAULT_HUD_SKIN: CodexHudSkin = 'bunny'

export function isHudSkin(value: string): value is CodexHudSkin {
  return HUD_SKINS.some((skin) => skin.id === value)
}

function hudMinutesLabel(minutes: number | null | undefined): string {
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return '5h'
  if (minutes % 10080 === 0) {
    const count = minutes / 10080
    return count === 1 ? 'w' : `${count}w`
  }
  if (minutes % 1440 === 0) {
    const count = minutes / 1440
    return count === 1 ? 'd' : `${count}d`
  }
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${Math.ceil(minutes)}m`
}

export interface CodexHudSource {
  account: CodexAccount | null
  skin: CodexHudSkin
  theme: CodexHudState['theme']
  today: CodexHudState['today']
}

/** 只保留签需要的聚合值；账号、邮箱、路径和原始错误都不进快照。 */
export function buildCodexHudSnapshot(source: CodexHudSource): CodexHudState {
  const { account } = source
  const state: CodexHudState = {
    skin: source.skin,
    theme: source.theme,
    primary: null,
    secondary: null,
    placeholder: null,
    severe: false,
    stale: false,
    placeholderAlert: false,
    today: source.today,
    updatedAt: account?.usage_updated_at ?? null,
  }

  if (!account) {
    state.placeholder = '暂无账号'
    return state
  }

  const standard = codexQuotaWindows(account)
  const primary = standard[0]
  if (primary) {
    state.primary = {
      label: hudQuotaLabel(primary.id, account),
      percentage: primary.percentage,
    }
    const secondary = standard[1]
    if (secondary) {
      state.secondary = {
        label: hudQuotaLabel(secondary.id, account),
        percentage: secondary.percentage,
      }
    }
    state.severe = primary.percentage <= 9 || primary.blockedBy !== null
    state.stale = !!account.quota_error
    return state
  }

  const additional = codexAdditionalQuotaWindows(account)[0]
  if (additional) {
    state.primary = { label: '额外', percentage: additional.percentage }
    state.severe = additional.percentage <= 9
    state.stale = !!account.quota_error
    return state
  }

  const credits = codexCredits(account)
  if (credits && (credits.percentage !== null || credits.unlimited)) {
    state.primary = {
      label: 'Credits',
      percentage: credits.percentage ?? 100,
      ...(credits.unlimited ? { unlimited: true } : {}),
    }
    state.severe = credits.percentage !== null && credits.percentage <= 9
    state.stale = !!account.quota_error
    return state
  }

  if (account.quota_error) {
    state.placeholder = '额度获取失败'
    state.placeholderAlert = true
  } else if (account.authorization_status?.trim().toLowerCase() === 'pending') {
    state.placeholder = '待授权'
  } else if (account.auth_mode === 'apikey') {
    state.placeholder = '按量计费'
  } else {
    state.placeholder = '暂无额度'
  }
  return state
}

/** 签上只有两个字宽的位置；id 是稳定来源，不去解析中文 label */
export function hudQuotaLabel(id: string, account: CodexAccount): string {
  if (id.startsWith('additional:')) return '额外'
  if (id === 'credits') return 'Credits'
  if (account.auth_mode === 'apikey') return '额度'
  if (id === 'weekly') return hudMinutesLabel(account.quota?.weekly_window_minutes ?? 10080)
  return hudMinutesLabel(account.quota?.hourly_window_minutes ?? 300)
}

/** 签上只放拉丁短标签（`5h` / `w` / `2w`），读屏要中文全称，别念成「w额度」。 */
export function hudWindowAria(label: string): string {
  const match = /^(\d*)([wdhm])$/.exec(label)
  if (!match) return `${label}额度`
  const unit = match[2] === 'w' ? '周' : match[2] === 'd' ? '天' : match[2] === 'h' ? '小时' : '分钟'
  return `${match[1] ? `${match[1]} ` : ''}${unit}额度`
}

export function formatHudCost(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return '未定价'
  if (value === 0) return '≈$0'
  if (value < 0.01) return value < 0.0005 ? '≈<$0.001' : `≈$${value.toFixed(3)}`
  if (value < 1_000) return `≈$${value.toFixed(2)}`
  if (value < 1_000_000) return `≈$${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return `≈$${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

export function hudAriaLabel(state: CodexHudState): string {
  const parts: string[] = []
  if (state.primary) {
    const primary = state.primary.unlimited ? '不限额' : `${state.primary.percentage}%`
    parts.push(`${hudWindowAria(state.primary.label)} ${primary}`)
    if (state.secondary) {
      const secondary = state.secondary.unlimited ? '不限额' : `${state.secondary.percentage}%`
      parts.push(`${hudWindowAria(state.secondary.label)} ${secondary}`)
    }
    if (state.severe) parts.push('额度偏低')
    if (state.stale) parts.push('刷新失败，显示缓存')
  } else if (state.placeholder) {
    parts.push(state.placeholder)
  }
  if (state.today) {
    parts.push(`今日 ${state.today.tokens.toLocaleString('zh-CN')} tok，${formatHudCost(state.today.costUsd)}`)
  } else {
    parts.push('今日用量暂无')
  }
  return `Codex 桌面挂件：${parts.join('；')}`
}
