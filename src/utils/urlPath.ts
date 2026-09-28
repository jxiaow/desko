const ABSOLUTE = /^https?:\/\//i

/**
 * 把录入值收敛成以「/」开头的子路径。
 * 粘进完整地址时剥掉协议与主机，只留路径段；剥完为空（纯主机名）返回 null。
 */
export function normalizeSubPath(raw: string): string | null {
  const trimmed = raw.trim().replace(/^\/+/, '')
  if (!trimmed) return null
  if (!ABSOLUTE.test(trimmed)) return '/' + trimmed
  try {
    const url = new URL(trimmed)
    const rest = (url.pathname + url.search + url.hash).replace(/^\/+/, '')
    return rest ? '/' + rest : null
  } catch {
    return null
  }
}

/** 历史数据里可能存着整条地址，这类值直接用作跳转目标 */
export function joinEntryUrl(baseUrl: string | null | undefined, path: string): string {
  if (ABSOLUTE.test(path)) return path
  if (!baseUrl) return path
  return baseUrl.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path)
}
