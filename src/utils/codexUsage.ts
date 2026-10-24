import type { CodexUsageBucket } from '../services/api/codex'

export type UsageRange = 'today' | 'week' | 'month' | 'all'

const usageNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const usdSmall = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 })

export function formatUsageCost(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '未定价'
  if (value > 0 && value < 0.0001) return '<$0.0001'
  return (value > 0 && value < 1 ? usdSmall : usd).format(value)
}

/** 摘要统一精度，明细提示保留小额估算，避免四舍五入后看似免费。 */
export function formatUsageCostDetail(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '估算金额（USD）：未定价'
  return `估算金额（USD）：$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 10 })}`
}

/** 大数按中文阅读单位展示；完整计数保留给明细提示和可访问名称。 */
export function formatTokenCount(value: number): string {
  if (Math.abs(value) >= 100_000_000) return `${usageNumber.format(value / 100_000_000)}亿`
  if (Math.abs(value) >= 10_000) return `${usageNumber.format(value / 10_000)}万`
  return usageNumber.format(value)
}

const RANGE_DAYS = { today: 1, week: 7, month: 30 } as const

export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 包含今天的 N 个本地自然日；按日期回退，以免夏令时让零点偏移。 */
export function usageWindowFrom(range: UsageRange, now = new Date()): number | null {
  if (range === 'all') return null
  const start = new Date(now)
  start.setHours(12, 0, 0, 0)
  start.setDate(start.getDate() - RANGE_DAYS[range] + 1)
  start.setHours(0, 0, 0, 0)
  return Math.floor(start.getTime() / 1000)
}

export interface CodexUsageHour extends CodexUsageBucket {
  timestamp: number
  endTimestamp: number
  future: boolean
}

/** 补齐当天已过的空小时；未发生的时段保留 future，图上不画零。 */
export function usageHours(buckets: CodexUsageBucket[], dayStart: number, asOf: number): CodexUsageHour[] {
  const nextDay = new Date(dayStart * 1000)
  nextDay.setDate(nextDay.getDate() + 1)
  nextDay.setHours(0, 0, 0, 0)
  const end = Math.floor(nextDay.getTime() / 1000)
  const byTimestamp = new Map(buckets.map(bucket => [Number(bucket.key), bucket]))
  const hours: CodexUsageHour[] = []
  const pad = (value: number) => String(value).padStart(2, '0')
  for (let timestamp = dayStart; timestamp < end; timestamp += 3600) {
    const date = new Date(timestamp * 1000)
    const bucket = byTimestamp.get(timestamp)
    hours.push({
      key: String(timestamp),
      label: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
      inputTokens: bucket?.inputTokens ?? 0,
      cachedInputTokens: bucket?.cachedInputTokens ?? 0,
      outputTokens: bucket?.outputTokens ?? 0,
      totalTokens: bucket?.totalTokens ?? 0,
      requestCount: bucket?.requestCount ?? 0,
      estimatedCostUsd: bucket ? bucket.estimatedCostUsd : 0,
      timestamp,
      endTimestamp: Math.min(timestamp + 3600, end),
      future: timestamp > asOf,
    })
  }
  // 回拨日同名小时用时区偏移区分，时间戳仍各自独立。
  const counts = new Map<string, number>()
  for (const hour of hours) counts.set(hour.label, (counts.get(hour.label) ?? 0) + 1)
  for (const hour of hours) {
    if ((counts.get(hour.label) ?? 0) < 2) continue
    const offset = -new Date(hour.timestamp * 1000).getTimezoneOffset()
    hour.label += ` (UTC${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)})`
  }
  return hours
}

/** A calendar axis: absent dates occupy a slot rather than compressing time. */
export function usageDays(buckets: CodexUsageBucket[], range: UsageRange, asOf: Date): (CodexUsageBucket & { recorded: boolean })[] {
  const today = localDayKey(asOf)
  const valid = buckets.filter(bucket => /^\d{4}-\d{2}-\d{2}$/.test(bucket.key) && bucket.key <= today)
  if (!valid.length) return []
  const last = range === 'all' ? valid.map(bucket => bucket.key).sort().slice(-1)[0] : today
  const end = new Date(`${last}T12:00:00`)
  const count = range === 'week' ? 7 : range === 'today' ? 1 : 30
  const byDay = new Map(valid.map(bucket => [bucket.key, bucket]))
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(end)
    date.setDate(date.getDate() - count + 1 + index)
    const key = localDayKey(date)
    const bucket = byDay.get(key)
    return { key, label: key, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, requestCount: 0, estimatedCostUsd: 0, ...bucket, recorded: !!bucket }
  })
}
