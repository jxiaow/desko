import type { CodexSessionUsageReport, CodexUsageBucket } from '../services/api/codex'
import { formatTokenCount as compact, formatUsageCost, localDayKey, usageDays, usageHours, usageWindowFrom, type UsageRange } from './codexUsage'

export const USAGE_POSTER_SIZE = { width: 1080, height: 1200 } as const
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
  /** 今日主图现在线位置：0–1；其它范围为 null */
  nowRatio: number | null
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
  let nowRatio: number | null = null
  if (range === 'today' && from != null) {
    const dayStart = from * 1000
    const nextMidnight = new Date(dayStart)
    nextMidnight.setHours(24, 0, 0, 0)
    nowRatio = Math.min(1, Math.max(0, (updatedAt - dayStart) / (nextMidnight.getTime() - dayStart)))
  }
  return {
    range, title: titles[range],
    period: range === 'all' ? '全部本地会话记录' : range === 'today' ? `${day} · 本地时间` : `${start} — ${day}`,
    asOf: `${day} ${clock}`,
    filename: `Codex-${titles[range].replaceAll(' ', '')}-${day}.png`,
    totals: { ...bucket(report.totals), requestCount: report.totals.requestCount, sessionCount: report.totals.sessionCount, estimatedCostUsd: report.totals.estimatedCostUsd },
    points: rows.map(row => ({ ...bucket(row), label: range === 'today' ? row.label : row.key.slice(5), future: 'future' in row && row.future === true })),
    trendPeriod: range === 'today' ? `${day} · 本地时间` : rows.length ? `${rows[0].key} — ${rows[rows.length - 1].key}` : '暂无本地用量记录',
    nowRatio,
    models: models.slice(0, 3).map(model => ({ label: model.label, totalTokens: model.totalTokens })),
    otherModels: Math.max(0, models.length - 3),
  }
}

interface PosterTheme {
  bg: string
  text: string
  secondary: string
  muted: string
  faint: string
  line: string
  pill: string
  accent: string
}

const themes: Record<UsagePosterTheme, PosterTheme> = {
  light: {
    bg: '#f6f6f4', text: '#1f2325', secondary: '#555d59', muted: '#6a716c', faint: '#9ba19b',
    line: '#dedfd9', pill: '#eef0eb', accent: '#3d7355',
  },
  dark: {
    bg: '#1a1b1e', text: '#e4e6e8', secondary: '#b4bcc5', muted: '#98a2ac', faint: '#77828c',
    line: '#33363b', pill: '#24262a', accent: '#84bc8f',
  },
}

const FONT = '"HarmonyOS Sans SC", "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif'

