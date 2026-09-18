import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEntriesStore } from './entries'
import { entriesApi } from '../services/api/entries'

// Mock API
vi.mock('../services/api/entries', () => ({
  entriesApi: {
    listEntriesWithPaths: vi.fn(),
    createEntry: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
    getPassword: vi.fn(),
  },
}))

describe('Entries Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('fetchEntries', () => {
    it('should fetch entries and set loading state', async () => {
      const store = useEntriesStore()
      const mockEntries = [
        {
          id: '1',
          name: 'GitHub',
          url: 'https://github.com',
          username: 'user',
          notes: null,
          category: '开发',
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ]
      vi.mocked(entriesApi.listEntriesWithPaths).mockResolvedValue(mockEntries)

      expect(store.loading).toBe(false)
      const fetchPromise = store.fetchEntries()
      expect(store.loading).toBe(true)
      
      await fetchPromise
      
      expect(store.loading).toBe(false)
      expect(store.entries).toEqual(mockEntries)
    })

    it('should call onError callback on failure', async () => {
      const store = useEntriesStore()
      const onError = vi.fn()
      vi.mocked(entriesApi.listEntriesWithPaths).mockRejectedValue(new Error('Network error'))

      await store.fetchEntries(onError)

      expect(onError).toHaveBeenCalledWith('Network error')
    })
  })

  describe('createEntry', () => {
    it('should create entry and refresh list', async () => {
      const store = useEntriesStore()
      const input = {
        name: 'New Entry',
        url: 'https://example.com',
        username: 'user',
        password: 'pass',
      }
      vi.mocked(entriesApi.createEntry).mockResolvedValue({} as any)
      vi.mocked(entriesApi.listEntriesWithPaths).mockResolvedValue([])

      await store.createEntry(input)

      expect(entriesApi.createEntry).toHaveBeenCalledWith(input)
      expect(entriesApi.listEntriesWithPaths).toHaveBeenCalled()
    })
  })

  describe('updateEntry', () => {
    it('should update entry and refresh list', async () => {
      const store = useEntriesStore()
      const input = {
        name: 'Updated Entry',
        url: 'https://updated.com',
      }
      vi.mocked(entriesApi.updateEntry).mockResolvedValue({} as any)
      vi.mocked(entriesApi.listEntriesWithPaths).mockResolvedValue([])

      await store.updateEntry('1', input)

      expect(entriesApi.updateEntry).toHaveBeenCalledWith('1', input)
      expect(entriesApi.listEntriesWithPaths).toHaveBeenCalled()
    })
  })

  describe('deleteEntry', () => {
    it('should delete entry and refresh list', async () => {
      const store = useEntriesStore()
      vi.mocked(entriesApi.deleteEntry).mockResolvedValue()
      vi.mocked(entriesApi.listEntriesWithPaths).mockResolvedValue([])

      await store.deleteEntry('1')

      expect(entriesApi.deleteEntry).toHaveBeenCalledWith('1')
      expect(entriesApi.listEntriesWithPaths).toHaveBeenCalled()
    })
  })

  describe('getPassword', () => {
    it('should return password from API', async () => {
      const store = useEntriesStore()
      vi.mocked(entriesApi.getPassword).mockResolvedValue('secret-password')

      const password = await store.getPassword('1')

      expect(password).toBe('secret-password')
      expect(entriesApi.getPassword).toHaveBeenCalledWith('1')
    })
  })

  describe('filteredEntries', () => {
    beforeEach(() => {
      const store = useEntriesStore()
      store.entries = [
        {
          id: '1',
          name: 'GitHub',
          url: 'https://github.com',
          username: null,
          notes: null,
          category: '开发',
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: '2',
          name: 'Gmail',
          url: 'https://gmail.com',
          username: null,
          notes: null,
          category: '邮箱',
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: '3',
          name: 'Twitter',
          url: 'https://twitter.com',
          username: null,
          notes: null,
          category: '开发',
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ]
    })

    it('should return all entries when no filter', () => {
      const store = useEntriesStore()
      store.activeTab = 'all'
      store.searchKeyword = ''

      expect(store.filteredEntries.length).toBe(3)
    })

    it('should filter by category tab', () => {
      const store = useEntriesStore()
      store.activeTab = '开发'
      store.searchKeyword = ''

      expect(store.filteredEntries.length).toBe(2)
      expect(store.filteredEntries.every(e => e.category === '开发')).toBe(true)
    })

    it('should filter by search keyword in name', () => {
      const store = useEntriesStore()
      store.activeTab = 'all'
      store.searchKeyword = 'git'

      expect(store.filteredEntries.length).toBe(1)
      expect(store.filteredEntries[0].name).toBe('GitHub')
    })

    it('should filter by search keyword in url', () => {
      const store = useEntriesStore()
      store.activeTab = 'all'
      store.searchKeyword = 'gmail'

      expect(store.filteredEntries.length).toBe(1)
      expect(store.filteredEntries[0].name).toBe('Gmail')
    })

    it('should combine category and search filters', () => {
      const store = useEntriesStore()
      store.activeTab = '开发'
      store.searchKeyword = 'hub'

      expect(store.filteredEntries.length).toBe(1)
      expect(store.filteredEntries[0].name).toBe('GitHub')
    })
  })

  describe('tabs', () => {
    it('should compute tabs with counts', () => {
      const store = useEntriesStore()
      store.entries = [
        {
          id: '1',
          name: 'Entry 1',
          url: null,
          username: null,
          notes: null,
          category: '开发',
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: '2',
          name: 'Entry 2',
          url: null,
          username: null,
          notes: null,
          category: '开发',
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: '3',
          name: 'Entry 3',
          url: null,
          username: null,
          notes: null,
          category: '邮箱',
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ]

      expect(store.tabs).toEqual([
        { id: 'all', name: '全部', count: 3 },
        { id: '开发', name: '开发', count: 2 },
        { id: '邮箱', name: '邮箱', count: 1 },
      ])
    })

    it('should group uncategorized entries as 未分类', () => {
      const store = useEntriesStore()
      store.entries = [
        {
          id: '1',
          name: 'Entry 1',
          url: null,
          username: null,
          notes: null,
          category: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ]

      expect(store.tabs).toEqual([
        { id: 'all', name: '全部', count: 1 },
        { id: '未分类', name: '未分类', count: 1 },
      ])
    })
  })
})
