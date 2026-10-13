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
  /** 真址带 CNAME 或多 A 轮换：钉死等于锁在一个会失效的节点上 */
  cdnLike: boolean
  note: string
  /** 上次落盘结果：none / applied / failed */
  applyState: 'none' | 'applied' | 'failed' | string
  /** 落盘批次 id，撤销靠它找回回滚点 */
  applyBatch: string
  createdAt: number
  updatedAt: number
  checkedAt: number
}

/** 确认弹窗里的一条：这条将往系统里写什么，或为什么写不了 */
export interface PlannedRow {
  id: string
  label: string
  /** 空 = 这条没有要写的东西 */
  action: string
  /** 非空 = 这条自动判定不了，不进批次 */
  blocked: string
}

export interface ApplyPlan {
  rows: PlannedRow[]
  /** 可以进批次的条目数 */
  ready: number
  blocked: number
}

/** helper 回传的逐条落盘结果 */
export interface ApplyItem {
  id: string
  op: 'pin' | 'route' | string
  ok: boolean
  /** false = 系统里本来就对，这条没动过 */
  changed: boolean
  error: string
}

export interface ApplyOutcome {
  batchId: string
  /** UAC 上按了取消：不算失败，清单与批次都不动 */
  cancelled: boolean
  rolledBack: boolean
  items: ApplyItem[]
  /** 整批层面的问题：helper 没跑起来、没回传、或回滚本身失败 */
  error: string
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
  /** 落盘计划：逐条列出要往系统里写什么，只读路由表，不提权。allowCdn = 用户坚持要钉的 CDN 条目 */
  plan: (allowCdn: string[]): Promise<ApplyPlan> => invoke('bypass_plan', { allowCdn }),
  /** 一批落盘：一批共用一次 UAC */
  apply: (allowCdn: string[]): Promise<ApplyOutcome> => invoke('bypass_apply', { allowCdn }),
  /** 按回滚点撤销一批 */
  revert: (batch: string): Promise<ApplyOutcome> => invoke('bypass_revert', { batch }),
  /** 有回滚点时回批次 id，没有回空串 */
  rollbackBatch: (): Promise<string> => invoke('bypass_rollback_exists'),
}

/** 这条还需不需要往系统里写。与后端 needs_apply 同判据，两处不许各算各的 */
export const needsApply = (t: BypassTarget) =>
  (t.verdict === 'hostsOnly' || t.verdict === 'needRoute') && t.applyState !== 'applied'

/** 这条会不会真的进落盘批次：CDN 轮换的域名默认不钉，除非在确认弹窗里显式坚持 */
export const inApplyBatch = (t: BypassTarget) => needsApply(t) && !t.cdnLike

export const VERDICT_LABEL: Record<Verdict, string> = {
  directOk: '直连可用',
  hostsOnly: '仅缺 DNS 固定',
  needRoute: '缺少路由',
  unreachable: '目标不可达',
  egressUnknown: '出口未确定',
}
