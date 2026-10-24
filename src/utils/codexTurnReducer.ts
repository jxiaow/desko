import type { DialogEvent, DialogItem, DialogRequest, DialogSnapshot, DialogTurn } from '../services/api/codexDialog'

export function replaceItem(items: DialogItem[], item: DialogItem): DialogItem[] {
  return items.some(entry => entry.id === item.id) ? items.map(entry => entry.id === item.id ? item : entry) : [...items, item]
}
export function applyEvent(turns: DialogTurn[], message: DialogEvent): DialogTurn[] {
  const { method, params } = message
  if (!params) return turns
  const id = params.turnId || params.turn?.id
  if (!id || !['turn/started', 'turn/completed', 'item/started', 'item/completed', 'item/agentMessage/delta', 'item/commandExecution/outputDelta'].includes(method || '')) return turns
  const existing = turns.find(turn => turn.id === id)
  let turn: DialogTurn = existing || { id, status: 'inProgress', items: [] }
  if (method === 'turn/started') turn = { ...turn, ...params.turn, items: turn.items }
  if ((method === 'item/started' || method === 'item/completed') && params.item) {
    const items = params.item.type === 'userMessage' ? turn.items.filter(item => !item.optimistic) : turn.items
    turn = { ...turn, items: replaceItem(items, params.item) }
  }
  if (method === 'item/agentMessage/delta' || method === 'item/commandExecution/outputDelta') {
    const agent = method === 'item/agentMessage/delta'
    const item = turn.items.find(entry => entry.id === params.itemId) || { id: params.itemId!, type: agent ? 'agentMessage' : 'commandExecution' }
    const field = agent ? 'text' : 'aggregatedOutput'
    let value = (item[field] || '') + (params.delta || '')
    if (!agent && value.length > 200000) value = value.slice(-200000)
    turn = { ...turn, items: replaceItem(turn.items, { ...item, [field]: value }) }
  }
  if (method === 'turn/completed') turn = { ...turn, ...params.turn, items: (params.turn?.items || []).reduce(replaceItem, turn.items) }
  return existing ? turns.map(entry => entry.id === id ? turn : entry) : [...turns, turn]
}
export function reduceView(turns: DialogTurn[], requests: DialogRequest[], message: DialogEvent) {
  if (message.type === 'event') {
    turns = applyEvent(turns, message)
    if (message.method === 'serverRequest/resolved') requests = requests.filter(r => r.id !== message.params?.requestId)
    if (message.method === 'turn/completed') requests = []
  }
  if (message.type === 'approval' && message.request) requests = [...requests.filter(r => r.id !== message.request!.id), message.request]
  if (message.type === 'approvalResolved') requests = requests.filter(r => r.id !== message.requestId)
  return { turns, requests }
}
export function restoreView(snapshot: DialogSnapshot, queued: DialogEvent[]) {
  let turns = [...snapshot.turns]
  if (snapshot.activeTurn) {
    const active = snapshot.activeTurn
    const index = turns.findIndex(t => t.id === active.id)
    if (index < 0) turns.push(active)
    else turns[index] = { ...turns[index], ...active, items: active.items.length ? active.items : turns[index].items }
  }
  let view = { turns, requests: snapshot.requests || [] }
  for (const message of queued) if (message.seq > snapshot.eventSeq) view = reduceView(view.turns, view.requests, message)
  return view
}
export function finishSend(turns: DialogTurn[], pendingId: string, text: string, response: { turn: DialogTurn }) {
  const existing = turns.find(turn => turn.id === response.turn.id)
  const without = turns.filter(turn => turn.id !== pendingId)
  const optimistic: DialogItem = { id: pendingId, type: 'userMessage', optimistic: true, content: [{ type: 'text', text }] }
  if (existing) return without.map(turn => turn.id === existing.id && !turn.items.some(i => i.type === 'userMessage') ? { ...turn, items: [optimistic, ...turn.items] } : turn)
  const items = response.turn.items || []
  return [...without, { ...response.turn, items: items.some(i => i.type === 'userMessage') ? items : [optimistic, ...items] }]
}
export const userText = (item: DialogItem) => (item.content || []).map(p => p.type === 'text' ? p.text : '[附件]').join('\n')
export const isBusy = (turns: DialogTurn[]) => turns.some(t => ['inProgress', 'waitingOnApproval'].includes(t.status))
