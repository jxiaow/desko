import { describe, expect, it } from 'vitest'
import { formatTokenCount, formatUsageCost, formatUsageCostDetail, localDayKey, usageHours, usageWindowFrom } from './codexUsage'

it.each([[null, '未定价'], [undefined, '未定价'], [0, '$0.00'], [0.000001, '<$0.0001'], [0.004, '$0.0040'], [0.012345, '$0.0123'], [3.9478, '$3.95'], [1234.5, '$1,234.50']])('金额 %s 显示为 %s', (value, expected) => {
  expect(formatUsageCost(value as number | null | undefined)).toBe(expected)
})

it('金额摘要取整后，提示仍能核对原始精度且缺失定价保持明确', () => {
  expect(formatUsageCostDetail(3.9478)).toBe('估算金额（USD）：$3.9478')
  expect(formatUsageCostDetail(0.000001)).toBe('估算金额（USD）：$0.000001')
  expect(formatUsageCostDetail(null)).toContain('未定价')
})

it.each([[0, '0'], [9999, '9,999'], [10000, '1万'], [12345, '1.23万'], [1200000, '120万'], [100000000, '1亿'], [1234567890, '12.35亿']])('Token %s 显示为 %s', (value, expected) => {
  expect(formatTokenCount(Number(value))).toBe(expected)
})

describe('本地自然日的用量窗口', () => {
  it('当天从本地零点起，近 7/30 天恰好包含今天在内的 7/30 个日期', () => {
    const now = new Date(2026, 9, 13, 21, 30)
    const keyOf = (range: 'today' | 'week' | 'month') => localDayKey(new Date(usageWindowFrom(range, now)! * 1000))
    expect(keyOf('today')).toBe('2026-10-13')
    expect(keyOf('week')).toBe('2026-10-07')
    expect(keyOf('month')).toBe('2026-09-14')
    expect(new Date(usageWindowFrom('today', now)! * 1000).getHours()).toBe(0)
    expect(now.getHours()).toBe(21)
    expect(usageWindowFrom('all', now)).toBeNull()
  })

  it('跨年和闰年按日历回退，日键不经过 UTC 转换', () => {
    const start = usageWindowFrom('week', new Date(2027, 0, 3, 0, 10))!
    expect(localDayKey(new Date(start * 1000))).toBe('2026-12-28')
    expect(localDayKey(new Date(usageWindowFrom('month', new Date(2024, 2, 1))! * 1000))).toBe('2024-02-01')
  })

  it('真实小时桶填入已过空档，未来时段不进入图中观测值', () => {
    const start = usageWindowFrom('today', new Date(2026, 9, 13, 6, 30))!
    const hours = usageHours([
      { key: String(start + 3600), label: '01:00', inputTokens: 100, cachedInputTokens: 80, outputTokens: 20, totalTokens: 120, requestCount: 2, estimatedCostUsd: null },
    ], start, start + 6.5 * 3600)
    expect(hours).toHaveLength(24)
    expect(hours[0].totalTokens).toBe(0)
    expect(hours[1].totalTokens).toBe(120)
    expect(hours[1].requestCount).toBe(2)
    expect(hours[0].estimatedCostUsd).toBe(0)
    expect(hours[1].estimatedCostUsd).toBeNull()
    expect(hours[6].future).toBe(false)
    expect(hours[7].future).toBe(true)
    expect(hours.filter(hour => !hour.future).reduce((sum, hour) => sum + hour.totalTokens, 0)).toBe(120)
  })
})

describe('每日图表日期轴', () => {
  const bucket = (key: string, totalTokens = 120) => ({ key, label:key, totalTokens, inputTokens:100, cachedInputTokens:80, outputTokens:20, requestCount:1, estimatedCostUsd:0.01 })
  it('稀疏记录按自然日显示完整七天，缺失日不压缩时间', async () => {
    const { usageDays } = await import('./codexUsage')
    const rows = usageDays([bucket('2026-10-11'),bucket('2026-10-13')], 'week', new Date(2026,9,13))
    expect(rows.map(row => row.key)).toEqual(['2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11','2026-10-12','2026-10-13'])
    expect(rows[5]).toMatchObject({totalTokens:0,recorded:false})
    expect(rows.filter(row => row.recorded).map(row => row.totalTokens)).toEqual([120,120])
  })
  it('全部用量显示截至最后一条记录的连续30天，未来数据不入图', async () => {
    const { usageDays } = await import('./codexUsage')
    const rows = usageDays([bucket('2026-09-03'),bucket('2026-10-15')], 'all', new Date(2026,9,13))
    expect(rows).toHaveLength(30)
    expect(rows[29].key).toBe('2026-09-03')
    expect(rows.reduce((sum,row)=>sum+row.totalTokens,0)).toBe(120)
    expect(usageDays([], 'month',new Date())).toEqual([])
  })
})
