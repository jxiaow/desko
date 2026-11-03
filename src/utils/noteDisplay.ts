const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
/** 真机里绝大多数小记没有格式标题，首块就是这张纸片的标题；超过一行就不再是「标题」。 */
const VOICE_MAX_CHARS = 40
/** 手写的列表在正文里只是普通段落：行首记号就是唯一的结构线索，两位以上数字不认，避开年份与小数。 */
const HANG_RE = /^\s*(?:[-–—•·]|\d{1,2}[.、)])\s+/

/** 给阅读层打排版类：空段只作段落分隔，手写列表要悬挂缩进。 */
export function markNoteRhythm(html: string): string {
  if (!html) return html
  const div = document.createElement('div')
  div.innerHTML = html
  for (const el of Array.from(div.children)) {
    if (el.tagName !== 'P') continue
    // 只剩图片、换行、勾选框的块仍是内容，不算空段
    if (!el.textContent?.trim() && !el.querySelector('img, br, input, video, audio, iframe, table, pre')) el.classList.add('tp-blank')
    else if (HANG_RE.test(el.textContent || '')) el.classList.add('tp-hang')
  }
  return div.innerHTML
}

/** 传入已清理标签的展示 HTML；保留首块节点，任务勾选仍按原顺序对位。 */
export function noteDisplay(html: string) {
  const div = document.createElement('div')
  div.innerHTML = html
  const first = div.firstElementChild
  const firstText = (first?.textContent ?? '').trim()
  // 混排图片或任务的块仍是正文，不能为提升文字标题把其中的内容一并藏掉。
  const hasStructure = !!first?.querySelector('img, input, ul, ol, pre')
  const hideFirstBlock = !!first && HEADINGS.has(first.tagName) && !!firstText && !hasStructure
  const voiceFirst = !hideFirstBlock && !!first && !hasStructure
    && (first.tagName === 'P' || HEADINGS.has(first.tagName))
    && firstText.length > 0 && firstText.length <= VOICE_MAX_CHARS
  return {
    title: hideFirstBlock ? firstText : '',
    hideFirstBlock,
    voiceFirst,
  }
}
