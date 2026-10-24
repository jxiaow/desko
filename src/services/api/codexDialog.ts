import { invoke } from '../transport'

export type DialogEnvironment = { kind: 'native' } | { kind: 'wsl'; distro: string; user: string }
export interface DialogDirectory { cwd: string; environment: DialogEnvironment }
export interface DialogEnvironments { nativeLabel: string; distros: string[]; wslError?: string }

export interface DialogItem {
  id: string
  type: string
  status?: string
  text?: string
  content?: { type: string; text?: string }[]
  command?: string
  aggregatedOutput?: string
  exitCode?: number | null
  changes?: { path: string; diff?: string; kind?: { type: string } }[]
  server?: string
  tool?: string
  query?: string
  summary?: string | string[]
  result?: unknown
  arguments?: unknown
  optimistic?: boolean
}
export interface DialogTurn { id: string; status: string; items: DialogItem[]; model?: string; effort?: string; error?: { message: string } | null }
export interface DialogModel { id: string; model: string; displayName?: string; isDefault?: boolean; supportedReasoningEfforts?: { reasoningEffort: string; description?: string }[]; defaultReasoningEffort?: string }
export interface DialogThread { id: string; sessionId?: string; source?: string; cwd: string; title: string; model: string | null; sandbox: string; updatedAt: number; status: string }
export interface DialogRequest {
  id: string | number
  method: string
  params: {
    threadId: string
    turnId?: string
    command?: string
    cwd?: string
    grantRoot?: string
    reason?: string
    permissions?: unknown
    availableDecisions?: unknown[]
    isBlocking?: boolean
    questions?: { id: string; header?: string; question: string; isSecret?: boolean; options?: { label: string; description: string }[] | null }[]
  }
}
export interface DialogEvent {
  type: string
  seq: number
  runtimeId: string
  method?: string
  params?: { threadId?: string; turnId?: string; turn?: DialogTurn; item?: DialogItem; itemId?: string; delta?: string; requestId?: string | number; error?: { message: string } }
  request?: DialogRequest
  requestId?: string | number
  threadId?: string
  threads?: DialogThread[]
  status?: string
  error?: string
}
export interface DialogSnapshot { thread: DialogThread; turns: DialogTurn[]; activeTurn?: DialogTurn | null; requests: DialogRequest[]; eventSeq: number }
export interface DialogWorkspace { name: string; path: string; branch: string; files: { path: string; status: string; originalPath?: string }[]; error?: string }
export interface DialogBootstrap {
  runtimeId: string
  environment: DialogEnvironment
  status: string
  error?: string
  historyError?: string
  models: DialogModel[]
  threads: DialogThread[]
  workspace: DialogWorkspace
  account: { type: string; plan?: string } | null
}
export const dialogAction = <T>(action: string, params: Record<string, unknown> = {}) =>
  invoke<T>('codex_dialog_action', { action, params })
