<script setup lang="ts">
import AppIcon from './AppIcon.vue'

const ICONS = { success: 'check', error: 'alert', info: 'info' } as const

defineProps<{
  toast: { show: boolean; message: string; type: 'success' | 'error' | 'info' }
}>()
</script>

<template>
  <Transition name="toast">
    <div v-if="toast.show" class="toast" :class="toast.type">
      <AppIcon :name="ICONS[toast.type]" :size="13" />
      {{ toast.message }}
    </div>
  </Transition>
</template>

<style scoped>
/* 内容区顶沿居中的反色胶囊（2026-10-12 搬家轮，见 docs/design/toast/）：
   右下角在余光区、800ms 根本捕不到；顶沿居中落在动作后的视线停留区。
   居中参考系是「侧栏以右」：--toast-side 由 App.vue 按侧栏三态喂宽度，
   左上角是模块名、右上是六颗钮，都不相干。top = 标题栏 42 + 10。
   反色面由主题给：--toast-bg 纸底是暗胶囊、墨底翻成亮胶囊，字色走 --toast-* 三档。 */
.toast {
  position: fixed;
  top: 52px;
  left: calc(var(--toast-side, 56px) + (100vw - var(--toast-side, 56px)) / 2);
  transform: translateX(-50%);
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
  transition: opacity 0.18s ease, translate 0.18s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  translate: 0 8px;
}
</style>
