import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openExternal, openLinkFromClick } from './openExternal'

beforeEach(() => {
  const meta = document.createElement('meta')
  meta.name = 'desko-runtime'
  meta.content = 'web'
  document.head.append(meta)
})
afterEach(() => {
  document.querySelectorAll('meta[name="desko-runtime"]').forEach(meta => meta.remove())
  vi.restoreAllMocks()
})

describe('浏览器外链', () => {
  it('只把 HTTP(S) 链接交给独立浏览器标签', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    await openExternal('https://example.com/path')
    expect(open).toHaveBeenCalledWith('https://example.com/path', '_blank', 'noopener,noreferrer')
    await expect(openExternal('javascript:alert(1)')).rejects.toThrow()
    await expect(openExternal('file:///secret')).rejects.toThrow()
    expect(open).toHaveBeenCalledOnce()
  })
})

describe('正文链接点击认领', () => {
  /** 照阅读面的接法：容器上挂委托，点击从正文里的节点冒泡上来。
      树故意不挂进 document：jsdom 会对 `<a href="/x">` 的点击真去导航 */
  const clickInside = (html: string, targetSelector: string) => {
    const host = document.createElement('div')
    host.innerHTML = html
    host.addEventListener('click', (e) => { openLinkFromClick(e as MouseEvent) })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    host.querySelector(targetSelector)!.dispatchEvent(event)
    return event
  }

  it('绝对地址认领并吃掉默认行为', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const event = clickInside('<p>看 <a href="https://a.test/x">标题</a></p>', 'a')
    expect(event.defaultPrevented).toBe(true)
    expect(open).toHaveBeenCalledWith('https://a.test/x', '_blank', 'noopener,noreferrer')
  })

  it('锚点与站内相对路径不送外部浏览器', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    expect(clickInside('<p><a href="#段">段</a></p>', 'a').defaultPrevented).toBe(false)
    expect(clickInside('<p><a href="/notes">列表</a></p>', 'a').defaultPrevented).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('点到没有链接的正文上不认领', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    expect(clickInside('<p>纯文字</p>', 'p').defaultPrevented).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})
