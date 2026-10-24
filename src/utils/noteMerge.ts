import { normalizeAssetHtml } from '../services/attachmentSrc'
import { sanitizeNoteHtml } from './sanitizeNoteHtml'

function listFamily(node: Node | null): string | null {
  if (!(node instanceof Element)) return null
  if (node.tagName === 'OL') return 'ol'
  if (node.tagName === 'UL') return node.getAttribute('data-type') === 'taskList' ? 'task' : 'ul'
  return null
}

function isEmptyBlock(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return !node.textContent?.trim()
  if (!(node instanceof Element) || node.tagName !== 'P') return false
  return Array.from(node.childNodes).every(child =>
    child.nodeType === Node.TEXT_NODE ? !child.textContent?.trim() : child.nodeName === 'BR',
  )
}

/** Append top-level blocks, joining only adjacent lists of the same family. */
export function mergeNoteHtml(parts: string[]): string {
  // 清洗之前始终留在惰性文档中，避免原始图片的事件属性被激活。
  const result = new DOMParser().parseFromString('', 'text/html').body
  let blanks: Node[] = []
  for (const html of parts) {
    const body = new DOMParser().parseFromString(html, 'text/html').body
    const blocks = Array.from(body.childNodes)
    if (blocks.every(isEmptyBlock)) continue
    for (const block of blocks) {
      if (isEmptyBlock(block)) {
        blanks.push(block)
        continue
      }
      const previous = result.lastChild
      const family = listFamily(block)
      if (family && family === listFamily(previous)) {
        for (const child of Array.from(block.childNodes)) previous!.appendChild(child)
      } else {
        result.append(...blanks, block)
      }
      blanks = []
    }
  }
  result.append(...blanks)
  return normalizeAssetHtml(sanitizeNoteHtml(result.innerHTML))
}
