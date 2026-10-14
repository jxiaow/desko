import { describe, expect, it } from 'vitest'
import { sanitizeNoteHtml } from './sanitizeNoteHtml'

describe('sanitizeNoteHtml', () => {
  it('keeps note editor task, image, code and tag markup', () => {
    const html = '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"></label><div><p>#今天</p></div></li></ul>' +
      '<img src="attachments/photo.png" alt="照片" style="width: 50%" data-note-image="">' +
      '<pre><code class="language-typescript">const x = 1</code></pre><span class="tag-inline" data-tag="今天">#今天</span>'
    expect(sanitizeNoteHtml(html)).toBe(html)
  })

  it('removes executable tags, event handlers, unsafe URLs and styles', () => {
    const html = '<p onclick="evil()">ok<script>evil()</script><svg onload="evil()"><circle></circle></svg></p>' +
      '<img src="javascript:evil()" onerror="evil()"><img src="attachments/safe.png" onerror="evil()" style="width: 50%; background: url(javascript:evil())">' +
      '<a href="javascript:evil()" target="_blank">bad</a><a href="https://example.com/#tag" target="_blank" onclick="evil()">good</a>'
    const clean = sanitizeNoteHtml(html)
    expect(clean).toContain('<p>ok</p>')
    expect(clean).toContain('<img src="attachments/safe.png">')
    expect(clean).toContain('<a>bad</a>')
    expect(clean).toContain('<a href="https://example.com/#tag" target="_blank" rel="noopener noreferrer">good</a>')
    expect(clean).not.toMatch(/evil|<script|<svg|onerror|onclick|background/)
  })

  it('rejects encoded attachment path traversal', () => {
    expect(sanitizeNoteHtml('<img src="attachments/%2e%2e%2fsecret.png"><img src="attachments/safe.png">'))
      .toBe('<img src="attachments/safe.png">')
  })
})
