<script setup lang="ts">
import { computed } from 'vue'
import { icons, type IconName } from '../../utils/icons'

const props = withDefaults(defineProps<{
  name: IconName
  size?: number
  filled?: boolean
}>(), {
  size: 14,
  filled: false,
})

// 有专用实心母版的（当前只有星标）走 Solar Round Bold 实心件；其余仍靠 fill/stroke 反相。
const markup = computed(() => {
  const solid = `${props.name}Filled` as IconName
  return props.filled && solid in icons ? icons[solid] : icons[props.name]
})
// viewBox 24 上写死 stroke 2 会让小图标相对更粗（20px 落 1.67px、12px 落 0.6px），
// 和窗控三键的发丝线不在一档。按尺寸反算，全窗实笔恒为 STROKE_PX。
// 渲染尺寸取偶数：15/13 这类奇数落在 28/32 的偶数容器里会居中到半像素，
// 1× 屏上的抗锯齿边缘就会发毛；取整后每颗图标都落在整像素上。
const STROKE_PX = 1.5
const renderSize = computed(() => Math.max(8, Math.round(props.size / 2) * 2))
const strokeWidth = computed(() => +(STROKE_PX * 24 / renderSize.value).toFixed(2))
</script>

<template>
  <svg
    :width="renderSize"
    :height="renderSize"
    viewBox="0 0 24 24"
    :fill="props.filled ? 'currentColor' : 'none'"
    :stroke="props.filled ? 'none' : 'currentColor'"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    :data-icon="props.name"
    aria-hidden="true"
    v-html="markup"
  />
</template>
