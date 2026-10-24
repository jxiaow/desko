import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { codexApi, type CodexSessionRecord, type CodexSessionTokenStats } from '../../services/api/codex'
import { clearCodexSession, sessions, sessionsLoaded, sessionOpenGroups } from '../../services/codexState'
import { useConfirmStore } from '../../stores/confirm'
import CodexSessionsPanel from './CodexSessionsPanel.vue'

vi.mock('../../services/api/codex', () => ({
  codexApi: { listSessions: vi.fn(), sessionTokenStats: vi.fn(), moveToTrash: vi.fn() },
}))

const session = {
  sessionId: 'synthetic-session', title: 'Synthetic session', cwd: 'C:\\demo',
  projectName: 'Demo', updatedAt: 1,
} as CodexSessionRecord

describe('会话分组与重要操作生命周期', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    clearCodexSession()
    sessions.value = [session]
    sessionsLoaded.value = true
    vi.mocked(codexApi.listSessions).mockResolvedValue([session])
  })

  it('首次加载使用完整列表骨架，不提前显示空目录', async () => {
    sessions.value = []
    sessionsLoaded.value = false
    vi.mocked(codexApi.listSessions).mockImplementationOnce(() => new Promise(() => {}))
    const wrapper = mount(CodexSessionsPanel)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.codex-skeleton').exists()).toBe(true)
    expect(wrapper.findAll('.skeleton-project')).toHaveLength(3)
    expect(wrapper.find('.empty-state').exists()).toBe(false)
    wrapper.unmount()
  })

  it('统计加载、失败、无用量三种状态分开显示，失败可以重试', async () => {
    let reject!: (error: unknown) => void
    vi.mocked(codexApi.sessionTokenStats).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const wrapper = mount(CodexSessionsPanel)
    await flushPromises()
    await wrapper.get('.sess-row').trigger('click')
    expect(codexApi.sessionTokenStats).toHaveBeenCalledTimes(1)
    expect(wrapper.get('.sess-no-usage').text()).toContain('正在读取')
    expect(wrapper.find('.hero-placeholder').exists()).toBe(true)
    reject('模拟失败')
    await flushPromises()
    expect(wrapper.get('.token-error').text()).toContain('重试统计')
    expect(wrapper.get('.sess-no-usage').text()).not.toContain('没有 Token')
    vi.mocked(codexApi.sessionTokenStats).mockResolvedValueOnce([])
    await wrapper.get('.token-error button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.token-error').exists()).toBe(false)
    expect(wrapper.get('.hero-num').text()).toBe('0')
    expect(wrapper.get('.sess-no-usage').text()).toContain('没有 Token 记录')
    wrapper.unmount()
  })

  it('列表请求未结束或窗口隐藏时不轮询，返回窗口时补取，卸载后清理监听与定时器', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    let finish!: (result: CodexSessionRecord[]) => void
    vi.mocked(codexApi.listSessions).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    vi.mocked(codexApi.sessionTokenStats).mockResolvedValue([])
    const wrapper = mount(CodexSessionsPanel)
    try {
      await vi.advanceTimersByTimeAsync(30_000)
      expect(codexApi.listSessions).toHaveBeenCalledTimes(1)
      finish([session])
      await flushPromises()
      visibility.mockReturnValue('hidden')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(codexApi.listSessions).toHaveBeenCalledTimes(1)
      visibility.mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))
      await flushPromises()
      expect(codexApi.listSessions).toHaveBeenCalledTimes(2)
      wrapper.unmount()
      await vi.advanceTimersByTimeAsync(60_000)
      window.dispatchEvent(new Event('focus'))
      expect(codexApi.listSessions).toHaveBeenCalledTimes(2)
    } finally {
      if (wrapper.exists()) wrapper.unmount()
      visibility.mockRestore()
      vi.useRealTimers()
    }
  })

  it('首次展开最近项目，手动收起后迟到统计与重新进入都不重新展开', async () => {
    let finish!: (value: CodexSessionTokenStats[]) => void
    vi.mocked(codexApi.sessionTokenStats).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(CodexSessionsPanel)
    await flushPromises()
    const group = wrapper.get('.grp-head')
    expect(group.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.sess-row').exists()).toBe(true)
    await group.trigger('click')
    expect(group.attributes('aria-expanded')).toBe('false')
    finish([])
    await flushPromises()
    expect(sessionOpenGroups.value.size).toBe(0)
    expect(group.attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
    vi.mocked(codexApi.sessionTokenStats).mockResolvedValue([])
    const again = mount(CodexSessionsPanel)
    await flushPromises()
    expect(again.get('.grp-head').attributes('aria-expanded')).toBe('false')
    again.unmount()
  })

  it('会话删除确认打开后锁屏卸载，旧回调不能移动会话', async () => {
    vi.mocked(codexApi.sessionTokenStats).mockResolvedValue([])
    const wrapper = mount(CodexSessionsPanel)
    await flushPromises()
    await wrapper.get('.sess-row').trigger('click')
    await wrapper.get('.trash-btn').trigger('click')
    expect(useConfirmStore().confirmDialog.show).toBe(true)
    expect(codexApi.moveToTrash).not.toHaveBeenCalled()
    wrapper.unmount()
    useConfirmStore().handleConfirm()
    await flushPromises()
    expect(codexApi.moveToTrash).not.toHaveBeenCalled()
  })
})
