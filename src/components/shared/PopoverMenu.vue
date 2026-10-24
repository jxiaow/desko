<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useEscapeClose } from '../../composables/useEscapeClose'
import { usePageActive } from '../../composables/usePageActive'

const pageActive = usePageActive()

const props = defineProps<{
  /** 锚定元素：浮层贴着它摆放，点它本身不触发「点击外部关闭」 */
  anchor: HTMLElement | null
  align?: 'end' | 'start'
  wide?: boolean
  /** 挂在弹窗（.dialog-overlay z-index 1000）之上时用 */
  modal?: boolean
  /** 定宽面板：盖掉 .popover 的 148px 下限，给规格化的窄菜单（如 136px 动作单） */
  width?: number
  /** 选项菜单与锚定输入框同宽，窗口缩放时一并更新。 */
  matchWidth?: boolean
  role?: 'menu' | 'dialog'
  ariaLabel?: string
  panelClass?: string
  /** 项目设置可在浮层内展开另一个传送到 body 的选项菜单。 */
  nestedMenus?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
const pos = ref<{ top: number; left: number; width?: number }>({ top: 0, left: 0, width: props.width })
let anchorObserver: ResizeObserver | undefined

const place = () => {
  if (!pageActive.value) return
  const a = props.anchor
  const el = panel.value
  if (!a || !el) return
  const r = a.getBoundingClientRect()
  const desiredWidth = props.matchWidth ? Math.min(r.width, window.innerWidth - 16) : props.width
  el.style.width = desiredWidth ? `${desiredWidth}px` : ''
  const { width, height } = el.getBoundingClientRect()
  const wantLeft = props.align === 'start' ? r.left : r.right - width
  pos.value = {
    width: desiredWidth,
    left: Math.max(8, Math.min(wantLeft, window.innerWidth - width - 8)),
    top: window.innerHeight - r.bottom > height + 16
      ? r.bottom + 6
      : Math.max(8, r.top - height - 6),
  }
}

const onPointerDown = (e: MouseEvent) => {
  if (!pageActive.value) return
  const target = e.target as Node
  if (panel.value?.contains(target)) return
  if (props.anchor?.contains(target)) return
  if (props.nestedMenus && (target as Element).closest?.('.popover.modal')) return
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
  anchorObserver = new ResizeObserver(place)
  if (panel.value) anchorObserver.observe(panel.value)
  if (props.matchWidth) {
    for (let element = props.anchor; element; element = element.parentElement) anchorObserver.observe(element)
  }
  document.addEventListener('mousedown', onPointerDown, true)
  window.addEventListener('resize', onReflow)
  window.addEventListener('scroll', onReflow, true)
})

onBeforeUnmount(() => {
  anchorObserver?.disconnect()
  document.removeEventListener('mousedown', onPointerDown, true)
  window.removeEventListener('resize', onReflow)
  window.removeEventListener('scroll', onReflow, true)
})
</script>

<template>
  <Teleport to="body" :disabled="!pageActive">
    <div
      ref="panel"
      class="popover"
      :class="[props.panelClass, { wide: props.wide, modal: props.modal, fixed: !!props.width || props.matchWidth }]"
      :role="props.role || 'menu'"
      :aria-label="props.ariaLabel"
      :style="{ top: pos.top + 'px', left: pos.left + 'px', width: pos.width ? pos.width + 'px' : undefined }"
    >
      <slot />
    </div>
  </Teleport>
</template>
