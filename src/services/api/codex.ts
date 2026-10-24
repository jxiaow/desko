import { invoke } from '../transport'

/** 主动重置次数里的单条记录；status 后端已小写化，缺省时得自己看 expires_at */
export interface CodexResetCredit {
  id?: string | null
  status?: string | null
  reset_type?: string | null
  granted_at?: number | null
  expires_at?: number | null
  redeemed_at?: number | null
  raw_status?: string | null
}

/** get_codex_reset_credits 的整份快照 */
export interface CodexResetCreditsSnapshot {
  available_count?: number | null
  credits: CodexResetCredit[]
  next_expires_at?: number | null
}

/** 后端模型逐字节取自上游 cockpit-tools，序列化保持 snake_case，这里照抄字段名 */
export interface CodexQuota {
  hourly_percentage: number
  hourly_reset_time: number | null
  hourly_window_minutes?: number | null
  hourly_window_present?: boolean | null
  weekly_percentage: number
  weekly_reset_time: number | null
  weekly_window_minutes?: number | null
  weekly_window_present?: boolean | null
  reset_credits_available?: number | null
  reset_credits?: CodexResetCredit[] | null
  reset_credits_next_expires_at?: number | null
  /** 官方 usage 响应；包含 Credits 和模型专属额度，读取时须校验形状。 */
  raw_data?: unknown
}

export interface CodexAccount {
  id: string
  email: string
  auth_mode: 'oauth' | 'apikey'
  account_name?: string | null
  account_note?: string | null
  tags?: string[] | null
  plan_type?: string | null
  auth_file_plan_type?: string | null
  account_id?: string | null
  user_id?: string | null
  organization_id?: string | null
  /** personal / team 之类，行内「Team Name」事实行的兜底依据 */
  account_structure?: string | null
  /** ISO 串或 unix 秒的字符串，两种都可能，解析见 CodexModule 的 parseWhen */
  subscription_active_until?: string | null
  api_provider_name?: string | null
  api_base_url?: string | null
  requires_reauth?: boolean
  /** 为什么登不上：切号失败时后端把上游报错原样写进来（codex_account_runtime_switch.rs:129），只挂在徽标 title 上 */
  reauth_reason?: string | null
  authorization_status?: string | null
  quota?: CodexQuota | null
  quota_error?: { code?: string; message: string; timestamp: number } | null
  usage_updated_at?: number | null
  token_updated_at?: number | null
  /** 只为解 id_token 的 auth_provider（「使用 X 登录」），不落地任何凭据 */
  tokens?: { id_token?: string | null } | null
  created_at: number
  last_used: number
}

/** 登录相关的应答结构体带 rename_all = "camelCase"，与账号模型不同 */
export interface OAuthLoginStart {
  loginId: string
  authUrl: string
}

export interface DeviceAuthStart {
  loginId: string
  userCode: string
  verificationUrl: string
  pollIntervalSeconds: number
}

export interface StoragePaths {
  providerStorePath: string
  configPath: string
  authPath: string
}

export interface CodexSwitchPolicy { restartWindows: boolean; applyToWsl: boolean }
export interface CodexClientCounts { appCount: number; cliCount: number }
export interface CodexClientOutcome {
  closedApp: number; closedCli: number; reopenedApp: number; reopenedCli: number
  reopenFailures: number; reopenPlanId?: string
}
export interface CodexWslTarget { distro: string; user: string }
export interface CodexWslAssignment {
  targets: CodexWslTarget[]; current: { id?: string | null; email: string } | null
  consistent: boolean; error?: string
}
export interface CodexWslAssignmentPreview extends CodexWslAssignment {
  daemonCount: number; cliCount: number; alreadyAssigned: boolean; canApply: boolean
}
export interface CodexSwitchPreview {
  windows: CodexClientCounts; wsl: CodexWslAssignmentPreview | null
  windowsError?: string; wslError?: string
}
export interface CodexWslOutcome {
  status: 'skipped' | 'done' | 'partial' | 'aborted'; targets: number; written: number
  daemonsStopped: number; clisStopped: number
  failures: { distro: string; user: string; message: string }[]
}
export interface CodexSwitchOutcome {
  account: CodexAccount; windows: CodexClientOutcome; wsl: CodexWslOutcome | null; warnings?: string[]
}

