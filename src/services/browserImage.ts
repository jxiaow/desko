import { invoke, webSessionGeneration } from './transport'
import type { Attachment } from '../types'

/** 只有字节、没有本机路径的图片（剪贴板粘贴、浏览器里选的 File）走这颗命令 */
export async function uploadImageBytes(file: File, noteId?: string): Promise<Attachment> {
  const epoch = webSessionGeneration()
  if (!file.size || file.size > 15 * 1024 * 1024) throw new Error('图片应小于 15 MB')
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
  if (epoch !== webSessionGeneration()) throw new Error('Web 会话已变更，请重新选择图片')
  return invoke('save_attachment_bytes', { name: file.name, data, noteId: noteId ?? null })
}
export function pickBrowserImage(): Promise<File | null> {
  const epoch = webSessionGeneration()
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp'
    input.style.display = 'none'
    let settled = false
    const onExpired = () => finish(null)
    const finish = (file: File | null) => {
      if (settled) return
      settled = true
      window.removeEventListener('desko:web-session-expired', onExpired)
      input.remove()
      resolve(epoch === webSessionGeneration() ? file : null)
    }
    window.addEventListener('desko:web-session-expired', onExpired, { once: true })
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => finish(null), { once: true })
    document.body.appendChild(input)
    input.click()
  })
}
