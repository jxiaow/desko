import { describe, expect, it } from 'vitest'
import { noteDisplay, markNoteRhythm } from './noteDisplay'
import { stripTagsFromHtml } from './format'

describe('noteDisplay', () => {
  it.each(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])('promotes only an explicit %s heading', tag => {
    const html = stripTagsFromHtml(`<${tag}>阅读<strong>标题</strong> #工作</${tag}><p>正文</p>`)
    expect(noteDisplay(html)).toEqual({ title: '阅读标题', hideFirstBlock: true, voiceFirst: false })
  })
  // 真标题已把首块藏掉，声部交给 .memo-title，正文首块不能再抢一次
  it.each([
    '<ul><li>首项</li></ul>',
    '<ul data-type="taskList"><li><input type="checkbox">待办</li></ul>',
    '<p><img src="attachments/image.png"></p>',
    '<p>配图说明<img src="attachments/image.png"></p>',
    '<blockquote><p>本周任务</p><ul><li><input type="checkbox">待办</li></ul></blockquote>',
    '<p></p><p>第二段</p>',
    '<pre>代码</pre>',
    '<blockquote><p>引用正文</p></blockquote>',
    `<p>${'这一条的首块故意写得很长，用来验证超过四十字不升标题声部的护栏是否真的生效，不该整段抢戏。'}</p>`,
  ])('keeps structural, quoted or overlong first blocks in the body', html => {
    expect(noteDisplay(html)).toEqual({ title: '', hideFirstBlock: false, voiceFirst: false })
  })
  // 没有真标题的短记（真机里的绝大多数）：首块纯文字段落就是这张纸片的标题声部
  it.each([
    '<p>普通首段</p>',
    '<p><strong>加粗正文</strong></p>',
  ])('gives a short plain first block the title voice', html => {
    expect(noteDisplay(html).voiceFirst).toBe(true)
    expect(noteDisplay(html).hideFirstBlock).toBe(false)
  })
  it('does not invent a title or skip past a normal paragraph to find a later heading', () => {
    expect(noteDisplay('')).toEqual({ title: '', hideFirstBlock: false, voiceFirst: false })
    expect(noteDisplay('<p>首段正文</p><h2>正文小标题</h2>').hideFirstBlock).toBe(false)
  })
})

describe('markNoteRhythm', () => {
  it('marks empty top-level paragraphs and hand-written list lines', () => {
    const html = '<p>甲</p><p></p><p>1. 第一条</p><p>- 第二条</p><p>2026. 年份</p><p><img src="a.png"></p>'
    expect(markNoteRhythm(html)).toBe(
      '<p>甲</p><p class="tp-blank"></p><p class="tp-hang">1. 第一条</p><p class="tp-hang">- 第二条</p><p>2026. 年份</p><p><img src="a.png"></p>',
    )
  })
  it('leaves nested, quoted and code content alone', () => {
    const html = '<blockquote><p></p><p>- 引用</p></blockquote><pre>- 代码</pre><ul><li>1. 列表</li></ul>'
    expect(markNoteRhythm(html)).toBe(html)
  })
})
