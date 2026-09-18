// vite alias: '@tauri-apps/api/core' -> 本文件（仅 E2E 模式）
import { getBackend } from './backend'

export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return (await getBackend().invoke(cmd, args ?? {})) as T
}

export function convertFileSrc(filePath: string): string {
  return filePath
}

// @tauri-apps/plugin-shell、plugin-fs 在预构建时从 core 导入这两个符号
export class Channel<T = unknown> {
  constructor(readonly handlers?: {
    onmessage?: (message: T) => void
    onError?: (error: unknown) => void
    onend?: () => void
  }) {}
  get id(): number {
    return 0
  }
}

export class Resource {
  constructor(readonly rid: string) {}
  static close(_rid: Resource | string): Promise<void> {
    return Promise.resolve()
  }
}
