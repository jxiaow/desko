import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ProfilesPane from './ProfilesPane.vue'
import { profilesApi } from '../../services/api/profiles'
import { useNotesStore } from '../../stores/notes'
import { useConfirmStore } from '../../stores/confirm'
import { useToastStore } from '../../stores/toast'

vi.mock('../../services/api/profiles', () => ({ profilesApi: { list: vi.fn(), switchTo: vi.fn() } }))
vi.mock('../../stores/notes', () => ({ useNotesStore: vi.fn() }))

const noteState = { noteDraftHtml: '', flushNoteSave: vi.fn() }
const profiles = [
  { id: 'default', name: '默认', cloudBase: 'desko', isActive: true },
  { id: 'work', name: '工作', cloudBase: 'desko-work', isActive: false },
]

describe('ProfilesPane switch', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    noteState.noteDraftHtml = ''
    vi.mocked(useNotesStore).mockReturnValue(noteState as any)
    vi.mocked(profilesApi.list).mockResolvedValue({ activeId: 'default', profiles: profiles as any })
    vi.mocked(profilesApi.switchTo).mockResolvedValue(undefined)
    noteState.flushNoteSave.mockResolvedValue(undefined)
  })

  async function confirmSwitch() {
    const wrapper = mount(ProfilesPane)
    await flushPromises()
    await wrapper.find('.prow:nth-child(2) .action-btn.primary').trigger('click')
    useConfirmStore().handleConfirm()
    await flushPromises()
    return wrapper
  }

  it('flushes notes before sending the process-restarting profile switch', async () => {
    await confirmSwitch()
    expect(noteState.flushNoteSave).toHaveBeenCalledOnce()
    expect(profilesApi.switchTo).toHaveBeenCalledWith('work')
    expect(noteState.flushNoteSave.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(profilesApi.switchTo).mock.invocationCallOrder[0])
  })

  it('keeps the current profile when a pending note cannot be saved', async () => {
    noteState.flushNoteSave.mockRejectedValueOnce(new Error('disk full'))
    await confirmSwitch()
    expect(profilesApi.switchTo).not.toHaveBeenCalled()
    expect(useToastStore().toast.message).toContain('disk full')
  })

  it('blocks restart while a new note remains unpublished', async () => {
    noteState.noteDraftHtml = '<p>还没发布</p>'
    await confirmSwitch()
    expect(noteState.flushNoteSave).not.toHaveBeenCalled()
    expect(profilesApi.switchTo).not.toHaveBeenCalled()
    expect(useToastStore().toast.message).toContain('先保存或放弃')
  })
})
