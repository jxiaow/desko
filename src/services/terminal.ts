/* 终端偏好：决定快捷方式「在终端中打开」拉起哪个控制台。
 * 明文 meta 存 auto / wt / cmd；识别不了的一律回落 auto。
 * 真正的分叉在 Rust 端 open_terminal：auto 与 wt 都优先 Windows Terminal、
 * 失败回退 cmd，cmd 则固定经典控制台。 */
import { settingsApi } from './api/settings'

export type TerminalId = 'auto' | 'wt' | 'cmd'

export interface TerminalInfo {
  id: TerminalId
  name: string
  desc: string
}

export const TERMINALS: TerminalInfo[] = [
  { id: 'auto', name: '自动', desc: '优先 Windows Terminal，未安装则用命令提示符' },
  { id: 'wt', name: 'Windows Terminal', desc: '固定用 Windows Terminal，缺失时回退命令提示符' },
  { id: 'cmd', name: '命令提示符', desc: '固定用经典 cmd 控制台' },
]

export const DEFAULT_TERMINAL: TerminalId = 'auto'

const isTerminalId = (v: string): v is TerminalId => TERMINALS.some((t) => t.id === v)

/** 从设置里读终端偏好；读不到或不认识都回落到默认，不抛错。 */
export const readTerminal = async (): Promise<TerminalId> => {
  try {
    const raw = await settingsApi.getSetting('terminal')
    return isTerminalId(raw) ? raw : DEFAULT_TERMINAL
  } catch {
    return DEFAULT_TERMINAL
  }
}

/** 落盘偏好。失败（比如非 Tauri 环境）返回 false，不影响本次会话。 */
export const saveTerminal = async (id: TerminalId): Promise<boolean> => {
  try {
    await settingsApi.setSetting('terminal', id)
    return true
  } catch {
    return false
  }
}
