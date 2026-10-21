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
  /** 今日主图现在线位置：0–1；其它范围为 null */
  nowRatio: number | null
  models: { label: string; totalTokens: number }[]
  otherModels: number
}

const titles: Record<UsageRange, string> = { today: '今日用量', week: '近 7 天用量', month: '近 30 天用量', all: '全部用量' }
const rangeLabels: Record<UsageRange, string> = { today: '今日', week: '近 7 天', month: '近 30 天', all: '全部' }
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
  track: string
  pill: string
  accent: string
  fresh: string
  cached: string
  output: string
  glowA: string
  glowB: string
  glowAAlpha: number
  glowBAlpha: number
}

const themes: Record<UsagePosterTheme, PosterTheme> = {
  light: {
    bg: '#f6f6f4', text: '#1f2325', secondary: '#555d59', muted: '#6a716c', faint: '#9ba19b',
    line: '#dedfd9', track: '#e8e8e2', pill: '#eef0eb', accent: '#3d7355',
    fresh: '#376cb3', cached: '#32856f', output: '#b96b25',
    glowA: '61,115,85', glowB: '55,108,179', glowAAlpha: .075, glowBAlpha: .045,
  },
  dark: {
    bg: '#1a1b1e', text: '#e4e6e8', secondary: '#b4bcc5', muted: '#98a2ac', faint: '#77828c',
    line: '#33363b', track: '#292c30', pill: '#24262a', accent: '#84bc8f',
    fresh: '#8aadf4', cached: '#6bc5b4', output: '#e8ac68',
    glowA: '132,188,143', glowB: '138,173,244', glowAAlpha: .10, glowBAlpha: .06,
  },
}

const FONT = '"HarmonyOS Sans SC", "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif'
const MONO = '"Consolas", "HarmonyOS Sans SC", monospace'

