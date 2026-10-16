/** Only the HTML produced by the note editor may reach a read-only v-html surface. */
const ALLOWED = new Set([
  'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 's', 'u',
  'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'div', 'span', 'label', 'input',
  'img', 'a', 'hr',
])
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'template',
  'video', 'audio', 'link', 'meta', 'base', 'button', 'textarea', 'select', 'option',
])

/** 正文链接的合法地址口径：编辑器 setLink 与渲染清洗共用这一份 */
export function safeLink(value: string): boolean {
  const url = value.trim()
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return false
  return /^(https?:\/\/|mailto:|\/[^/]|#)/i.test(url)
}

/** 正文图片的合法地址口径：编辑器解析剪贴板与渲染清洗共用这一份（data:、blob: 一律不收） */
export function safeImage(value: string): boolean {
  const url = value.trim()
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return false
  if (/^attachments\/[^/\\]+$/i.test(url)) {
    try {
      const name = decodeURIComponent(url.slice('attachments/'.length))
      return name !== '.' && name !== '..' && !/[\\/\u0000-\u001f\u007f]/.test(name)
    } catch { return false }
  }
  if (/^https?:\/\//i.test(url)) return true
  return /^(asset:\/\/|desko-asset:\/\/)/i.test(url)
}

function clean(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) { child.remove(); continue }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const element = child as Element
    const tag = element.tagName.toLowerCase()
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || DROP_WITH_CONTENT.has(tag)) {
      element.remove()
      continue
    }
    clean(element)
    if (!ALLOWED.has(tag)) {
      element.replaceWith(...Array.from(element.childNodes))
      continue
    }

    const attrs = Array.from(element.attributes)
    for (const attr of attrs) element.removeAttribute(attr.name)
    const get = (name: string) => attrs.find(a => a.name.toLowerCase() === name)?.value
    if (tag === 'a') {
      const href = get('href')
      if (href && safeLink(href)) {
        element.setAttribute('href', href.trim())
        if (get('target') === '_blank') {
          element.setAttribute('target', '_blank')
          element.setAttribute('rel', 'noopener noreferrer')
        }
      }
    } else if (tag === 'img') {
      const src = get('src')
      if (!src || !safeImage(src)) { element.remove(); continue }
      element.setAttribute('src', src.trim())
      const alt = get('alt')
      if (alt) element.setAttribute('alt', alt)
      const width = get('style')?.match(/^\s*width:\s*(100|[1-9]?\d(?:\.\d+)?)%\s*;?\s*$/i)?.[1]
      if (width) element.setAttribute('style', `width: ${width}%`)
      if (get('data-note-image') != null) element.setAttribute('data-note-image', '')
    } else if (tag === 'input') {
      if (get('type') !== 'checkbox') { element.remove(); continue }
      element.setAttribute('type', 'checkbox')
      if (get('checked') != null) element.setAttribute('checked', 'checked')
      if (get('disabled') != null) element.setAttribute('disabled', 'disabled')
    } else if (tag === 'ul' && get('data-type') === 'taskList') {
      element.setAttribute('data-type', 'taskList')
    } else if (tag === 'li' && get('data-type') === 'taskItem') {
      element.setAttribute('data-type', 'taskItem')
      if (get('data-checked') === 'true' || get('data-checked') === 'false') {
        element.setAttribute('data-checked', get('data-checked')!)
      }
    } else if (tag === 'code') {
      const className = get('class')
      if (className && /^language-[a-z\d_-]+$/i.test(className)) element.setAttribute('class', className)
    } else if (tag === 'span' && get('class') === 'tag-inline') {
      element.setAttribute('class', 'tag-inline')
      const dataTag = get('data-tag')
      if (dataTag) element.setAttribute('data-tag', dataTag)
    }
  }
}

export function sanitizeNoteHtml(html: string): string {
  if (!html) return ''
  // DOMParser keeps imported markup inert while event attributes are removed.
  const root = new DOMParser().parseFromString(html, 'text/html').body
  clean(root)
  return root.innerHTML
}
