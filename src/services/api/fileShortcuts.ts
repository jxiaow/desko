import { invoke } from '@tauri-apps/api/core'
import type { FileShortcut, CreateFileShortcutInput, UpdateFileShortcutInput } from '../../types'

export const fileShortcutsApi = {
  listFileShortcuts: (): Promise<FileShortcut[]> =>
    invoke('list_file_shortcuts'),
  createFileShortcut: (input: CreateFileShortcutInput): Promise<FileShortcut> =>
    invoke('create_file_shortcut', { input }),
  updateFileShortcut: (id: string, input: UpdateFileShortcutInput): Promise<void> =>
    invoke('update_file_shortcut', { id, ...input }),
  deleteFileShortcut: (id: string): Promise<void> =>
    invoke('delete_file_shortcut', { id }),
  openFile: (path: string): Promise<void> =>
    invoke('open_file', { path }),
  openTerminal: (path: string): Promise<void> =>
    invoke('open_terminal', { path }),
}