/** 固定尺寸 Canvas，不截取页面或加载外部图片；预览、复制与保存共用这份 PNG。 */
export async function renderUsagePoster(data: UsagePosterData, theme: UsagePosterTheme, showCost: boolean): Promise<Blob> {
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

  const c = themes[theme]
  const num = new Intl.NumberFormat('zh-CN')
  const total = Math.max(0, data.totals.totalTokens)
  const freshTotals = Math.max(0, data.totals.inputTokens - data.totals.cachedInputTokens)
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
  const fit = (content: string, maxWidth: number, size: number, weight = 600) => {
    if (measure(content, size, weight) <= maxWidth) return content
    const chars = [...content]
    while (chars.length && measure(chars.join('') + '…', size, weight) > maxWidth) chars.pop()
    return chars.join('') + '…'
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
  for (const [cx, cy, radius, rgb, alpha] of [
    [993, -8, 900, c.glowA, c.glowAAlpha],
    [0, height + 72, 820, c.glowB, c.glowBAlpha],
  ] as const) {
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    glow.addColorStop(0, rgba(rgb, alpha))
    glow.addColorStop(.7, rgba(rgb, 0))
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, width, height)
  }

  // 品牌行
  ctx.fillStyle = c.accent
  roundPath(72, 70, 6, 28, 3)
  ctx.fill()
  text('Desko', 92, 99, 28, c.text, 650, 'left', FONT, -.56)
  const brandWidth = measure('Desko', 28, 650, FONT, -.56)
  const dividerX = 92 + brandWidth + 24
  ctx.fillStyle = c.line
  ctx.fillRect(dividerX, 75, 1, 18)
  text('Codex 用量', dividerX + 25, 98, 19, c.muted)

  const rangeText = rangeLabels[data.range]
  const pillWidth = 40 + 7 + 9 + measure(rangeText, 18)
  const pillX = contentRight - pillWidth
  ctx.save()
  ctx.strokeStyle = c.line
  ctx.lineWidth = 1
  roundPath(pillX, 64, pillWidth, 40, 20)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = c.accent
  ctx.beginPath()
  ctx.arc(pillX + 23.5, 84, 3.5, 0, Math.PI * 2)
  ctx.fill()
  text(rangeText, pillX + 36, 90, 18, c.secondary)

  // 总量与统计栏
  text('总 Token', 72, 203, 18, c.muted, 400, 'left', FONT, 1.44)
  text(data.period, contentRight, 203, 18, c.muted, 400, 'right')

  const heroText = compact(total)
  let heroSize = 190
  const heroSpacing = () => -0.055 * heroSize
  while (heroSize > 120 && measure(heroText, heroSize, 600, FONT, heroSpacing()) > 622) heroSize -= 4
  text(heroText, 72, 364, heroSize, c.text, 600, 'left', FONT, heroSpacing())
  text(`${num.format(total)} tokens`, 72, 442, 23, c.muted, 400, 'left', MONO, .23)

  const rail = [
    { label: '请求数', value: compact(data.totals.requestCount) },
    { label: '会话数', value: compact(data.totals.sessionCount) },
    ...(showCost ? [{ label: '估算金额 · USD', value: formatUsageCost(data.totals.estimatedCostUsd) }] : []),
  ]
  for (const [index, row] of rail.entries()) {
    text(row.label, contentRight, 224 + index * 68, 16, c.muted, 400, 'right')
    let size = 30
    while (size > 22 && measure(row.value, size, 600) > 250) size -= 2
    text(row.value, contentRight, 258 + index * 68, size, c.text, 600, 'right')
  }

  // 用量构成
  const cached = Math.max(0, data.totals.cachedInputTokens)
  const output = Math.max(0, data.totals.outputTokens)
  const cachedPct = total ? (cached / total * 100).toFixed(1) : '0.0'
  text('用量构成', 72, 552, 24, c.text, 600, 'left', FONT, -.24)
  text(`缓存命中占 ${cachedPct}%`, contentRight, 552, 17, c.muted, 400, 'right')
  roundPath(72, 574, contentWidth, 20, 10)
  ctx.fillStyle = c.track
  ctx.fill()
  if (total > 0) {
    ctx.save()
    roundPath(72, 574, contentWidth, 20, 10)
    ctx.clip()
    const gap = 3
    const usable = contentWidth - gap * 2
    let x = 72
    for (const [value, color] of [[freshTotals, c.fresh], [cached, c.cached], [output, c.output]] as const) {
      const segment = Math.min(usable, value / total * usable)
      if (segment > 0) {
        ctx.fillStyle = color
        ctx.fillRect(x, 574, segment, 20)
      }
      x += segment + gap
    }
    ctx.restore()
  }
  const legend = [
    { label: '净输入', value: freshTotals, color: c.fresh },
    { label: '缓存命中', value: cached, color: c.cached },
    { label: '输出', value: output, color: c.output },
  ]
  for (const [index, item] of legend.entries()) {
    const x = 72 + index * 320
    ctx.fillStyle = item.color
    roundPath(x, 622, 9, 9, 3)
    ctx.fill()
    text(item.label, x + 18, 636, 17, c.muted)
    text(compact(item.value), x + 248, 636, 24, c.text, 600, 'right')
    text(`${total ? (item.value / total * 100).toFixed(1) : '0.0'}%`, x + 296, 636, 15, c.muted, 400, 'right')
  }

  // 主图与模型区高度从页脚向上确定，页脚始终贴底。
  const modelsShift = showCost ? 0 : 40
  const modelRows = data.models.length
  let modelHeadingY: number
  let modelRuleY: number
  let modelFirstRowY = 0
  let modelEmptyY = 0
  if (modelRows) {
    modelFirstRowY = 1232 + modelsShift - (modelRows - 1) * 58
    modelHeadingY = modelFirstRowY - 42
    modelRuleY = modelHeadingY - 44
  } else {
    modelHeadingY = 1188 + modelsShift
    modelRuleY = 1144 + modelsShift
    modelEmptyY = modelHeadingY + 58
  }
  const plotX = 150
  const plotWidth = contentRight - plotX
  const plotTop = data.range === 'all' ? 780 : 756
  const plotBottom = modelRuleY - 42
  const plotHeight = Math.max(120, plotBottom - plotTop)

  const observed = data.points.map((point, index) => ({ point, index })).filter(item => !item.point.future)
  const peak = Math.max(0, ...observed.map(item => item.point.totalTokens))
  const step = peak ? Math.max(1, 10 ** Math.floor(Math.log10(peak)) / 5) : 1
  const axisMax = peak ? Math.ceil(peak * 1.1 / step) * step : 0
  const peakPoint = observed.reduce<{ point: PosterBucket & { label: string; future: boolean }; index: number } | null>(
    (best, item) => !best || item.point.totalTokens > best.point.totalTokens ? item : best,
    null,
  )

  text(data.range === 'today' ? '每小时用量' : '每日用量', 72, 710, 24, c.text, 600, 'left', FONT, -.24)
  text(peak > 0 && peakPoint ? `峰值 ${peakPoint.point.label.split(' ')[0]} · ${compact(peak)}` : '峰值 —', contentRight, 710, 17, c.muted, 400, 'right')
  if (data.range === 'all') text(`最近 30 天 · ${data.trendPeriod}`, 72, 740, 15, c.muted)

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
        area.addColorStop(0, rgba(theme === 'light' ? '61,115,85' : '132,188,143', .16))
        area.addColorStop(1, rgba(theme === 'light' ? '61,115,85' : '132,188,143', 0))
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
        ctx.save()
        topRoundPath(bx, barTop, bw, barHeight, 3)
        ctx.clip()
        let bottom = plotBottom
        for (const [amount, color] of [[Math.max(0, item.point.inputTokens - item.point.cachedInputTokens), c.fresh], [item.point.cachedInputTokens, c.cached], [item.point.outputTokens, c.output]] as const) {
          const segment = amount / item.point.totalTokens * barHeight
          if (segment > 0) {
            ctx.fillStyle = color
            ctx.fillRect(bx, bottom - segment, bw, segment)
          }
          bottom -= segment
        }
        ctx.restore()
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
    const clock = data.asOf.slice(-5)
    dashLine(nowX, plotTop - 14, nowX, plotBottom, c.faint, [4, 5])
    text(`现在 ${clock}`, nowX, plotTop - 22, 14, c.muted, 400, 'center')
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

  // 主要模型
  ctx.fillStyle = c.line
  ctx.fillRect(72, modelRuleY, contentWidth, 1)
  text('主要模型', 72, modelHeadingY, 24, c.text, 600, 'left', FONT, -.24)
  text('按 Token 占比', contentRight, modelHeadingY, 17, c.muted, 400, 'right')
  if (!modelRows) {
    text('暂无模型用量记录', 72, modelEmptyY, 20, c.muted)
  } else {
    for (const [index, model] of data.models.entries()) {
      const baseline = modelFirstRowY + index * 58
      const share = total ? Math.min(1, Math.max(0, model.totalTokens / total)) : 0
      text(fit(model.label, 250, 22), 72, baseline, 22, c.text, 600)
      ctx.fillStyle = c.track
      roundPath(344, baseline - 15, 452, 8, 4)
      ctx.fill()
      if (share > 0) {
        ctx.save()
        ctx.globalAlpha = .82
        ctx.fillStyle = c.accent
        roundPath(344, baseline - 15, Math.max(8, 452 * share), 8, 4)
        ctx.fill()
        ctx.restore()
      }
      text(compact(model.totalTokens), 922, baseline, 22, c.text, 600, 'right')
      text(`${(share * 100).toFixed(1)}%`, contentRight, baseline, 15, c.muted, 400, 'right')
    }
    if (data.otherModels) text(`另有 ${data.otherModels} 个模型`, 72, modelFirstRowY + (modelRows - 1) * 58 + 30, 17, c.muted)
  }

  // 页脚
  if (showCost) text('估算金额按标准 API 价格计算，不代表订阅实际扣费。', 72, 1346, 14, c.muted)
  ctx.fillStyle = c.accent
  ctx.beginPath()
  ctx.arc(74.5, 1380, 2.5, 0, Math.PI * 2)
  ctx.fill()
  text('Desko · 本地用量统计', 85, 1385, 15, c.muted)
  text(`截至 ${data.asOf}`, contentRight, 1385, 15, c.muted, 400, 'right')

  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法生成 PNG 图片，请重试')), 'image/png'))
}
