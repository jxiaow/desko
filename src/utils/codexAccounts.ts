import type { CodexAccount } from '../services/api/codex'
import { codexQuotaRemaining } from './codexQuota'
export { codexQuotaRemaining } from './codexQuota'

export type CodexAccountAuthFilter = 'all' | 'oauth' | 'apikey'
export type CodexAccountStatusFilter = 'all' | 'attention' | 'low' | 'expired'
export type CodexAccountSort = 'default' | 'quota' | 'recent' | 'name'

export interface CodexAccountFilters {
  query: string
  auth: CodexAccountAuthFilter
  status: CodexAccountStatusFilter
  tag: string
  sort: CodexAccountSort
}

export function codexNeedsAttention(account: CodexAccount): boolean {
  return !!account.requires_reauth || !!account.quota_error ||
    (account.authorization_status ?? '').trim().toLowerCase() === 'pending'
}

export function codexSubscriptionExpired(account: CodexAccount, now = Date.now()): boolean {
  if (account.auth_mode === 'apikey') return false
  const raw = account.subscription_active_until?.trim()
  if (!raw) return false
  const at = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw)
  return Number.isFinite(at) && at <= now
}

export function filterCodexAccounts(accounts: CodexAccount[], filters: CodexAccountFilters): CodexAccount[] {
  const words = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const result = accounts.filter(account => {
    if (filters.auth !== 'all' && account.auth_mode !== filters.auth) return false
    if (filters.tag && !account.tags?.includes(filters.tag)) return false
    if (filters.status === 'attention' && !codexNeedsAttention(account)) return false
    if (filters.status === 'expired' && !codexSubscriptionExpired(account)) return false
    const remaining = codexQuotaRemaining(account)
    if (filters.status === 'low' && (remaining === null || remaining > 20)) return false
    const text = [account.email, account.account_name, account.account_note, account.plan_type, account.auth_file_plan_type,
      account.api_provider_name, account.api_base_url, ...(account.tags ?? [])].join(' ').toLowerCase()
    return words.every(word => text.includes(word))
  })
  if (filters.sort === 'quota') result.sort((a, b) => (codexQuotaRemaining(b) ?? -1) - (codexQuotaRemaining(a) ?? -1))
  else if (filters.sort === 'recent') result.sort((a, b) => b.last_used - a.last_used)
  else if (filters.sort === 'name') result.sort((a, b) =>
    (a.account_name || a.email).localeCompare(b.account_name || b.email))
  return result
}
