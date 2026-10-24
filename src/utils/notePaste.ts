import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'

const blankText = (node: ProseMirrorNode) => node.isText
  && !node.marks.some(mark => mark.type.spec.code)
  && /^[\s\u200b\ufeff]*$/.test(node.text ?? '')

function emptyParagraph(node: ProseMirrorNode): boolean {
  if (node.type.name !== 'paragraph') return false
  let empty = true
  node.forEach(child => {
    if (child.type.name !== 'hardBreak' && !blankText(child)) empty = false
  })
  return empty
}

/** 只合并相邻换行及其间的空白，不改变正文里的连续空格、行内代码或缩进。 */
function collapseBreaks(content: Fragment): Fragment {
  const nodes: ProseMirrorNode[] = []
  let afterBreak = false
  let spaces: ProseMirrorNode[] = []
  content.forEach(node => {
    if (node.type.name === 'hardBreak') {
      if (!afterBreak) nodes.push(node)
      spaces = []
      afterBreak = true
    } else if (afterBreak && blankText(node)) {
      spaces.push(node)
    } else {
      nodes.push(...spaces, node)
      spaces = []
      afterBreak = false
    }
  })
  nodes.push(...spaces)
  return Fragment.fromArray(nodes)
}

function cleanFragment(fragment: Fragment, origins: WeakMap<ProseMirrorNode, ProseMirrorNode>): Fragment {
  const nodes: ProseMirrorNode[] = []
  fragment.forEach(node => {
    // <pre> 和已存在代码块里的粘贴必须逐字保留。
    if (node.type.spec.code || node.isLeaf) {
      nodes.push(node)
      return
    }
    const content = node.isTextblock ? collapseBreaks(node.content) : cleanFragment(node.content, origins)
    // 列表项可能需要一个起始段落；优先保留 schema 要求的结构。
    const cleaned = node.type.validContent(content) ? node.copy(content) : node
    origins.set(cleaned, node)
    nodes.push(cleaned)
  })
  if (nodes.length < 2) return Fragment.fromArray(nodes)
  const nonempty = nodes.filter(node => !emptyParagraph(node))
  // 纯空白粘贴最多留下一个段落，不构造无效的空列表项。
  return Fragment.fromArray(nonempty.length ? nonempty : nodes.slice(0, 1))
}

/** 仅延续仍在原边界上的节点；移除空段落后新露出的引用、列表等应保持闭合。 */
function preservedOpenDepth(
  original: Fragment,
  cleaned: Fragment,
  maxDepth: number,
  side: 'firstChild' | 'lastChild',
  origins: WeakMap<ProseMirrorNode, ProseMirrorNode>,
): number {
  let before = original[side]
  let after = cleaned[side]
  let depth = 0
  while (depth < maxDepth && before && after && !after.isLeaf && (origins.get(after) ?? after) === before) {
    depth += 1
    before = before[side]
    after = after[side]
  }
  return depth
}

/** 在剪贴板解析完成后清理，保留 schema 已识别的富文本和粘贴事务的撤销行为。 */
export function normalizeNotePaste(slice: Slice, inCode = false): Slice {
  if (inCode) return slice
  const origins = new WeakMap<ProseMirrorNode, ProseMirrorNode>()
  const content = cleanFragment(slice.content, origins)
  if (content.eq(slice.content)) return slice
  return new Slice(content,
    preservedOpenDepth(slice.content, content, slice.openStart, 'firstChild', origins),
    preservedOpenDepth(slice.content, content, slice.openEnd, 'lastChild', origins))
}
