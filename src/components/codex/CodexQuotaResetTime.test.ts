import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CodexQuotaResetTime from './CodexQuotaResetTime.vue'

const now = new Date(2026, 9, 14, 12, 0).getTime()
const timestamp = new Date(2026, 9, 14, 13, 30).getTime() / 1000

describe('额度具体重置时间', () => {
  it('在页面文字中显示完整本地日期和时间，并提供机器可读时间', () => {
    const wrapper = mount(CodexQuotaResetTime, { props: { timestamp, now } })
    expect(wrapper.get('time').text()).toBe('重置 2026-10-14 13:30')
    expect(wrapper.get('time').attributes('datetime')).toBe(new Date(timestamp * 1000).toISOString())
    expect(wrapper.get('.q-reset-relative').text()).toBe('（1 小时 30 分钟后重置）')
  })

  it('刷新时根据新的当前时间更新剩余时间，保持绝对重置时间', async () => {
    const wrapper = mount(CodexQuotaResetTime, { props: { timestamp, now } })
    await wrapper.setProps({ now: now + 30 * 60000 })
    expect(wrapper.get('time').text()).toBe('重置 2026-10-14 13:30')
    expect(wrapper.text()).toContain('1 小时后重置')
  })

  it('到达重置时间仍保留具体时间，明确需要刷新确认', () => {
    const wrapper = mount(CodexQuotaResetTime, { props: { timestamp, now: timestamp * 1000 } })
    expect(wrapper.get('time').text()).toBe('重置 2026-10-14 13:30')
    expect(wrapper.text()).toContain('已到重置时间，等待刷新')
  })

  it.each([null, 0, NaN, Infinity, Number.MAX_VALUE])('缺失或无法转换的时间 %s 不显示虚构日期', timestamp => {
    const wrapper = mount(CodexQuotaResetTime, { props: { timestamp, now } })
    expect(wrapper.find('time').exists()).toBe(false)
    expect(wrapper.text()).toBe('尚未提供重置时间')
  })
})
