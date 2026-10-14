import { describe, expect, it } from 'vitest'
import type { CodexAccount } from '../services/api/codex'
import { filterCodexAccounts, type CodexAccountFilters } from './codexAccounts'

const account = (id: string, fields: Partial<CodexAccount> = {}): CodexAccount => ({
  id, email: `${id}@example.com`, auth_mode: 'oauth', created_at: 0, last_used: 0, ...fields,
})
const defaults: CodexAccountFilters = { query: '', auth: 'all', status: 'all', tag: '', sort: 'default' }
const filter = (accounts: CodexAccount[], fields: Partial<CodexAccountFilters>) =>
  filterCodexAccounts(accounts, { ...defaults, ...fields }).map(a => a.id)
const quota = (hourly: number, weekly: number) => ({
  hourly_percentage: hourly, weekly_percentage: weekly, hourly_reset_time: null, weekly_reset_time: null,
})

describe('Codex 账号筛选', () => {
  it('显示名称不能遮住邮箱搜索，多个词可以跨邮箱、备注和标签匹配', () => {
    const accounts = [account('main', { account_name: '主力', account_note: '工作项目', tags: ['团队'], plan_type: 'free', auth_file_plan_type: 'plus' }), account('other')]
    expect(filter(accounts, { query: ' MAIN@ 工作 团队 ' })).toEqual(['main'])
    expect(filter(accounts, { query: 'main 不存在' })).toEqual([])
    expect(filter(accounts, { query: 'PLUS' })).toEqual(['main'])
  })

  it('类型、状态与标签叠加，标签按完整值匹配', () => {
    const accounts = [account('a', { requires_reauth: true, tags: ['工作'] }), account('b', { tags: ['工作室'] }),
      account('key', { auth_mode: 'apikey', requires_reauth: true, tags: ['工作'] })]
    expect(filter(accounts, { auth: 'oauth', status: 'attention', tag: '工作' })).toEqual(['a'])
  })

  it('无配额账号不会被当成低配额，任一窗口低于或等于 20% 都需要显示', () => {
    const accounts = [account('missing'), account('low', { quota: quota(90, 20) }), account('ready', { quota: quota(21, 90) })]
    expect(filter(accounts, { status: 'low' })).toEqual(['low'])
  })

  it('到期筛选兼容秒与 ISO 字符串，API Key 不按订阅时间判断', () => {
    const accounts = [account('seconds', { subscription_active_until: '1' }), account('iso', { subscription_active_until: '2000-01-01T00:00:00Z' }),
      account('bad', { subscription_active_until: 'unknown' }), account('key', { auth_mode: 'apikey', subscription_active_until: '1' })]
    expect(filter(accounts, { status: 'expired' })).toEqual(['seconds', 'iso'])
  })

  it('可用配额优先按更紧的窗口比较，无配额排后，原账号顺序不被改写', () => {
    const accounts = [account('missing'), account('low', { quota: quota(90, 10) }), account('ready', { quota: quota(60, 80) })]
    expect(filter(accounts, { sort: 'quota' })).toEqual(['ready', 'low', 'missing'])
    expect(accounts.map(a => a.id)).toEqual(['missing', 'low', 'ready'])
    expect(filter(accounts, {})).toEqual(['missing', 'low', 'ready'])
  })
})
