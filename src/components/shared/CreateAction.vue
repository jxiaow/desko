<script setup lang="ts">
import AppIcon from './AppIcon.vue'

defineProps<{ label: string }>()
</script>

<template>
  <button class="btn-primary create-action" type="button" :aria-label="label">
    <AppIcon name="plus" :size="13" />
    <span>{{ label }}</span>
  </button>
</template>

<style scoped>
.page-bar .create-action { --bg-workspace-primary: var(--bg-workspace-selected); --bg-workspace-primary-hover: var(--bg-workspace-hover); --bg-workspace-primary-active: var(--bg-workspace-selected); --text-workspace-primary: var(--text-brand); flex-shrink: 0; }
</style>
