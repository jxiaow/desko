import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { useCodexDialog } from './useCodexDialog'
import { dialogAction, type DialogEvent, type DialogSnapshot } from '../services/api/codexDialog'

let receive: (event: { payload: DialogEvent }) => void
vi.mock('../services/events', () => ({ listen: vi.fn(async (_name, handler) => { receive = handler; return vi.fn() }) }))
vi.mock('../services/api/codexDialog', () => ({ dialogAction: vi.fn() }))
const thread = { id: 't', title: '对话', cwd: '/repo', model: 'model', sandbox: 'read-only', status: 'idle', updatedAt: 0 }
const snapshot = (): DialogSnapshot => ({ thread, turns: [], requests: [], eventSeq: 0 })
const base = { runtimeId: 'r', environment: { kind: 'native' }, status: 'ready', models: [], account: null, threads: [thread], workspace: { name: 'repo', path: '/repo', branch: 'main', files: [] } }
let client: ReturnType<typeof useCodexDialog>
let wrapper: ReturnType<typeof mount>

beforeEach(async () => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
  vi.mocked(dialogAction).mockReset().mockImplementation(async action => {
    if (action === 'environments') return { nativeLabel: 'Windows', distros: ['Ubuntu'] } as never
    if (action === 'status') return { cwd: '/repo', directories: [] } as never
    if (action === 'connect') return base as never
    if (action === 'selectThread') return snapshot() as never
    if (action === 'createThread') return snapshot() as never
    return {} as never
  })
  wrapper = mount(defineComponent({ setup() { client = useCodexDialog(); return () => null } }))
  await flushPromises()
})
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals() })

it('refreshes imported history without discarding the selected conversation or its draft', async () => {
  await client.selectThread('t')
  client.draft.value = '尚未发送'
  vi.mocked(dialogAction).mockResolvedValueOnce({ threads: [thread, { ...thread, id: 'cli', source: 'cli' }] })
  await client.refreshHistory()
  expect(client.threads.value.map(t => t.id)).toEqual(['t', 'cli'])
  expect(client.selected.value).toBe('t')
  expect(client.draft.value).toBe('尚未发送')
})

it('ignores a history refresh result after the connected runtime changes', async () => {
  let resolve!: (result: unknown) => void
  vi.mocked(dialogAction).mockImplementationOnce(() => new Promise(done => { resolve = done }) as never)
  const refresh = client.refreshHistory()
  vi.mocked(dialogAction).mockResolvedValueOnce({ ...base, runtimeId: 'different-runtime', threads: [] })
  await client.connect('/different')
  resolve({ threads: [thread] })
  await refresh
  expect(client.threads.value).toEqual([])
})

it('refresh preserves a draft, including when history fails to load', async () => {
  await client.selectThread('t')
  client.draft.value = '未发送的内容'
  vi.mocked(dialogAction).mockRejectedValueOnce(new Error('history unavailable'))
  await client.selectThread('t')
  expect(client.draft.value).toBe('未发送的内容')
  expect(client.error.value).toContain('history unavailable')
})

it('restores a snapshot after missed Web events and preserves the unsent draft', async () => {
  await client.selectThread('t')
  client.draft.value = '下一条消息'
  vi.mocked(dialogAction).mockResolvedValueOnce({ ...snapshot(), turns: [{ id: 'recovered', status: 'completed', items: [] }] })
  window.dispatchEvent(new Event('desko:web-events-reset'))
  await flushPromises()
  expect(client.turns.value[0].id).toBe('recovered')
  expect(client.draft.value).toBe('下一条消息')
})

it('defers a Web snapshot reset until an in-flight send completes', async () => {
  await client.selectThread('t')
  client.draft.value = '检查项目'
  let resolve!: (value: unknown) => void
  vi.mocked(dialogAction).mockImplementationOnce(() => new Promise(done => { resolve = done }) as never)
  const send = client.send()
  window.dispatchEvent(new Event('desko:web-events-reset'))
  expect(client.sending.value).toBe(true)
  expect(dialogAction).toHaveBeenLastCalledWith('send', expect.any(Object))
  resolve({ turn: { id: 'sent', status: 'completed', items: [] } })
  await send
  await flushPromises()
  expect(client.sending.value).toBe(false)
  expect(dialogAction).toHaveBeenLastCalledWith('selectThread', expect.objectContaining({ threadId: 't' }))
})

