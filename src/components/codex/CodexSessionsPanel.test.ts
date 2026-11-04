import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { codexApi, type CodexSessionRecord, type CodexSessionTokenStats } from '../../services/api/codex'
import { clearCodexSession, sessions, sessionsLoaded, sessionDirectoryFilter, sessionTotalCount, sessionQuery, sessionSearchMode } from '../../services/codexState'
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
    const wrapper = mount(CodexSessionsPanel, { global: { stubs: { teleport: true, PopoverMenu: { template: '<div><slot /></div>' } } } })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.codex-skeleton').exists()).toBe(true)
    expect(wrapper.findAll('.skeleton-project')).toHaveLength(3)
    expect(wrapper.find('.empty-state').exists()).toBe(false)
    wrapper.unmount()
  })

  it('统计加载、失败、无用量三种状态分开显示，失败可以重试', async () => {
    let reject!: (error: unknown) => void
    vi.mocked(codexApi.sessionTokenStats).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const wrapper = mount(CodexSessionsPanel, { global: { stubs: { teleport: true, PopoverMenu: { template: '<div><slot /></div>' } } } })
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
    const wrapper = mount(CodexSessionsPanel, { global: { stubs: { teleport: true, PopoverMenu: { template: '<div><slot /></div>' } } } })
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

  it('首次直接展示会话，不自动打开详情，迟到统计和重新进入不改变布局', async () => {
    let finish!: (value: CodexSessionTokenStats[]) => void
    vi.mocked(codexApi.sessionTokenStats).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(CodexSessionsPanel, { global: { stubs: { teleport: true, PopoverMenu: { template: '<div><slot /></div>' } } } })
    await flushPromises()
    expect(wrapper.findAll('.sess-row')).toHaveLength(1)
    expect(wrapper.find('.sess-detail').exists()).toBe(false)
    finish([])
    await flushPromises()
    expect(wrapper.find('.sess-detail').exists()).toBe(false)
    wrapper.unmount()
    vi.mocked(codexApi.sessionTokenStats).mockResolvedValue([])
    const again = mount(CodexSessionsPanel, { global: { stubs: { teleport: true, PopoverMenu: { template: '<div><slot /></div>' } } } })
    await flushPromises()
    expect(again.findAll('.sess-row')).toHaveLength(1)
    expect(again.find('.sess-detail').exists()).toBe(false)
    again.unmount()
  })

  it('会话删除确认打开后锁屏卸载，旧回调不能移动会话', async () => {
    vi.mocked(codexApi.sessionTokenStats).mockResolvedValue([])
    const wrapper = mount(CodexSessionsPanel, { global: { stubs: { teleport: true, PopoverMenu: { template: '<div><slot /></div>' } } } })
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
  it('目录操作包含搜索隐藏的会话，确认前不移动，并在完成后核对列表', async () => {
    vi.mocked(codexApi.sessionTokenStats).mockResolvedValue([])
    const wrapper = mount(CodexSessionsPanel, { global: { stubs: { teleport: true, PopoverMenu: { template: '<div><slot /></div>' } } } })
    await flushPromises()
    sessionTotalCount.value = 3
    sessionQuery.value = 'Synthetic'
    const hidden = { ...session, sessionId: 'hidden' }
    vi.mocked(codexApi.listSessions).mockResolvedValueOnce([session, hidden, { ...session, sessionId: 'other', cwd: 'D:/other' }])
    sessionDirectoryFilter.value = session.cwd
    await wrapper.vm.$nextTick()
    await wrapper.get('.directory-menu-button').trigger('click')
    await wrapper.get('.directory-trash').trigger('click')
    await flushPromises()
    expect(useConfirmStore().confirmDialog.message).toContain('2 条')
    expect(codexApi.moveToTrash).not.toHaveBeenCalled()
    vi.mocked(codexApi.moveToTrash).mockResolvedValue({ message: '已移动', requestedSessionCount: 2, trashedSessionCount: 2, trashedInstanceCount: 1, trashDirs: [] })
    vi.mocked(codexApi.listSessions).mockResolvedValue([])
    useConfirmStore().handleConfirm()
    await flushPromises()
    expect(codexApi.moveToTrash).toHaveBeenCalledWith(['synthetic-session', 'hidden'])
    expect(sessions.value).toEqual([])
    expect(sessionTotalCount.value).toBe(1)
    wrapper.unmount()
  })

  it('空关键词切换搜索范围不请求；有效搜索和清空仍按最终范围刷新', async () => {
    vi.useFakeTimers()
    vi.mocked(codexApi.sessionTokenStats).mockResolvedValue([])
    const wrapper = mount(CodexSessionsPanel, { global: { stubs: { teleport: true, PopoverMenu: { template: '<div><slot /></div>' } } } })
    try {
      await flushPromises()
      const initial = vi.mocked(codexApi.listSessions).mock.calls.length
      sessionSearchMode.value = 'content'
      await vi.advanceTimersByTimeAsync(400)
      sessionQuery.value = '   '
      sessionSearchMode.value = 'title'
      await vi.advanceTimersByTimeAsync(400)
      expect(codexApi.listSessions).toHaveBeenCalledTimes(initial)
      sessionQuery.value = 'needle'
      await vi.advanceTimersByTimeAsync(400)
      expect(codexApi.listSessions).toHaveBeenLastCalledWith('needle', undefined)
      sessionSearchMode.value = 'content'
      await vi.advanceTimersByTimeAsync(400)
      expect(codexApi.listSessions).toHaveBeenLastCalledWith(undefined, 'needle')
      sessionQuery.value = ''
      await wrapper.vm.$nextTick()
      sessionSearchMode.value = 'title'
      await vi.advanceTimersByTimeAsync(400)
      expect(codexApi.listSessions).toHaveBeenLastCalledWith('', undefined)
      expect(codexApi.listSessions).toHaveBeenCalledTimes(initial + 3)
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
  })

})
