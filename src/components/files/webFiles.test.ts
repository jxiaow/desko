import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadWebFile, readWebDirectory, webFileUrl } from './webFiles'

const session = vi.hoisted(() => ({ generation: 0, expire: vi.fn() }))
vi.mock('../../services/transport', () => ({
  webSessionGeneration: () => session.generation,
  expireWebSession: () => session.expire(),
}))

const originalFetch = globalThis.fetch

beforeEach(() => { globalThis.fetch = vi.fn(); session.generation = 0; session.expire.mockClear() })
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks() })

describe('Web 文件访问', () => {
  it('只通过收藏 ID 和相对路径请求目录', async () => {
    const directory = { name: '资料', path: '子目录', entries: [{ name: 'a.txt', path: '子目录/a.txt', directory: false, size: 8 }] }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(directory), { status: 200 }))
    expect(webFileUrl('a/b', '子目录/a.txt')).toBe('/api/files/a%2Fb?path=%E5%AD%90%E7%9B%AE%E5%BD%95%2Fa.txt')
    expect(await readWebDirectory('one', '子目录')).toEqual(directory)
    expect(fetch).toHaveBeenCalledWith('/api/files/one?path=%E5%AD%90%E7%9B%AE%E5%BD%95', { credentials: 'same-origin', method: 'GET' })
  })

  it('401 通知应用收起已解锁内容', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: '已过期' }), { status: 401 }))
    await expect(readWebDirectory('one')).rejects.toThrow('浏览器访问已过期')
    expect(session.expire).toHaveBeenCalledOnce()
  })

  it('目录读取失败显示服务端错误', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: '目录已移除' }), { status: 404 }))
    await expect(readWebDirectory('one')).rejects.toThrow('目录已移除')
  })

  it('下载响应使用收藏名称，清理非法文件名字符', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await downloadWebFile('one', '', 'a/b\\c.txt')
    expect(fetch).toHaveBeenCalledWith('/api/files/one?path=', { credentials: 'same-origin', method: 'HEAD' })
    expect(click).toHaveBeenCalledOnce()
    const clicked = click.mock.instances[0] as HTMLAnchorElement
    expect(clicked.download).toBe('a_b_c.txt')
    expect(clicked.getAttribute('href')).toBe('/api/files/one?path=')
  })

  it('下载预检失效时不触发浏览器保存', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await expect(downloadWebFile('one', 'a.txt', 'a.txt')).rejects.toThrow('浏览器访问已过期')
    expect(click).not.toHaveBeenCalled()
  })

  it('旧请求在重新登录后返回时既不踢新会话，也不触发下载', async () => {
    let finish!: (response: Response) => void
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const pending = downloadWebFile('one', 'a.txt', 'a.txt')
    session.generation++
    finish(new Response(null, { status: 401 }))
    await expect(pending).rejects.toThrow('浏览器访问已过期')
    expect(session.expire).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
  })
})
