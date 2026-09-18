import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFileShortcutsStore } from './fileShortcuts'
import { fileShortcutsApi } from '../services/api/fileShortcuts'

// Mock API
vi.mock('../services/api/fileShortcuts', () => ({
  fileShortcutsApi: {
    listFileShortcuts: vi.fn(),
    createFileShortcut: vi.fn(),
    updateFileShortcut: vi.fn(),
    deleteFileShortcut: vi.fn(),
  },
}))

describe('FileShortcuts Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('fetchShortcuts', () => {
    it('should fetch shortcuts and set loading state', async () => {
      const store = useFileShortcutsStore()
      const mockShortcuts = [
        {
          id: '1',
          name: 'Documents',
          path: '/home/user/documents',
          shortcut_type: 'folder' as const,
          created_at: Date.now(),
        },
      ]
      vi.mocked(fileShortcutsApi.listFileShortcuts).mockResolvedValue(mockShortcuts)

      expect(store.loading).toBe(false)
      const fetchPromise = store.fetchShortcuts()
      expect(store.loading).toBe(true)
      
      await fetchPromise
      
      expect(store.loading).toBe(false)
      expect(store.shortcuts).toEqual(mockShortcuts)
    })

    it('should handle fetch error gracefully', async () => {
      const store = useFileShortcutsStore()
      // Reset state first since shortcuts is module-level
      store.shortcuts = []
      vi.mocked(fileShortcutsApi.listFileShortcuts).mockRejectedValue(new Error('Network error'))

      await store.fetchShortcuts()

      expect(store.loading).toBe(false)
      expect(store.shortcuts).toEqual([])
    })
  })

  describe('addShortcut', () => {
    it('should add shortcut to the beginning of list', async () => {
      const store = useFileShortcutsStore()
      const newShortcut = {
        id: '2',
        name: 'New Folder',
        path: '/new/path',
        shortcut_type: 'folder' as const,
        created_at: Date.now(),
      }
      vi.mocked(fileShortcutsApi.createFileShortcut).mockResolvedValue(newShortcut)

      const result = await store.addShortcut('New Folder', '/new/path', 'folder')

      expect(fileShortcutsApi.createFileShortcut).toHaveBeenCalledWith({
        name: 'New Folder',
        path: '/new/path',
        shortcut_type: 'folder',
      })
      expect(result).toEqual(newShortcut)
      expect(store.shortcuts[0]).toEqual(newShortcut)
    })
  })

  describe('updateShortcut', () => {
    it('should update shortcut in list', async () => {
      const store = useFileShortcutsStore()
      store.shortcuts = [
        {
          id: '1',
          name: 'Old Name',
          path: '/old/path',
          shortcut_type: 'file' as const,
          created_at: Date.now(),
        },
      ]
      vi.mocked(fileShortcutsApi.updateFileShortcut).mockResolvedValue()

      await store.updateShortcut('1', 'New Name', '/new/path', 'folder')

      expect(fileShortcutsApi.updateFileShortcut).toHaveBeenCalledWith('1', {
        name: 'New Name',
        path: '/new/path',
        shortcut_type: 'folder',
      })
      expect(store.shortcuts[0].name).toBe('New Name')
      expect(store.shortcuts[0].path).toBe('/new/path')
      expect(store.shortcuts[0].shortcut_type).toBe('folder')
    })

    it('should not update if shortcut not found', async () => {
      const store = useFileShortcutsStore()
      store.shortcuts = []
      vi.mocked(fileShortcutsApi.updateFileShortcut).mockResolvedValue()

      await store.updateShortcut('999', 'Name', '/path', 'file')

      expect(store.shortcuts).toEqual([])
    })
  })

  describe('removeShortcut', () => {
    it('should remove shortcut from list', async () => {
      const store = useFileShortcutsStore()
      store.shortcuts = [
        {
          id: '1',
          name: 'Shortcut 1',
          path: '/path/1',
          shortcut_type: 'file' as const,
          created_at: Date.now(),
        },
        {
          id: '2',
          name: 'Shortcut 2',
          path: '/path/2',
          shortcut_type: 'folder' as const,
          created_at: Date.now(),
        },
      ]
      vi.mocked(fileShortcutsApi.deleteFileShortcut).mockResolvedValue()

      await store.removeShortcut('1')

      expect(fileShortcutsApi.deleteFileShortcut).toHaveBeenCalledWith('1')
      expect(store.shortcuts.length).toBe(1)
      expect(store.shortcuts[0].id).toBe('2')
    })
  })

  describe('filteredShortcuts', () => {
    beforeEach(() => {
      const store = useFileShortcutsStore()
      store.shortcuts = [
        {
          id: '1',
          name: 'Documents',
          path: '/home/user/documents',
          shortcut_type: 'folder' as const,
          created_at: Date.now(),
        },
        {
          id: '2',
          name: 'Downloads',
          path: '/home/user/downloads',
          shortcut_type: 'folder' as const,
          created_at: Date.now(),
        },
        {
          id: '3',
          name: 'README.md',
          path: '/home/user/README.md',
          shortcut_type: 'file' as const,
          created_at: Date.now(),
        },
      ]
    })

    it('should return all shortcuts when no search keyword', () => {
      const store = useFileShortcutsStore()
      store.searchKeyword = ''

      expect(store.filteredShortcuts.length).toBe(3)
    })

    it('should filter by name', () => {
      const store = useFileShortcutsStore()
      store.searchKeyword = 'doc'

      expect(store.filteredShortcuts.length).toBe(1)
      expect(store.filteredShortcuts[0].name).toBe('Documents')
    })

    it('should filter by path', () => {
      const store = useFileShortcutsStore()
      store.searchKeyword = 'user'

      expect(store.filteredShortcuts.length).toBe(3)
    })

    it('should be case insensitive', () => {
      const store = useFileShortcutsStore()
      store.searchKeyword = 'README'

      expect(store.filteredShortcuts.length).toBe(1)
      expect(store.filteredShortcuts[0].name).toBe('README.md')
    })
  })
})
