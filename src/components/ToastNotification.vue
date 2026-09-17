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
}

.toast.success { background: #0f172a; color: #4ade80; }
.toast.error { background: #0f172a; color: #f87171; }
.toast.info { background: #0f172a; color: #60a5fa; }

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