it('ignores a stale snapshot after switching conversations', async () => {
  let resolve!: (value: DialogSnapshot) => void
  vi.mocked(dialogAction).mockImplementationOnce(() => new Promise(r => { resolve = r }))
  const loading = client.selectThread('t')
  client.newConversation()
  resolve({ ...snapshot(), turns: [{ id: 'old', status: 'completed', items: [{ id: 'a', type: 'agentMessage', text: '旧会话' }] }] })
  await loading
  expect(client.selected.value).toBeNull()
  expect(client.turns.value).toEqual([])
})

it('buffers events during history loading and applies only newer events', async () => {
  let resolve!: (value: DialogSnapshot) => void
  vi.mocked(dialogAction).mockImplementationOnce(() => new Promise(r => { resolve = r }))
  const loading = client.selectThread('t')
  receive({ payload: { runtimeId: 'r', seq: 2, type: 'event', method: 'item/agentMessage/delta', params: { threadId: 't', turnId: 'turn', itemId: 'a', delta: '续写' } } })
  resolve({ ...snapshot(), eventSeq: 1, turns: [{ id: 'turn', status: 'inProgress', items: [{ id: 'a', type: 'agentMessage', text: '原文' }] }] })
  await loading
  expect(client.turns.value[0].items[0].text).toBe('原文续写')
})

it('retains a prompt when disconnect precedes send failure, then reconciles a confirmed delivery', async () => {
  await client.selectThread('t')
  client.draft.value = '检查项目'
  let reject!: (reason: Error) => void
  vi.mocked(dialogAction).mockImplementationOnce(() => new Promise((_r, fail) => { reject = fail }))
  const send = client.send()
  await flushPromises()
  receive({ payload: { runtimeId: 'r', seq: 1, type: 'runtime', status: 'disconnected' } })
  reject(new Error('连接已断开'))
  await send
  expect(client.draft.value).toBe('检查项目')
  vi.mocked(dialogAction).mockResolvedValueOnce({ ...snapshot(), turns: [{ id: 'delivered', status: 'completed', items: [{ id: 'u', type: 'userMessage', content: [{ type: 'text', text: '检查项目' }] }] }] })
  await client.selectThread('t')
  expect(client.draft.value).toBe('')
  expect(client.turns.value[0].id).toBe('delivered')
})

it('unmounting while a thread is being created never sends the pending prompt', async () => {
  client.draft.value = '检查项目'
  let resolve!: (value: DialogSnapshot) => void
  vi.mocked(dialogAction).mockImplementationOnce(() => new Promise(r => { resolve = r }))
  const send = client.send()
  wrapper.unmount()
  resolve(snapshot())
  await send
  expect(vi.mocked(dialogAction).mock.calls.some(([action]) => action === 'send')).toBe(false)
})

it('keeps selection and draft separate when the same path is opened in another environment', async () => {
  await client.selectThread('t')
  client.draft.value = 'Windows 草稿'
  const environment = { kind: 'wsl' as const, distro: 'Ubuntu', user: 'alice' }
  vi.mocked(dialogAction).mockResolvedValueOnce({ ...base, environment, threads: [] })
  await client.connect('/repo', false, environment)
  expect(dialogAction).toHaveBeenLastCalledWith('connect', { cwd: '/repo', restart: false, environment })
  expect(client.environment.value).toEqual(environment)
  expect(client.selected.value).toBeNull()
  expect(client.draft.value).toBe('')
  expect(localStorage.getItem('desko.codex.dialog./repo')).toBe('t')
  expect(client.directories.value).toContainEqual({ cwd: '/repo', environment })
})

it('never carries a draft to a copied thread with the same id in another environment', async () => {
  await client.selectThread('t')
  client.draft.value = '仅针对 Windows 的消息'
  const environment = { kind: 'wsl' as const, distro: 'Ubuntu', user: 'alice' }
  localStorage.setItem('desko.codex.dialog.wsl.["Ubuntu","alice"]./repo', 't')
  vi.mocked(dialogAction).mockResolvedValueOnce({ ...base, environment }).mockResolvedValueOnce(snapshot())
  await client.connect('/repo', false, environment)
  expect(client.selected.value).toBe('t')
  expect(client.draft.value).toBe('')
})