/** 会话可见性修复账本（后端带 rename_all = "camelCase"），只取界面要播报的几项 */
export interface SessionVisibilityRepairSummary {
  mutatedInstanceCount: number
  updatedSqliteRowCount: number
  changedRolloutFileCount: number
  skippedSqliteFileCount: number
  message: string
}

export interface FileImportResult {
  imported: CodexAccount[]
  failed: { email: string; error: string }[]
}

/** 会话属于哪个 Codex 实例。desko 只有官方默认目录一份，running 恒 false（进程探针是桩） */
export interface CodexSessionLocation {
  instanceId: string
  instanceName: string
  running: boolean
}

/** codex_list_sessions_across_instances 的单条（后端 rename_all = "camelCase"） */
export interface CodexSessionRecord {
  sessionId: string
  title: string
  cwd: string
  /** 官方客户端的项目名，缺失时前端回退到目录名 */
  projectName?: string | null
  /** unix 秒 */
  updatedAt?: number | null
  locationCount: number
  locations: CodexSessionLocation[]
  /** conversation / external / subagent，非 conversation 时行上加徽标 */
  sessionKind: string
}

/** 每会话的官方累计 Token、请求数与估算金额；进「会话」档一次全量预取。 */
export interface CodexSessionTokenStats {
  sessionId: string
  /** 每轮重发的上下文累计，含缓存命中，不等于真实计费输入 */
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /** 其中命中缓存的部分；净输入 = inputTokens - cachedInputTokens */
  cachedInputTokens: number
  cacheWriteInputTokens: number
  /** 含在 outputTokens 里的那部分推理输出 */
  reasoningOutputTokens: number
  requestCount: number
  /** 模型标准 API 单价估算（美元）；包含未定价模型时为 null。 */
  estimatedCostUsd: number | null
}

/** 用量桶：本地日（key = YYYY-MM-DD）、小时（key = Unix 秒）或模型。 */
export interface CodexUsageBucket {
  key: string
  label: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  totalTokens: number
  requestCount: number
  estimatedCostUsd: number | null
}

/** 某模型在当前时间窗口内的会话用量；key 为会话 ID，label 为会话标题。 */
export interface CodexUsageSession extends CodexUsageBucket {
  cwd: string
  lastUsedAt: number
}

/** 窗口内的总量；Token、请求数与估算金额与会话统计同源。 */
export interface CodexUsageTotals {
  inputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
  requestCount: number
  sessionCount: number
  fileCount: number
  estimatedCostUsd: number | null
}

/** codex_query_session_usage 的返回（上游同名命令，desko 现扫现算、不建 sqlite 表） */
export interface CodexSessionUsageReport {
  totals: CodexUsageTotals
  byDay: CodexUsageBucket[]
  /** 小时桶：key 为起点的 Unix 秒，label 为本地 HH:mm。 */
  byHour: CodexUsageBucket[]
  byModel: CodexUsageBucket[]
  modelSessions: Record<string, CodexUsageSession[]>
  fromTimestamp?: number | null
  toTimestamp?: number | null
  scanMillis: number
  /** 同一次目录扫描、同一截止时间下的其他统计窗口。子报告不再嵌套。 */
  windows?: Partial<Record<'today' | 'week' | 'month' | 'all', CodexSessionUsageReport>>
}

/** 移进回收站的结果；留底目录住在 desko 自己的数据目录，不在 ~/.codex 里 */
export interface CodexSessionTrashSummary {
  requestedSessionCount: number
  trashedSessionCount: number
  trashedInstanceCount: number
  trashDirs: string[]
  message: string
}

/** codex_list_trashed_sessions_across_instances 的单条 */
export interface CodexTrashedSessionRecord {
  sessionId: string
  title: string
  cwd: string
  /** unix 秒（清单里的 RFC3339 由后端换算） */
  deletedAt?: number | null
  sizeBytes: number
  locationCount: number
  locations: Array<{ instanceId: string; instanceName: string }>
}

