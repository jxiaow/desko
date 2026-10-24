import { describe, expect, it } from 'vitest'
import { mergeNoteHtml } from './noteMerge'

const task = (text: string, checked = false) => `<ul data-type="taskList"><li data-type="taskItem" data-checked="${checked}"><p>${text}</p></li></ul>`
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html').body

describe('mergeNoteHtml', () => {
  it('joins task lists across whitespace and blank paragraphs while retaining checked states', () => {
    const body = parse(mergeNoteHtml([task('甲', true) + '<p><br></p>', '<p>&nbsp;</p>\n' + task('乙')]))
    expect(body.children).toHaveLength(1)
    expect(body.querySelectorAll('ul[data-type="taskList"] > li')).toHaveLength(2)
    expect([...body.querySelectorAll('li')].map(li => li.getAttribute('data-checked'))).toEqual(['true', 'false'])
  })

  it.each(['ul', 'ol'])('joins adjacent %s lists', tag => {
    expect(mergeNoteHtml([`<${tag}><li>甲</li></${tag}>`, `<${tag}><li>乙</li></${tag}>`]))
      .toBe(`<${tag}><li>甲</li><li>乙</li></${tag}>`)
  })

  it('keeps task, unordered and ordered lists separate', () => {
    const body = parse(mergeNoteHtml([task('甲'), '<ul><li>乙</li></ul>', '<ol><li>丙</li></ol>']))
    expect([...body.children].map(el => el.tagName)).toEqual(['UL', 'UL', 'OL'])
  })

  it.each(['<p>正文</p>', '<h2>标题</h2>', '<blockquote><p>引用</p></blockquote>', '<p><img src="attachments/x__a.png"></p>', '<hr>'])('keeps a list boundary at %s', separator => {
    const body = parse(mergeNoteHtml([task('甲'), separator, task('乙')]))
    expect(body.querySelectorAll('ul[data-type="taskList"]')).toHaveLength(2)
    expect(body.innerHTML).toContain(separator)
  })

  it('retains nested lists without flattening them', () => {
    const nested = '<ul><li><p>父项</p><ul><li><p>子项</p></li></ul></li></ul>'
    const body = parse(mergeNoteHtml([nested, '<ul><li><p>末项</p></li></ul>']))
    expect(body.querySelector('ul > li > ul')?.outerHTML).toBe('<ul><li><p>子项</p></li></ul>')
    expect(body.querySelectorAll(':scope > ul > li')).toHaveLength(2)
  })

  it('ignores blank sources and sanitizes HTML while keeping relative images', () => {
    expect(mergeNoteHtml([' \n<p>&nbsp;<br></p>', '<p>正文</p>', '<p></p>'])).toBe('<p>正文</p>')
    expect(mergeNoteHtml(['<img src="attachments/x__a.png" onerror="alert(1)"><script>bad()</script>']))
      .toBe('<img src="attachments/x__a.png">')
    expect(mergeNoteHtml(['<p><br></p>', ' \n'])).toBe('')
  })
})
