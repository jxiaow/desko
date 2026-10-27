import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { listen } from '../services/events'
import { dialogAction, type DialogBootstrap, type DialogEnvironment, type DialogDirectory, type DialogEnvironments, type DialogEvent, type DialogRequest, type DialogSnapshot, type DialogThread, type DialogTurn, type DialogWorkspace } from '../services/api/codexDialog'
import { finishSend, isBusy, reduceView, restoreView, userText } from '../utils/codexTurnReducer'
import { usePageAutoRefresh } from './usePageAutoRefresh'

const problem = (error: unknown) => error instanceof Error ? error.message : String(error)

export function useCodexDialog() {
  const connection = ref<'idle' | 'connecting' | 'ready' | 'disconnected'>('idle')
  const runtimeId = ref('')
  const directories = ref<DialogDirectory[]>([])
  const environment = ref<DialogEnvironment>({ kind: 'native' })
  const environments = ref<DialogEnvironments>({ nativeLabel: '本机', distros: [] })
  const environmentsLoading = ref(false)
  const environmentKey = (env: DialogEnvironment) => env.kind === 'native' ? 'native' : JSON.stringify([env.distro, env.user])
  const storageKey = () => environment.value.kind === 'native' ? `desko.codex.dialog.${cwd.value}` : `desko.codex.dialog.wsl.${environmentKey(environment.value)}.${cwd.value}`
  async function refreshEnvironments() {
    environmentsLoading.value = true
    try {
      const next = await dialogAction<DialogEnvironments>('environments')
      if (active) environments.value = next
    } catch (e) { if (active) error.value = problem(e) }
    finally { if (active) environmentsLoading.value = false }
  }
  const cwd = ref('')
  const workspace = ref<DialogWorkspace | null>(null)
  const models = ref<DialogBootstrap['models']>([])
  const account = ref<DialogBootstrap['account']>(null)
  const threads = ref<DialogThread[]>([])
  const selected = ref<string | null>(null)
  const turns = ref<DialogTurn[]>([])
  const requests = ref<DialogRequest[]>([])
  const draft = ref('')
  const error = ref('')
  const loading = ref(false)
  const historyLoading = ref(false)
  const sending = ref(false)
  const stopping = ref(false)
  const model = ref('')
  const effort = ref('')
  const currentModel = computed(() => models.value.find(item => (item.model || item.id) === model.value))
  watch(currentModel, value => {
    const levels = value?.supportedReasoningEfforts || []
    if (!levels.some(level => level.reasoningEffort === effort.value)) effort.value = value?.defaultReasoningEffort || levels[0]?.reasoningEffort || ''
  }, { flush: 'sync' })
  const sandbox = ref('workspace-write')
  type SavedDraft = { id: string; threadId: string | null; text: string; model: string; effort: string; updatedAt: number }
  const savedDrafts = ref<SavedDraft[]>([])
  const draftId = ref<string>(crypto.randomUUID())
  const draftStorageKey = () => `${storageKey()}.drafts`
  let turnSettings: Record<string, { model: string; effort: string }> = {}
  const draftThreads = computed(() => savedDrafts.value.filter(item => !item.threadId && item.text.trim()))
  function persist(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)) }
    catch { if (!error.value) error.value = '本地保存失败，当前内容仍在窗口中，请暂时保留此窗口。' }
  }
  function saveDraft() {
    if (!workspace.value) return
    const entry: SavedDraft = { id: draftId.value, threadId: selected.value, text: draft.value, model: model.value, effort: effort.value, updatedAt: Date.now() }
    savedDrafts.value = savedDrafts.value.filter(item => item.id !== entry.id && (!entry.threadId || item.threadId !== entry.threadId))
    if (entry.text.trim()) savedDrafts.value.unshift(entry)
    persist(draftStorageKey(), savedDrafts.value)
  }
  function restoreDraft(threadId: string | null, id?: string) {
    const entry = savedDrafts.value.find(item => id ? item.id === id : threadId ? item.threadId === threadId : !item.threadId)
    draftId.value = entry?.id || crypto.randomUUID()
    draft.value = entry?.text || ''
    if (entry && models.value.some(item => (item.model || item.id) === entry.model)) {
      model.value = entry.model
      effort.value = currentModel.value?.supportedReasoningEfforts?.some(level => level.reasoningEffort === entry.effort) ? entry.effort : currentModel.value?.defaultReasoningEffort || ''
    }
  }
  function openDraft(id: string) {
    if (busy.value || requests.value.length) return
    saveDraft(); newConversation(false); restoreDraft(null, id)
  }
  const busy = computed(() => sending.value || isBusy(turns.value))
  const anyBusy = computed(() => busy.value || threads.value.some(t => ['inProgress', 'waitingOnApproval'].includes(t.status)))
  const selectedThread = computed(() => threads.value.find(t => t.id === selected.value))
  let active = true
  let selection = 0
  let connectionVersion = 0
  let workspaceVersion = 0
  let threadsRevision = 0
  let queue: DialogEvent[] | null = null
  type PendingSend = { threadId: string; text: string; previousTurns: Set<string>; model: string; effort: string }
  let pendingSend: PendingSend | null = null
  let recovery: PendingSend | null = null
  let unlisten: (() => void) | undefined
  let deferredResync = false
  const request = <T>(action: string, params: Record<string, unknown> = {}) => dialogAction<T>(action, { ...params, runtimeId: runtimeId.value })

  function setView(view: { turns: DialogTurn[]; requests: DialogRequest[] }) {
    turns.value = view.turns.map(turn => ({ ...turn, ...turnSettings[`${selected.value}:${turn.id}`] }))
    requests.value = view.requests
  }
  async function refreshWorkspace() {
    const current = runtimeId.value
    const connectionAt = connectionVersion
    const version = ++workspaceVersion
    const currentRequest = () => active && current === runtimeId.value && connectionAt === connectionVersion && version === workspaceVersion
    try {
      const next = await request<DialogWorkspace>('workspace')
      if (currentRequest()) workspace.value = next
    } catch (e) { if (currentRequest()) error.value = problem(e) }
  }
  async function refreshHistory() {
    if (historyLoading.value || connection.value !== 'ready') return
    const current = runtimeId.value
    const connectionAt = connectionVersion
    const revision = threadsRevision
    const currentRequest = () => active && current === runtimeId.value && connectionAt === connectionVersion
    historyLoading.value = true
    try {
      const result = await request<{ threads: DialogThread[] }>('syncThreads')
      if (currentRequest() && revision === threadsRevision) threads.value = result.threads
    } catch (e) { if (currentRequest() && revision === threadsRevision) error.value = `同步历史失败：${problem(e)}` }
    finally { if (currentRequest()) historyLoading.value = false }
  }
  async function selectThread(id: string, remember = true) {
    const version = ++selection
    if (selected.value !== id) { if (remember) saveDraft(); restoreDraft(id); recovery = null }
    else if (!remember) restoreDraft(id)
    selected.value = id
    loading.value = true
    sending.value = false
    error.value = ''
    turns.value = []; requests.value = []; queue = []
    try {
      const snapshot = await request<DialogSnapshot>('selectThread', { threadId: id })
      if (!active || version !== selection) return
      setView(restoreView(snapshot, queue || []))
      if (recovery?.threadId === id) {
        const sent = turns.value.some(t => !recovery!.previousTurns.has(t.id) && t.items.some(i => i.type === 'userMessage' && userText(i) === recovery!.text))
        if (sent && draft.value === recovery.text) draft.value = ''
        if (!sent) error.value = '消息已保留，请核对记录后再发送。'
        recovery = null
      }
      localStorage.setItem(storageKey(), id)
    } catch (e) { if (active && version === selection) error.value = problem(e) }
    finally { if (active && version === selection) { loading.value = false; queue = null } }
  }
  function newConversation(remember = true) {
    if (remember) saveDraft()
    selection++; selected.value = null; queue = null
    recovery = null
    turns.value = []; requests.value = []; draft.value = ''; draftId.value = crypto.randomUUID(); error.value = ''
    sending.value = false; loading.value = false
    localStorage.removeItem(storageKey())
  }
  async function connect(path: string, restart = false, target = environment.value) {
    if (!path || connection.value === 'connecting') return
    const version = ++connectionVersion
    historyLoading.value = false
    selection++
    connection.value = 'connecting'; error.value = ''
    try {
      const result = await dialogAction<DialogBootstrap>('connect', { cwd: path, restart, environment: target })
      if (!active || version !== connectionVersion) return
      const sameWorkspace = !!workspace.value && workspace.value.path === result.workspace.path && environmentKey(environment.value) === environmentKey(result.environment)
      const savedDraft = sameWorkspace ? draft.value : ''
      saveDraft()
      if (!sameWorkspace) { selected.value = null; draft.value = ''; recovery = null }
      runtimeId.value = result.runtimeId; cwd.value = result.workspace.path; environment.value = result.environment
      workspace.value = result.workspace; models.value = result.models; account.value = result.account
      threads.value = result.threads; connection.value = result.status === 'ready' ? 'ready' : 'disconnected'
      if (!directories.value.some(d => d.cwd === cwd.value && environmentKey(d.environment) === environmentKey(environment.value))) directories.value.push({ cwd: cwd.value, environment: result.environment })
      model.value = result.models.find(m => m.isDefault)?.model || result.models[0]?.model || ''
      try { savedDrafts.value = JSON.parse(localStorage.getItem(draftStorageKey()) || '[]') } catch { savedDrafts.value = [] }
      try { turnSettings = JSON.parse(localStorage.getItem(`${storageKey()}.turn-settings`) || '{}') } catch { turnSettings = {} }
      const previous = localStorage.getItem(storageKey())
      if (previous && result.threads.some(t => t.id === previous)) await selectThread(previous, false)
      else { newConversation(false); restoreDraft(null); if (sameWorkspace && savedDraft) draft.value = savedDraft }
      if (result.historyError) error.value = result.historyError
    } catch (e) {
      if (active && version === connectionVersion) {
        if (!workspace.value) { cwd.value = path; environment.value = target }
        connection.value = 'disconnected'; error.value = problem(e)
      }
    }
  }
  async function send() {
    if (!draft.value.trim() || busy.value || loading.value || connection.value !== 'ready') return
    const version = selection
    const text = draft.value.trim()
    const parameters = { model: model.value, effort: effort.value }
    let id = selected.value
    sending.value = true; error.value = ''
    draft.value = ''; saveDraft()
    const pendingId = `pending:${crypto.randomUUID()}`
    try {
      if (!id) {
        const created = await request<DialogSnapshot>('createThread', { model: parameters.model, sandbox: sandbox.value })
        if (!active || version !== selection) return
        id = created.thread.id; selected.value = id
        if (!threads.value.some(t => t.id === id)) { threadsRevision++; threads.value.unshift(created.thread) }
        localStorage.setItem(storageKey(), id)
      }
      saveDraft()
      pendingSend = { threadId: id, text, previousTurns: new Set(turns.value.map(t => t.id)), ...parameters }
      turns.value.push({ id: pendingId, status: 'pending', ...parameters, items: [{ id: pendingId, type: 'userMessage', optimistic: true, content: [{ type: 'text', text }] }] })
      const response = await request<{ turn: DialogTurn }>('send', { threadId: id, text, ...parameters })
      if (active && version === selection) {
        turnSettings[`${id}:${response.turn.id}`] = parameters
        persist(`${storageKey()}.turn-settings`, turnSettings)
        setView({ turns: finishSend(turns.value, pendingId, text, response), requests: requests.value })
      }
    } catch (e) {
      if (active && version === selection) {
        error.value = problem(e)
        turns.value = turns.value.filter(t => t.id !== pendingId)
        if (!draft.value) draft.value = text
        else if (draft.value !== text) {
          savedDrafts.value.unshift({ id: crypto.randomUUID(), threadId: null, text, ...parameters, updatedAt: Date.now() })
          saveDraft()
        }
      }
    } finally {
      if (pendingSend?.text === text && pendingSend.threadId === id) pendingSend = null
      if (active && version === selection) sending.value = false
      if (deferredResync) { deferredResync = false; resync() }
    }
  }
  async function stop() {
    if (!selected.value || stopping.value) return
    stopping.value = true
    try { await request('interrupt', { threadId: selected.value }) }
    catch (e) { if (active) error.value = problem(e) }
    finally { stopping.value = false }
  }
  async function respond(payload: Record<string, unknown>) { await request('respond', payload) }
  async function importIndex(path: string) {
    try {
      const result = await request<{ imported: number }>('importIndex', { path })
      if (active) error.value = result.imported ? `已导入 ${result.imported} 条对话` : '索引中没有当前工作目录的新对话'
    } catch (e) { if (active) error.value = problem(e) }
  }
  function receive(message: DialogEvent) {
    if (!active || message.runtimeId !== runtimeId.value) return
    if (message.type === 'runtime' && message.status === 'disconnected') {
      if (pendingSend?.threadId === selected.value) {
        recovery = pendingSend
        if (!draft.value) draft.value = pendingSend.text
      }
      selection++; connection.value = 'disconnected'; error.value = message.error || 'Codex 已断开'
      requests.value = []; queue = null; loading.value = false; sending.value = false
      return
    }
    if (message.type === 'warning') error.value = message.error || ''
    if (message.type === 'threads') { threadsRevision++; threads.value = message.threads || [] }
    const id = message.params?.threadId || message.request?.params.threadId || message.threadId
    if (!id || id !== selected.value) return
    if (pendingSend?.threadId === id && message.method === 'turn/started' && message.params?.turn) turnSettings[`${id}:${message.params.turn.id}`] = { model: pendingSend.model, effort: pendingSend.effort }
    if (queue) { queue.push(message); return }
    setView(reduceView(turns.value, requests.value, message))
    if (message.method === 'turn/completed') void refreshWorkspace()
    if (message.method === 'error') error.value = message.params?.error?.message || 'Codex 执行失败'
  }
  function resync() {
    if (!active || !selected.value || connection.value !== 'ready') return
    if (sending.value) { deferredResync = true; return }
    void selectThread(selected.value)
  }
  watch([draft, model, effort], () => { if (connection.value === 'ready' && !loading.value) saveDraft() })
  usePageAutoRefresh(async () => {
    await Promise.all([refreshHistory(), refreshWorkspace()])
  }, () => connection.value !== 'ready')
  onMounted(async () => {
    window.addEventListener('desko:web-events-reset', resync)
    try {
      const stop = await listen<DialogEvent>('codex:dialog', e => receive(e.payload))
      if (!active) { stop(); return }
      unlisten = stop
      void refreshEnvironments()
      const status = await dialogAction<{ cwd: string | null; environment: DialogEnvironment | null; directories: DialogDirectory[] }>('status')
      if (!active) return
      directories.value = status.directories
      if (status.cwd) { cwd.value = status.cwd; await connect(status.cwd, false, status.environment || { kind: 'native' }) }
    } catch (e) { if (active) error.value = problem(e) }
  })
  onUnmounted(() => { saveDraft(); active = false; selection++; connectionVersion++; unlisten?.(); queue = null; window.removeEventListener('desko:web-events-reset', resync) })
  return { connection, directories, environment, environments, environmentsLoading, refreshEnvironments, cwd, workspace, models, account, threads, selected, turns, requests, draft, error, loading, historyLoading, refreshHistory,
    sending, stopping, model, effort, currentModel, sandbox, busy, anyBusy, selectedThread, draftThreads, savedDrafts, draftId, openDraft, saveDraft, connect, selectThread, newConversation, send, stop, respond, refreshWorkspace, importIndex }
}
