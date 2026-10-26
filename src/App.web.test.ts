import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from './App.vue'
import { authApi } from './services/api/auth'
import { useAuthStore } from './stores/auth'
import { useNotesStore } from './stores/notes'
import { useEntriesStore } from './stores/entries'
import { useFileShortcutsStore } from './stores/fileShortcuts'
import { usePasswordStore } from './stores/password'
import { flushModulesBeforeLock } from './modules/state'

vi.mock('./services/api/auth', () => ({ authApi: { isInitialized: vi.fn(async () => true), lock: vi.fn() } }))
vi.mock('./modules/state', () => ({ bootEnabledModules: vi.fn(), flushModulesBeforeLock: vi.fn(), lockEnabledModules: vi.fn() }))
vi.mock('./composables/useAutoLock', () => ({ useAutoLock: vi.fn() }))
vi.mock('./composables/useClipboard', () => ({ useClipboard: () => ({ clearClipboardTimer: vi.fn() }) }))
vi.mock('./utils/hoverGuard', () => ({ installHoverGuard: vi.fn() }))
// App 的 setup 就要读当前路由（目录承载位按模块判定），这里不装整个导航。
// 只替 useRoute/useRouter：src/router 在模块加载时就要真的 createRouter。
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => ({ name: 'notes', path: '/notes', meta: {} }),
  useRouter: () => ({ push: vi.fn() }),
}))

let meta: HTMLMetaElement
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  meta = document.createElement('meta'); meta.name = 'desko-runtime'; meta.content = 'web'; document.head.append(meta)
})
afterEach(() => meta.remove())

it('expiration clears private state immediately while logout is stalled and never stages old drafts', async () => {
  let finish!: () => void
  vi.mocked(authApi.lock).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const wrapper = mount(App, { global: { stubs: {
    TitleBar: true, Sidebar: true, SetupPage: true, UnlockPage: true, SettingsDialog: true,
    WebSettingsDialog: true, ChangePasswordDialog: true, NoteLockDialog: true,
    ToastNotification: true, ConfirmDialog: true, ModuleRouterView: true,
  } } })
  await flushPromises()
  const auth = useAuthStore()
  const notes = useNotesStore()
  auth.appState = 'unlocked'
  notes.notes = [{ id: 'synthetic', content_html: 'secret' }] as any
  notes.noteDraftHtml = 'unpublished secret'
  useEntriesStore().entries = [{ id: 'synthetic', name: 'private entry' }] as any
  useFileShortcutsStore().shortcuts = [{ id: 'synthetic', path: 'private path' }] as any
  usePasswordStore().passwordCache = { synthetic: { value: 'secret', ts: 1 } }
  window.dispatchEvent(new Event('desko:web-session-expired'))
  expect(auth.appState).toBe('locked')
  expect(notes.notes).toEqual([])
  expect(notes.noteDraftHtml).toBe('')
  expect(useEntriesStore().entries).toEqual([])
  expect(useFileShortcutsStore().shortcuts).toEqual([])
  expect(usePasswordStore().passwordCache).toEqual({})
  expect(flushModulesBeforeLock).not.toHaveBeenCalled()
  expect(authApi.lock).toHaveBeenCalledTimes(1)
  // A late logout completion must not change a subsequent login's local state.
  auth.appState = 'unlocked'
  finish()
  await flushPromises()
  expect(auth.appState).toBe('unlocked')
  wrapper.unmount()
})