it('restores separate history drafts and a new unsent conversation', async () => {
  await client.selectThread('t'); client.draft.value = '第一段的草稿'
  await client.selectThread('other'); expect(client.draft.value).toBe('')
  client.draft.value = '第二段的草稿'
  await client.selectThread('t'); expect(client.draft.value).toBe('第一段的草稿')
  client.newConversation(); client.draft.value = '还未发送的新对话'
  await flushPromises()
  const id = client.draftId.value
  client.newConversation(); expect(client.draft.value).toBe('')
  expect(client.draftThreads.value.some(item => item.id === id)).toBe(true)
  client.openDraft(id); expect(client.draft.value).toBe('还未发送的新对话')
  await client.selectThread('other'); expect(client.draft.value).toBe('第二段的草稿')
})

it('restores drafts after returning to the same project in a different environment', async () => {
  await client.selectThread('t'); client.draft.value = '本机项目草稿'
  const environment = { kind: 'wsl' as const, distro: 'Ubuntu', user: 'alice' }
  vi.mocked(dialogAction).mockResolvedValueOnce({ ...base, environment, threads: [] })
  await client.connect('/repo', false, environment); client.draft.value = 'WSL 草稿'
  vi.mocked(dialogAction).mockResolvedValueOnce(base).mockResolvedValueOnce(snapshot())
  await client.connect('/repo', false, { kind: 'native' })
  expect(client.draft.value).toBe('本机项目草稿')
})

it('captures model and reasoning at send time and keeps changes for the next turn', async () => {
  client.models.value = [
    { id: 'a', model: 'a', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] },
    { id: 'b', model: 'b', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
  ]
  client.model.value = 'a'; client.effort.value = 'high'
  await client.selectThread('t'); client.draft.value = '检查代码'
  let resolve!: (value: unknown) => void
  vi.mocked(dialogAction).mockImplementationOnce(() => new Promise(done => { resolve = done }) as never)
  const sent = client.send()
  expect(dialogAction).toHaveBeenLastCalledWith('send', expect.objectContaining({ model: 'a', effort: 'high' }))
  receive({ payload: { runtimeId: 'r', seq: 1, type: 'event', method: 'turn/started', params: { threadId: 't', turn: { id: 'actual', status: 'inProgress', items: [] } } } })
  client.model.value = 'b'
  expect(client.effort.value).toBe('low')
  expect(client.turns.value.find(turn => turn.id === 'actual')).toMatchObject({ model: 'a', effort: 'high' })
  resolve({ turn: { id: 'actual', status: 'completed', items: [] } }); await sent
  expect(client.model.value).toBe('b')
  expect(client.turns.value.find(turn => turn.id === 'actual')).toMatchObject({ model: 'a', effort: 'high' })
})

it('preserves text typed while the first thread is being created', async () => {
  client.draft.value = '当前要发送的消息'
  let resolve!: (value: unknown) => void
  vi.mocked(dialogAction).mockImplementationOnce(() => new Promise(done => { resolve = done }) as never)
  const sent = client.send()
  client.draft.value = '下一条草稿'
  vi.mocked(dialogAction).mockResolvedValueOnce({ turn: { id: 'actual', status: 'completed', items: [] } })
  resolve(snapshot()); await sent
  expect(client.draft.value).toBe('下一条草稿')
  expect(dialogAction).toHaveBeenLastCalledWith('send', expect.objectContaining({ text: '当前要发送的消息' }))
})

it('keeps a failed prompt recoverable when the user has already typed the next draft', async () => {
  await client.selectThread('t'); client.draft.value = '未能发出的消息'
  let reject!: (error: Error) => void
  vi.mocked(dialogAction).mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail }) as never)
  const sent = client.send(); client.draft.value = '下一条消息'
  reject(new Error('发送失败')); await sent
  expect(client.draft.value).toBe('下一条消息')
  expect(client.draftThreads.value.some(item => item.text === '未能发出的消息')).toBe(true)
})
