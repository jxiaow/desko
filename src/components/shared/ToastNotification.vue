<script setup lang="ts">
defineProps<{
  toast: { show: boolean; message: string; type: 'success' | 'error' | 'info' }
}>()
</script>

<template>
  <Transition name="toast">
    <div v-if="toast.show" class="toast" :class="toast.type">
      {{ toast.message }}
    </div>
  </Transition>
</template>

<style scoped>
/* 右下角反色胶囊（V5.2 §7）：贴边 20px 与批量底栏同档，但底栏居中、两不相撞。
   反色面由主题给：--toast-bg 纸底是暗胶囊、墨底翻成亮胶囊，字色走 --toast-* 三档。 */
.toast {
  position: fixed;
  right: var(--space-5);
  bottom: var(--space-5);
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: 500;
  z-index: 2000;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 360px;
  background: var(--toast-bg);
}

.toast.success { color: var(--toast-ok); }
.toast.error { color: var(--toast-err); }
.toast.info { color: var(--toast-info); }

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
