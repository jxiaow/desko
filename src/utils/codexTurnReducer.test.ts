import { describe, expect, it } from 'vitest'
import { applyEvent, finishSend, restoreView } from './codexTurnReducer'
import type { DialogEvent, DialogSnapshot, DialogTurn } from '../services/api/codexDialog'

const event = (seq: number, method: string, params: DialogEvent['params']): DialogEvent => ({ type: 'event', runtimeId: 'r', seq, method, params })
const snapshot = (): DialogSnapshot => ({ thread: { id: 't', cwd: '/repo', title: 'Test', model: 'model', sandbox: 'read-only', status: 'idle', updatedAt: 0 }, turns: [], requests: [], eventSeq: 4 })

describe('Codex conversation replay', () => {
  it('does not apply deltas already included in the snapshot', () => {
    const value = snapshot()
    value.turns = [{ id: 'turn', status: 'inProgress', items: [{ id: 'a', type: 'agentMessage', text: '你好' }] }]
    const restored = restoreView(value, [event(3, 'item/agentMessage/delta', { turnId: 'turn', itemId: 'a', delta: '你好' }), event(5, 'item/agentMessage/delta', { turnId: 'turn', itemId: 'a', delta: '，世界' })])
    expect(restored.turns[0].items[0].text).toBe('你好，世界')
    expect(value.turns[0].items[0].text).toBe('你好')
  })
  it('keeps a completion arriving before the send response and deduplicates the user message', () => {
    let turns: DialogTurn[] = [{ id: 'pending', status: 'pending', items: [] }]
    turns = applyEvent(turns, event(1, 'item/started', { turnId: 'turn', item: { id: 'u', type: 'userMessage', content: [{ type: 'text', text: '检查' }] } }))
    turns = applyEvent(turns, event(2, 'item/agentMessage/delta', { turnId: 'turn', itemId: 'a', delta: '完成' }))
    turns = applyEvent(turns, event(3, 'turn/completed', { turn: { id: 'turn', status: 'completed', items: [] } }))
    turns = finishSend(turns, 'pending', '检查', { turn: { id: 'turn', status: 'inProgress', items: [] } })
    expect(turns).toHaveLength(1)
    expect(turns[0].status).toBe('completed')
    expect(turns[0].items.filter(i => i.type === 'userMessage')).toHaveLength(1)
    expect(turns[0].items[1].text).toBe('完成')
  })
  it('keeps string and numeric request ids distinct and clears approvals on completion', () => {
    const value = snapshot()
    value.requests = [7, '7'].map(id => ({ id, method: 'item/fileChange/requestApproval', params: { threadId: 't' } }))
    const resolved = restoreView(value, [event(5, 'serverRequest/resolved', { requestId: 7 })])
    expect(resolved.requests.map(r => r.id)).toEqual(['7'])
    expect(restoreView(value, [event(5, 'turn/completed', { turn: { id: 'turn', status: 'failed', items: [], error: { message: '失败' } } })]).requests).toEqual([])
  })
  it('preserves partial text on failure and bounds command output', () => {
    let turns = applyEvent([], event(1, 'item/commandExecution/outputDelta', { turnId: 'turn', itemId: 'c', delta: 'x'.repeat(200005) }))
    expect(turns[0].items[0].aggregatedOutput?.length).toBe(200000)
    turns = applyEvent(turns, event(2, 'turn/completed', { turn: { id: 'turn', status: 'failed', items: [], error: { message: '失败' } } }))
    expect(turns[0].error?.message).toBe('失败')
    expect(turns[0].items).toHaveLength(1)
  })
})
