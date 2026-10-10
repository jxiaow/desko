import { invoke } from '@tauri-apps/api/core'

/** 四态判定：后端 bypass_service::Verdict 的 as_str() 与此一一对应 */
export type Verdict = 'directOk' | 'hostsOnly' | 'needRoute' | 'unreachable' | 'egressUnknown'

export interface Egress {
  ifIndex: number
  interface: string
  source: string
  nextHop: string
  /** 出口源地址落在 fake-IP 段：这块卡就是当前的接管方 */
  isTaker: boolean
}

export interface Target {
  kind: 'domain' | 'ip' | 'cidr'
  host: string
  port: number
  path: string
  scheme: string
}

export interface ProbeReport {
  input: string
  target: Target
  /** hosts 直连管理区里已经固定的地址 */
  pinned: string | null
  localAnswers: string[]
  hijacked: boolean
  realIps: string[]
  /** 带 CNAME 或多 A 记录＝CDN 轮换特征，固定后会锁在会失效的节点上 */
  cdnLike: boolean
  chosen: string | null
  httpStatus: number | null
  probeMs: number | null
  egress: Egress | null
  verdict: Verdict
  recommend: boolean
  stale: boolean
  headline: string
  detail: string
  pending: string[]
}

export interface BypassTarget {
  id: string
  host: string
  /** 当初粘进来的原文，重探按它解回端口/路径/掩码 */
  input: string
  kind: string
  port: number
  path: string
  scheme: string
  address: string
  interfaceName: string
  nextHop: string
  verdict: string
  stale: boolean
  note: string
  createdAt: number
  updatedAt: number
  checkedAt: number
}

/** 页面顶部小账 */
export interface BypassStatus {
  /** hosts 直连托管区里已固定的域名条数；托管区读不出来时为 0，原因看 hostsError */
  managedHosts: number
  hostsError: string
  total: number
  /** 判定要写系统的条数（缺 DNS 固定 / 缺路由） */
  pending: number
  stale: number
}

export const bypassApi = {
  /** 只探不写：结论弹窗用 */
  probe: (input: string): Promise<ProbeReport> => invoke('bypass_probe', { input }),
  /** 把探过的目标加入清单：命中后端缓存，不再跑第二遍网络 */
  save: (input: string): Promise<ProbeReport> => invoke('bypass_save', { input }),
  list: (): Promise<BypassTarget[]> => invoke('bypass_list'),
  status: (): Promise<BypassStatus> => invoke('bypass_status'),
  recheck: (id: string): Promise<ProbeReport> => invoke('bypass_recheck', { id }),
  /** 改这条的原文，按新原文重探并覆盖回原行 */
  edit: (id: string, input: string): Promise<ProbeReport> => invoke('bypass_edit', { id, input }),
  remove: (id: string): Promise<void> => invoke('bypass_delete', { id }),
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  directOk: '直连可用',
  hostsOnly: '仅缺 DNS 固定',
  needRoute: '缺少路由',
  unreachable: '目标不可达',
  egressUnknown: '出口未确定',
}
