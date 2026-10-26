import type { CodexAccount, CodexQuota } from '../services/api/codex'

/** 额度映射只读这几项；锁屏命令只回这个子集，不回账号与凭据。 */
export type CodexQuotaAccount = Pick<
  CodexAccount,
  'auth_mode' | 'authorization_status' | 'quota' | 'quota_error' | 'usage_updated_at'
>

export interface CodexQuotaWindow {
  id: string
  label: string
  percentage: number
  resetTime: number | null
  blockedBy: string | null
}

export interface CodexCredits {
  remaining: number | null
  total: number | null
  percentage: number | null
  unlimited: boolean
  resetTime: number | null
  monthly: boolean
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const number = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}
const percent = (value: unknown): number | null => {
  const parsed = number(value)
  return parsed === null ? null : Math.round(Math.max(0, Math.min(100, parsed)))
}
const nonnegative = (value: unknown): number | null => {
  const parsed = number(value)
  return parsed !== null && parsed >= 0 ? parsed : null
}

export function codexQuotaWindowLabel(minutes: number | null | undefined, fallback: string): string {
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return fallback
  if (minutes % 10080 === 0) return minutes === 10080 ? '周额度' : `${minutes / 10080} 周额度`
  if (minutes % 1440 === 0) return `${minutes / 1440} 天额度`
  if (minutes % 60 === 0) return `${minutes / 60} 小时额度`
  return `${Math.ceil(minutes)} 分钟额度`
}

function resetTime(window: Record<string, unknown>, observedAt: number): number | null {
  const at = nonnegative(window.reset_at)
  if (at !== null) return at > 1e12 ? Math.floor(at / 1000) : at
  const after = nonnegative(window.reset_after_seconds)
  return after === null ? null : observedAt + after
}

/** 新快照以接口存在标记为准；旧快照用原始响应判定，再兼容没有标记的历史格式。 */
function hasWindow(quota: CodexQuota, kind: 'hourly' | 'weekly'): boolean {
  if (typeof quota.hourly_window_present === 'boolean' || typeof quota.weekly_window_present === 'boolean') {
    return quota[`${kind}_window_present`] === true
  }
  const raw = record(quota.raw_data)
  if (raw && 'rate_limit' in raw) {
    const limits = record(raw.rate_limit)
    return record(limits?.[kind === 'hourly' ? 'primary_window' : 'secondary_window']) !== null
  }
  return true
}

export function codexQuotaWindows(account: CodexQuotaAccount): CodexQuotaWindow[] {
  const quota = account.quota
  if (!quota || account.authorization_status?.trim().toLowerCase() === 'pending') return []
  const windows: CodexQuotaWindow[] = []
  for (const kind of ['hourly', 'weekly'] as const) {
    // API 供应商返回的是服务余额，不适用 ChatGPT 的双窗口。
    if (account.auth_mode === 'apikey' && kind === 'weekly') continue
    if (!hasWindow(quota, kind)) continue
    const percentage = percent(quota[`${kind}_percentage`])
    if (percentage === null) continue
    windows.push({
      id: kind,
      label: account.auth_mode === 'apikey' ? '服务额度' : codexQuotaWindowLabel(quota[`${kind}_window_minutes`], kind === 'hourly' ? '5 小时额度' : '周额度'),
      percentage,
      resetTime: nonnegative(quota[`${kind}_reset_time`]),
      blockedBy: null,
    })
  }
  const exhausted = windows.find(window => window.id === 'weekly' && window.percentage === 0)
  if (exhausted) {
    const primary = windows.find(window => window.id === 'hourly')
    if (primary) { primary.percentage = 0; primary.blockedBy = exhausted.label }
  }
  return windows
}

export function codexAdditionalQuotaWindows(account: CodexQuotaAccount): CodexQuotaWindow[] {
  const limits = record(account.quota?.raw_data)?.additional_rate_limits
  if (account.auth_mode === 'apikey' || account.authorization_status?.trim().toLowerCase() === 'pending' || !Array.isArray(limits)) return []
  const windows: CodexQuotaWindow[] = []
  const observedAt = account.usage_updated_at || Math.floor(Date.now() / 1000)
  for (const [index, value] of limits.entries()) {
    const limit = record(value)
    const rate = record(limit?.rate_limit)
    const name = typeof limit?.limit_name === 'string' ? limit.limit_name.trim() : ''
    const feature = typeof limit?.metered_feature === 'string' ? limit.metered_feature.trim() : ''
    for (const kind of ['primary', 'secondary'] as const) {
      const window = record(rate?.[`${kind}_window`])
      const used = number(window?.used_percent)
      if (!window || used === null || used < 0 || used > 100) continue
      const seconds = nonnegative(window.limit_window_seconds)
      windows.push({
        id: `additional:${index}:${kind}`,
        label: `${name || feature || '额外模型'} · ${codexQuotaWindowLabel(seconds === null ? null : Math.ceil(seconds / 60), kind === 'primary' ? '5 小时额度' : '周额度')}`,
        percentage: Math.round(100 - used),
        resetTime: resetTime(window, observedAt),
        blockedBy: null,
      })
    }
  }
  return windows
}

export function codexCredits(account: CodexQuotaAccount): CodexCredits | null {
  if (account.auth_mode === 'apikey' || account.authorization_status?.trim().toLowerCase() === 'pending') return null
  const raw = record(account.quota?.raw_data)
  const limit = record(record(raw?.spend_control)?.individual_limit)
  const observedAt = account.usage_updated_at || Math.floor(Date.now() / 1000)
  if (limit) {
    const total = nonnegative(limit.limit)
    const used = nonnegative(limit.used)
    const remaining = nonnegative(limit.remaining) ?? (total !== null && used !== null ? Math.max(0, total - used) : null)
    const percentage = percent(limit.remaining_percent) ?? (total !== null && total > 0 && remaining !== null ? percent(remaining / total * 100) : null)
    if (total !== null || remaining !== null || percentage !== null) {
      return { remaining, total, percentage, unlimited: false, resetTime: resetTime(limit, observedAt), monthly: true }
    }
  }
  const credits = record(raw?.credits)
  if (!credits) return null
  const unlimited = credits.unlimited === true || credits.unlimited === 'true'
  const remaining = nonnegative(credits.remaining) ?? nonnegative(credits.balance)
  return unlimited || remaining !== null ? { remaining, total: null, percentage: null, unlimited, resetTime: null, monthly: false } : null
}

export function codexQuotaRemaining(account: CodexQuotaAccount): number | null {
  const percentages = codexQuotaWindows(account).map(window => window.percentage)
  const credits = codexCredits(account)
  if (credits?.percentage !== null && credits?.percentage !== undefined) percentages.push(credits.percentage)
  return percentages.length ? Math.min(...percentages) : null
}
