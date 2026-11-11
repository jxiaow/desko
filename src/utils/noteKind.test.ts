import { describe, expect, it } from 'vitest'
import { noteKind } from './noteKind'

/* 前几条直接抄自 2026-11-05 的实机帧 tmp/ui-review/paper-1600-notes.png：
   那一屏七条内容完全不同，卡面却长得一模一样，正是这组分类要拆开的东西。 */
describe('noteKind · 实机帧里的真实内容', () => {
  it('裸链接解成域名 + 路径，而不是一串 URL 摆在三行预算里', () => {
    const info = noteKind('<p>https://github.com/tuojiaxin/TG</p>')
    expect(info.kind).toBe('link')
    expect(info.headline).toBe('github.com')
    expect(info.detail).toBe('/tuojiaxin/TG')
    expect(info.href).toBe('https://github.com/tuojiaxin/TG')
  })

  it('链接被编辑器自动包成 <a> 时同样认得', () => {
    const info = noteKind('<p><a href="https://example.com/a?b=1">https://example.com/a?b=1</a></p>')
    expect(info.kind).toBe('link')
    expect(info.host).toBe('example.com')
    expect(info.detail).toBe('/a?b=1')
  })

  it('单行命令拆成命令头 + 参数', () => {
    const info = noteKind('<p>python3 studio/scripts/preview-books.py</p>')
    expect(info.kind).toBe('command')
    expect(info.headline).toBe('python3')
    expect(info.detail).toBe('studio/scripts/preview-books.py')
    expect(info.code).toBe('python3 studio/scripts/preview-books.py')
  })

  it('带中文的记录不会被误判成命令', () => {
    const info = noteKind('<p>汪鹏(西安) 10/27 15:06:01</p><p>环境: 172.36.100.35 80/443</p>')
    expect(info.kind).toBe('text')
    expect(info.headline).toBe('汪鹏(西安) 10/27 15:06:01')
    expect(info.detail).toContain('172.36.100.35')
  })

  it('两行短文保留标题声部与剩余正文，并给出字数', () => {
    const info = noteKind('<p>请检查【章节或文件路径】</p><p>看看有没有叙述不自然、信息像临时补上、读起来不连贯的问题。</p>')
    expect(info.kind).toBe('text')
    expect(info.headline).toBe('请检查【章节或文件路径】')
    expect(info.detail).toContain('读起来不连贯')
    expect(info.chars).toBeGreaterThan(20)
  })

  it('超长首块不冒充标题，截一段当开头', () => {
    const info = noteKind(`<p>${'这是一段故意写得很长的小记开头'.repeat(6)}</p>`)
    expect(info.kind).toBe('text')
    expect(info.headline.length).toBeLessThanOrEqual(24)
  })
})

describe('noteKind · 结构化内容', () => {
  it('任务清单给出逐项状态与完成数', () => {
    const html = '<p>发版前检查</p><ul data-type="taskList">'
      + '<li data-checked="true"><div>跑单测</div></li>'
      + '<li data-checked="false"><div>出安装包</div></li>'
      + '<li data-checked="false"><div>写更新日志</div></li></ul>'
    const info = noteKind(html)
    expect(info.kind).toBe('task')
    expect(info.headline).toBe('发版前检查')
    expect(info.tasks?.map(t => t.text)).toEqual(['跑单测', '出安装包', '写更新日志'])
    expect(info.done).toBe(1)
    expect(info.total).toBe(3)
  })

  it('代码块只取前三行，不把整段塞进卡面', () => {
    const info = noteKind('<p>构建脚本</p><pre>line 1\nline 2\nline 3\nline 4\nline 5</pre>')
    expect(info.kind).toBe('code')
    expect(info.headline).toBe('构建脚本')
    expect(info.code).toBe('line 1\nline 2\nline 3')
  })

  it('配图给出缩略源，文字仍留作说明', () => {
    const info = noteKind('<p>窗口对比帧</p><p><img data-note-image src="attachments/shot.png"></p>')
    expect(info.kind).toBe('image')
    expect(info.imageSrc).toBe('attachments/shot.png')
    expect(info.headline).toBe('窗口对比帧')
  })

  it('空内容与空段落退回普通小记，不抛错', () => {
    expect(noteKind('').kind).toBe('text')
    expect(noteKind('<p></p><p><br></p>').kind).toBe('text')
  })
})
