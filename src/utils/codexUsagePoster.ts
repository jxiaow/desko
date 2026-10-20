import type { CodexSessionUsageReport, CodexUsageBucket } from '../services/api/codex'
import { formatTokenCount as compact, formatUsageCost, localDayKey, usageDays, usageHours, usageWindowFrom, type UsageRange } from './codexUsage'

export const USAGE_POSTER_SIZE = { width: 1080, height: 1440 } as const
export type UsagePosterTheme = 'light' | 'dark'
type PosterBucket = Pick<CodexUsageBucket, 'inputTokens' | 'cachedInputTokens' | 'outputTokens' | 'totalTokens'>
export interface UsagePosterData {
  range: UsageRange
  title: string
  period: string
  asOf: string
  filename: string
  totals: PosterBucket & { requestCount: number; sessionCount: number; estimatedCostUsd: number | null }
  points: (PosterBucket & { label: string; future: boolean })[]
  trendPeriod: string
  models: { label: string; totalTokens: number }[]
  otherModels: number
}

const titles: Record<UsageRange, string> = { today: '今日用量', week: '近 7 天用量', month: '近 30 天用量', all: '全部用量' }
const bucket = (row: PosterBucket): PosterBucket => ({ inputTokens: row.inputTokens, cachedInputTokens: row.cachedInputTokens, outputTokens: row.outputTokens, totalTokens: row.totalTokens })

/** 仅复制分享所需的汇总字段，固定打开时的快照，不携带账号、会话或目录信息。 */
export function usagePosterData(report: CodexSessionUsageReport, range: UsageRange, updatedAt: number): UsagePosterData {
  const date = new Date(updatedAt)
  const day = localDayKey(date)
  const clock = date.toTimeString().slice(0, 5)
  const from = report.fromTimestamp ?? usageWindowFrom(range, date)
  const start = from == null ? '' : localDayKey(new Date(from * 1000))
  const rows = range === 'today'
    ? usageHours(report.byHour, from!, Math.floor(updatedAt / 1000))
    : usageDays(report.byDay, range, date)
  const models = [...report.byModel].sort((a, b) => b.totalTokens - a.totalTokens)
  return {
    range, title: titles[range],
    period: range === 'all' ? '全部本地会话记录' : range === 'today' ? day : `${start} — ${day}`,
    asOf: `${day} ${clock}`,
    filename: `Codex-${titles[range].replaceAll(' ', '')}-${day}.png`,
    totals: { ...bucket(report.totals), requestCount: report.totals.requestCount, sessionCount: report.totals.sessionCount, estimatedCostUsd: report.totals.estimatedCostUsd },
    points: rows.map(row => ({ ...bucket(row), label: range === 'today' ? row.label : row.key.slice(5), future: 'future' in row && row.future === true })),
    trendPeriod: range === 'today' ? `${day} · 本地时间` : rows.length ? `${rows[0].key} — ${rows[rows.length - 1].key}` : '暂无本地用量记录',
    models: models.slice(0, 3).map(model => ({ label: model.label, totalTokens: model.totalTokens })),
    otherModels: Math.max(0, models.length - 3),
  }
}

const themes = {
  light: { bg: '#f6f7f3', text: '#202b2b', muted: '#63736e', line: '#d9dfd9', fill: '#e9eee8', fresh: '#3e70b5', cached: '#348875', output: '#b9722f' },
  dark: { bg: '#172522', text: '#ecf1e9', muted: '#a0b6aa', line: '#344a40', fill: '#243a31', fresh: '#91b4ed', cached: '#75c5a5', output: '#e5b477' },
} as const

