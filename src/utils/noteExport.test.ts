import { describe, expect, it } from 'vitest'
import { buildNoteExport, noteExportExtension, noteExportFilename } from './noteExport'
import type { Note } from '../types'

const note = (overrides: Partial<Note> = {}): Note => ({ id: 'a', title: '导出小记', content_html: '<p>正文 #工作</p>', category: null, created_at: 1720000000000, updated_at: 1720000000000, pinned: false, starred: false, encrypted: false, archived: false, archived_at: null, ...overrides })
const image = 'data:image/png;base64,aGVsbG8='

describe('小记导出', () => {
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
