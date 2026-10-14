import { needsApply, VERDICT_LABEL, type BypassTarget, type Verdict } from '../../services/api/bypass'

/** 页面分区：需检查（异常）→ 待配置（还没写系统）→ 直连可用（收 chip） */
export type Zone = 'check' | 'write' | 'ok'

export function zoneOf(t: BypassTarget): Zone {
  if (t.applyState === 'failed' || t.stale || t.verdict === 'unreachable' || t.verdict === 'egressUnknown') return 'check'
  return needsApply(t) ? 'write' : 'ok'
}

export type RowFlag = { label: string; cls: string; tip: string }

export function flagsOf(t: BypassTarget): RowFlag[] {
  const flags: RowFlag[] = []
  if (t.applyState === 'failed') flags.push({ label: '需检查', cls: 'warn', tip: '上次配置未完成，或配置后的连接检查未通过。请重新探测查看原因' })
  if (t.stale) flags.push({ label: '固定地址不可用', cls: 'warn', tip: 'hosts 固定地址不在本次 DNS 答案中，且当前无法连接' })
  if (t.cdnLike) flags.push({ label: '地址可能变化', cls: 'off', tip: 'DNS 包含别名或多个地址，固定后可能需要更新 hosts' })
  if (t.applyState === 'applied') flags.push({ label: '已配置', cls: 'ok', tip: 'hosts 或系统路由配置已通过校验' })
  return flags
}

/** 判定档只有三张脸：直连已可用（绿）、还差一步（警）、根本连不上（红） */
export const verdictClass = (v: string) => (v === 'directOk' ? 'ok' : v === 'unreachable' ? 'bad' : 'warn')

export const verdictLabel = (v: string) => VERDICT_LABEL[v as Verdict] ?? v

export function hostOf(t: BypassTarget) {
  if (t.kind !== 'domain' || !t.input) return t.host
  const authority = t.input.match(/^https?:\/\/([^/?#]+)/i)?.[1] ?? t.input
  return /:\d+$/.test(authority) ? `${t.host}:${t.port}` : t.host
}

/** 卡面次行那句结论：存的是判定的 headline，换个说法再念一遍等于没说话 */
export function faceNote(t: BypassTarget) {
  const note = t.note
  if (!note) return ''
  const label = verdictLabel(t.verdict)
  if (note === label || note.startsWith(label)) return ''
  // 这两档 badge 本身就是结论，headline 只是它的另一种写法
  if (t.verdict === 'directOk' || t.verdict === 'egressUnknown') return ''
  return note
}

/** 展开只念库里存的那句结论，不再跑一次网络；要新结论走卡面的重新探测 */
export function rowNote(t: BypassTarget) {
  const head = faceNote(t)
  let rest = ''
  if (t.applyState === 'failed') {
    rest = '上次配置或连接检查未通过，请重新探测查看原因。'
  } else if (t.verdict === 'hostsOnly' || t.verdict === 'needRoute') {
    // 写过的行不能再念「需要写入」：那条判定已被这一批落盘了
    rest = t.applyState === 'applied' ? 'hosts 或系统路由已配置。' : '需要配置 hosts 或系统路由，请使用清单上方的「配置直连」。'
  }
  if (!rest) return head
  return head ? `${head}。${rest}` : rest
}

export const fmtTime = (ms: number) => (ms ? new Date(ms).toLocaleString() : '—')

/** 面上只放得起「月/日 时:分」，完整时间留在 title 上 */
export function clockOf(ms: number) {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
