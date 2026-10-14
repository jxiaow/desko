import { invoke } from '@tauri-apps/api/core'

export interface TunnelBinary {
  expectedVersion: string
  installed: boolean
  path: string | null
  /** 校验留痕在：执行路径每次都会重算哈希，状态路径只读留痕，不再全量洗 55MB */
  verified: boolean
  /** 已落盘产物的哈希短前缀；未校验时回 null */
  actualSha256: string | null
}

/** 浏览器授权时选中的主域名；授权密钥只在后端使用。 */
export interface TunnelDomain {
  name: string
  status: string
}

export interface TunnelStatus {
  /** 本机有没有可启动的隧道（授权与创建完成后的事实） */
  bound: boolean
  /** 子进程句柄还在 */
  alive: boolean
  /** cloudflared 写过 pidfile = 真连上了 Cloudflare 边缘 */
  registered: boolean
  running: boolean
  pid: number | null
  note: string | null
}

/** 授权引导：完成与否不看命令退出码，只看凭据文件到没到 */
export interface TunnelLogin {
  state: 'idle' | 'waiting' | 'authorized' | 'timeout'
  url: string | null
  secondsLeft: number
  /** 授权进程最后说的话：它早退而凭据没落位时，这一句就是原因 */
  note: string | null
}

/** 接入进度：由本机特征推导，每格对应一个下一步动作 */
export interface TunnelProvision {
  step: 'no-binary' | 'not-authorized' | 'no-tunnel' | 'missing-credentials' | 'no-services' | 'not-routed' | 'ready'
  message: string
  tunnelName: string | null
  tunnelId: string | null
  /** 服务表规模：unroutedCount > 0 时出口是「应用」，不是重建隧道 */
  serviceCount: number
  unroutedCount: number
  /** 凭据文件在不在：进度句从最早的空缺说起，这一行只说自己那一格 */
  authorized: boolean
  /** 刚查到的同名隧道不在本机记录里 —— 只有这时才允许「接管」 */
  nameTaken: boolean
}

/** 一条服务：一个公网子域指向本机一个端口 */
export interface TunnelServiceRow {
  id: string
  hostname: string
  port: number
  label: string
  /** fileshare 才给「口令/只读」那套开关；其余条目 desko 不在请求链路上 */
  preset: string
  routed: boolean
  /** 这一刻本机端口在不在听，与登记值无关 */
  listening: boolean
  /** 公网侧设过口令没有：摘要本身不出后端，界面只认这个事实 */
  hasPublicPassword: boolean
  publicReadOnly: boolean
}

/** 同一条隧道多处在跑 = 按地理就近静默劈流，这里给出别处的处数 */
export interface TunnelSplitReport {
  liveCount: number
  externalCount: number
  conflict: boolean
  message: string
}

export const tunnelApi = {
  authorizedDomain: (): Promise<TunnelDomain> => invoke('tunnel_authorized_domain'),
  binaryStatus: (): Promise<TunnelBinary> =>
    invoke('tunnel_binary_status'),
  fetchBinary: (): Promise<TunnelBinary> =>
    invoke('tunnel_fetch_binary'),
  provisionStatus: (): Promise<TunnelProvision> =>
    invoke('tunnel_provision_status'),
  loginStart: (): Promise<TunnelLogin> =>
    invoke('tunnel_login_start'),
  loginStatus: (): Promise<TunnelLogin> =>
    invoke('tunnel_login_status'),
  loginCancel: (): Promise<void> =>
    invoke('tunnel_login_cancel'),
  ensureTunnel: (name: string, adopt = false): Promise<TunnelProvision> =>
    invoke('tunnel_ensure_tunnel', { name, adopt }),
  apply: (): Promise<TunnelProvision> =>
    invoke('tunnel_apply'),
  listServices: (): Promise<TunnelServiceRow[]> =>
    invoke('tunnel_list_services'),
  addService: (input: { hostname: string; port: number; label: string; preset: string }): Promise<TunnelServiceRow[]> =>
    invoke('tunnel_add_service', input),
  updateService: (input: { id: string; hostname: string; port: number; label: string }): Promise<TunnelServiceRow[]> =>
    invoke('tunnel_update_service', input),
  removeService: (id: string): Promise<TunnelServiceRow[]> =>
    invoke('tunnel_remove_service', { id }),
  /** 口令留空 = 不改口令、只动只读位（摘要不回前端，界面上没有"当前口令"可原样提交） */
  setServicePolicy: (input: { id: string; password: string; readOnly: boolean }): Promise<TunnelServiceRow[]> =>
    invoke('tunnel_set_service_policy', input),
  probeConnectors: (): Promise<TunnelSplitReport> =>
    invoke('tunnel_probe_connectors'),
  status: (): Promise<TunnelStatus> =>
    invoke('tunnel_status'),
  start: (): Promise<TunnelStatus> =>
    invoke('tunnel_start'),
  stop: (): Promise<void> =>
    invoke('tunnel_stop'),
  revoke: (): Promise<TunnelProvision> =>
    invoke('tunnel_revoke'),
}
