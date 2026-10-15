import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeClipboardText } from './clipboard'

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

describe('Web 剪贴板回退', () => {
  it('HTTP 页面没有 Clipboard API 时经用户操作复制并恢复焦点', async () => {
    const previous = document.createElement('button')
    document.body.append(previous)
    previous.focus()
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    const exec = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec })
    try {
      expect(await writeClipboardText('验证码')).toBe('fallback')
      expect(exec).toHaveBeenCalledWith('copy')
      expect(document.activeElement).toBe(previous)
      expect(document.querySelector('textarea')).toBeNull()
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
      else delete (navigator as any).clipboard
      delete (document as any).execCommand
      previous.remove()
    }
  })

  it('桌面版复制错误仍向调用者报告', async () => {
    document.querySelector('meta[name="desko-runtime"]')?.remove()
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    try { await expect(writeClipboardText('secret')).rejects.toThrow('denied') }
    finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
      else delete (navigator as any).clipboard
    }
  })
})
