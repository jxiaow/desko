import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  extractTags,
  formatRelativeTime,
  formatDate,
  stripHtml,
  htmlToText,
  deriveTitleFromHtml,
  headingTitle,
  wordCount,
  formatAbsTime,
  highlightTagsInHtml,
  getDateGroupLabel,
} from './format'

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
    expect(formatAbsTime(new Date(2026, 2, 5, 9, 7).getTime())).toBe('3月5日 09:07')
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
