import { convertFileSrc } from '@tauri-apps/api/core'
import { invoke } from './transport'
import { isWebRuntime } from './runtime'

/**
 * 库里只存**相对**形态：
 *   - note_attachments.file_path = 附件目录下的文件名
 *   - 正文 <img src="attachments/<文件名>">
 * 绝对路径带着用户名和 APPDATA，一旦进了库，迁移包换台机器（甚至换个 Windows
 * 账号）图片就全显示不出来。显示时再由本机附件目录拼 asset URL。
 */
export const SRC_DIR = 'attachments'

/** 一张图的来路 → 附件落盘 → 正文里该用的 src。noteId 为空即草稿（只暂存文件，发布时才补记录） */
export type SaveImage = (source: File | string, noteId: string | null) => Promise<string | null>

/** 本机附件目录；只在运行时用一次，绝不写进数据 */
let baseDir = ''
/** 取列表前调一次；拿不到（锁屏、纯浏览器测试）就退回相对写法，不报错 */
export async function ensureAttachmentBase(): Promise<void> {
  if (baseDir) return
  try {
    baseDir = await invoke<string>('get_attachment_dir')
  } catch {
    baseDir = ''
  }
}

/** 任何来路的写法 → 附件目录下的文件名 */
export const nameOf = (stored: string): string => stored.split(/[\\/]/).pop() ?? stored

/** 规范形态（存进库、插进正文的那种） */
export const srcOf = (stored: string): string => `${SRC_DIR}/${nameOf(stored)}`

/** 显示用 URL：由本机目录现拼 */
export const attachmentSrc = (stored: string): string => {
  const name = nameOf(stored)
  if (isWebRuntime()) return `/api/attachments/${encodeURIComponent(name)}`
  return baseDir ? convertFileSrc(`${baseDir}/${name}`) : srcOf(name)
}

const isOurAssetSrc = (src: string) =>
  src.startsWith(`${SRC_DIR}/`) ||
  src.startsWith('/api/attachments/') ||
  src.startsWith('asset://') ||
  src.includes('asset.localhost') ||
  src.startsWith('desko-asset://')

/** src → 文件名；认规范形态和历史那批 asset URL（整条绝对路径被 encode 成最后一段） */
export function attachmentNameFromSrc(src: string | null | undefined): string | null {
  if (!src || !isOurAssetSrc(src)) return null
  try {
    return nameOf(decodeURIComponent(src.slice(src.lastIndexOf('/') + 1)))
  } catch {
    return null
  }
}

const SRC_ATTR = /src="([^"]*)"/g

function mapAssetSrcs(html: string, to: (name: string) => string): string {
  if (!html) return html
  return html.replace(SRC_ATTR, (all: string, src: string) => {
    const name = attachmentNameFromSrc(src)
    return name ? `src="${to(name)}"` : all
  })
}

/** 存 → 显示：把 attachments/<名> 换成本机能加载的 asset URL */
export const resolveAssetHtml = (html: string): string => mapAssetSrcs(html, attachmentSrc)

/** 显示 → 存：把 asset URL（含历史绝对路径那批）洗回 attachments/<名>，外链原样 */
export const normalizeAssetHtml = (html: string): string => mapAssetSrcs(html, srcOf)

/** 发布小记时按正文里出现的图片补附件记录，删小记才能连带清文件 */
export function collectAttachmentNames(html: string): string[] {
  if (!html) return []
  const names = new Set<string>()
  for (const m of html.matchAll(SRC_ATTR)) {
    const n = attachmentNameFromSrc(m[1])
    if (n) names.add(n)
  }
  return [...names]
}

/** 正文已经引用的附件不再进附件条，避免同一张图出现两次 */
export function unreferencedAttachments<T extends { file_path: string }>(
  html: string,
  attachments: T[],
): T[] {
  if (!attachments.length) return attachments
  const referenced = new Set(collectAttachmentNames(html))
  if (!referenced.size) return attachments
  return attachments.filter((a) => !referenced.has(nameOf(a.file_path)))
}
