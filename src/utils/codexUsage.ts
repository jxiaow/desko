import type { CodexUsageBucket } from '../services/api/codex'

export type UsageRange = 'today' | 'week' | 'month' | 'all'

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
