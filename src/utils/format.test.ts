import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  extractTags,
  formatRelativeTime,
  formatDate,
  stripHtml,
  htmlToText,
  htmlToTagText,
  htmlToLinkText,
  deriveTitleFromHtml,
  headingTitle,
  wordCount,
  formatAbsTime,
  highlightTagsInHtml,
  stripTagsFromText,
  stripTagsFromHtml,
  getDateGroupLabel,
  splitUrlHostPath,
} from './format'

describe('列表正文标签', () => {
  it('只移除独立标签，保留 C# 与链接锚点文字', () => {
    expect(stripTagsFromText('C# 记录 #工作 #产品 https://a.test/#part')).toBe('C# 记录   https://a.test/#part')
  })

  it('隐藏正文标签并保留富文本块、图片和任务项结构', () => {
    const html = '<p>正文 #工作</p><p><strong>#产品</strong> 后续</p><ul data-type="taskList"><li data-type="taskItem"><label><input type="checkbox"></label><div><p>待办 #工作</p></div></li></ul><img src="attachments/a.png">'
    const div = document.createElement('div')
    div.innerHTML = stripTagsFromHtml(html)
    expect(div.textContent).not.toContain('#工作')
    expect(div.textContent).not.toContain('#产品')
    expect(div.querySelectorAll('p')).toHaveLength(3)
    expect(div.querySelector('strong')).not.toBeNull()
    expect(div.querySelector('input')?.type).toBe('checkbox')
    expect(div.querySelector('img')?.getAttribute('src')).toBe('attachments/a.png')
  })

  it('代码、链接与属性中的井号保持原样', () => {
    expect(stripTagsFromHtml('<p>#标签 <code>#代码</code> <a href="/#part">#链接</a></p><pre>#脚本</pre>')).toBe('<p> <code>#代码</code> <a href="/#part">#链接</a></p><pre>#脚本</pre>')
  })

  it('跨粗体节点的标签完整隐藏，代码和换行会中断标签', () => {
    expect(stripTagsFromHtml('<p>#工<strong>作</strong> <strong>#</strong>产品</p>')).toBe('')
    expect(stripTagsFromHtml('<p>#工<code>代码</code>作<br>后续</p>')).toBe('<p><code>代码</code>作<br>后续</p>')
  })

  it('中文或中文标点紧邻标签时，正文和底部使用同一份识别结果', () => {
    const html = '<p>今天，#工<strong>作</strong>，继续#产品</p>'
    expect(extractTags(htmlToTagText(html))).toEqual(['工作', '产品'])
    expect(stripTagsFromHtml(html)).toBe('<p>今天，<strong></strong>，继续</p>')
    expect(stripTagsFromText('标题，#工作')).toBe('标题，')
  })

  it('URL、代码和链接不会生成底部标签', () => {
    const html = '<p>https://example.com/#part #工作 <a href="/#ref">#链接</a><code>#代码</code></p>'
    expect(extractTags(htmlToTagText(html))).toEqual(['工作'])
    expect(stripTagsFromHtml(html)).toContain('https://example.com/#part')
    expect(extractTags('https://example.com/#part 今天#工作')).toEqual(['工作'])
  })

  it('换行和列表项中断标签，提取与展示使用相同边界', () => {
    const html = '<p>#工作<br>下一行</p><ul><li>#生活</li><li>普通内容</li></ul>'
    expect(extractTags(htmlToTagText(html))).toEqual(['工作', '生活'])
    expect(stripTagsFromHtml(html)).toBe('<p><br>下一行</p><ul><li>普通内容</li></ul>')
  })

  it('被标签洗空的块整块收起，空行与图片块保留', () => {
    const html = '<p>#工作</p><p></p><p><strong>#产品</strong></p><h2>#生活</h2><blockquote><p>#引用</p></blockquote><ul><li>#标签</li><li><img src="attachments/a.png"></li></ul>'
    expect(stripTagsFromHtml(html)).toBe('<p></p><ul><li><img src="attachments/a.png"></li></ul>')
  })
})

describe('splitUrlHostPath', () => {
  it('无路径 URL 全部归主机', () => {
    expect(splitUrlHostPath('https://github.com')).toEqual({ host: 'github.com', path: '' })
  })

  it('结尾斜杠不算路径', () => {
    expect(splitUrlHostPath('https://github.com/')).toEqual({ host: 'github.com', path: '' })
  })

  it('主机与路径分色拆分', () => {
    expect(splitUrlHostPath('http://10.0.0.107:8080/view/QT/job/winqt_app')).toEqual({
      host: '10.0.0.107:8080',
      path: '/view/QT/job/winqt_app',
    })
  })

  it('解析失败按首个斜杠拆', () => {
    expect(splitUrlHostPath('not a url/path')).toEqual({ host: 'not a url', path: '/path' })
  })
})

