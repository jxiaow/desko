import { describe, expect, it } from 'vitest'
import type { CodexSessionUsageReport, CodexUsageBucket } from '../services/api/codex'
import { usagePosterData } from './codexUsagePoster'
import { usageWindowFrom } from './codexUsage'

const now = new Date(2026, 9, 20, 12, 30)
const dayStart = usageWindowFrom('today', now)!
const row = (key: string, totalTokens = 13700): CodexUsageBucket => ({
  key, label: key, inputTokens: totalTokens - 1400, cachedInputTokens: 11000,
  outputTokens: 1400, totalTokens, requestCount: 2, estimatedCostUsd: .1,
})
const report = (): CodexSessionUsageReport => ({
  totals: { ...row('totals'), cacheWriteInputTokens: 0, reasoningOutputTokens: 400, sessionCount: 1, fileCount: 1 },
  byDay: [row('2026-10-20')], byHour: [row(String(dayStart + 12 * 3600))], byModel: [row('gpt-5.4')],
  modelSessions: { 'gpt-5.4': [{ ...row('private-session-id'), label: 'private-session-title', cwd: 'C:/private-project', lastUsedAt: dayStart }] },
  fromTimestamp: dayStart, toTimestamp: Math.floor(now.getTime() / 1000) + 1, scanMillis: 123,
})

describe('用量海报的分享快照', () => {
  it('仅取汇总、时间桶和模型统计，不携带会话明细或嵌套窗口', () => {
    const source = report()
    source.windows = { all: report() }
    const data = usagePosterData(source, 'today', now.getTime())
    expect(data.title).toBe('今日用量')
    expect(data.period).toBe('2026-10-20 · 本地时间')
    expect(data.asOf).toBe('2026-10-20 12:30')
    expect(data.filename).toBe('Codex-今日用量-2026-10-20.png')
    expect(data.nowRatio).toBeCloseTo(.5208, 4)
    expect(data.totals.totalTokens).toBe(13700)
    expect(data.points.filter(point => !point.future).reduce((sum, point) => sum + point.totalTokens, 0)).toBe(13700)
    expect(JSON.stringify(data)).not.toMatch(/private-session|private-project|modelSessions|windows|scanMillis|fileCount/)
  })

  it('预览快照不随报告原地更新而改变，未知金额仍为未知', () => {
    const source = report()
    source.totals.estimatedCostUsd = null
    const data = usagePosterData(source, 'today', now.getTime())
    source.totals.totalTokens = 99999
    source.byHour[0].totalTokens = 99999
    source.byModel[0].label = 'changed'
    expect(data.totals.totalTokens).toBe(13700)
    expect(data.totals.estimatedCostUsd).toBeNull()
    expect(data.points.reduce((sum, point) => sum + point.totalTokens, 0)).toBe(13700)
    expect(data.models[0].label).toBe('gpt-5.4')
  })

  it('历史范围保留空缺日期，窗口和文件名按当前统计日期生成', () => {
    const source = report()
    source.fromTimestamp = usageWindowFrom('week', now)
    const data = usagePosterData(source, 'week', now.getTime())
    expect(data.period).toBe('2026-10-14 — 2026-10-20')
    expect(data.points).toHaveLength(7)
    expect(data.points[0]).toMatchObject({ label: '10-14', totalTokens: 0, future: false })
    expect(data.nowRatio).toBeNull()
    expect(data.trendPeriod).toBe('2026-10-14 — 2026-10-20')
    expect(data.filename).toBe('Codex-近7天用量-2026-10-20.png')
  })

  it('全部汇总保留总量，趋势独立标明最后记录附近的30个自然日', () => {
    const source = report()
    source.fromTimestamp = null
    source.byDay = [row('2026-08-01'), row('2026-09-10')]
    source.totals.totalTokens = 27400
    const data = usagePosterData(source, 'all', now.getTime())
    expect(data.period).toBe('全部本地会话记录')
    expect(data.totals.totalTokens).toBe(27400)
    expect(data.trendPeriod).toBe('2026-08-12 — 2026-09-10')
    expect(data.points).toHaveLength(30)
    expect(data.points.reduce((sum, point) => sum + point.totalTokens, 0)).toBe(13700)
  })

  it('零用量可分享，未来小时留空，模型按真实用量选择前三个', () => {
    const source = report()
    source.totals = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningOutputTokens: 0, cacheWriteInputTokens: 0, requestCount: 0, sessionCount: 0, fileCount: 0, estimatedCostUsd: 0 }
    source.byHour = []
    source.byModel = []
    const empty = usagePosterData(source, 'today', now.getTime())
    expect(empty.totals.totalTokens).toBe(0)
    expect(empty.points.filter(point => point.future)).toHaveLength(11)
    expect(empty.models).toEqual([])
    source.byModel = [row('a', 1), row('b', 7), row('c', 3), row('d', 9)]
    expect(usagePosterData(source, 'today', now.getTime()).models.map(model => model.label)).toEqual(['d', 'b', 'c'])
    expect(usagePosterData(source, 'today', now.getTime()).otherModels).toBe(1)
  })
})
