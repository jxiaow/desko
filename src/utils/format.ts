export function stripHtml(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  const text = div.textContent || ''
  return text.length > 120 ? text.slice(0, 120) + '...' : text
}

export function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`
  return formatDate(timestamp)
}

export function extractTags(content: string): string[] {
  // 支持英文、数字、下划线和中文字符
  const tagRegex = /#([\w\u4e00-\u9fa5]+)/g
  const tags: string[] = []
  let match
  while ((match = tagRegex.exec(content)) !== null) {
    tags.push(match[1])
  }
  return [...new Set(tags)] // 去重
}

/** 正文转纯文本：块级元素之间补换行，不做长度截断 */
export function htmlToText(html: string): string {
  if (!html) return ''
  const div = document.createElement('div')
  div.innerHTML = html
  const blocks = Array.from(div.children)
  if (blocks.length === 0) return (div.textContent || '').trim()
  return blocks
    .map(b => (b.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** 只有图片也算有内容：图片是正文的一部分，不该被当成空草稿拦下来 */
export function htmlHasContent(html: string): boolean {
  if (!html) return false
  if (/<img\b/i.test(html)) return true
  return htmlToText(html).trim().length > 0
}

/** 标题取正文第一行非空文本，最多 20 字 */
export function deriveTitleFromHtml(html: string): string {
  const firstLine = htmlToText(html).split('\n').find(Boolean) || ''
  return firstLine.slice(0, 20) || '小记'
}

/** 加密行只把真标题留成明文：正文首块必须真是 h1–h3，规则与 Rust note_service::heading_title 一致 */
const HEADING_FIRST = /^\s*<(h[123])(?:\s[^>]*)?>([\s\S]*?)<\/\1>/i

export function headingTitle(html: string): string {
  const m = html.match(HEADING_FIRST)
  if (!m) return ''
  const div = document.createElement('div')
  div.innerHTML = m[2]
  return (div.textContent || '').trim().slice(0, 20)
}

/** 中日韩逐字计数，拉丁字母按词计数 */
export function wordCount(text: string): number {
  return (text.match(/[\u4e00-\u9fa5]|[A-Za-z0-9_'’-]+/g) || []).length
}

export function formatAbsTime(ts: number): string {
  const d = new Date(ts)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const TAG_IN_HTML = /(^|[\s>])(#([\w\u4e00-\u9fa5]+))/g

/**
 * 把正文 HTML 里的 #标签 包成 span.ti（flomo 式内联着色）。
 * 标签字符集只允许字母数字下划线和汉字，拼进属性无需转义。
 */
export function highlightTagsInHtml(html: string): string {
  return html.replace(TAG_IN_HTML, (_m, pre: string, full: string, tag: string) =>
    `${pre}<span class="tag-inline" data-tag="${tag}">${full}</span>`)
}

/** 卡片上只显示 host + 路径：协议和结尾斜杠是噪音，解析失败就原样显示 */
export function formatUrlDisplay(url: string): string {
  try {
    const u = new URL(url)
    return u.host + u.pathname.replace(/\/+$/, '') + u.search
  } catch {
    return url.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '')
  }
}

export function getDateGroupLabel(timestamp: number): string {
  const now = new Date()
  const date = new Date(timestamp)
  
  // 重置时间部分，只比较日期
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  
  const diffTime = today.getTime() - targetDate.getTime()
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
  
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return '本周'
  if (diffDays < 30) return '本月'
  return '更早'
}