describe('extractTags', () => {
  it('should extract single tag', () => {
    expect(extractTags('Hello #world')).toEqual(['world'])
  })

  it('should extract multiple tags', () => {
    expect(extractTags('Hello #world #test #foo')).toEqual(['world', 'test', 'foo'])
  })

  it('should deduplicate tags', () => {
    expect(extractTags('#test #test #foo')).toEqual(['test', 'foo'])
  })

  it('should return empty array for no tags', () => {
    expect(extractTags('Hello world')).toEqual([])
  })

  it('should handle tags with numbers', () => {
    expect(extractTags('#tag1 #tag2')).toEqual(['tag1', 'tag2'])
  })

  it('should handle tags in Chinese text', () => {
    expect(extractTags('这是一条 #测试 #小记')).toEqual(['测试', '小记'])
  })
})

describe('formatRelativeTime', () => {
  it('should return "刚刚" for current time', () => {
    expect(formatRelativeTime(Date.now())).toBe('刚刚')
  })

  it('should return minutes for recent time', () => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
    expect(formatRelativeTime(fiveMinutesAgo)).toBe('5分钟前')
  })

  it('should return hours for same day', () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
    expect(formatRelativeTime(twoHoursAgo)).toBe('2小时前')
  })

  it('should return days for this week', () => {
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000
    expect(formatRelativeTime(threeDaysAgo)).toBe('3天前')
  })

  it('should return formatted date for older time', () => {
    const oldDate = new Date('2024-01-15').getTime()
    expect(formatRelativeTime(oldDate)).toBe('2024-01-15')
  })
})

describe('formatDate', () => {
  it('should format date correctly', () => {
    const date = new Date('2024-03-15').getTime()
    expect(formatDate(date)).toBe('2024-03-15')
  })

  it('should pad single digit month and day', () => {
    const date = new Date('2024-01-05').getTime()
    expect(formatDate(date)).toBe('2024-01-05')
  })
})

describe('stripHtml', () => {
  it('should strip HTML tags', () => {
    expect(stripHtml('<p>Hello <strong>world</strong></p>')).toBe('Hello world')
  })

  it('should truncate long text', () => {
    const longText = '<p>' + 'a'.repeat(200) + '</p>'
    const result = stripHtml(longText)
    expect(result.length).toBe(123) // 120 + '...'
    expect(result.endsWith('...')).toBe(true)
  })

  it('should not truncate short text', () => {
    expect(stripHtml('<p>Short</p>')).toBe('Short')
  })
})

describe('htmlToText', () => {
  it('should return empty string for empty input', () => {
    expect(htmlToText('')).toBe('')
  })

  it('should join block elements with newlines', () => {
    expect(htmlToText('<p>第一行</p><p>第二行</p>')).toBe('第一行\n第二行')
  })

  it('should return bare text without children', () => {
    expect(htmlToText('纯文本')).toBe('纯文本')
  })

  it('should collapse internal whitespace', () => {
    expect(htmlToText('<p>一   二\n  三</p>')).toBe('一 二 三')
  })

  it('should skip blank blocks', () => {
    expect(htmlToText('<p></p><p>内容</p><p>   </p>')).toBe('内容')
  })

  it('should drop the href', () => {
    expect(htmlToText('<p><a href="https://a.test/x">标题</a></p>')).toBe('标题')
  })
})

describe('htmlToLinkText', () => {
  it('should keep only the bare url in place of a titled link', () => {
    expect(htmlToLinkText('<p>看 <a target="_blank" rel="noopener noreferrer nofollow" href="https://a.test/x">GitLab 标题</a></p>'))
      .toBe('看 https://a.test/x')
  })

  it('should keep a bare url bare', () => {
    expect(htmlToLinkText('<p><a href="https://a.test/x">https://a.test/x</a></p>')).toBe('https://a.test/x')
  })

  it('should fall back to the link text when the href is empty', () => {
    expect(htmlToLinkText('<p><a href="">占位</a></p>')).toBe('占位')
  })

  it('should keep plain text untouched', () => {
    expect(htmlToLinkText('<p>只有文字</p>')).toBe('只有文字')
    expect(htmlToLinkText('')).toBe('')
  })

  it('should join blocks and drop every title', () => {
    expect(htmlToLinkText('<p>看 <a href="https://a.test/1">一</a></p><p>看 <a href="https://a.test/2">二</a></p>'))
      .toBe('看 https://a.test/1\n看 https://a.test/2')
  })
})

