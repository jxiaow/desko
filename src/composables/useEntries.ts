import { ref, computed } from 'vue'
import { api } from '../services/api'
import type { Entry, CreateEntryInput, UpdateEntryInput, Tab } from '../types'

export function useEntries() {
  const entries = ref<Entry[]>([])
  const loading = ref(false)
  const searchKeyword = ref('')
  const activeTab = ref('all')

  const categories = computed(() => {
    const map: Record<string, number> = {}
    entries.value.forEach(e => {
      const cat = e.category || '未分类'
      map[cat] = (map[cat] || 0) + 1
    })
    return map
  })

  const tabs = computed<Tab[]>(() => {
    const result: Tab[] = [{ id: 'all', name: '全部', count: entries.value.length }]
    for (const [cat, count] of Object.entries(categories.value)) {
      result.push({ id: cat, name: cat, count })
    }
    return result
  })

  const filteredEntries = computed(() => {
    let list = entries.value
    if (activeTab.value !== 'all') {
      list = list.filter(e => (e.category || '未分类') === activeTab.value)
    }
    if (searchKeyword.value) {
      const kw = searchKeyword.value.toLowerCase()
      list = list.filter(e => 
        e.name.toLowerCase().includes(kw) || 
        (e.url && e.url.toLowerCase().includes(kw))
      )
    }
    return list
  })

  const fetchEntries = async (onError?: (msg: string) => void) => {
    loading.value = true
    try {
      entries.value = await api.listEntriesWithPaths()
    } catch (e: any) {
      console.error('Failed to fetch entries:', e)
      if (onError) {
        onError(e.message || '加载数据失败')
      }
    } finally {
      loading.value = false
    }
  }

  const createEntry = async (input: CreateEntryInput) => {
    await api.createEntry(input)
    await fetchEntries()
  }

  const updateEntry = async (id: string, input: UpdateEntryInput) => {
    await api.updateEntry(id, input)
    await fetchEntries()
  }

  const deleteEntry = async (id: string) => {
    await api.deleteEntry(id)
    await fetchEntries()
  }

  const getPassword = async (id: string): Promise<string> => {
    return await api.getPassword(id)
  }

  return {
    entries,
    loading,
    searchKeyword,
    activeTab,
    tabs,
    filteredEntries,
    fetchEntries,
    createEntry,
    updateEntry,
    deleteEntry,
    getPassword,
  }
}
