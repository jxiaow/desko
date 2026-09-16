import { ref, computed } from 'vue'
import { api } from '../services/api'
import type { FileShortcut } from '../types'

const shortcuts = ref<FileShortcut[]>([])
const loading = ref(false)
const searchKeyword = ref('')

export function useFileShortcuts() {
  const filteredShortcuts = computed(() => {
    if (!searchKeyword.value) return shortcuts.value
    const kw = searchKeyword.value.toLowerCase()
    return shortcuts.value.filter(s =>
      s.name.toLowerCase().includes(kw) || s.path.toLowerCase().includes(kw)
    )
  })

  const fetchShortcuts = async () => {
    loading.value = true
    try {
      shortcuts.value = await api.listFileShortcuts()
    } catch (e) {
      console.error('Failed to fetch file shortcuts:', e)
    } finally {
      loading.value = false
    }
  }

  const addShortcut = async (name: string, path: string, shortcutType: 'file' | 'folder') => {
    const created = await api.createFileShortcut({ name, path, shortcut_type: shortcutType })
    shortcuts.value.unshift(created)
    return created
  }

  const removeShortcut = async (id: string) => {
    await api.deleteFileShortcut(id)
    shortcuts.value = shortcuts.value.filter(s => s.id !== id)
  }

  return {
    shortcuts,
    loading,
    searchKeyword,
    filteredShortcuts,
    fetchShortcuts,
    addShortcut,
    removeShortcut,
  }
}
