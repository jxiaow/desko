<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useEscapeClose } from '../../composables/useEscapeClose'

const props = defineProps<{
  /** 锚定元素：浮层贴着它摆放，点它本身不触发「点击外部关闭」 */
  anchor: HTMLElement | null
  align?: 'end' | 'start'
  wide?: boolean
  /** 挂在弹窗（.dialog-overlay z-index 1000）之上时用 */
  modal?: boolean
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

// Esc 走全局分层栈：浮层后开、后登记，一次按键只关它，不连带底下的弹窗
useEscapeClose(() => emit('close'))

// 浮层是 fixed 定位，页面滚动或缩放后跟着锚点重摆。
// 原先是滚动即关闭，但点击前浏览器补发的 scroll 事件会晚于挂载一帧，
// 弹窗里刚展开的下拉会被这记延迟 scroll 秒关。
const onReflow = () => place()

onMounted(() => {
  place()
  document.addEventListener('mousedown', onPointerDown, true)
  window.addEventListener('resize', onReflow)
  window.addEventListener('scroll', onReflow, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onPointerDown, true)
  window.removeEventListener('resize', onReflow)
  window.removeEventListener('scroll', onReflow, true)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="panel"
      class="popover"
      :class="{ wide: props.wide, modal: props.modal }"
      role="menu"
      :style="{ top: pos.top + 'px', left: pos.left + 'px' }"
    >
      <slot />
    </div>
  </Teleport>
</template>