describe('deriveTitleFromHtml', () => {
  it('should use the first non-empty line', () => {
    expect(deriveTitleFromHtml('<p>标题行</p><p>正文</p>')).toBe('标题行')
    expect(deriveTitleFromHtml('<p></p><p>次行</p>')).toBe('次行')
  })

  it('should fall back to 小记 for blank content', () => {
    expect(deriveTitleFromHtml('')).toBe('小记')
    expect(deriveTitleFromHtml('<p>   </p>')).toBe('小记')
  })

  it('should truncate to 20 characters', () => {
    expect(deriveTitleFromHtml(`<p>${'长'.repeat(40)}</p>`)).toBe('长'.repeat(20))
  })
})

describe('headingTitle', () => {
  it('should keep only a real first heading', () => {
    expect(headingTitle('<h2>薪酬沟通</h2><p>三月调档</p>')).toBe('薪酬沟通')
    expect(headingTitle('<p>三月调档</p>')).toBe('')
    expect(headingTitle('<h4>四级不算标题</h4>')).toBe('')
  })

  it('should strip tags and cap at 20 characters', () => {
    expect(headingTitle('<h1><strong>调薪</strong>窗口</h1>')).toBe('调薪窗口')
    expect(headingTitle(`<h3>${'长'.repeat(30)}</h3>`)).toBe('长'.repeat(20))
  })
})

describe('wordCount', () => {
  it('should count CJK characters individually', () => {
    expect(wordCount('中文测试')).toBe(4)
  })

  it('should count latin words', () => {
    expect(wordCount('hello world')).toBe(2)
  })

  it('should mix CJK and latin', () => {
    expect(wordCount('中文 hello')).toBe(3)
  })

  it('should return 0 for blank text', () => {
    expect(wordCount('')).toBe(0)
    expect(wordCount('   ')).toBe(0)
  })
})

describe('formatAbsTime', () => {
  it('should render month, day and padded time', () => {
    expect(formatAbsTime(new Date(new Date().getFullYear(), 2, 5, 9, 7).getTime())).toBe('3月5日 09:07')
  })
  it('includes the year for past and future calendar years', () => {
    const current = new Date().getFullYear()
    for (const year of [current - 1, current + 1]) {
      expect(formatAbsTime(new Date(year, 11, 31, 23, 5).getTime())).toBe(`${year}年12月31日 23:05`)
    }
  })
})

describe('highlightTagsInHtml', () => {
  it('should wrap a tag preceded by whitespace', () => {
    expect(highlightTagsInHtml('<p>看 #标签 这里</p>')).toBe(
      '<p>看 <span class="tag-inline" data-tag="标签">#标签</span> 这里</p>',
    )
  })

  it('should wrap a tag at the start of a block', () => {
    expect(highlightTagsInHtml('<p>#todo text</p>')).toBe(
      '<p><span class="tag-inline" data-tag="todo">#todo</span> text</p>',
    )
  })

  it('should leave mid-word hashes alone', () => {
    expect(highlightTagsInHtml('<p>a#标签</p>')).toBe('<p>a#标签</p>')
  })

  it('should leave text without tags unchanged', () => {
    expect(highlightTagsInHtml('<p>没有标签</p>')).toBe('<p>没有标签</p>')
  })

  it('代码块与行内代码里的井号不染色', () => {
    expect(highlightTagsInHtml('<pre><code>#!/bin/sh\necho #release</code></pre>')).toBe(
      '<pre><code>#!/bin/sh\necho #release</code></pre>',
    )
    expect(highlightTagsInHtml('<p>跑 <code>#release</code> 然后 #tag</p>')).toBe(
      '<p>跑 <code>#release</code> 然后 <span class="tag-inline" data-tag="tag">#tag</span></p>',
    )
  })
})

describe('htmlToTagText', () => {
  it('剥掉代码内容，只留正文', () => {
    expect(htmlToTagText('<p>发布 #release 计划</p><pre><code>#notatag</code></pre>')).toBe('发布 #release 计划')
    expect(htmlToTagText('<p>调用 <code>#inline</code> 记号 #real</p>')).toBe('调用 记号 #real')
  })

  it('空串进空串出', () => {
    expect(htmlToTagText('')).toBe('')
  })
})

describe('getDateGroupLabel', () => {
  it('should bucket by recency', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 15, 12, 0, 0))
    const day = 24 * 60 * 60 * 1000
    expect(getDateGroupLabel(Date.now())).toBe('今天')
    expect(getDateGroupLabel(Date.now() - day)).toBe('昨天')
    expect(getDateGroupLabel(Date.now() - 3 * day)).toBe('本周')
    expect(getDateGroupLabel(Date.now() - 14 * day)).toBe('本月')
    expect(getDateGroupLabel(Date.now() - 60 * day)).toBe('更早')
  })
})

afterEach(() => {
  vi.useRealTimers()
})
