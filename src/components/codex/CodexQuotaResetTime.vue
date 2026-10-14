<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ timestamp: number | null; now: number }>()
const date = computed(() => {
  if (!props.timestamp || !Number.isFinite(props.timestamp)) return null
  const value = new Date(props.timestamp * 1000)
  return Number.isFinite(value.getTime()) ? value : null
})
const pad = (value: number) => String(value).padStart(2, '0')
const absolute = computed(() => {
  const value = date.value
  return value ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}` : ''
})
const relative = computed(() => {
  if (!date.value) return ''
  const minutes = Math.ceil((date.value.getTime() - props.now) / 60000)
  if (minutes <= 0) return '已到重置时间，等待刷新'
  const hours = Math.floor(minutes / 60)
  if (hours >= 24) return `${Math.floor(hours / 24)} 天${hours % 24 ? ` ${hours % 24} 小时` : ''}后重置`
  if (hours) return `${hours} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}后重置`
  return `${minutes} 分钟后重置`
})
</script>

<template>
  <span class="q-when">
    <template v-if="date">
      <time class="q-reset-at" :datetime="date.toISOString()" :title="`本地时间：${absolute}`">重置 {{ absolute }}</time>
      <span class="q-reset-relative">（{{ relative }}）</span>
    </template>
    <span v-else>尚未提供重置时间</span>
  </span>
</template>

<style scoped>
.q-when { display: block; white-space: nowrap; font-size: var(--text-xs); line-height: 1.5; }
.q-reset-at { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.q-reset-relative, .q-when > span:only-child { color: var(--text-muted); }
</style>