/** 固定尺寸 Canvas，不截取页面或加载外部图片；预览、复制与保存共用这份 PNG。 */
export async function renderUsagePoster(data: UsagePosterData, theme: UsagePosterTheme, showCost: boolean, accent?: string): Promise<Blob> {
  if (document.fonts) {
    const deadline = new Promise<void>(resolve => setTimeout(resolve, 1200))
    await Promise.race([document.fonts.load('600 190px "HarmonyOS Sans SC"').catch(() => undefined), deadline])
    await Promise.race([document.fonts.ready, deadline])
  }

  const canvas = document.createElement('canvas')
  canvas.width = USAGE_POSTER_SIZE.width
  canvas.height = USAGE_POSTER_SIZE.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法生成图片，请重试')

  const c = { ...themes[theme] }
  // Canvas 接受主题的 CSS 色值（含 oklch），取实际 RGB 后调节明暗以保证可读性。
  ctx.fillStyle = c.accent
  if (accent) ctx.fillStyle = accent
  ctx.fillRect(0, 0, 1, 1)
  const pixel = ctx.getImageData(0, 0, 1, 1).data
  const mix = (target: number, amount: number) => [pixel[0], pixel[1], pixel[2]].map(v => Math.round(v * (1 - amount) + target * amount))
  const ink = mix(theme === 'light' ? 0 : 255, theme === 'light' ? .16 : .26)
  const accentRgb = ink.join(',')
  c.accent = `rgb(${accentRgb})`
  const total = Math.max(0, data.totals.totalTokens)
  const lettering = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  const width = canvas.width
  const height = canvas.height
  const contentRight = 1008
  const contentWidth = contentRight - 72
  const rgba = (rgb: string, alpha: number) => `rgba(${rgb},${alpha})`

  const roundPath = (x: number, y: number, w: number, h: number, radius: number) => {
    const r = Math.max(0, Math.min(radius, w / 2, h / 2))
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }
  const topRoundPath = (x: number, y: number, w: number, h: number, radius: number) => {
    const r = Math.max(0, Math.min(radius, w / 2, h))
    ctx.beginPath()
    ctx.moveTo(x, y + h)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h)
    ctx.closePath()
  }
  const measure = (content: string, size: number, weight = 400, family = FONT, spacing = 0) => {
    ctx.font = `${weight} ${size}px ${family}`
    lettering.letterSpacing = `${spacing}px`
    return ctx.measureText(content).width
  }
  const text = (content: string, x: number, y: number, size: number, color: string = c.text, weight = 400, align: CanvasTextAlign = 'left', family = FONT, spacing = 0) => {
    ctx.font = `${weight} ${size}px ${family}`
    lettering.letterSpacing = `${spacing}px`
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(content, x, y)
  }
  const dashLine = (x1: number, y1: number, x2: number, y2: number, color: string, dash: number[]) => {
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.setLineDash(dash)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.restore()
  }

  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = c.accent
  ctx.fillRect(0, 0, width, 10)

  // 品牌行
  ctx.fillStyle = c.accent
  roundPath(72, 70, 6, 28, 3)
  ctx.fill()
  text('Desko', 92, 99, 28, c.text, 650, 'left', FONT, -.56)
  const brandWidth = measure('Desko', 28, 650, FONT, -.56)
  const dividerX = 92 + brandWidth + 24
  ctx.fillStyle = c.line
  ctx.fillRect(dividerX, 75, 1, 18)
  text('Codex', dividerX + 25, 98, 19, c.muted)

  // 总量与统计栏
  text(data.title, 72, 185, 28, c.text, 600)
  text(data.period, contentRight, 185, 18, c.muted, 400, 'right')

  const heroText = compact(total)
  let heroSize = 156
  const heroSpacing = () => -0.055 * heroSize
  while (heroSize > 120 && measure(heroText, heroSize, 600, FONT, heroSpacing()) > contentWidth - 120) heroSize -= 4
  text(heroText, 66, 350, heroSize, c.accent, 600, 'left', FONT, heroSpacing())
  text('Token', 72 + measure(heroText, heroSize, 600, FONT, heroSpacing()) + 18, 350, 24, c.muted)

  const rail = [
    { label: '请求数', value: compact(data.totals.requestCount) },
    { label: '会话数', value: compact(data.totals.sessionCount) },
    ...(showCost ? [{ label: '估算金额 · USD', value: formatUsageCost(data.totals.estimatedCostUsd) }] : []),
  ]
  for (const [index, row] of rail.entries()) {
    const x = 72 + index * contentWidth / rail.length
    text(row.label, x, 422, 18, c.muted)
    let size = 30
    while (size > 22 && measure(row.value, size, 600) > contentWidth / rail.length - 32) size -= 2
    text(row.value, x, 462, size, c.text, 600)
  }

  // 一张趋势图承接摘要，不再叠加构成、排行和重复数字。
  const plotX = 150
  const plotWidth = contentRight - plotX
  const plotTop = 590
  const plotBottom = 1040 - (data.models.length ? 92 + data.models.length * 44 : 0)
  const plotHeight = Math.max(120, plotBottom - plotTop)

  const observed = data.points.map((point, index) => ({ point, index })).filter(item => !item.point.future)
  const peak = Math.max(0, ...observed.map(item => item.point.totalTokens))
  const step = peak ? Math.max(1, 10 ** Math.floor(Math.log10(peak)) / 5) : 1
  const axisMax = peak ? Math.ceil(peak * 1.1 / step) * step : 0
  const peakPoint = observed.reduce<{ point: PosterBucket & { label: string; future: boolean }; index: number } | null>(
    (best, item) => !best || item.point.totalTokens > best.point.totalTokens ? item : best,
    null,
  )

  text(data.range === 'today' ? '每小时用量' : data.range === 'all' ? '最近 30 天用量' : '每日用量', 72, 540, 24, c.text, 600, 'left', FONT, -.24)
  if (data.range === 'all') text(data.trendPeriod, contentRight, 540, 16, c.muted, 400, 'right')


  const gridRatios = peak > 0 ? [1, .5, 0] : [0]
  for (const ratio of gridRatios) {
    const y = plotBottom - plotHeight * ratio
    dashLine(plotX, y, plotX + plotWidth, y, c.line, [4, 6])
    text(axisMax ? compact(axisMax * ratio) : '0', plotX - 14, y + 5, 15, c.muted, 400, 'right')
  }

  const count = data.points.length
  const column = count ? plotWidth / count : plotWidth
  if (count) {
    const xAt = (index: number) => plotX + column * (index + .5)
    const yAt = (value: number) => plotBottom - value / axisMax * plotHeight
    if (data.range === 'today') {
      if (peak > 0 && observed.length) {
        const area = ctx.createLinearGradient(0, yAt(peak), 0, plotBottom)
        area.addColorStop(0, rgba(accentRgb, .16))
        area.addColorStop(1, rgba(accentRgb, 0))
        ctx.beginPath()
        ctx.moveTo(xAt(observed[0].index), plotBottom)
        for (const item of observed) ctx.lineTo(xAt(item.index), yAt(item.point.totalTokens))
        ctx.lineTo(xAt(observed[observed.length - 1].index), plotBottom)
        ctx.closePath()
        ctx.fillStyle = area
        ctx.fill()

        ctx.beginPath()
        observed.forEach((item, index) => {
          const x = xAt(item.index)
          const y = yAt(item.point.totalTokens)
          if (index === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.strokeStyle = c.accent
        ctx.lineWidth = 3
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.stroke()
      }
      if (peak > 0 && peakPoint) {
        const x = xAt(peakPoint.index)
        const y = yAt(peakPoint.point.totalTokens)
        ctx.fillStyle = c.bg
        ctx.beginPath()
        ctx.arc(x, y, 7.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = c.accent
        ctx.beginPath()
        ctx.arc(x, y, 4.5, 0, Math.PI * 2)
        ctx.fill()
      }
    } else {
      for (const item of observed) {
        if (item.point.totalTokens <= 0) continue
        const bw = Math.min(column * .62, 36)
        const bx = xAt(item.index) - bw / 2
        const barHeight = item.point.totalTokens / axisMax * plotHeight
        const barTop = plotBottom - barHeight
        topRoundPath(bx, barTop, bw, barHeight, 3)
        ctx.fillStyle = c.accent
        ctx.fill()
      }
    }

    const labelIndices = data.range === 'today'
      ? data.points.map((point, index) => ({ point, index })).filter(item => ['00', '04', '08', '12', '16', '20', '23'].includes(item.point.label.slice(0, 2))).map(item => item.index)
      : data.range === 'week'
        ? data.points.map((_, index) => index)
        : [0, 7, 14, 21, count - 1]
    for (const index of [...new Set(labelIndices)].filter(index => index >= 0 && index < count)) {
      const label = data.points[index].label.split(' ')[0]
      text(data.range === 'today' ? label.slice(0, 2) : label, xAt(index), plotBottom + 26, 15, c.muted, 400, 'center')
    }
  }

  if (data.nowRatio != null) {
    const nowX = plotX + plotWidth * data.nowRatio
    dashLine(nowX, plotTop - 14, nowX, plotBottom, c.faint, [4, 5])
  }

  if (total === 0) {
    const message = '暂无本地用量记录'
    const messageWidth = measure(message, 20)
    const centerY = plotTop + plotHeight / 2
    ctx.fillStyle = c.pill
    roundPath(plotX + plotWidth / 2 - messageWidth / 2 - 18, centerY - 19, messageWidth + 36, 38, 19)
    ctx.fill()
    text(message, plotX + plotWidth / 2, centerY + 7, 20, c.secondary, 400, 'center')
  }

  // 模型排行只保留名称和用量，不重复列占比。
  if (data.models.length) {
    const headingY = plotBottom + 90
    ctx.fillStyle = c.line
    ctx.fillRect(72, plotBottom + 52, contentWidth, 1)
    text('模型排行', 72, headingY, 24, c.text, 600)
    for (const [index, model] of data.models.entries()) {
      const y = headingY + 44 + index * 44
      let name = model.label
      while (name.length && measure(name, 20, 500) > 270) name = name.slice(0, -1)
      if (name !== model.label) name = name.slice(0, -1) + '…'
      text(name, 72, y, 20, c.secondary, 500)
      const share = total ? Math.min(1, Math.max(0, model.totalTokens / total)) : 0
      ctx.fillStyle = c.line
      roundPath(370, y - 12, 440, 6, 3)
      ctx.fill()
      if (share > 0) {
        ctx.fillStyle = c.accent
        roundPath(370, y - 12, Math.max(6, 440 * share), 6, 3)
        ctx.fill()
      }
      text(compact(model.totalTokens), contentRight, y, 20, c.text, 500, 'right')
    }
    if (data.otherModels) text(`另有 ${data.otherModels} 个模型`, 72, headingY + 44 * data.models.length + 30, 15, c.muted)
  }

  // 时间只保留必要的截止信息，金额说明与显示开关一致。
  if (showCost) text('金额为 API 价格估算，非订阅实际扣费', 72, 1140, 14, c.muted)
  text(`截至 ${data.range === 'today' ? data.asOf.slice(-5) : data.asOf}`, contentRight, 1140, 15, c.muted, 400, 'right')

  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法生成 PNG 图片，请重试')), 'image/png'))
}
