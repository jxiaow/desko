import { describe, expect, it } from 'vitest'
import type { CodexAccount, CodexQuota } from '../services/api/codex'
import {
  DEFAULT_HUD_SKIN,
  HUD_ALERT_MOVES,
  HUD_DOZE_EVERY,
  HUD_DOZE_GAP_MS,
  HUD_DOZE_MOVE,
  HUD_FIRST_SCENE_MS,
  HUD_LIFE_MOVES,
  HUD_MOVE_MS,
  HUD_SCENE_GAPS_MS,
  buildCodexHudSnapshot,
  formatHudCost,
  hudAriaLabel,
  hudQuotaLabel,
  isHudSkin,
  type CodexHudState,
  type CodexHudSkin,
} from './codexHud'

const account = (quota: Partial<CodexQuota> = {}, fields: Partial<CodexAccount> = {}): CodexAccount => ({
  id: 'fixture',
  email: 'secret@example.invalid',
  auth_mode: 'oauth',
  created_at: 0,
  last_used: 0,
  usage_updated_at: 1_800_000_000,
  quota: {
    hourly_percentage: 68,
    weekly_percentage: 42,
    hourly_reset_time: null,
    weekly_reset_time: null,
    ...quota,
  },
  ...fields,
})

const theme: CodexHudState['theme'] = {
  theme: 'paper',
  base: 'light',
  accent: 'ink',
  atmosphere: false,
}

const snapshot = (accountValue: CodexAccount | null) =>
  buildCodexHudSnapshot({
    account: accountValue,
    skin: 'bunny',
    theme,
    today: { tokens: 1_942_000, costUsd: 12.34 },
  })

describe('挂件生活场景表', () => {
  const skins: CodexHudSkin[] = ['bunny', 'penguin', 'snail']

  it('每只皮肤三手不重样，且都不含打盹', () => {
    for (const skin of skins) {
      const pool = HUD_LIFE_MOVES[skin]
      expect(pool).toHaveLength(3)
      expect(new Set(pool).size).toBe(3)
      expect(pool).not.toContain(HUD_DOZE_MOVE)
    }
  })

  it('三只的手互不撞车', () => {
    for (let i = 0; i < skins.length; i++) {
      for (let j = i + 1; j < skins.length; j++) {
        expect(HUD_LIFE_MOVES[skins[i]].some((mv) => HUD_LIFE_MOVES[skins[j]].includes(mv))).toBe(false)
      }
    }
  })

  it('告警那手是这只自己的招牌，且已经在它的生活池里', () => {
    const alerts = skins.map((skin) => HUD_ALERT_MOVES[skin])
    expect(new Set(alerts).size).toBe(skins.length)
    skins.forEach((skin, index) => {
      expect(HUD_LIFE_MOVES[skin]).toContain(alerts[index])
    })
  })

  it('每手都有时长，打盹最长且醒完静得最久', () => {
    for (const mv of [...skins.flatMap((skin) => HUD_LIFE_MOVES[skin]), HUD_DOZE_MOVE, ...skins.map((s) => HUD_ALERT_MOVES[s])]) {
      expect(HUD_MOVE_MS[mv]).toBeGreaterThan(0)
    }
    const longest = Math.max(...Object.values(HUD_MOVE_MS).filter((ms) => ms !== HUD_MOVE_MS.doze))
    expect(HUD_MOVE_MS.doze).toBeGreaterThan(longest)
    expect(HUD_DOZE_GAP_MS).toBeGreaterThan(Math.max(...HUD_SCENE_GAPS_MS))
  })

  it('开机第一手比平时的档期更短', () => {
    expect(HUD_FIRST_SCENE_MS).toBeLessThan(Math.min(...HUD_SCENE_GAPS_MS))
    expect(HUD_DOZE_EVERY).toBeGreaterThan(1)
  })
})

describe('挂件额度标签', () => {
  it.each([
    ['hourly', 300, '5h'],
    ['hourly', 120, '2h'],
    ['hourly', 45, '45m'],
    ['weekly', 10080, 'w'],
    ['weekly', 20160, '2w'],
    ['weekly', 1440, 'd'],
    ['weekly', 2880, '2d'],
  ])('%s 窗口 %s 分钟压成 %s', (id, minutes, label) => {
    const quota = id === 'weekly'
      ? account({ weekly_window_minutes: Number(minutes) })
      : account({ hourly_window_minutes: Number(minutes) })
    expect(hudQuotaLabel(id, quota)).toBe(label)
  })

  it('额外窗口、Credits 与 API Key 有固定短标签', () => {
    expect(hudQuotaLabel('additional:0:primary', account())).toBe('额外')
    expect(hudQuotaLabel('credits', account())).toBe('Credits')
    expect(hudQuotaLabel('hourly', account({}, { auth_mode: 'apikey' }))).toBe('额度')
  })

  it('皮肤名单只认三款，未知值回落兔子', () => {
    expect(DEFAULT_HUD_SKIN).toBe('bunny')
    expect(isHudSkin('penguin')).toBe(true)
    expect(isHudSkin('snail')).toBe(true)
    expect(isHudSkin('dragon')).toBe(false)
  })
})

describe('今日金额压缩', () => {
  it.each([
    [null, '未定价'],
    [Number.NaN, '未定价'],
    [-1, '未定价'],
    [0, '≈$0'],
    [0.0042, '≈$0.004'],
    [0.0003, '≈<$0.001'],
    [12.34, '≈$12.34'],
    [999.99, '≈$999.99'],
    [1234, '≈$1.2k'],
    [1_200_000, '≈$1.2M'],
  ])('%s → %s', (value, label) => {
    expect(formatHudCost(value as number | null)).toBe(label)
  })
})

