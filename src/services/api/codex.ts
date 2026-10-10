import { invoke } from '@tauri-apps/api/core'

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
  weekly_percentage: number
  weekly_reset_time: number | null
  weekly_window_minutes?: number | null
  reset_credits_available?: number | null
  reset_credits?: CodexResetCredit[] | null
  reset_credits_next_expires_at?: number | null
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

export const codexApi = {
  list: (): Promise<CodexAccount[]> => invoke('list_codex_accounts'),
  current: (): Promise<CodexAccount | null> => invoke('get_current_codex_account'),

  switch: (accountId: string): Promise<CodexAccount> =>
    invoke('switch_codex_account', { accountId, launchAfterSwitch: false }),

  refreshQuota: (accountId: string): Promise<CodexQuota> =>
    invoke('refresh_codex_quota', { accountId }),
  refreshAllQuotas: (accountIds: string[]): Promise<number> =>
    invoke('refresh_codex_quotas_batch', { accountIds, background: true }),
  refreshProfile: (accountId: string): Promise<CodexAccount> =>
    invoke('refresh_codex_account_profile', { accountId }),
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
  removeMany: (accountIds: string[]): Promise<void> =>
    invoke('delete_codex_accounts', { accountIds }),

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

  /** 读 ~/.codex/auth.json 落一条账号，不动官方凭据 */
  importLocal: (): Promise<CodexAccount> => invoke('import_codex_from_local', { instanceId: null }),
  importFiles: (filePath: string[]): Promise<FileImportResult> =>
    invoke('import_codex_from_files', { filePaths: filePath }),
  exportJson: (accountIds: string[]): Promise<string> =>
    invoke('export_codex_accounts', { accountIds }),

  storagePaths: (): Promise<StoragePaths> => invoke('get_codex_storage_paths'),
  openConfigToml: (): Promise<void> => invoke('open_codex_config_toml'),

  /** 官方 config.toml 里生效的 model_provider：官方客户端按它过滤侧栏会话 */
  historyProvider: (): Promise<string> => invoke('get_codex_history_visibility_provider'),
  /** 对默认 profile 做一次 quick 会话可见性修复（改前自动备份官方数据） */
  repairSessionVisibility: (): Promise<SessionVisibilityRepairSummary> =>
    invoke('codex_repair_session_visibility_for_launch_target'),
}
