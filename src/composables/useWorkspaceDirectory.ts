import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useEntriesStore } from '../stores/entries'
import { useNotesStore } from '../stores/notes'
import { useToastStore } from '../stores/toast'
import { hasWorkspaceDirectory, workspaceDirectoryMediaQuery } from '../components/layout/workspaceLayout'
import { isWebRuntime } from '../services/runtime'
import { useWorkspaceDirectoryPreferences } from '../components/layout/useWorkspaceDirectoryPreferences'
import { useEscapeClose } from './useEscapeClose'

export function useWorkspaceDirectory() {
  const route = useRoute()
  const authStore = useAuthStore()
  const notesStore = useNotesStore()
  const entriesStore = useEntriesStore()
  const toastStore = useToastStore()
  const preferences = useWorkspaceDirectoryPreferences()
  const media = window.matchMedia(workspaceDirectoryMediaQuery)
  const wide = ref(media.matches)
  let disposed = false

  const directoryAvailable = computed(() => {
    if (!hasWorkspaceDirectory(String(route.name))) return false
    // 桌面的小记与收藏把筛选放回内容顶部；浏览器仍保留右侧栏的窄屏交互。
    if (!isWebRuntime()) return false
    return route.name === 'notes'
      ? notesStore.notes.length > 0 || notesStore.hasActiveFilters
      : entriesStore.entries.length > 0 || !!entriesStore.searchKeyword || entriesStore.activeTab !== 'all'
  })
  const directoryVisible = computed(() => directoryAvailable.value && (preferences.open.value[String(route.name)] ?? false))
  const directoryCompact = computed(() => !wide.value)
  const directoryPinned = computed(() => preferences.pinned.value[String(route.name)] ?? false)

  function toggleDirectoryPin() {
    if (!directoryAvailable.value) return
    void preferences.setPinned(String(route.name), !directoryPinned.value).catch(() => {
      toastStore.showToast('固定状态未能保存，下次启动将使用原设置', 'error')
    })
  }
  function setDirectoryVisible(visible: boolean) {
    if (!directoryAvailable.value) return
    void preferences.setVisible(String(route.name), visible).catch(() => {
      toastStore.showToast('目录状态未能保存，下次启动将使用原设置', 'error')
    })
  }
  const toggleDirectory = () => setDirectoryVisible(!directoryVisible.value)
  function closeDirectory() {
    setDirectoryVisible(false)
    document.getElementById('workspace-directory-toggle')?.focus()
  }
  const onMediaChange = (event: MediaQueryListEvent) => { wide.value = event.matches }
  function onOutsideClick(event: MouseEvent) {
    if (!directoryVisible.value || directoryPinned.value || !(event.target instanceof Element)) return
    if (event.target.closest('#workspace-directory, #workspace-directory-toggle, [data-workspace-directory-trigger], [role="dialog"], .dialog-overlay')) return
    // click 后收起，保留本次点击的编辑、搜索或导航动作及其焦点。
    setDirectoryVisible(false)
  }

  useEscapeClose(closeDirectory, () => authStore.appState === 'unlocked' && directoryVisible.value && !directoryPinned.value)
  async function restoreDirectory() {
    await preferences.restore()
    if (!disposed) document.addEventListener('click', onOutsideClick)
  }
  onMounted(() => media.addEventListener('change', onMediaChange))
  onUnmounted(() => {
    disposed = true
    media.removeEventListener('change', onMediaChange)
    document.removeEventListener('click', onOutsideClick)
  })

  return { directoryAvailable, directoryVisible, directoryCompact, directoryPinned, toggleDirectoryPin, toggleDirectory, closeDirectory, restoreDirectory }
}
