import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { fileShortcutsApi as api } from '../services/api/fileShortcuts'
import type { FileShortcut } from '../types'

const shortcuts = ref<FileShortcut[]>([])
const loading = ref(false)
const searchKeyword = ref('')

export const useFileShortcutsStore = defineStore('fileShortcuts', () => {
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

  const updateShortcut = async (id: string, name: string, path: string, shortcutType: 'file' | 'folder') => {
    await api.updateFileShortcut(id, { name, path, shortcut_type: shortcutType })
    const idx = shortcuts.value.findIndex(s => s.id === id)
    if (idx !== -1) {
      shortcuts.value[idx] = { ...shortcuts.value[idx], name, path, shortcut_type: shortcutType }
    }
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
    updateShortcut,
    removeShortcut,
  }
})
