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
      <div class="toast-badge">
        <AppIcon class="toast-icon" :name="ICONS[toast.type]" :size="12" />
      </div>
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
  padding: 5px 16px 5px 7px;
  border-radius: 999px;
  font-size: var(--text-xs);
  line-height: 18px;
  font-weight: 550;
  z-index: 2000;
  /* 现代悬浮微胶囊通知：浅色纯白通透高对比，深色黑曜岩稳重高清晰 */
  box-shadow: 0 10px 30px -4px rgba(15, 23, 42, 0.12), 0 3px 10px -2px rgba(15, 23, 42, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.08);
  display: flex;
  align-items: center;
  gap: 8px;
  width: max-content;
  max-width: min(400px, calc(100vw - var(--toast-side, 56px) - var(--toast-right, 0px) - 24px));
  overflow: hidden;
  background: var(--toast-bg, #ffffff);
  color: var(--toast-fg, #1e293b);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
:global(:root[data-base='dark']) .toast {
  background: var(--toast-bg, #20232c);
  color: var(--toast-fg, #f1f3f7);
  box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.5), 0 4px 12px -2px rgba(0, 0, 0, 0.3);
  border-color: rgba(255, 255, 255, 0.1);
}

.toast-badge {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.toast-icon {
  flex: none;
}

.toast.success .toast-badge {
  background: #dcfce7;
  color: #15803d;
}
.toast.error .toast-badge {
  background: #fee2e2;
  color: #dc2626;
}
.toast.info .toast-badge {
  background: var(--accent-soft);
  color: var(--accent);
}

:global(:root[data-base='dark']) .toast.success .toast-badge {
  background: rgba(34, 197, 94, 0.18);
  color: #4ade80;
}
:global(:root[data-base='dark']) .toast.error .toast-badge {
  background: rgba(239, 68, 68, 0.18);
  color: #f87171;
}
:global(:root[data-base='dark']) .toast.info .toast-badge {
  background: var(--accent-soft);
  color: var(--accent);
}

.toast-message {
  min-width: 0;
  max-height: min(216px, calc(100dvh - 88px));
  overflow-y: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  color: inherit;
  letter-spacing: -0.01em;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1), translate 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  translate: 0 -6px;
}
</style>