/** 固定尺寸 Canvas，不截取页面或加载外部图片；预览、复制与保存共用这份 PNG。 */
export async function renderUsagePoster(data: UsagePosterData, theme: UsagePosterTheme, showCost: boolean): Promise<Blob> {
  await document.fonts?.ready
  const canvas = document.createElement('canvas')
  canvas.width = USAGE_POSTER_SIZE.width
  canvas.height = USAGE_POSTER_SIZE.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法生成图片，请重试')
  const c = themes[theme]
  const font = '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif'
  const num = new Intl.NumberFormat('zh-CN')
  const fresh = (row: PosterBucket) => Math.max(0, row.inputTokens - row.cachedInputTokens)
  const text = (content: string, x: number, y: number, size: number, color: string = c.text, weight = 400, align: CanvasTextAlign = 'left') => {
    ctx.font = `${weight} ${size}px ${font}`
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(content, x, y)
  }
  const line = (x: number, y: number, width: number) => {
    ctx.strokeStyle = c.line
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width, y); ctx.stroke()
  }
  const dot = (x: number, y: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(x, y, 12, 12) }
  const fit = (content: string, width: number) => {
    if (ctx.measureText(content).width <= width) return content
    const chars = [...content]
    while (chars.length && ctx.measureText(chars.join('') + '…').width > width) chars.pop()
    return chars.join('') + '…'
  }
  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = c.cached
  ctx.fillRect(72, 70, 7, 40)
  text('CODEX', 98, 105, 42, c.text, 700)
  text('USAGE REPORT', 1008, 101, 21, c.muted, 500, 'right')
  text(data.title, 72, 183, 36, c.text, 600)
  text(data.period, 72, 227, 25, c.muted)
  text(compact(data.totals.totalTokens), 66, 355, 112, c.text, 650)
  text(`${num.format(data.totals.totalTokens)} Token`, 74, 397, 24, c.muted)

  const facts = [
    { label: '请求数', value: compact(data.totals.requestCount) },
    { label: '会话数', value: compact(data.totals.sessionCount) },
    ...(showCost ? [{ label: '估算金额 · USD', value: formatUsageCost(data.totals.estimatedCostUsd) }] : []),
  ]
  for (const [i, fact] of facts.entries()) {
    const x = 72 + i * 320
    text(fact.label, x, 455, 22, c.muted)
    // 金额保留完整计价精度，过长时缩小字号。
    let size = 32
    ctx.font = `600 ${size}px ${font}`
    while (size > 18 && ctx.measureText(fact.value).width > 290) { size -= 2; ctx.font = `600 ${size}px ${font}` }
    text(fact.value, x, 499, size, c.text, 600)
  }
  line(72, 533, 936)
  for (const [i, metric] of [
    { label: '净输入', value: fresh(data.totals), color: c.fresh },
    { label: '缓存命中', value: data.totals.cachedInputTokens, color: c.cached },
    { label: '输出', value: data.totals.outputTokens, color: c.output },
  ].entries()) {
    const x = 72 + i * 320
    dot(x, 567, metric.color)
    text(metric.label, x + 22, 581, 24, c.muted)
    text(compact(metric.value), x, 636, 43, c.text, 600)
  }

  text(data.range === 'today' ? '每小时用量' : '每日用量', 72, 710, 27, c.text, 600)
  text(data.trendPeriod, 1008, 709, 20, c.muted, 400, 'right')
  const plot = (x: number, y: number, width: number, height: number, metric: 'total' | 'fresh' | 'output') => {
    const values = data.points.map(point => point.future ? 0 : metric === 'fresh' ? fresh(point) : metric === 'output' ? point.outputTokens : point.totalTokens)
    const peak = Math.max(0, ...values)
    const step = peak ? Math.max(1, 10 ** Math.floor(Math.log10(peak)) / 5) : 1
    const max = peak ? Math.ceil(peak * 1.1 / step) * step : 1
    for (const ratio of [0, .5, 1]) {
      line(x, y + height * (1 - ratio), width)
      text(compact(max * ratio), x - 14, y + height * (1 - ratio) + 7, 18, c.muted, 400, 'right')
    }
    const count = data.points.length
    if (!count) { text('暂无本地用量记录', x + width / 2, y + height / 2 + 8, 24, c.muted, 400, 'center'); return }
    const column = width / count
    const futureAt = data.points.findIndex(point => point.future)
    if (futureAt >= 0) {
      const start = x + futureAt * column
      ctx.fillStyle = c.fill
      ctx.fillRect(start, y, width - futureAt * column, height)
      if (metric === 'total' && width - futureAt * column > 130) text('未到时段', start + (width - futureAt * column) / 2, y + 30, 19, c.muted, 400, 'center')
    }
    if (metric === 'total' && data.range === 'today') {
      const observed = data.points.filter(point => !point.future)
      ctx.beginPath()
      observed.forEach((point, index) => {
        const px = x + column * (index + .5), py = y + height * (1 - point.totalTokens / max)
        if (index === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.strokeStyle = c.fresh
      ctx.lineWidth = 3
      ctx.stroke()
      if (observed.length) {
        const last = observed.length - 1
        ctx.fillStyle = c.fresh
        ctx.beginPath(); ctx.arc(x + column * (last + .5), y + height * (1 - observed[last].totalTokens / max), 5, 0, Math.PI * 2); ctx.fill()
      }
    } else {
      data.points.forEach((point, index) => {
        if (point.future) return
        const bw = Math.min(column * .62, 32), bx = x + column * (index + .5) - bw / 2
        if (metric === 'total') {
          let bottom = y + height
          for (const [amount, color] of [[fresh(point), c.fresh], [point.cachedInputTokens, c.cached], [point.outputTokens, c.output]] as const) {
            const bh = amount / max * height
            ctx.fillStyle = color
            ctx.fillRect(bx, bottom - bh, bw, bh)
            bottom -= bh
          }
        } else if (values[index] > 0) {
          const bh = Math.max(2, values[index] / max * height)
          ctx.fillStyle = c[metric]
          ctx.fillRect(bx, y + height - bh, bw, bh)
        }
      })
    }
    const ticks = metric === 'total' ? [0, Math.floor((count - 1) / 2), count - 1] : [0, count - 1]
    for (const index of new Set(ticks)) text(data.points[index].label.split(' ')[0], x + column * (index + .5), y + height + 28, 18, c.muted, 400, index === 0 ? 'left' : index === count - 1 ? 'right' : 'center')
  }
  plot(146, 750, 862, 162, 'total')
  for (const [index, metric] of (['fresh', 'output'] as const).entries()) {
    const x = 72 + index * 490
    dot(x, 976, c[metric])
    text(metric === 'fresh' ? '净输入' : '输出', x + 22, 991, 24, c.text, 500)
    text('独立刻度', x + 446, 991, 18, c.muted, 400, 'right')
    plot(x + 74, 1021, 372, 82, metric)
  }
  line(72, 1152, 936)
  text('主要模型', 72, 1195, 24, c.text, 600)
  if (!data.models.length) text('暂无模型用量记录', 72, 1244, 24, c.muted)
  for (const [i, model] of data.models.entries()) {
    ctx.font = `500 26px ${font}`
    text(fit(model.label, 640), 72, 1241 + i * 41, 26, c.text, 500)
    text(compact(model.totalTokens), 1008, 1241 + i * 41, 26, c.muted, 400, 'right')
  }
  if (data.otherModels) text(`另有 ${data.otherModels} 个模型`, 72, 1350, 18, c.muted)
  if (showCost) text('金额按标准 API 价格估算，不代表订阅实际扣费。', 72, 1376, 18, c.muted)
  text('Desko · 本地用量统计', 72, 1410, 20, c.muted, 500)
  text(`截至 ${data.asOf}`, 1008, 1410, 18, c.muted, 400, 'right')
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法生成 PNG 图片，请重试')), 'image/png'))
}
