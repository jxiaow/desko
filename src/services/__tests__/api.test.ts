import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from '../api'

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'

const mockInvoke = vi.mocked(invoke)

describe('api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('auth', () => {
    it('isInitialized should call invoke with correct command', async () => {
      mockInvoke.mockResolvedValue(true)
      
      const result = await api.isInitialized()
      
      expect(mockInvoke).toHaveBeenCalledWith('is_initialized')
      expect(result).toBe(true)
    })

    it('setupMasterPassword should pass password', async () => {
      mockInvoke.mockResolvedValue(undefined)
      
      await api.setupMasterPassword('test-password')
      
      expect(mockInvoke).toHaveBeenCalledWith('setup_master_password', { 
        password: 'test-password' 
      })
    })

    it('unlock should pass password', async () => {
      mockInvoke.mockResolvedValue(undefined)
      
      await api.unlock('my-password')
      
      expect(mockInvoke).toHaveBeenCalledWith('unlock', { 
        password: 'my-password' 
      })
    })

    it('lock should call invoke', async () => {
      mockInvoke.mockResolvedValue(undefined)
      
      await api.lock()
      
      expect(mockInvoke).toHaveBeenCalledWith('lock')
    })
  })

  describe('entries', () => {
    it('listEntries should call invoke without parameters', async () => {
      mockInvoke.mockResolvedValue([])

      await api.listEntries()

      expect(mockInvoke).toHaveBeenCalledWith('list_entries')
    })

    it('createEntry should pass input', async () => {
      const input = {
        name: 'Test',
        password: 'secret',
        url: 'https://example.com',
      }
      mockInvoke.mockResolvedValue({ id: '1', ...input })
      
      await api.createEntry(input)
      
      expect(mockInvoke).toHaveBeenCalledWith('create_entry', { input })
    })

    it('updateEntry should pass id and input', async () => {
      const input = {
        name: 'Updated',
        password: 'new-secret',
      }
      mockInvoke.mockResolvedValue({ id: '1', ...input })
      
      await api.updateEntry('1', input)
      
      expect(mockInvoke).toHaveBeenCalledWith('update_entry', { 
        id: '1', 
        input 
      })
    })

    it('deleteEntry should pass id', async () => {
      mockInvoke.mockResolvedValue(undefined)
      
      await api.deleteEntry('1')
      
      expect(mockInvoke).toHaveBeenCalledWith('delete_entry', { id: '1' })
    })

    it('getPassword should pass id', async () => {
      mockInvoke.mockResolvedValue('decrypted-password')
      
      const result = await api.getPassword('1')
      
      expect(mockInvoke).toHaveBeenCalledWith('get_password', { id: '1' })
      expect(result).toBe('decrypted-password')
    })
  })

  describe('data', () => {
    it('exportSql should call invoke', async () => {
      mockInvoke.mockResolvedValue('SQL content')
      
      const result = await api.exportSql()
      
      expect(mockInvoke).toHaveBeenCalledWith('export_sql')
      expect(result).toBe('SQL content')
    })

    it('getDbPath should call invoke', async () => {
      mockInvoke.mockResolvedValue('/path/to/db')
      
      const result = await api.getDbPath()
      
      expect(mockInvoke).toHaveBeenCalledWith('get_db_path')
      expect(result).toBe('/path/to/db')
    })

    it('importSql should pass sql', async () => {
      mockInvoke.mockResolvedValue(undefined)
      
      await api.importSql('INSERT INTO ...')
      
      expect(mockInvoke).toHaveBeenCalledWith('import_sql', { 
        sql: 'INSERT INTO ...' 
      })
    })
  })
})
