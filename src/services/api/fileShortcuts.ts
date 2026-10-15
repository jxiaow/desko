import { invoke } from '../transport'
import type { FileShortcut, CreateFileShortcutInput, UpdateFileShortcutInput } from '../../types'

export const fileShortcutsApi = {
  listFileShortcuts: (): Promise<FileShortcut[]> =>
    invoke('list_file_shortcuts'),
  createFileShortcut: (input: CreateFileShortcutInput): Promise<FileShortcut> =>
    invoke('create_file_shortcut', { input }),
  // Tauri 按 camelCase 键取 Rust 的 snake_case 参数，平铺传 shortcut_type 会被静默丢弃
  updateFileShortcut: (id: string, input: UpdateFileShortcutInput): Promise<void> =>
    invoke('update_file_shortcut', { id, name: input.name, path: input.path, shortcutType: input.shortcut_type }),
  deleteFileShortcut: (id: string): Promise<void> =>
    invoke('delete_file_shortcut', { id }),
  openFile: (path: string): Promise<void> =>
    invoke('open_file', { path }),
  openTerminal: (path: string): Promise<void> =>
    invoke('open_terminal', { path }),
}
