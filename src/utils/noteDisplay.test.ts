import { describe, expect, it } from 'vitest'
import { noteDisplay } from './noteDisplay'
import { stripTagsFromHtml } from './format'

describe('noteDisplay', () => {
  it.each(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])('promotes only an explicit %s heading', tag => {
    const html = stripTagsFromHtml(`<${tag}>阅读<strong>标题</strong> #工作</${tag}><p>正文</p>`)
    expect(noteDisplay(html)).toEqual({ title: '阅读标题', hideFirstBlock: true })
  })
  it.each([
    '<ul><li>首项</li></ul>',
    '<ul data-type="taskList"><li><input type="checkbox">待办</li></ul>',
    '<p><img src="attachments/image.png"></p>',
    '<p>配图说明<img src="attachments/image.png"></p>',
    '<blockquote><p>本周任务</p><ul><li><input type="checkbox">待办</li></ul></blockquote>',
    '<p></p><p>第二段</p>',
    '<pre>代码</pre>',
    '<p>普通首段</p>',
    '<p><strong>加粗正文</strong></p>',
    '<blockquote><p>引用正文</p></blockquote>',
  ])('keeps structural or empty first blocks in the body', html => {
    expect(noteDisplay(html)).toEqual({ title: '', hideFirstBlock: false })
  })
  it('does not invent a title or skip past a normal paragraph to find a later heading', () => {
    expect(noteDisplay('')).toEqual({ title: '', hideFirstBlock: false })
    expect(noteDisplay('<p>首段正文</p><h2>正文小标题</h2>').hideFirstBlock).toBe(false)
  })
})
