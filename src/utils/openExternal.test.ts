import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openExternal } from './openExternal'

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
