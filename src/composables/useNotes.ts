import { ref, computed, onBeforeUnmount } from 'vue'
import { api } from '../services/api'
import type { Note } from '../types'

export function useNotes(showToast: (msg: string, type?: 'success' | 'error' | 'info') => void, showConfirm: (title: string, msg: string, cb: () => void) => void) {
  const notes = ref<Note[]>([])
  const notesLoading = ref(false)
  const noteSearchKeyword = ref('')
  const activeNoteTab = ref('all')
  const selectedNote = ref<Note | null>(null)
  const noteSaveTimer = ref<number | null>(null)

  const noteCategories = computed(() => {
    const cats = new Set<string>()
    notes.value.forEach(n => { if (n.category) cats.add(n.category) })
    return Array.from(cats).sort()
  })

  const filteredNotes = computed(() => {
    let result = notes.value
    if (activeNoteTab.value !== 'all') {
      result = result.filter(n => n.category === activeNoteTab.value)
    }
    if (noteSearchKeyword.value) {
      const kw = noteSearchKeyword.value.toLowerCase()
      result = result.filter(n => n.title.toLowerCase().includes(kw) || n.content_html.toLowerCase().includes(kw))
    }
    return result
  })

  const fetchNotes = async () => {
    notesLoading.value = true
    try {
      notes.value = await api.listNotes()
    } catch (e: any) {
      showToast('加载笔记失败: ' + e.message, 'error')
    } finally {
      notesLoading.value = false
    }
  }

  const selectNote = (note: Note) => {
    selectedNote.value = { ...note }
  }

  const openNewNote = async () => {
    try {
      const note = await api.createNote({ title: '', content_html: '', category: undefined })
      notes.value.unshift(note)
      selectedNote.value = { ...note }
    } catch (e: any) {
      showToast('创建失败：' + e.message, 'error')
    }
  }

  const saveSelectedNote = async () => {
    if (!selectedNote.value) return
    try {
      await api.updateNote(selectedNote.value.id, {
        title: selectedNote.value.title,
        content_html: selectedNote.value.content_html,
        category: selectedNote.value.category || undefined,
      })
      const idx = notes.value.findIndex(n => n.id === selectedNote.value!.id)
      if (idx >= 0) {
        notes.value[idx] = { ...selectedNote.value }
      }
    } catch (e: any) {
      showToast('保存失败：' + e.message, 'error')
    }
  }

  const onNoteTitleChange = () => {
    if (!selectedNote.value) return
    if (noteSaveTimer.value) clearTimeout(noteSaveTimer.value)
    noteSaveTimer.value = window.setTimeout(() => saveSelectedNote(), 500)
  }

  const onNoteContentChange = (html: string) => {
    if (!selectedNote.value) return
    selectedNote.value.content_html = html
    if (noteSaveTimer.value) clearTimeout(noteSaveTimer.value)
    noteSaveTimer.value = window.setTimeout(() => saveSelectedNote(), 500)
  }

  const doDeleteNote = (note: Note) => {
    showConfirm('确认删除', `确定删除笔记「${note.title || '无标题'}」吗？`, async () => {
      try {
        await api.deleteNote(note.id)
        notes.value = notes.value.filter(n => n.id !== note.id)
        if (selectedNote.value?.id === note.id) {
          selectedNote.value = null
        }
        showToast('笔记已删除')
      } catch (e: any) {
        showToast('删除失败：' + e.message, 'error')
      }
    })
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

  onBeforeUnmount(() => {
    if (noteSaveTimer.value) clearTimeout(noteSaveTimer.value)
  })

  return {
    notes, notesLoading, noteSearchKeyword, activeNoteTab, selectedNote,
    noteCategories, filteredNotes,
    fetchNotes, selectNote, openNewNote, onNoteTitleChange, onNoteContentChange,
    doDeleteNote, stripHtml, formatDate,
  }
}
