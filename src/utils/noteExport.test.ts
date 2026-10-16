import { describe, expect, it } from 'vitest'
import { buildNoteExport, NOTE_EXPORT_FORMATS, noteExportExtension, noteExportFilename } from './noteExport'
import type { Note } from '../types'

const note = (overrides: Partial<Note> = {}): Note => ({ id: 'a', title: '导出小记', content_html: '<p>正文 #工作</p>', category: null, created_at: 1720000000000, updated_at: 1720000000000, pinned: false, starred: false, encrypted: false, archived: false, archived_at: null, ...overrides })
const image = 'data:image/png;base64,aGVsbG8='

describe('小记导出', () => {
  it.each(NOTE_EXPORT_FORMATS)('$label 标签只在标签栏展示一次，标题和正文不重复', ({ id, extension }) => {
    const source = note({ title: '项目记录 #工作 #生活', content_html: '<h2>项目记录 #工作</h2><p>今天，#工<strong>作</strong>，继续记录</p><p>#生活</p>' })
    const file = buildNoteExport([source], id).files[0]
    expect(file.content.match(/#工作/g)).toHaveLength(1)
    expect(file.content.match(/#生活/g)).toHaveLength(1)
    if (id === 'markdown') {
      expect(file.content).toMatch(/^# 项目记录\n/)
      expect(file.content).toContain('今天，')
      expect(file.content).toContain('，继续记录')
    } else {
      const doc = new DOMParser().parseFromString(file.content, 'text/html')
      expect(doc.title).toBe('项目记录')
      expect(doc.querySelector('header h1')?.textContent).toBe('项目记录')
      expect(doc.querySelector('header p:last-child')?.textContent).toBe('#工作 #生活')
      doc.querySelector('header')?.remove()
      expect(doc.body.textContent).not.toMatch(/#工作|#生活/)
      expect(doc.body.textContent).toContain('今天，，继续记录')
    }
    if (id !== 'pdf') expect(file.name).toBe(`项目记录.${extension}`)
    expect(source.title).toBe('项目记录 #工作 #生活')
    expect(source.content_html).toContain('#工<strong>作</strong>')
  })

  it.each(NOTE_EXPORT_FORMATS)('$label 保留代码和链接中的井号', ({ id }) => {
    const html = '<p>正文 #工作 <code>#命令</code> <a href="https://example.com/#片段">#链接</a> https://example.com/#anchor</p><pre><code>echo #脚本</code></pre>'
    const content = buildNoteExport([note({ content_html: html })], id).files[0].content
    expect(content.match(/#工作/g)).toHaveLength(1)
    expect(content).toContain('#命令')
    expect(content).toContain('#链接')
    expect(content).toContain('https://example.com/#片段')
    expect(content).toContain('https://example.com/#anchor')
    expect(content).toContain('echo #脚本')
    if (id !== 'markdown') {
      const doc = new DOMParser().parseFromString(content, 'text/html')
      expect(doc.querySelector('header p:last-child')?.textContent).toBe('#工作')
    }
  })

  it.each(NOTE_EXPORT_FORMATS)('$label 仅含标签的标题回退为小记', ({ id, extension }) => {
    const file = buildNoteExport([note({ title: '#工作', content_html: '<p>#工作</p>' })], id).files[0]
    expect(file.content.match(/#工作/g)).toHaveLength(1)
    if (id === 'markdown') expect(file.content).toMatch(/^# 小记\n/)
    else expect(new DOMParser().parseFromString(file.content, 'text/html').title).toBe('小记')
    if (id !== 'pdf') expect(file.name).toBe(`小记.${extension}`)
  })

  it('Markdown 保留任务状态、链接、代码与附件图片', () => {
    const html = '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>完成</p></div></li><li data-type="taskItem" data-checked="false"><div><p>待办</p></div></li></ul><p><a href="https://example.com">链接</a></p><pre><code class="language-js">const x = 1;</code></pre><img src="attachments/p.png" alt="配图">'
    const result = buildNoteExport([note({ content_html: html })], 'markdown', { 'p.png': image })
    expect(result.files[0].content).toContain('- [x] 完成')
    expect(result.files[0].content).toContain('- [ ] 待办')
    expect(result.files[0].content).toContain('[链接](https://example.com)')
    expect(result.files[0].content).toContain('```js\nconst x = 1;')
    expect(result.files[0].content).toContain(`![配图](${image})`)
    expect(result.missingImages).toBe(0)
  })

  it('HTML 清理脚本、转义标题，内嵌图片且不保留交互控件', () => {
    const result = buildNoteExport([note({ title: '<script>标题</script>', content_html: '<script>alert(1)</script><p onclick="evil()">安全正文</p><img src="attachments/p.png" onerror="evil()"><input type="checkbox">' })], 'html', { 'p.png': image })
    expect(result.files[0].content).toContain('&lt;script&gt;标题&lt;/script&gt;')
    expect(result.files[0].content).toContain(image)
    expect(result.files[0].content).not.toMatch(/<script|onclick|onerror|<input/)
  })

  it('无法读取的图片给出文字占位与计数，不留下本机路径和外部请求', () => {
    const result = buildNoteExport([note({ content_html: '<img src="attachments/lost.png"><img src="https://example.com/remote.png" alt="外链图">' })], 'html')
    expect(result.missingImages).toBe(2)
    expect(result.files[0].content).toContain('图片未嵌入：lost.png')
    expect(result.files[0].content).not.toContain('<img')
  })

  it('Word 输出明确为 .doc，中文编码与 Word HTML 头完整', () => {
    const file = buildNoteExport([note()], 'word').files[0]
    expect(file.name).toBe('导出小记.doc')
    expect(file.content.startsWith('\ufeff')).toBe(true)
    expect(file.content).toContain('Word.Document')
    expect(file.content).toContain('xmlns:w=')
  })

  it('PDF 将多条小记放在同一文档，文件名去重不覆盖', () => {
    const notes = [note(), note({ id: 'b' }), note({ id: 'c', title: '导出小记 (2)' })]
    expect(buildNoteExport(notes, 'pdf').files[0].content.match(/<article>/g)).toHaveLength(3)
    const names = buildNoteExport(notes, 'markdown').files.map(f => f.name)
    expect(new Set(names).size).toBe(3)
    expect(noteExportExtension('markdown', 3)).toBe('zip')
    expect(noteExportExtension('pdf', 3)).toBe('pdf')
  })

  it('文件名不包含路径、控制字符、尾点或 Windows 设备名', () => {
    expect(noteExportFilename('../CON:\\a?*')).not.toMatch(/[\\/:?*]/)
    expect(noteExportFilename('CON')).toBe('_CON')
    expect(noteExportFilename('  ... ')).toBe('小记')
    expect(noteExportFilename('粘贴\u007f标题\u0085')).toBe('粘贴-标题-')
  })
})