describe('挂件快照', () => {
  it('双窗口直接映射主次额度，今日汇总原样带出', () => {
    const state = snapshot(account())
    expect(state.primary).toEqual({ label: '5h', percentage: 68 })
    expect(state.secondary).toEqual({ label: 'w', percentage: 42 })
    expect(state.today).toEqual({ tokens: 1_942_000, costUsd: 12.34 })
    expect(state.severe).toBe(false)
    expect(state.placeholder).toBeNull()
  })

  it('没有次额度时只留主额度', () => {
    const state = snapshot(account({ hourly_window_present: true, weekly_window_present: false }))
    expect(state.primary).toEqual({ label: '5h', percentage: 68 })
    expect(state.secondary).toBeNull()
  })

  it('没有 5 小时窗口时周窗口升级为主额度', () => {
    const state = snapshot(account({
      hourly_window_minutes: 10080,
      hourly_window_present: true,
      weekly_window_present: false,
    }))
    expect(state.primary).toEqual({ label: 'w', percentage: 68 })
    expect(state.secondary).toBeNull()
  })

  it('没有标准窗口时第一扇额外窗口兜底', () => {
    const state = snapshot(account({
      hourly_window_present: false,
      weekly_window_present: false,
      raw_data: { additional_rate_limits: [{
        limit_name: 'gpt-5.3-codex-spark',
        rate_limit: { primary_window: { used_percent: 35, limit_window_seconds: 18000 } },
      }] },
    }))
    expect(state.primary).toEqual({ label: '额外', percentage: 65 })
    expect(state.secondary).toBeNull()
  })

  it('Credits 有百分比时兜底为主额度', () => {
    const state = snapshot(account({
      hourly_window_present: false,
      weekly_window_present: false,
      raw_data: { spend_control: { individual_limit: { limit: 25000, used: 15000 } } },
    }))
    expect(state.primary).toEqual({ label: 'Credits', percentage: 40 })
  })

  it('Credits 不限额时填满并显示 ∞', () => {
    const state = snapshot(account({
      hourly_window_present: false,
      weekly_window_present: false,
      raw_data: { credits: { unlimited: true } },
    }))
    expect(state.primary).toEqual({ label: 'Credits', percentage: 100, unlimited: true })
    expect(state.severe).toBe(false)
  })

  it('只有余额没有百分比的 Credits 不伪造额度，退回占位', () => {
    const state = snapshot(account({
      hourly_window_present: false,
      weekly_window_present: false,
      raw_data: { credits: { balance: 42 } },
    }))
    expect(state.primary).toBeNull()
    expect(state.placeholder).toBe('暂无额度')
  })

  it('低额度只在主额度 0–9 或次窗口耗尽时成立', () => {
    expect(snapshot(account({ hourly_percentage: 9 })).severe).toBe(true)
    expect(snapshot(account({ hourly_percentage: 10 })).severe).toBe(false)
    const exhausted = snapshot(account({ weekly_percentage: 0 }))
    expect(exhausted.primary?.percentage).toBe(0)
    expect(exhausted.severe).toBe(true)
  })

  it('刷新失败但有缓存时保留数据并标 stale', () => {
    const state = snapshot(account({}, { quota_error: { message: 'network down', timestamp: 1 } }))
    expect(state.primary).not.toBeNull()
    expect(state.stale).toBe(true)
  })

  it('刷新失败且无缓存时画虚线并提示获取失败', () => {
    const state = snapshot(account(
      { hourly_window_present: false, weekly_window_present: false },
      { quota_error: { message: 'network down', timestamp: 1 } },
    ))
    expect(state.placeholder).toBe('额度获取失败')
    expect(state.placeholderAlert).toBe(true)
  })

  it('待授权、API Key、无账号各有占位文案', () => {
    expect(snapshot(account(
      { hourly_window_present: false, weekly_window_present: false },
      { authorization_status: ' Pending ' },
    )).placeholder).toBe('待授权')
    expect(snapshot(account(
      { hourly_window_present: false, weekly_window_present: false },
      { auth_mode: 'apikey' },
    )).placeholder).toBe('按量计费')
    expect(snapshot(null).placeholder).toBe('暂无账号')
  })

  it('完整百分比和今日汇总进入可访问名称', () => {
    const label = hudAriaLabel(snapshot(account()))
    expect(label).toContain('5 小时额度 68%')
    expect(label).toContain('周额度 42%')
    expect(label).toContain('今日 1,942,000 tok')
    expect(label).toContain('≈$12.34')
  })

  it('快照不携带邮箱、账号名、路径或原始报错', () => {
    const dirty = account({}, {
      email: 'secret@example.invalid',
      account_name: '私人工作号',
      account_id: 'acct-secret',
      quota_error: { message: 'C:\\Users\\secret\\.codex\\auth.json 读取失败', timestamp: 1 },
    })
    const serialized = JSON.stringify(snapshot(dirty))
    for (const leaked of ['secret@example.invalid', '私人工作号', 'acct-secret', 'C:\\Users', 'auth.json']) {
      expect(serialized).not.toContain(leaked)
    }
  })

  it('皮肤原样进快照', () => {
    const skin: CodexHudSkin = 'snail'
    const state = buildCodexHudSnapshot({ account: null, skin, theme, today: null })
    expect(state.skin).toBe(skin)
    expect(state.today).toBeNull()
  })
})
