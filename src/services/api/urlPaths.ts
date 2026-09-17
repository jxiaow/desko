import { invoke } from '@tauri-apps/api/core'
import type { UrlPath, CreateUrlPathInput, UpdateUrlPathInput } from '../../types'

export const urlPathsApi = {
  listUrlPaths: (entryId: string): Promise<UrlPath[]> =>
    invoke('list_url_paths', { entryId }),
  createUrlPath: (input: CreateUrlPathInput): Promise<UrlPath> =>
    invoke('create_url_path', { input }),
  updateUrlPath: (id: string, input: UpdateUrlPathInput): Promise<void> =>
    invoke('update_url_path', { id, input }),
  deleteUrlPath: (id: string): Promise<void> =>
    invoke('delete_url_path', { id }),
}
