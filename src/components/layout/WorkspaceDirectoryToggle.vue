<script setup lang="ts">
import { inject } from 'vue'
import { usePageActive } from '../../composables/usePageActive'
import { workspaceDirectoryKey } from './workspaceLayout'
import AppIcon from '../shared/AppIcon.vue'

const directory = inject(workspaceDirectoryKey)
const pageActive = usePageActive()
</script>

<template>
  <Teleport to="#workspace-fixed-tools" defer>
    <button v-if="directory && pageActive" id="workspace-directory-toggle" class="bar-btn workspace-directory-toggle" type="button" :data-tip="directory.visible.value ? '收起目录 (Ctrl+B)' : '展开目录 (Ctrl+B)'" :aria-label="directory.visible.value ? '收起目录' : '展开目录'" :aria-expanded="directory.visible.value" aria-controls="workspace-directory" @click="directory.toggle">
      <AppIcon name="directory" :size="16" />
    </button>
  </Teleport>
</template>

<style scoped>
.workspace-directory-toggle { flex-shrink: 0; height: 30px; }
.workspace-directory-toggle[aria-expanded="true"] { background: var(--sidebar-active); color: var(--text-brand); }
</style>
