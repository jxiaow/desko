import { describe, expect, it } from 'vitest'
import type { CodexAccount, CodexQuota } from '../services/api/codex'
import { codexAdditionalQuotaWindows, codexCredits, codexQuotaRemaining, codexQuotaWindowLabel, codexQuotaWindows } from './codexQuota'

const account = (quota: Partial<CodexQuota> = {}, fields: Partial<CodexAccount> = {}): CodexAccount => ({
  id: 'fixture', email: 'quota@example.invalid', auth_mode: 'oauth', created_at: 0, last_used: 0,
  usage_updated_at: 1800000000,
  quota: { hourly_percentage: 75, weekly_percentage: 40, hourly_reset_time: null, weekly_reset_time: null, ...quota }, ...fields,
})

describe('实际额度窗口', () => {
  it.each([[300, '5 小时额度'], [10080, '周额度'], [20160, '2 周额度'], [1440, '1 天额度'], [45, '45 分钟额度']])('使用接口时长 %s 分钟：%s', (minutes, label) => {
    expect(codexQuotaWindowLabel(Number(minutes), '缺失')).toBe(label)
  })
  it('Free 主窗口为一周时只展示实际存在的一条，不制造 5 小时窗口', () => {
    const free = account({ hourly_window_minutes: 10080, hourly_window_present: true, weekly_window_present: false }, { plan_type: 'free' })
    expect(codexQuotaWindows(free).map(w => [w.label, w.percentage])).toEqual([['周额度', 75]])
    expect(codexQuotaRemaining(free)).toBe(75)
  })
  it('两窗口均不存在时返回空，不把后端兼容占位 100% 当成可用额度', () => {
    const absent = account({ hourly_window_present: false, weekly_window_present: false, hourly_percentage: 100, weekly_percentage: 100 })
    expect(codexQuotaWindows(absent)).toEqual([])
    expect(codexQuotaRemaining(absent)).toBeNull()
  })
  it('缺标记的旧快照从原始响应判断窗口；无元数据旧快照仍兼容双窗口', () => {
    expect(codexQuotaWindows(account({ raw_data: { rate_limit: { primary_window: null, secondary_window: {} } } })).map(w => w.id)).toEqual(['weekly'])
    expect(codexQuotaWindows(account({ raw_data: { rate_limit: null } }))).toEqual([])
    expect(codexQuotaWindows(account())).toHaveLength(2)
  })
  it('次窗口耗尽后主窗口也不可用，提示使用实际周期名称', () => {
    const exhausted = account({ weekly_percentage: 0, weekly_window_minutes: 20160 })
    expect(codexQuotaWindows(exhausted)[0]).toMatchObject({ percentage: 0, blockedBy: '2 周额度' })
    expect(codexQuotaRemaining(exhausted)).toBe(0)
  })
  it('不存在的低数值窗口不参与排序和低额度判断', () => {
    expect(codexQuotaRemaining(account({ hourly_percentage: 0, hourly_window_present: false, weekly_window_present: true }))).toBe(40)
  })
  it('API 余额只展示服务额度，待授权账号不展示占位额度', () => {
    expect(codexQuotaWindows(account({}, { auth_mode: 'apikey' })).map(w => w.label)).toEqual(['服务额度'])
    const pending = account({ raw_data: { credits: { balance: 10 } } }, { authorization_status: ' Pending ' })
    expect(codexQuotaWindows(pending)).toEqual([])
    expect(codexQuotaRemaining(pending)).toBeNull()
  })
  it('校验百分比并将异常数值限制在 0–100；非数值不制造进度', () => {
    expect(codexQuotaWindows(account({ hourly_percentage: 125, weekly_percentage: -10 })).map(w => w.percentage)).toEqual([0, 0])
    expect(codexQuotaWindows(account({ hourly_percentage: NaN, weekly_window_present: false, hourly_window_present: true }))).toEqual([])
  })
})

describe('Credits 与模型额度', () => {
  it('Business 月额度读取实际总量、余量和百分比，包括已耗尽的零余额', () => {
    const business = account({ hourly_window_present: false, weekly_window_present: false, raw_data: {
      spend_control: { individual_limit: { limit: '25000', used: '8000', remaining: '17000', remaining_percent: 68, reset_at: 1801000000 } },
    } }, { plan_type: 'business' })
    expect(codexCredits(business)).toEqual({ remaining: 17000, total: 25000, percentage: 68, resetTime: 1801000000, monthly: true, unlimited: false })
    expect(codexQuotaRemaining(business)).toBe(68)
    business.quota!.raw_data = { spend_control: { individual_limit: { limit: 25000, remaining: 0 } } }
    expect(codexCredits(business)?.remaining).toBe(0)
    expect(codexQuotaRemaining(business)).toBe(0)
  })
  it('从总量与已用量计算余量；相对重置以快照时间为基准', () => {
    const credits = codexCredits(account({ raw_data: { spend_control: { individual_limit: { limit: 100, used: 25, reset_after_seconds: 3600 } } } }))
    expect(credits).toMatchObject({ remaining: 75, percentage: 75, resetTime: 1800003600 })
  })
  it('仅余额时不虚构总额度和百分比；不限额必须有明确字段', () => {
    expect(codexCredits(account({ raw_data: { credits: { balance: '42' } } }))).toMatchObject({ remaining: 42, total: null, percentage: null, unlimited: false })
    expect(codexCredits(account({ raw_data: { credits: { unlimited: true } } }))?.unlimited).toBe(true)
    expect(codexCredits(account({ raw_data: {} }))).toBeNull()
  })
  it('模型专属窗口按实际已用百分比换算，保留独立周期与重置时间', () => {
    const additional = codexAdditionalQuotaWindows(account({ raw_data: { additional_rate_limits: [{
      limit_name: 'gpt-5.3-codex-spark', rate_limit: {
        primary_window: { used_percent: 35, limit_window_seconds: 18000, reset_after_seconds: 1800 },
        secondary_window: { used_percent: 60, limit_window_seconds: 604800, reset_at: 1801000000 },
      },
    }] } }))
    expect(additional.map(w => [w.label, w.percentage, w.resetTime])).toEqual([
      ['gpt-5.3-codex-spark · 5 小时额度', 65, 1800001800], ['gpt-5.3-codex-spark · 周额度', 40, 1801000000],
    ])
  })
  it('不可信原始响应与非法用量不会产生 Credits 或模型进度', () => {
    for (const raw of [null, [], 'invalid', { credits: { balance: 'invalid', unlimited: 'false' } }, { spend_control: { individual_limit: { limit: -1 } } }]) {
      expect(codexCredits(account({ raw_data: raw }))).toBeNull()
    }
    expect(codexAdditionalQuotaWindows(account({ raw_data: { additional_rate_limits: [null, { rate_limit: { primary_window: { used_percent: 101 } } }] } }))).toEqual([])
  })
})
