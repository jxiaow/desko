import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { codexApi, type CodexSessionRecord, type CodexSessionTokenStats } from '../../services/api/codex'
import { clearCodexSession, sessions, sessionsLoaded, sessionOpenGroups } from '../../services/codexState'
import { useConfirmStore } from '../../stores/confirm'
import CodexSessionsPanel from './CodexSessionsPanel.vue'

vi.mock('../../services/api/codex', () => ({
  codexApi: { sessionTokenStats: vi.fn(), moveToTrash: vi.fn() },
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
  })

  it('默认收起；补取用量期间可立即展开和收起，迟到结果不改展开态', async () => {
    let finish!: (value: CodexSessionTokenStats[]) => void
    vi.mocked(codexApi.sessionTokenStats).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(CodexSessionsPanel)
    const group = wrapper.get('.grp-head')
    expect(group.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.sess-row').exists()).toBe(false)
    await group.trigger('click')
    expect(group.attributes('aria-expanded')).toBe('true')
    await group.trigger('click')
    expect(group.attributes('aria-expanded')).toBe('false')
    finish([])
    await flushPromises()
    expect(sessionOpenGroups.value.size).toBe(0)
    expect(group.attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('会话删除确认打开后锁屏卸载，旧回调不能移动会话', async () => {
    vi.mocked(codexApi.sessionTokenStats).mockResolvedValue([])
    const wrapper = mount(CodexSessionsPanel)
    await wrapper.get('.grp-head').trigger('click')
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
