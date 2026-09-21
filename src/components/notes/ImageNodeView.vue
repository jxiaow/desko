<script setup lang="ts">
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { NodeViewProps } from '@tiptap/vue-3'

const props = defineProps<NodeViewProps>()

/** 拖拽中只改本地样式，松手才提交事务：每帧 updateAttributes 会把输入历史灌满 */
const liveWidth = ref<string | null>(null)
const shownWidth = computed(() => liveWidth.value ?? props.node.attrs.width ?? null)

const onPointerDown = (e: PointerEvent) => {
  e.preventDefault()
  e.stopPropagation()
  const wrap = (e.target as HTMLElement).closest<HTMLElement>('.img-node')
  const container = wrap?.closest<HTMLElement>('.ProseMirror')
  if (!wrap || !container) return
  const startPx = wrap.getBoundingClientRect().width
  const containerPx = container.clientWidth || 1
  const startX = e.clientX
  const move = (ev: PointerEvent) => {
    const pct = Math.min(100, Math.max(15, ((startPx + ev.clientX - startX) / containerPx) * 100))
    liveWidth.value = pct.toFixed(1) + '%'
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    if (liveWidth.value) props.updateAttributes({ width: liveWidth.value })
    liveWidth.value = null
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
</script>

<template>
  <NodeViewWrapper class="img-node" data-note-image :style="shownWidth ? { width: shownWidth } : undefined">
    <img :src="node.attrs.src" :alt="node.attrs.alt || ''" draggable="false" />
    <span class="img-resize" title="拖动调整宽度" @pointerdown="onPointerDown"></span>
  </NodeViewWrapper>
</template>

<style scoped>
.img-node {
  position: relative;
  max-width: 100%;
  cursor: default;
}
.img-node img {
  display: block;
  width: 100%;
  border-radius: var(--radius);
}
/* 手柄平时不占注意力：悬停或选中图片块才出现（选中态类名由 ProseMirror 加在 wrapper 上） */
.img-resize {
  position: absolute;
  right: 5px;
  bottom: 5px;
  width: 14px;
  height: 14px;
  border-right: 2px solid var(--accent);
  border-bottom: 2px solid var(--accent);
  border-radius: 0 0 var(--radius) 0;
  cursor: nwse-resize;
  opacity: 0;
  transition: opacity var(--transition);
}
.img-node:hover .img-resize,
.img-node.ProseMirror-selectednode .img-resize { opacity: 1; }
.img-node.ProseMirror-selectednode img { outline: 2px solid var(--accent); }
</style>
