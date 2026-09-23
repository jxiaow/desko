import { invoke } from '@tauri-apps/api/core'
import type { Note, CreateNoteInput, UpdateNoteInput, Attachment } from '../../types'

export const notesApi = {
  listNotes: (): Promise<Note[]> =>
    invoke('list_notes'),
  createNote: (input: CreateNoteInput): Promise<Note> =>
    invoke('create_note', { input }),
  updateNote: (id: string, input: UpdateNoteInput): Promise<void> =>
    invoke('update_note', { id, input }),
  deleteNote: (id: string): Promise<void> =>
    invoke('delete_note', { id }),
  batchDeleteNotes: (ids: string[]): Promise<number> =>
    invoke('batch_delete_notes', { ids }),
  togglePinNote: (id: string): Promise<boolean> =>
    invoke('toggle_pin_note', { id }),
  toggleStarNote: (id: string): Promise<boolean> =>
    invoke('toggle_star_note', { id }),
  /** 单条加密：正文进密文，DEK 由口令与主密码各封一条 */
  lockNote: (id: string, passphrase: string): Promise<void> =>
    invoke('lock_note', { id, passphrase }),
  unlockNote: (id: string, passphrase: string): Promise<string> =>
    invoke('unlock_note', { id, passphrase }),
  unlockNoteByMaster: (id: string, masterPassword: string): Promise<string> =>
    invoke('unlock_note_by_master', { id, masterPassword }),
  relockNote: (id: string): Promise<void> =>
    invoke('relock_note', { id }),
  removeNoteLock: (id: string, input: UpdateNoteInput): Promise<void> =>
    invoke('remove_note_lock', { id, input }),
  revealNote: (id: string): Promise<string> =>
    invoke('reveal_note', { id }),
  listAttachments: (noteId: string): Promise<Attachment[]> =>
    invoke('list_attachments', { noteId }),
  uploadAttachment: (noteId: string, filePath: string): Promise<Attachment> =>
    invoke('upload_attachment', { noteId, filePath }),
  /** 草稿还没有 note id：先把文件收进附件目录，发布时再补记录 */
  stageAttachment: (filePath: string): Promise<Attachment> =>
    invoke('stage_attachment', { filePath }),
  bindAttachments: (noteId: string, paths: string[]): Promise<Attachment[]> =>
    invoke('bind_attachments', { noteId, paths }),
  deleteAttachment: (id: string): Promise<void> =>
    invoke('delete_attachment', { id }),
  /** 无存活登记、也不被任何正文引用的附件文件（草稿刚暂存的除外） */
  orphans: (): Promise<OrphanFile[]> =>
    invoke('attachment_orphans'),
  cleanupOrphans: (names: string[]): Promise<number> =>
    invoke('attachment_cleanup', { names }),
}

export interface OrphanFile {
  name: string
  size: number
}
