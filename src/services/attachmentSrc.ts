import { convertFileSrc } from '@tauri-apps/api/core'

/** 正文里的图片 src 一律由附件绝对路径换算而来，库里只存这个地址，不复制字节 */
export const attachmentSrc = (filePath: string): string => convertFileSrc(filePath)

const isAssetSrc = (src: string) =>
  src.startsWith('asset://') || /^https?:\/\/asset\.localhost\//.test(src)

/** convertFileSrc 把整条路径 encodeURIComponent 成最后一段，反解就取最后一段再解码 */
export function attachmentPathFromSrc(src: string | null | undefined): string | null {
  if (!src || !isAssetSrc(src)) return null
  try {
    return decodeURIComponent(src.slice(src.lastIndexOf('/') + 1))
  } catch {
    return null
  }
}

/** 发布小记时按正文里出现的图片补附件记录，删小记才能连带清文件 */
export function collectAttachmentPaths(html: string): string[] {
  if (!html) return []
  const box = document.createElement('div')
  box.innerHTML = html
  const paths = new Set<string>()
  box.querySelectorAll('img').forEach((img) => {
    const p = attachmentPathFromSrc(img.getAttribute('src'))
    if (p) paths.add(p)
  })
  return [...paths]
}

/** 正文已经引用的附件不再进附件条，避免同一张图出现两次 */
export function unreferencedAttachments<T extends { file_path: string }>(
  html: string,
  attachments: T[],
): T[] {
  if (!attachments.length) return attachments
  const referenced = new Set(collectAttachmentPaths(html))
  if (!referenced.size) return attachments
  return attachments.filter((a) => !referenced.has(a.file_path))
}
