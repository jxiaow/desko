import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { DOMParser, DOMSerializer, Slice } from '@tiptap/pm/model'
import { normalizeNotePaste } from './notePaste'
import { EditorState, TextSelection } from '@tiptap/pm/state'

const schema = getSchema([StarterKit, TaskList, TaskItem])
function parse(html: string) {
  const dom = document.createElement('div')
  dom.innerHTML = html
  return DOMParser.fromSchema(schema).parseSlice(dom, { preserveWhitespace: true })
}
function html(slice: Slice) {
  const dom = document.createElement('div')
  dom.append(DOMSerializer.fromSchema(schema).serializeFragment(slice.content))
  return dom.innerHTML
}
const clean = (source: string) => html(normalizeNotePaste(parse(source)))

describe('小记粘贴整理', () => {
  it('移除段落之间和首尾的大段空行，包括空格、NBSP 和不可见占位', () => {
    expect(clean('<p><br></p><p>甲</p><p> </p><p>&nbsp;</p><p>\u200b</p><p><br></p><p>乙</p><p></p>'))
      .toBe('<p>甲</p><p>乙</p>')
  })
  it('压缩段内连续换行，保留正常换行、正文双空格和缩进', () => {
    expect(clean('<p>  甲  乙<br><br> &nbsp; <br><strong>丙</strong><br>  丁</p>'))
      .toBe('<p>  甲  乙<br><strong>丙</strong><br>  丁</p>')
  })
  it('保留代码块和行内代码的原始空白', () => {
    const source = '<pre><code>  a\n\n\n    b\n</code></pre><p><code>  </code></p><p>结尾</p>'
    expect(clean(source)).toBe(source)
    const slice = parse('<p>代码前</p><p></p><p>代码后</p>')
    expect(normalizeNotePaste(slice, true)).toBe(slice)
  })
  it('清理引用和列表项的冗余段落，保留列表编号、链接及必需的空列表项', () => {
    const result = clean('<blockquote><p>引文</p><p></p><p>下一段</p></blockquote><ol start="3"><li><p></p><p><a href="https://example.com">链接</a></p></li><li><p></p></li></ol>')
    const root = document.createElement('div'); root.innerHTML = result
    expect(root.querySelectorAll('blockquote p')).toHaveLength(2)
    expect(root.querySelector('ol')?.getAttribute('start')).toBe('3')
    expect(root.querySelectorAll('li')).toHaveLength(2)
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
    expect(root.querySelectorAll('li:first-child p')).toHaveLength(1)
    expect(root.querySelectorAll('li:last-child p')).toHaveLength(1)
  })
  it('没有多余空行时不改变剪贴板边界，单个空格粘贴也保留', () => {
    for (const source of ['<p> </p>', '<h2>标题</h2><p>正文</p>', '<p>甲<br>乙</p>']) {
      const slice = parse(source)
      expect(normalizeNotePaste(slice)).toBe(slice)
    }
  })
  it('移除边界空段落后插入正文，引用格式及前后文字仍保留', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('beforeAFTER'))])
    for (const source of [
      '<p></p><blockquote><p>quote</p></blockquote>',
      '<blockquote><p>quote</p></blockquote><p></p>',
      '<p></p><blockquote><p>quote</p></blockquote><p></p>',
    ]) {
      const state = EditorState.create({ doc, selection: TextSelection.create(doc, 7) })
      const original = state.tr.replaceSelection(parse(source)).doc
      let originalQuotes = 0
      original.descendants(node => { if (node.type.name === 'blockquote') originalQuotes += 1 })
      const next = state.tr.replaceSelection(normalizeNotePaste(parse(source))).doc
      next.check()
      expect(next.textContent).toBe('beforequoteAFTER')
      const quoted: string[] = []
      next.descendants(node => { if (node.type.name === 'blockquote') quoted.push(node.textContent) })
      expect(quoted).toHaveLength(originalQuotes)
      for (const text of quoted) expect(text).toContain('quote')
    }
  })
  it('清理嵌套边界时只保留原来开放的祖先，不把后续列表拉平', () => {
    const original = parse('<blockquote><p></p><ul><li><p>列表内容</p></li></ul><p></p></blockquote>')
    const normalized = normalizeNotePaste(original)
    expect(normalized.openStart).toBe(1)
    expect(normalized.openEnd).toBe(1)
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('beforeAFTER'))])
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 7) })
    const next = state.tr.replaceSelection(normalized).doc
    next.check()
    const items: string[] = []
    next.descendants(node => { if (node.type.name === 'listItem') items.push(node.textContent) })
    expect(items).toEqual(['列表内容'])
  })
  it('只含空段落的粘贴压缩为一个有效段落，重复整理结果一致', () => {
    const result = normalizeNotePaste(parse('<p></p><p><br></p><p>&nbsp;</p>'))
    expect(result.content.childCount).toBe(1)
    expect(normalizeNotePaste(result)).toBe(result)
  })
})
