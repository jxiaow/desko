<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useFileShortcutsStore } from '../stores/fileShortcuts'
import FileShortcutsModule from '../components/files/FileShortcutsModule.vue'

const fileShortcutsStore = useFileShortcutsStore()
const {
  loading, loadError, searchKeyword, filteredShortcuts,
} = storeToRefs(fileShortcutsStore)
const { fetchShortcuts, addShortcut, updateShortcut, removeShortcut } = fileShortcutsStore
</script>

<template>
  <FileShortcutsModule
    :search-keyword="searchKeyword"
    :loading="loading"
    :load-error="loadError"
    :filtered-shortcuts="filteredShortcuts"
    @update:search-keyword="searchKeyword = $event"
    @add-shortcut="addShortcut"
    @update-shortcut="updateShortcut"
    @remove-shortcut="removeShortcut"
    @retry-load="fetchShortcuts"
  />
</template>
