<script setup lang="ts">
import { defineAsyncComponent, ref, onMounted, onBeforeUnmount } from 'vue'
import type { Note } from '../types'
import TurndownService from 'turndown'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'

const NoteEditor = defineAsyncComponent(() => import('./NoteEditor.vue'))

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})

const exportNote = async (note: Note) => {
  const markdown = `# ${note.title}\n\n${turndownService.turndown(note.content_html)}`
  const filePath = await save({
    defaultPath: `${note.title || '未命名笔记'}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (filePath) {
    await writeTextFile(filePath, markdown)
    emit('showToast', '导出成功', 'success')
  }
}

const contextMenu = ref({ show: false, x: 0, y: 0, note: null as Note | null })

const onNoteContextMenu = (event: MouseEvent, note: Note) => {
  event.preventDefault()
  contextMenu.value = { show: true, x: event.clientX, y: event.clientY, note }
}

const closeContextMenu = () => {
  contextMenu.value.show = false
  contextMenu.value.note = null
}

const deleteFromContextMenu = () => {
  if (contextMenu.value.note) {
    emit('deleteNote', contextMenu.value.note)
  }
  closeContextMenu()
}

const exportFromContextMenu = () => {
  if (contextMenu.value.note) {
    exportNote(contextMenu.value.note)
  }
  closeContextMenu()
}

onMounted(() => {
  document.addEventListener('click', closeContextMenu)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeContextMenu)
})

const props = defineProps<{
  notes: Note[]
  notesLoading: boolean
  noteSearchKeyword: string
  activeNoteTab: string
  selectedNote: Note | null
  noteCategories: string[]
  filteredNotes: Note[]
}>()

const emit = defineEmits<{
  'update:noteSearchKeyword': [value: string]
  'update:activeNoteTab': [value: string]
  'update:selectedNote': [note: Note]
  selectNote: [note: Note]
  openNewNote: []
  noteTitleChange: []
  noteContentChange: [html: string]
  deleteNote: [note: Note]
  showToast: [msg: string, type?: 'success' | 'error' | 'info']
}>()

const onTitleInput = (event: Event) => {
  if (!props.selectedNote) return
  const newTitle = (event.target as HTMLInputElement).value
  emit('update:selectedNote', { ...props.selectedNote, title: newTitle })
  emit('noteTitleChange')
}

const stripHtml = (html: string) => {
  const div = document.createElement('div')
  div.innerHTML = html
  const text = div.textContent || ''
  return text.length > 120 ? text.slice(0, 120) + '...' : text
}

const formatDate = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
</script>

<template>
  <div class="notes-layout">
    <div class="notes-list-panel">
      <div class="notes-list-header">
        <div class="search-box">
          <span class="search-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input :value="noteSearchKeyword" @input="emit('update:noteSearchKeyword', ($event.target as HTMLInputElement).value)" placeholder="搜索..." />
          <button v-if="noteSearchKeyword" class="search-clear" @click="emit('update:noteSearchKeyword', '')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <button class="btn-primary" @click="emit('openNewNote')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>
      <div class="notes-tabs">
        <div class="tab" :class="{ active: activeNoteTab === 'all' }" @click="emit('update:activeNoteTab', 'all')">全部</div>
        <div v-for="cat in noteCategories" :key="cat" class="tab" :class="{ active: activeNoteTab === cat }" @click="emit('update:activeNoteTab', cat)">{{ cat }}</div>
      </div>
      <div class="notes-list" v-if="!notesLoading">
        <div v-for="note in filteredNotes" :key="note.id"
             class="note-list-item"
             :class="{ active: selectedNote?.id === note.id }"
             @click="emit('selectNote', note)"
             @contextmenu="onNoteContextMenu($event, note)">
          <div class="note-list-title">{{ note.title || '无标题' }}</div>
          <div class="note-list-preview">{{ stripHtml(note.content_html) || '无内容' }}</div>
          <div class="note-list-meta">
            <span>{{ formatDate(note.updated_at) }}</span>
            <span v-if="note.category" class="note-list-cat">{{ note.category }}</span>
          </div>
        </div>
        <div v-if="!filteredNotes.length" class="notes-empty">
          <div class="empty-title">{{ noteSearchKeyword ? '未找到' : '暂无笔记' }}</div>
        </div>
      </div>
      <div v-else class="notes-loading">
        <div class="skeleton-note" v-for="n in 5" :key="n">
          <div class="skeleton-line short"></div>
          <div class="skeleton-line shorter"></div>
        </div>
      </div>
    </div>

    <div class="notes-editor-panel">
      <div v-if="selectedNote" class="notes-editor-container">
        <div class="notes-editor-header">
          <input class="notes-title-input" :value="selectedNote.title" @input="onTitleInput($event)" placeholder="无标题" />
          <button class="note-action-btn" @click="exportNote(selectedNote)" title="导出为 Markdown">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <button class="note-delete-btn" @click="emit('deleteNote', selectedNote)" title="删除">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
        <NoteEditor :key="selectedNote.id" :initial-content="selectedNote.content_html" @update="emit('noteContentChange', $event)" />
      </div>
      <div v-else class="notes-editor-empty">
        <div class="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div class="empty-title">选择一篇笔记</div>
        <div class="empty-desc">或点击 + 新建</div>
      </div>
    </div>

    <div v-if="contextMenu.show" class="context-menu" :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }">
      <div class="context-menu-item" @click="exportFromContextMenu">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        导出
      </div>
      <div class="context-menu-item danger" @click="deleteFromContextMenu">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        删除
      </div>
    </div>
  </div>
</template>

<style scoped>
.notes-layout { display: flex; flex: 1; overflow: hidden; background: var(--bg); }
.notes-list-panel { width: 250px; border-right: 1px solid var(--border); display: flex; flex-direction: column; background: var(--panel-bg); flex-shrink: 0; }
.notes-list-header { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.notes-list-header .search-box { flex: 1; height: 28px; }
.notes-list-header .btn-primary { height: 28px; width: 28px; padding: 0; border-radius: 6px; justify-content: center; }
.notes-tabs { display: flex; gap: 2px; padding: 5px 8px; border-bottom: 1px solid var(--border); overflow-x: auto; }
.notes-tabs::-webkit-scrollbar { display: none; }
.notes-tabs .tab { padding: 3px 7px; font-size: 11px; border-radius: 4px; white-space: nowrap; }
.notes-list { flex: 1; overflow-y: auto; padding: 3px 0; }
.notes-list::-webkit-scrollbar { width: 3px; }
.notes-list::-webkit-scrollbar-track { background: transparent; }
.notes-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

.note-list-item { padding: 8px 10px; margin: 0 5px; border-radius: 6px; cursor: pointer; transition: all 0.1s ease; }
.note-list-item:hover { background: var(--hover); }
.note-list-item.active { background: var(--accent-soft); }
.note-list-item.active .note-list-title { color: var(--accent); }
.note-list-title { font-size: 12px; font-weight: 500; color: var(--text); margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.3; }
.note-list-preview { font-size: 11px; color: var(--text-muted); margin-bottom: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.4; }
.note-list-meta { display: flex; align-items: center; gap: 5px; font-size: 10px; color: var(--text-muted); }
.note-list-cat { background: var(--hover); padding: 1px 4px; border-radius: 3px; font-size: 10px; font-weight: 500; }
.notes-empty, .notes-loading { padding: 32px 16px; text-align: center; }
.notes-loading .skeleton-note { padding: 8px 10px; margin: 0 5px; }
.notes-loading .skeleton-line { height: 7px; background: var(--hover); border-radius: 3px; margin-bottom: 5px; }
.notes-loading .skeleton-line.short { width: 60%; }
.notes-loading .skeleton-line.shorter { width: 30%; }

.notes-editor-panel { flex: 1; display: flex; flex-direction: column; background: var(--bg); overflow: hidden; min-width: 0; }
.notes-editor-container { display: flex; flex-direction: column; height: 100%; }
.notes-editor-header { display: flex; align-items: center; gap: 6px; padding: 10px 18px 6px; border-bottom: 1px solid var(--border); background: #fff; }
.notes-title-input { flex: 1; border: none; background: transparent; font-size: 16px; font-weight: 600; color: var(--text); outline: none; font-family: inherit; padding: 3px 0; }
.notes-title-input::placeholder { color: var(--text-muted); font-weight: 400; }

.note-action-btn { width: 26px; height: 26px; border: none; background: transparent; border-radius: 5px; cursor: pointer; color: var(--text-muted); display: flex; align-items: center; justify-content: center; transition: all 0.1s; opacity: 0.5; }
.note-action-btn:hover { background: var(--hover); color: var(--accent); opacity: 1; }

.note-delete-btn { width: 26px; height: 26px; border: none; background: transparent; border-radius: 5px; cursor: pointer; color: var(--text-muted); display: flex; align-items: center; justify-content: center; transition: all 0.1s; opacity: 0.5; }
.note-delete-btn:hover { background: var(--danger-soft); color: var(--danger); opacity: 1; }

.notes-editor-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-muted); }
.notes-editor-empty .empty-icon { margin-bottom: 10px; opacity: 0.25; }
.notes-editor-empty .empty-title { font-size: 13px; font-weight: 500; margin-bottom: 3px; color: var(--text-secondary); }
.notes-editor-empty .empty-desc { font-size: 11px; color: var(--text-muted); }

.context-menu {
  position: fixed;
  background: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-pop);
  padding: 4px;
  min-width: 120px;
  z-index: 1000;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.1s;
}

.context-menu-item:hover {
  background: var(--hover);
}

.context-menu-item.danger {
  color: var(--danger);
}

.context-menu-item.danger:hover {
  background: var(--danger-soft);
}
</style>
