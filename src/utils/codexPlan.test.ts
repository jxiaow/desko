import { describe, expect, it } from 'vitest'
import type { CodexAccount } from '../services/api/codex'
import { codexPlan } from './codexPlan'

const account = (fields: Partial<CodexAccount>): CodexAccount => ({
  id: 'fixture', email: 'plan@example.invalid', auth_mode: 'oauth', created_at: 0, last_used: 0, ...fields,
})

describe('会员标识', () => {
  it.each(['free', 'go', 'plus', 'team', 'business', 'enterprise', 'edu'])('区分 %s 的名称和样式', plan_type => {
    expect(codexPlan(account({ plan_type }))).toMatchObject({ label: plan_type.toUpperCase(), kind: plan_type })
  })
  it.each([['prolite', 'PRO 100', 'pro-lite'], ['pro', 'PRO 200', 'pro'], ['promax', 'PRO 500', 'pro-max'], ['pro-5x', 'PRO 100', 'pro-lite']])('识别 Pro 子档位 %s', (plan_type, label, kind) => {
    expect(codexPlan(account({ plan_type }))).toMatchObject({ label, kind })
  })
  it('官方订阅优先于历史文件名，空白值回退而未知类型保留原名', () => {
    expect(codexPlan(account({ plan_type: 'team', auth_file_plan_type: 'plus' })).label).toBe('TEAM')
    expect(codexPlan(account({ plan_type: ' ', auth_file_plan_type: 'plus' })).label).toBe('PLUS')
    expect(codexPlan(account({ plan_type: 'custom' }))).toMatchObject({ label: 'CUSTOM', kind: 'unknown' })
    expect(codexPlan(account({})).label).toBe('未识别')
  })
  it('兼容旧 Pro 文件名提示，官方 usage 可以识别新的 Pro 500', () => {
    expect(codexPlan(account({ auth_file_plan_type: 'promax' })).label).toBe('PRO 200')
    expect(codexPlan(account({ plan_type: 'pro', auth_file_plan_type: 'promax' })).label).toBe('PRO 200')
    expect(codexPlan(account({ plan_type: 'pro', auth_file_plan_type: 'prolite' })).label).toBe('PRO 100')
    expect(codexPlan(account({ plan_type: 'pro', quota: { hourly_percentage: 100, hourly_reset_time: null, weekly_percentage: 100, weekly_reset_time: null, raw_data: { plan_type: 'promax' } } })).label).toBe('PRO 500')
  })
  it('API Key 不会因历史套餐字段而冒充会员', () => {
    expect(codexPlan(account({ auth_mode: 'apikey', plan_type: 'pro' }))).toMatchObject({ label: 'API Key', kind: 'api' })
  })
})
