import type { CodexAccount } from '../services/api/codex'
import type { IconName } from './icons'

export interface CodexPlan {
  label: string
  kind: string
  icon: IconName
}

const PLANS: Record<string, CodexPlan> = {
  free: { label: 'FREE', kind: 'free', icon: 'user' },
  go: { label: 'GO', kind: 'go', icon: 'arrowRight' },
  plus: { label: 'PLUS', kind: 'plus', icon: 'star' },
  pro: { label: 'PRO 200', kind: 'pro', icon: 'star' },
  team: { label: 'TEAM', kind: 'team', icon: 'folder' },
  business: { label: 'BUSINESS', kind: 'business', icon: 'folder' },
  enterprise: { label: 'ENTERPRISE', kind: 'enterprise', icon: 'shield' },
  edu: { label: 'EDU', kind: 'edu', icon: 'doc' },
}

function proTier(raw: string): 'lite' | 'pro' | 'max' | null {
  const value = raw.toLowerCase().replace(/[_\s]+/g, '-')
  if (['prolite', 'pro-lite', 'pro-5x', 'codex-pro-5x', 'pro-100', 'chatgptprolite'].includes(value)) return 'lite'
  if (['pro', 'pro-20x', 'codex-pro-20x', 'pro-200', 'chatgptpro'].includes(value)) return 'pro'
  if (['promax', 'pro-max', 'pro-500', 'chatgptpromax'].includes(value)) return 'max'
  return null
}

/** 档位以后台的订阅值为准，历史 auth 文件名只在缺失或 Pro Lite 提示时兜底。 */
export function codexPlan(account: CodexAccount): CodexPlan {
  if (account.auth_mode === 'apikey') return { label: 'API Key', kind: 'api', icon: 'code' }
  const raw = account.quota?.raw_data
  const usagePlan = raw && typeof raw === 'object' && 'plan_type' in raw && typeof raw.plan_type === 'string' ? raw.plan_type.trim() : ''
  const officialPlan = account.plan_type?.trim() || usagePlan
  const plan = officialPlan || account.auth_file_plan_type?.trim() || ''
  if (!plan) return { label: '未识别', kind: 'unknown', icon: 'user' }
  let pro = proTier(plan)
  // 旧导入文件名里的 promax 表示 20x，不能当成官方的新 Pro 500。
  if (!officialPlan && pro === 'max') pro = 'pro'
  if (pro === 'pro') {
    pro = proTier(usagePlan) || (proTier(account.auth_file_plan_type?.trim() || '') === 'lite' ? 'lite' : 'pro')
  }
  if (pro === 'lite') return { label: 'PRO 100', kind: 'pro-lite', icon: 'star' }
  if (pro === 'max') return { label: 'PRO 500', kind: 'pro-max', icon: 'star' }
  if (pro === 'pro') return PLANS.pro!
  const key = plan.toLowerCase().replace(/^chatgpt[_-]?/, '')
  return PLANS[key] || { label: plan.toUpperCase(), kind: 'unknown', icon: 'user' }
}
