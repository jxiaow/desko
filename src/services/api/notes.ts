import { uploadBrowserImage } from '../browserImage'
import { invoke } from '../transport'
import type { Note, CreateNoteInput, UpdateNoteInput, Attachment } from '../../types'
import type { NoteExportFile, NoteExportFormat } from '../../utils/noteExport'

export const notesApi = {
  exportImages: (names: string[]): Promise<Record<string, string>> =>
    invoke('note_export_images', { names }),
  writeExport: (path: string, format: NoteExportFormat, files: NoteExportFile[], noteIds: string[]): Promise<void> =>
    invoke('note_export_write', { path, format, files, noteIds }),
  listNotes: (): Promise<Note[]> =>
    invoke('list_notes'),
  createNote: (input: CreateNoteInput): Promise<Note> =>
    invoke('create_note', { input }),
  updateNote: (id: string, input: UpdateNoteInput): Promise<void> =>
    invoke('update_note', { id, input }),
  stageDrafts: (drafts: NoteDraft[]): Promise<void> =>
    invoke('stage_note_drafts', { drafts }),
  recoverDrafts: (): Promise<NoteDraft[]> =>
    invoke('recover_note_drafts'),
  deleteNote: (id: string): Promise<void> =>
    invoke('delete_note', { id }),
  batchDeleteNotes: (ids: string[]): Promise<number> =>
    invoke('batch_delete_notes', { ids }),
  togglePinNote: (id: string): Promise<boolean> =>
    invoke('toggle_pin_note', { id }),
  toggleStarNote: (id: string): Promise<boolean> =>
    invoke('toggle_star_note', { id }),
  setNoteArchived: (id: string, archived: boolean): Promise<boolean> =>
    invoke('set_note_archived', { id, archived }),
  batchSetArchived: (ids: string[], archived: boolean): Promise<number> =>
    invoke('batch_set_archived', { ids, archived }),
  /** 小记域口令：全库一把，状态分「设过」与「本会话已解开」 */
  noteKeyStatus: (): Promise<NoteKeyStatus> =>
    invoke('note_key_status'),
  /** 首次设口令，顺带把旧逐条封条改封，返回全部明文 */
  noteKeySetup: (passphrase: string): Promise<NotePlain[]> =>
    invoke('note_key_setup', { passphrase }),
  noteKeyUnlock: (passphrase: string): Promise<NotePlain[]> =>
    invoke('note_key_unlock', { passphrase }),
  /** 兜底：会话已解锁时免输入，用主密钥封条取回域密钥 */
  noteKeyRecover: (): Promise<NotePlain[]> =>
    invoke('note_key_recover'),
  noteKeyRelock: (): Promise<void> =>
    invoke('note_key_relock'),
  noteKeyChange: (passphrase: string): Promise<void> =>
    invoke('note_key_change', { passphrase }),
  /** 单条加密：正文进密文，DEK 由域密钥封住 */
  lockNote: (id: string): Promise<void> =>
    invoke('lock_note', { id }),
  unlockNote: (id: string): Promise<string> =>
    invoke('unlock_note', { id }),
  relockNote: (id: string): Promise<void> =>
    invoke('relock_note', { id }),
  removeNoteLock: (id: string, input: UpdateNoteInput): Promise<void> =>
    invoke('remove_note_lock', { id, input }),
  revealNote: (id: string): Promise<string> =>
    invoke('reveal_note', { id }),
  listAttachments: (noteId: string): Promise<Attachment[]> =>
    invoke('list_attachments', { noteId }),
  uploadAttachment: (noteId: string, filePath: string | File): Promise<Attachment> =>
    typeof filePath === 'string' ? invoke('upload_attachment', { noteId, filePath }) : uploadBrowserImage(filePath, noteId),
  /** 草稿还没有 note id：先把文件收进附件目录，发布时再补记录 */
  stageAttachment: (filePath: string | File): Promise<Attachment> =>
    typeof filePath === 'string' ? invoke('stage_attachment', { filePath }) : uploadBrowserImage(filePath),
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

export interface NoteKeyStatus {
  /** 全库口令是否设过 */
  is_set: boolean
  /** 本会话是否已解开（域密钥在手） */
  is_open: boolean
}

export interface NotePlain {
  id: string
  html: string
}

export interface NoteDraft {
  id: string
  input: UpdateNoteInput
}
