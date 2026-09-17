<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useNotesStore } from '../stores/notes'
import NotesModule from '../components/notes/NotesModule.vue'

const notesStore = useNotesStore()
const {
  notes, notesLoading, noteSearchKeyword, activeNoteTab, selectedNote,
  noteCategories, filteredNotes,
} = storeToRefs(notesStore)
const {
  selectNote, openNewNote, onNoteTitleChange, onNoteContentChange,
  doDeleteNote
} = notesStore
</script>

<template>
  <NotesModule
    :notes="notes"
    :notes-loading="notesLoading"
    :note-search-keyword="noteSearchKeyword"
    :active-note-tab="activeNoteTab"
    :selected-note="selectedNote"
    :note-categories="noteCategories"
    :filtered-notes="filteredNotes"
    @update:note-search-keyword="noteSearchKeyword = $event"
    @update:active-note-tab="activeNoteTab = $event"
    @update:selected-note="selectedNote = $event"
    @select-note="selectNote"
    @open-new-note="openNewNote"
    @note-title-change="onNoteTitleChange"
    @note-content-change="onNoteContentChange"
    @delete-note="doDeleteNote"
  />
</template>
