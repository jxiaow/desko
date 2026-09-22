<script setup lang="ts">
import PopoverMenu from '../shared/PopoverMenu.vue'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{
  anchor: HTMLElement | null
}>()

const emit = defineEmits<{
  detail: []
  duplicate: []
  close: []
}>()
</script>

<template>
  <PopoverMenu :anchor="props.anchor" @close="emit('close')">
    <button class="pop-item" type="button" @click="emit('detail')">
      <AppIcon name="eye" :size="14" />
      查看详情
    </button>
    <button class="pop-item" type="button" @click="emit('duplicate')">
      <AppIcon name="copy" :size="14" />
      复制卡片
    </button>
  </PopoverMenu>
</template>
