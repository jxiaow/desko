<script setup lang="ts">
import AppIcon from './AppIcon.vue'

defineProps<{ label: string }>()
</script>

<template>
  <button class="btn-primary create-action" type="button" :title="label" :aria-label="label"><AppIcon name="plus" :size="14" /></button>
</template>

<style scoped>
.page-bar .create-action { --bg-workspace-primary: var(--bg-workspace-selected); --bg-workspace-primary-hover: var(--bg-workspace-hover); --bg-workspace-primary-active: var(--bg-workspace-selected); --text-workspace-primary: var(--text-brand); display: inline-flex; align-items: center; justify-content: center; gap: 0; width: 28px; min-width: 28px; height: 28px; padding: 0; border-radius: 7px; flex-shrink: 0; }
.web-runtime .create-action { width: 40px; min-width: 40px; height: 40px; }
</style>
