<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useFileShortcutsStore } from '../stores/fileShortcuts'
import FileShortcutsModule from '../components/files/FileShortcutsModule.vue'
defineOptions({ name: 'files' })

const fileShortcutsStore = useFileShortcutsStore()
const {
  loading, loadError, searchKeyword, filteredShortcuts, shortcuts,
} = storeToRefs(fileShortcutsStore)
const { fetchShortcuts, addShortcut, updateShortcut, removeShortcut } = fileShortcutsStore
</script>

<template>
  <FileShortcutsModule
    :search-keyword="searchKeyword"
    :loading="loading"
    :load-error="loadError"
    :filtered-shortcuts="filteredShortcuts"
    :total-shortcuts="shortcuts.length"
    @update:search-keyword="searchKeyword = $event"
    @add-shortcut="addShortcut"
    @update-shortcut="updateShortcut"
    @remove-shortcut="removeShortcut"
    @retry-load="fetchShortcuts"
  />
</template>
