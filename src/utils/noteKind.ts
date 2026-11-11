/**
 * 小记卡面的内容类型识别：把「一条 HTML」解成卡面能直接排版的结构。
 *
 * 现有 noteDisplay 只回答「首块要不要升标题」，noteMeta 只给纯文本和标签，
 * 于是链接、命令、待办、配图、长文全部落进同一个三行白条里，扫读只能靠认字。
 * 这里补的是「内容 → 卡面骨架」这一层：只做派生，不改写模型、不参与落库，
 * 任务勾选仍走 NoteCard.toggleTask 对 content_html 的原序对位。
 *
 * 加密态不在这里判：明文是否在手是会话状态（note.encrypted && !unlocked），
 * 调用方应先分流到封条，再把明文交给本函数。
 */
export type NoteKind = 'link' | 'command' | 'task' | 'code' | 'image' | 'text'

export interface NoteTask {
  text: string
  checked: boolean
}

export interface NoteKindInfo {
  kind: NoteKind
  /** 卡面左上角的类型字，不配彩色徽章（全屏只有一套强调色） */
  label: string
  headline: string
  detail: string
  /** link */
  href?: string
  host?: string
  /** task */
  tasks?: NoteTask[]
  done?: number
  total?: number
  /** code / command */
  code?: string
  /** image */
  imageSrc?: string
  /** text：去掉空白后的字数，用于卡底 meta */
  chars?: number
}

const COMMAND_HEAD = /^(?:python3?|node|npm|npx|pnpm|yarn|git|cargo|go|docker|kubectl|curl|wget|ssh|scp|sudo|bash|sh|zsh|pwsh|powershell|ffmpeg|rsync|tar|make|cmake|dotnet|java|ruby|php|pip3?|brew|systemctl|tauri|vite)\b/i
const CJK = /[\u3400-\u9fff]/
const BARE_URL = /^https?:\/\/\S+$/i
const MAX_COMMAND_CHARS = 120
const MAX_HEADLINE_CHARS = 40
const MAX_DETAIL_CHARS = 140

const blockTexts = (root: HTMLElement): string[] =>
  Array.from(root.children)
    .map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)

/** 干净的卡面摘要：块间留一个空格，不把列表符号和换行一起端上卡。 */
const plainOf = (blocks: string[]) => blocks.join(' ').trim()

const textInfo = (blocks: string[]): NoteKindInfo => {
  const plain = plainOf(blocks)
  const first = blocks[0] ?? ''
  const short = first.length > 0 && first.length <= MAX_HEADLINE_CHARS
  const headline = short ? first : first.slice(0, 24)
  const rest = short ? blocks.slice(1).join(' ') : plain.slice(headline.length).trim()
  return {
    kind: 'text',
    label: '小记',
    headline,
    detail: rest.slice(0, MAX_DETAIL_CHARS),
    chars: plain.replace(/\s/g, '').length,
  }
}

export function noteKind(html: string): NoteKindInfo {
  if (!html) return textInfo([])

  const root = document.createElement('div')
  root.innerHTML = html
  const blocks = blockTexts(root)
  const plain = plainOf(blocks)

  // 任务：编辑器写的是 Tiptap TaskList，li 上带 data-checked
  const taskList = root.querySelector('ul[data-type="taskList"]')
  if (taskList) {
    const tasks: NoteTask[] = Array.from(taskList.querySelectorAll('li')).map(li => ({
      text: (li.textContent ?? '').replace(/\s+/g, ' ').trim(),
      checked: li.getAttribute('data-checked') === 'true'
        || !!li.querySelector('input[type="checkbox"][checked]'),
    }))
    const done = tasks.filter(t => t.checked).length
    // 任务列表之前的文字块是这份清单的标题，没有就用「待办」
    const lead = blocks.find(b => !tasks.some(t => t.text === b)) ?? ''
    return {
      kind: 'task',
      label: '待办',
      headline: lead.slice(0, MAX_HEADLINE_CHARS) || '待办',
      detail: '',
      tasks,
      done,
      total: tasks.length,
    }
  }

  const pre = root.querySelector('pre')
  if (pre) {
    return {
      kind: 'code',
      label: '代码',
      headline: blocks.find(b => b !== (pre.textContent ?? '').trim())?.slice(0, MAX_HEADLINE_CHARS) ?? '代码',
      detail: '',
      code: (pre.textContent ?? '').split('\n').slice(0, 3).join('\n'),
    }
  }

  const img = root.querySelector('img')
  if (img) {
    return {
      kind: 'image',
      label: '图片',
      headline: plain.slice(0, MAX_HEADLINE_CHARS) || '图片',
      detail: blocks.slice(1).join(' ').slice(0, MAX_DETAIL_CHARS),
      imageSrc: img.getAttribute('src') ?? '',
    }
  }

  // 链接：整条就是一个裸 URL，或唯一一个 <a> 且文字就是它自己
  const anchors = Array.from(root.querySelectorAll('a'))
  const soleAnchor = anchors.length === 1 ? anchors[0] : null
  const href = (BARE_URL.test(plain) ? plain : '') || (soleAnchor?.getAttribute('href') ?? '')
  if (BARE_URL.test(plain) || (soleAnchor && soleAnchor.textContent?.trim() === href && BARE_URL.test(href))) {
    let host = href
    let path = ''
    try {
      const u = new URL(href)
      host = u.host
      path = u.pathname + u.search
    } catch { /* 非标准写法就整条当域名显示 */ }
    return { kind: 'link', label: '链接', headline: host, detail: path || href, href, host }
  }

  // 命令：单行、无中文、不长，且像一条真的命令（已知命令头或带路径参数）
  if (plain && !plain.includes('\n') && !CJK.test(plain) && plain.length <= MAX_COMMAND_CHARS
    && (COMMAND_HEAD.test(plain) || (/[\s./]/.test(plain) && /\/[\w.-]+/.test(plain)))) {
    const cut = plain.indexOf(' ')
    return {
      kind: 'command',
      label: '命令',
      headline: cut > 0 ? plain.slice(0, cut) : plain,
      detail: cut > 0 ? plain.slice(cut + 1) : '',
      code: plain,
    }
  }

  return textInfo(blocks)
}
