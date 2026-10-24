import { applyEvent } from '../../src/utils/codexTurnReducer'
import type { DialogEnvironment, DialogEvent, DialogRequest, DialogThread, DialogTurn } from '../../src/services/api/codexDialog'

export interface DialogHistorySeed { id: string; cwd: string; title: string; source: string; environment?: DialogEnvironment; text?: string }

export class CodexDialogMock {
  private cwd = ''
  private environment: DialogEnvironment = { kind: 'native' }
  private threadEnvironments = new Map<string, string>()
  private seq = 0
  private threads: DialogThread[] = []
  private turns = new Map<string, DialogTurn[]>()
  private requests: DialogRequest[] = []
  constructor(private emit: (event: string, payload: unknown) => void) {}
  seed(histories: DialogHistorySeed[]) {
    for (const seed of histories) {
      if (!['cli', 'vscode', 'exec', 'appServer', 'unknown'].includes(seed.source)) continue
      this.threads.push({ id: seed.id, cwd: seed.cwd, title: seed.title, source: seed.source, model: 'fixture-model', sandbox: 'workspace-write', status: 'idle', updatedAt: Date.now() })
      this.threadEnvironments.set(seed.id, JSON.stringify(seed.environment || { kind: 'native' }))
      this.turns.set(seed.id, [{ id: `history-${seed.id}`, status: 'completed', items: [{ id: 'old-reply', type: 'agentMessage', text: seed.text || '已有会话的完整回复。' }] }])
    }
  }
  private message(message: Omit<DialogEvent, 'seq' | 'runtimeId'>) {
    const value: DialogEvent = { ...message, seq: ++this.seq, runtimeId: 'dialog-fixture' }
    const id = value.params?.threadId
    if (id && value.type === 'event') this.turns.set(id, applyEvent(this.turns.get(id) || [], value))
    this.emit('codex:dialog', value)
  }
  private currentThreads() { return this.threads.filter(t => t.cwd === this.cwd && this.threadEnvironments.get(t.id) === JSON.stringify(this.environment)) }
  private threadList() { this.message({ type: 'threads', threads: structuredClone(this.currentThreads()) }) }
  private workspace() { return { name: '测试项目', path: this.cwd, branch: 'feature/dialog', files: [{ status: 'M', path: 'src/示例.ts' }] } }
  private finish(id: string, status = 'completed') {
    const turn = this.turns.get(id)?.at(-1)
    if (!turn || turn.status !== 'inProgress') return
    this.message({ type: 'event', method: 'turn/completed', params: { threadId: id, turn: { ...turn, status, items: [] } } })
    this.threads.find(t => t.id === id)!.status = status
    this.requests = this.requests.filter(r => r.params.threadId !== id)
    this.threadList()
  }
  async dispatch(action: string, params: Record<string, any> = {}): Promise<unknown> {
    const id = params.threadId as string
    switch (action) {
      case 'environments': return { nativeLabel: 'Windows', distros: ['Ubuntu', 'Debian'] }
      case 'status': return { cwd: this.cwd || null, environment: this.environment, directories: this.cwd ? [{ cwd: this.cwd, environment: this.environment }] : [] }
      case 'connect':
        if (String(params.cwd).includes('missing-cli')) throw '未找到 Codex CLI，请安装并登录 Codex'
        this.cwd = params.cwd
        this.environment = structuredClone(params.environment || { kind: 'native' })
        {
          const unc = String(params.cwd).replace(/\\/g, '/').match(/^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(?:\/(.*))?$/i)
          if (unc && this.environment.kind === 'native') this.environment = { kind: 'wsl', distro: unc[1], user: '' }
          if (this.environment.kind === 'wsl') {
            this.environment.distro ||= unc?.[1] || 'Ubuntu'
            if (unc) this.cwd = `/${unc[2] || ''}`
          }
        }
        if (this.environment.kind === 'wsl' && !this.environment.user) this.environment.user = 'alice'
        return { runtimeId: 'dialog-fixture', environment: this.environment, status: 'ready', workspace: this.workspace(), account: { type: 'chatgpt', plan: 'pro' }, models: [
          { id: 'fixture-model', model: 'fixture-model', displayName: '测试模型', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] },
          { id: 'fixture-fast', model: 'fixture-fast', displayName: '快速模型', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] },
        ], threads: this.currentThreads() }
      case 'createThread': {
        const thread = { id: `dialog-${this.threads.length + 1}`, cwd: this.cwd, title: '新对话', model: params.model, sandbox: params.sandbox, status: 'idle', updatedAt: Date.now() }
        this.threadEnvironments.set(thread.id, JSON.stringify(this.environment))
        this.threads.unshift(thread); this.turns.set(thread.id, []); this.threadList()
        return { thread, turns: [], requests: [], eventSeq: this.seq }
      }
      case 'selectThread':
        await new Promise(resolve => setTimeout(resolve, 60))
        return structuredClone({ thread: this.threads.find(t => t.id === id), turns: this.turns.get(id) || [], requests: this.requests.filter(r => r.params.threadId === id), eventSeq: this.seq })
      case 'send': {
        const thread = this.threads.find(t => t.id === id)!
        if (thread.status === 'inProgress') throw '当前对话正在执行'
        thread.title = params.text; thread.status = 'inProgress'
        const turn = { id: `turn-${++this.seq}`, status: 'inProgress', items: [] }
        this.message({ type: 'event', method: 'turn/started', params: { threadId: id, turn } })
        this.message({ type: 'event', method: 'item/started', params: { threadId: id, turnId: turn.id, item: { id: 'user', type: 'userMessage', content: [{ type: 'text', text: params.text }] } } })
        this.threadList()
        setTimeout(() => {
          this.message({ type: 'event', method: 'item/agentMessage/delta', params: { threadId: id, turnId: turn.id, itemId: 'reply', delta: '**正在检查**工作目录。' } })
          if (params.text.includes('审批') || params.text.includes('问题')) {
            const request: DialogRequest = { id: ++this.seq, method: params.text.includes('问题') ? 'item/tool/requestUserInput' : 'item/commandExecution/requestApproval', params: { threadId: id, turnId: turn.id, command: 'git status --short', cwd: this.cwd, questions: [{ id: 'choice', question: '选择验证范围', options: [{ label: '当前模块', description: '仅检查当前模块' }, { label: '全部', description: '检查全部模块' }] }] } }
            this.requests.push(request); this.message({ type: 'approval', request })
          } else if (!params.text.includes('暂停')) {
            this.message({ type: 'event', method: 'item/agentMessage/delta', params: { threadId: id, turnId: turn.id, itemId: 'reply', delta: '\n\n检查完成，没有修改文件。' } })
            this.finish(id)
          }
        }, 100)
        await new Promise(resolve => setTimeout(resolve, 150)) // Notifications precede the RPC response.
        return { turn }
      }
      case 'interrupt': this.finish(id, 'interrupted'); return {}
      case 'respond': {
        const index = this.requests.findIndex(r => r.id === params.requestId && r.params.threadId === id)
        if (index < 0) throw '此请求已经结束'
        this.requests.splice(index, 1)
        this.message({ type: 'approvalResolved', requestId: params.requestId, threadId: id })
        this.finish(id); return {}
      }
      case 'workspace': return this.workspace()
      case 'syncThreads': this.threadList(); return { threads: structuredClone(this.currentThreads()) }
      case 'importIndex': return { imported: 0 }
      default: throw `未实现的对话操作：${action}`
    }
  }
}