/** 账号留底摘要：列目录不解密，所以只有这几样够认出一个号 */
export interface CodexRecycledAccount {
  id: string
  account_id: string
  email: string
  account_name?: string | null
  plan_type?: string | null
  /** unix 秒 */
  deleted_at: number
}

/** 后端逐条攒的失败明细，只带 accountId——邮箱得前端起作业时自己抄 */
export interface CodexBatchDeleteError {
  accountId: string
  error: string
}

/**
 * 批量删除作业快照。`completed` 是「已处理」计数：失败的那条也会 +1，
 * 所以别把它读成「已删除 X 条」，删除数以 total - failed 算。
 */
export interface CodexBatchDeleteJobStatus {
  jobId: string
  status: 'running' | 'paused' | 'completed' | 'failed'
  total: number
  completed: number
  failed: number
  errors: CodexBatchDeleteError[]
}

export interface CodexSessionRestoreSummary {
  requestedSessionCount: number
  restoredSessionCount: number
  restoredInstanceCount: number
  message: string
}

export interface CodexSessionTrashDeleteSummary {
  requestedSessionCount: number
  deletedSessionCount: number
  deletedEntryCount: number
  freedSizeBytes: number
  message: string
}

export const codexApi = {
  list: (): Promise<CodexAccount[]> => invoke('list_codex_accounts'),
  current: (): Promise<CodexAccount | null> => invoke('get_current_codex_account'),

  switchCodexAccount: (accountId: string, clientPolicy: CodexSwitchPolicy): Promise<CodexSwitchOutcome> =>
    invoke('switch_codex_account', { accountId, clientPolicy }),
  previewCodexSwitch: (accountId: string): Promise<CodexSwitchPreview> => invoke('preview_codex_switch', { accountId }),
  getCodexWslAssignment: (): Promise<CodexWslAssignment> => invoke('get_codex_wsl_assignment'),
  previewCodexWslAssignment: (accountId: string): Promise<CodexWslAssignmentPreview> => invoke('preview_codex_wsl_assignment', { accountId }),
  assignCodexAccountToWsl: (accountId: string): Promise<CodexWslOutcome> => invoke('assign_codex_account_to_wsl', { accountId }),
  relaunchCodexClients: (planId: string): Promise<CodexClientOutcome> => invoke('relaunch_codex_clients', { planId }),

  refreshQuota: (accountId: string): Promise<CodexQuota> =>
    invoke('refresh_codex_quota', { accountId }),
  refreshAllQuotas: (accountIds: string[]): Promise<number> =>
    invoke('refresh_codex_quotas_batch', { accountIds, background: true }),
  refreshProfile: (accountId: string): Promise<CodexAccount> =>
    invoke('refresh_codex_account_profile', { accountId }),
  /** 订阅档位与到期时间的权威刷新；后端对 API Key 账号直接拒，所以只有 OAuth 行走这条 */
  refreshSubscription: (accountId: string): Promise<CodexAccount> =>
    invoke('refresh_codex_subscription_info', { accountId }),
  forceRefreshTokens: (accountId: string): Promise<CodexAccount> =>
    invoke('force_refresh_codex_tokens', { accountId }),

  consumeResetCredit: (accountId: string): Promise<void> =>
    invoke('consume_codex_reset_credit', { accountId }),

  /** 次数明细：确认弹窗打开时拉一次，含 可用/已使用/已过期 的逐条记录 */
  resetCredits: (accountId: string): Promise<CodexResetCreditsSnapshot> =>
    invoke('get_codex_reset_credits', { accountId }),

  setName: (accountId: string, name: string): Promise<CodexAccount> =>
    invoke('update_codex_account_name', { accountId, name }),
  setNote: (accountId: string, note: string): Promise<CodexAccount> =>
    invoke('update_codex_account_note', { accountId, note }),
  setTags: (accountId: string, tags: string[]): Promise<CodexAccount> =>
    invoke('update_codex_account_tags', { accountId, tags }),

  remove: (accountId: string): Promise<void> => invoke('delete_codex_account', { accountId }),

  /**
   * 批量删除作业：后端逐条走 remove_account，所以删掉的每一条都会在账号留底里（10 号稿 §2）。
   * 这一族没有事件，进度只能轮询 get；start 拿到空选择时返回 `jobId: ''`，别拿它去轮询。
   */
  startBatchDelete: (accountIds: string[]): Promise<CodexBatchDeleteJobStatus> =>
    invoke('start_codex_batch_delete', { accountIds }),
  getBatchDelete: (jobId: string): Promise<CodexBatchDeleteJobStatus> =>
    invoke('get_codex_batch_delete', { jobId }),
  /** 暂停只拦下一条：正在删的那条会跑完 */
  pauseBatchDelete: (jobId: string): Promise<CodexBatchDeleteJobStatus> =>
    invoke('pause_codex_batch_delete', { jobId }),
  /** 后端对已完成 / 失败的任务续跑是 no-op（原样返回状态），前端不用防重复点 */
  resumeBatchDelete: (jobId: string): Promise<CodexBatchDeleteJobStatus> =>
    invoke('resume_codex_batch_delete', { jobId }),
  /** 重试会把任务换成失败那批并清空上一轮 errors，明细得前端自己留 */
  retryFailedBatchDelete: (jobId: string): Promise<CodexBatchDeleteJobStatus> =>
    invoke('retry_failed_codex_batch_delete', { jobId }),
  /** 清任务只摘状态与盘快照，已删掉的账号不会回来（它们在留底里） */
  clearBatchDelete: (jobId: string): Promise<void> =>
    invoke('clear_codex_batch_delete', { jobId }),

  /**
   * 账号留底：删除时后端已把整条账号加密存进 desko 数据目录，这里只把它读回来。
   * 键名保持后端结构体的 snake_case——同一结构体也是磁盘落盘格式，改驼峰会让旧留底读不出。
   * 上游那条 export_codex_recycled_accounts（明文落盘）经裁定不接。
   */
  listRecycled: (): Promise<CodexRecycledAccount[]> => invoke('list_codex_recycled_accounts'),
  restoreRecycled: (recycleId: string): Promise<void> =>
    invoke('restore_codex_recycled_account', { recycleId }),
  deleteRecycled: (recycleId: string): Promise<void> =>
    invoke('delete_codex_recycled_account', { recycleId }),
  /** 清空只删「刚看到的那批 id」，不扫目录一把清 */
  emptyRecycled: (recycleIds: string[]): Promise<void> =>
    invoke('empty_codex_recycle_bin', { recycleIds }),

  /** 授权码流程：后端起本地回调服务并给出 auth_url，回跳地址由用户从浏览器复制回来 */
  oauthStart: (reauthAccountId?: string): Promise<OAuthLoginStart> =>
    invoke('codex_oauth_login_start', { reauthAccountId: reauthAccountId ?? null }),
  oauthCompleted: (loginId: string, reauthAccountId?: string): Promise<CodexAccount> =>
    invoke('codex_oauth_login_completed', { loginId, reauthAccountId: reauthAccountId ?? null }),
  oauthCancel: (loginId: string): Promise<void> => invoke('codex_oauth_login_cancel', { loginId }),
  oauthSubmitCallbackUrl: (loginId: string, callbackUrl: string): Promise<void> =>
    invoke('codex_oauth_submit_callback_url', { loginId, callbackUrl }),
  deviceAuthStart: (): Promise<DeviceAuthStart> => invoke('codex_oauth_device_auth_start'),
  oauthPortInUse: (): Promise<boolean> => invoke('is_codex_oauth_port_in_use'),

  addApiKey: (apiKey: string, apiBaseUrl?: string): Promise<CodexAccount> =>
    invoke('add_codex_account_with_api_key', {
      apiKey,
      apiBaseUrl: apiBaseUrl && apiBaseUrl.trim() ? apiBaseUrl.trim() : null,
    }),
  importAccessToken: (name: string, accessToken: string): Promise<CodexAccount> =>
    invoke('import_codex_access_token_account', { name, accessToken }),
  addTokens: (idToken: string, accessToken: string, refreshToken?: string): Promise<CodexAccount> =>
    invoke('add_codex_account_with_token', { idToken, accessToken, refreshToken: refreshToken?.trim() || null }),
  /** 改已入库 API Key 账号的凭据；后端其余参数都是 Option，留空即不动 */
  updateApiKey: (accountId: string, apiKey: string, apiBaseUrl?: string): Promise<CodexAccount> =>
    invoke('update_codex_api_key_credentials', {
      accountId,
      apiKey,
      apiBaseUrl: apiBaseUrl && apiBaseUrl.trim() ? apiBaseUrl.trim() : null,
    }),

  /** 读 ~/.codex/auth.json 落一条账号，不动官方凭据 */
  importLocal: (): Promise<CodexAccount> => invoke('import_codex_from_local', { instanceId: null }),
  importFiles: (filePath: string[]): Promise<FileImportResult> =>
    invoke('import_codex_from_files', { filePaths: filePath }),
  /** 粘贴导出的 JSON 文本（一条或数组），与选文件同一条落库路径 */
  importJson: (jsonContent: string): Promise<CodexAccount[]> =>
    invoke('import_codex_from_json', { jsonContent }),
  exportJson: (accountIds: string[]): Promise<string> =>
    invoke('export_codex_accounts', { accountIds }),

  storagePaths: (): Promise<StoragePaths> => invoke('get_codex_storage_paths'),
  openConfigToml: (): Promise<void> => invoke('open_codex_config_toml'),

  /** 官方 config.toml 里生效的 model_provider：官方客户端按它过滤侧栏会话 */
  historyProvider: (): Promise<string> => invoke('get_codex_history_visibility_provider'),
  /** 对默认 profile 做一次 quick 会话可见性修复（改前自动备份官方数据） */
  repairSessionVisibility: (): Promise<SessionVisibilityRepairSummary> =>
    invoke('codex_repair_session_visibility_for_launch_target'),

  /** 官方目录里的会话列表；标题和正文各走上游已有的本地搜索路径。 */
  listSessions: (titleQuery?: string, contentQuery?: string): Promise<CodexSessionRecord[]> =>
    invoke('codex_list_sessions_across_instances', {
      titleQuery: titleQuery && titleQuery.trim() ? titleQuery.trim() : null,
      contentQuery: contentQuery?.trim() || null,
    }),
  sessionTokenStats: (sessionIds: string[]): Promise<CodexSessionTokenStats[]> =>
    invoke('codex_get_session_token_stats_across_instances', { sessionIds }),

  /** 用量图：按本地日与模型聚合的逐轮增量；窗口留空即全量 */
  querySessionUsage: (
    fromTimestamp: number | null,
    toTimestamp: number | null,
    windows?: Record<string, number | null>,
  ): Promise<CodexSessionUsageReport> =>
    invoke('codex_query_session_usage', { fromTimestamp, toTimestamp, ...(windows ? { windows } : {}) }),

  /** 移进回收站：先留底进 desko 数据目录，再从官方会话目录删文件并重写索引 */
  moveToTrash: (sessionIds: string[]): Promise<CodexSessionTrashSummary> =>
    invoke('codex_move_sessions_to_trash_across_instances', { sessionIds }),
  listTrash: (): Promise<CodexTrashedSessionRecord[]> =>
    invoke('codex_list_trashed_sessions_across_instances'),
  restoreFromTrash: (sessionIds: string[]): Promise<CodexSessionRestoreSummary> =>
    invoke('codex_restore_sessions_from_trash_across_instances', { sessionIds }),
  /** 永久删除留底（官方目录此时已经不含这条会话） */
  deleteFromTrash: (sessionIds: string[]): Promise<CodexSessionTrashDeleteSummary> =>
    invoke('codex_delete_trashed_sessions_across_instances', { sessionIds }),
  emptyTrash: (): Promise<CodexSessionTrashDeleteSummary> =>
    invoke('codex_empty_session_trash_across_instances'),
  openSessionLocation: (sessionId: string): Promise<void> =>
    invoke('codex_open_session_location', { sessionId }),
  openSessionRollout: (sessionId: string): Promise<void> =>
    invoke('codex_open_session_rollout', { sessionId }),
}
