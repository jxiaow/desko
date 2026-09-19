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
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 18px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  z-index: 2000;
  box-shadow: var(--shadow-md);
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 360px;
  background: var(--toast-bg);
}

/* toast 是一块反色浮层：底色和三种文字色都由当前主题给（--toast-*），
   深色主题下它会翻成亮底暗字，而不是继续压在一团黑上。 */
.toast.success { color: var(--toast-ok); }
.toast.error { color: var(--toast-err); }
.toast.info { color: var(--toast-info); }

.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(16px) scale(0.95);
}
</style>
