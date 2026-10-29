<script setup lang="ts">
import AppIcon from './AppIcon.vue'

defineProps<{ label: string }>()
</script>

<template>
  <button class="btn-primary create-action" type="button" :aria-label="label">
    <AppIcon name="plus" :size="14" />
    <span>{{ label }}</span>
  </button>
</template>

<style scoped>
/* 底色交给工作区主钮令牌（`--bg-workspace-primary` 系）统一决定；
   这里只负责不被压缩，否则纸底会被写死回满彩强调色。 */
.page-bar .create-action { flex-shrink: 0; }
</style>
