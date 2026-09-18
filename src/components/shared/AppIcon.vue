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

const markup = computed(() => icons[props.name])
</script>

<template>
  <svg
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    :fill="props.filled ? 'currentColor' : 'none'"
    :stroke="props.filled ? 'none' : 'currentColor'"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="markup"
  />
</template>
