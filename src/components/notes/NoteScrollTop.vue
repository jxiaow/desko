<script setup lang="ts">
import { ref, watch } from 'vue'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{ target: HTMLElement | null }>()
const scrolled = ref(false)

watch(() => props.target, (target, _previous, onCleanup) => {
  const update = () => { scrolled.value = !!target && target.scrollTop > 80 }
  update()
  target?.addEventListener('scroll', update, { passive: true })
  onCleanup(() => target?.removeEventListener('scroll', update))
}, { immediate: true })

function scrollToTop(event: MouseEvent) {
  const target = props.target
  if (!target) return
  // 键盘激活后按钮会消失，把焦点留回编辑器，保留原来的选区。
  if (document.activeElement === event.currentTarget) {
    const editor = target.isContentEditable ? target : target.querySelector<HTMLElement>('[contenteditable="true"]')
    editor?.focus({ preventScroll: true })
  }
  target.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
}
</script>

<template>
  <button v-if="scrolled" class="note-scroll-top ib" type="button" title="回到顶部" aria-label="回到顶部" @mousedown.prevent @click="scrollToTop">
    <AppIcon name="chevDown" :size="16" />
  </button>
</template>

<style scoped>
.note-scroll-top {
  position: absolute;
  right: 16px;
  bottom: 12px;
  z-index: 2;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-ib);
  background: var(--bg-surface);
  color: var(--text-secondary);
  box-shadow: var(--shadow-xs);
}
.note-scroll-top:hover { background: var(--bg-surface-hover); color: var(--text); }
.note-scroll-top :deep(svg) { transform: rotate(180deg); }
</style>
