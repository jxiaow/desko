<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  /** 锚定元素：浮层贴着它摆放，点它本身不触发「点击外部关闭」 */
  anchor: HTMLElement | null
  align?: 'end' | 'start'
  wide?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
const pos = ref({ top: 0, left: 0 })

const place = () => {
  const a = props.anchor
  const el = panel.value
  if (!a || !el) return
  const r = a.getBoundingClientRect()
  const { width, height } = el.getBoundingClientRect()
  const wantLeft = props.align === 'start' ? r.left : r.right - width
  pos.value = {
    left: Math.max(8, Math.min(wantLeft, window.innerWidth - width - 8)),
    top: window.innerHeight - r.bottom > height + 16
      ? r.bottom + 6
      : Math.max(8, r.top - height - 6),
  }
}

const onPointerDown = (e: MouseEvent) => {
  const target = e.target as Node
  if (panel.value?.contains(target)) return
  if (props.anchor?.contains(target)) return
  emit('close')
}

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}

// 浮层是 fixed 定位，页面滚动后就会与锚点错位，直接关闭最省事
const onScroll = () => emit('close')

onMounted(() => {
  place()
  document.addEventListener('mousedown', onPointerDown, true)
  document.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('resize', onScroll)
  window.addEventListener('scroll', onScroll, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onPointerDown, true)
  document.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('resize', onScroll)
  window.removeEventListener('scroll', onScroll, true)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="panel"
      class="popover"
      :class="{ wide: props.wide }"
      role="menu"
      :style="{ top: pos.top + 'px', left: pos.left + 'px' }"
    >
      <slot />
    </div>
  </Teleport>
</template>
