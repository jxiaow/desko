import { expireWebSession, webSessionGeneration } from '../../services/transport'

export interface WebFileEntry {
  name: string
  path: string
  directory: boolean
  size: number
}

export interface WebDirectory {
  name: string
  path: string
  entries: WebFileEntry[]
}

export const webFileUrl = (id: string, path = '') =>
  `/api/files/${encodeURIComponent(id)}?path=${encodeURIComponent(path)}`

const requestWebFile = async (id: string, path: string, method: 'GET' | 'HEAD' = 'GET'): Promise<Response> => {
  const epoch = webSessionGeneration()
  let response: Response
  try {
    response = await fetch(webFileUrl(id, path), { credentials: 'same-origin', method })
  } catch {
    if (epoch !== webSessionGeneration()) throw new Error('浏览器访问已过期，请重新连接')
    expireWebSession()
    throw new Error('无法连接 Desko，请确认桌面端和 Web 服务仍在运行')
  }
  if (epoch !== webSessionGeneration()) throw new Error('浏览器访问已过期，请重新连接')
  if (response.status === 401) {
    expireWebSession()
    throw new Error('浏览器访问已过期，请重新连接')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error || '文件无法读取')
  }
  return response
}

export const readWebDirectory = async (id: string, path = ''): Promise<WebDirectory> => {
  const epoch = webSessionGeneration()
  const response = await requestWebFile(id, path)
  const directory = await response.json() as WebDirectory
  if (epoch !== webSessionGeneration()) throw new Error('浏览器访问已过期，请重新连接')
  return directory
}

export const downloadWebFile = async (id: string, path: string, name: string): Promise<void> => {
  const epoch = webSessionGeneration()
  await requestWebFile(id, path, 'HEAD')
  if (epoch !== webSessionGeneration()) throw new Error('浏览器访问已过期，请重新连接')
  const link = document.createElement('a')
  link.href = webFileUrl(id, path)
  link.download = name.replace(/[\\/\x00-\x1f]/g, '_') || 'download'
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
  }
}

