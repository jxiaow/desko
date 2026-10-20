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
      <AppIcon class="toast-icon" :name="ICONS[toast.type]" :size="13" />
      <span class="toast-message">{{ toast.message }}</span>
    </div>
  </Transition>
</template>

<style scoped>
/* 内容区顶沿居中的反色胶囊（2026-10-12 搬家轮，见 docs/design/toast/）：
   右下角在余光区、800ms 根本捕不到；顶沿居中落在动作后的视线停留区。
   居中参考系是正文区域：App.vue 用 --toast-side / --toast-right 扣除两侧面板，
   左上角是模块名、右上是六颗钮，都不相干。top = 标题栏 42 + 10。
   底色和三档字色由 --toast-* 给出；长文本换行并限制高度，短提示仍呈胶囊形。 */
.toast {
  position: fixed;
  top: 52px;
  left: calc(var(--toast-side, 56px) + (100vw - var(--toast-side, 56px) - var(--toast-right, 0px)) / 2);
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 16px;
  font-size: var(--text-xs);
  line-height: 18px;
  font-weight: 500;
  z-index: 2000;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: max-content;
  max-width: min(360px, calc(100vw - var(--toast-side, 56px) - var(--toast-right, 0px) - 24px));
  overflow: hidden;
  background: var(--toast-bg);
}

.toast-icon { flex: none; margin-top: 2.5px; }
.toast-message {
  min-width: 0;
  max-height: min(216px, calc(100dvh - 88px));
  overflow-y: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
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
