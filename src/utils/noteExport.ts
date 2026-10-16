import TurndownService from 'turndown'
import type { Note } from '../types'
import { attachmentNameFromSrc } from '../services/attachmentSrc'
import { extractTags, htmlToTagText, formatAbsTime, stripTagsFromHtml, stripTagsFromText } from './format'

export const NOTE_EXPORT_FORMATS = [
  { id: 'markdown', label: 'Markdown', extension: 'md' },
  { id: 'html', label: 'HTML', extension: 'html' },
  { id: 'word', label: 'Word', extension: 'doc' },
  { id: 'pdf', label: 'PDF', extension: 'pdf' },
] as const
export type NoteExportFormat = (typeof NOTE_EXPORT_FORMATS)[number]['id']
export interface NoteExportFile { name: string; content: string }

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const exportTitle = (title: string) => stripTagsFromText(title).trim() || '小记'

export function noteExportExtension(format: NoteExportFormat, count: number): string {
  return format === 'pdf' ? 'pdf' : count > 1 ? 'zip' : NOTE_EXPORT_FORMATS.find(f => f.id === format)!.extension
}

export function noteExportFilename(title: string): string {
  let name = [...title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, '-').trim()].slice(0, 72).join('').replace(/[. ]+$/, '') || '小记'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name
  return name
}

function exportBody(html: string, images: Record<string, string>) {
  const body = document.createElement('div')
  // 标签统一在文档头部展示，正文沿用列表的标签隐藏规则（同时清洗 HTML）。
  body.innerHTML = stripTagsFromHtml(html)
  let missingImages = 0
  for (const image of body.querySelectorAll('img')) {
    const name = attachmentNameFromSrc(image.getAttribute('src'))
    const data = name ? images[name] : undefined
    if (data && /^data:image\/(png|jpeg|gif|webp|bmp);base64,[a-z\d+/=]+$/i.test(data)) image.setAttribute('src', data)
    else {
      const label = document.createElement('p')
      label.textContent = `[图片未嵌入：${image.getAttribute('alt') || name || image.getAttribute('src') || '图片'}]`
      image.replaceWith(label)
      missingImages++
    }
  }
  // checkbox 只作打印标记，导出的 HTML 不保留可交互控件。
  for (const item of body.querySelectorAll('li[data-type="taskItem"]')) {
    const label = item.querySelector(':scope > label')
    const marker = document.createElement('span')
    marker.className = 'task-check'
    marker.textContent = item.getAttribute('data-checked') === 'true' ? '☑ ' : '☐ '
    if (label) label.replaceWith(marker)
    else item.prepend(marker)
  }
  body.querySelectorAll('input').forEach(input => input.remove())
  return { body, missingImages }
}

function markdown(body: HTMLElement) {
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
  converter.addRule('tasks', {
    filter: node => node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem',
    replacement: (content, node) => {
      const checked = (node as HTMLElement).getAttribute('data-checked') === 'true'
      return `- [${checked ? 'x' : ' '}] ${content.replace(/^[☑☐]\s*/, '').trim().replace(/\n/g, '\n  ')}\n`
    },
  })
  return converter.turndown(body)
}

/** 打印采用应用的浅色令牌，暗色界面也生成适合纸张的文档。 */
function printStyles() {
  const probe = document.createElement('div')
  probe.className = 'theme-scope'
  probe.dataset.theme = 'snow'
  probe.dataset.base = 'light'
  probe.dataset.accent = document.documentElement.dataset.accent || 'ink'
  probe.hidden = true
  document.body.append(probe)
  const style = getComputedStyle(probe)
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  const colors = { text: token('--text', '#2c2c2c'), muted: token('--text-secondary', '#555555'), border: token('--border', '#e2e2e2'), accent: token('--accent', '#315f9b') }
  probe.remove()
  return `@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:28px;color:${colors.text};background:#fff;font:11pt/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif}article+article{margin-top:32px;padding-top:24px;border-top:1px solid ${colors.border}}header{margin-bottom:22px}header h1{margin:0 0 8px;font-size:22pt;line-height:1.4}header p{margin:0;color:${colors.muted};font-size:9pt}h1,h2,h3{break-after:avoid}p,li{orphans:3;widows:3}a{color:${colors.accent};overflow-wrap:anywhere}img{max-width:100%;height:auto;break-inside:avoid}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;border:1px solid ${colors.border};background:#f5f5f5}code{font-family:Consolas,monospace}blockquote{margin-left:0;padding-left:16px;border-left:3px solid ${colors.border};color:${colors.muted}}ul[data-type=taskList]{list-style:none;padding-left:20px}li[data-type=taskItem]>.task-check{float:left;margin-left:-20px}li[data-type=taskItem]>div{display:block}li[data-type=taskItem] p{margin:0}hr{border:0;border-top:1px solid ${colors.border}}@media print{body{margin:0}}`
}

function documentHtml(title: string, articles: string[], word: boolean) {
  return `<!doctype html><html lang="zh-CN"${word ? ' xmlns:w="urn:schemas-microsoft-com:office:word"' : ''}><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">${word ? '<meta name="ProgId" content="Word.Document">' : ''}<title>${escape(title)}</title><style>${printStyles()}</style></head><body>${articles.join('\n')}</body></html>`
}

export function buildNoteExport(notes: Note[], format: NoteExportFormat, images: Record<string, string> = {}): { files: NoteExportFile[]; missingImages: number } {
  const used = new Set<string>()
  let missingImages = 0
  const articles: string[] = []
  const files: NoteExportFile[] = []
  for (const note of notes) {
    const { body, missingImages: missing } = exportBody(note.content_html, images)
    missingImages += missing
    const title = exportTitle(note.title)
    const tags = extractTags(htmlToTagText(note.content_html)).map(tag => '#' + tag).join(' ')
    const dates = `创建于 ${formatAbsTime(note.created_at)} · 更新于 ${formatAbsTime(note.updated_at)}`
    const article = `<article><header><h1>${escape(title)}</h1><p>${escape(dates)}</p>${tags ? `<p>${escape(tags)}</p>` : ''}</header>${body.innerHTML}</article>`
    articles.push(article)
    if (format === 'pdf') continue
    const extension = NOTE_EXPORT_FORMATS.find(f => f.id === format)!.extension
    const base = noteExportFilename(title)
    let name = `${base}.${extension}`
    for (let suffix = 2; used.has(name.toLowerCase()); suffix++) name = `${base} (${suffix}).${extension}`
    used.add(name.toLowerCase())
    const content = format === 'markdown'
      ? `# ${title.replace(/[\r\n]+/g, ' ').replace(/([\\`*{}\[\]()#+.!_<>|])/g, '\\$1')}\n\n${dates}\n\n${tags ? tags + '\n\n' : ''}${markdown(body)}\n`
      : (format === 'word' ? '\ufeff' : '') + documentHtml(title, [article], format === 'word')
    files.push({ name, content })
  }
  if (format === 'pdf' && notes.length) files.push({ name: '小记导出.pdf', content: documentHtml(notes.length === 1 ? exportTitle(notes[0].title) : '小记导出', articles, false) })
  return { files, missingImages }
}
