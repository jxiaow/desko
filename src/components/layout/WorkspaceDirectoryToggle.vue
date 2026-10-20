<script setup lang="ts">
import { inject } from 'vue'
import { workspaceDirectoryKey } from './workspaceLayout'
import AppIcon from '../shared/AppIcon.vue'

const directory = inject(workspaceDirectoryKey)
</script>

<template>
  <button v-if="directory" id="workspace-directory-toggle" class="bar-btn workspace-directory-toggle" type="button" :title="directory.visible.value ? '收起目录 (Ctrl+B)' : '展开目录 (Ctrl+B)'" :aria-label="directory.visible.value ? '收起目录' : '展开目录'" :aria-expanded="directory.visible.value" aria-controls="workspace-directory" @click="directory.toggle">
    <AppIcon name="panel" :size="16" />
  </button>
</template>

<style scoped>
.workspace-directory-toggle { flex-shrink: 0; }
.workspace-directory-toggle[aria-expanded="true"] { background: var(--sidebar-active); color: var(--text); }
</style>
