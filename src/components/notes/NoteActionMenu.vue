<script setup lang="ts">
import PopoverMenu from '../shared/PopoverMenu.vue'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{
  anchor: HTMLElement | null
  /** 全屏入口在卡片/只读态才有意义；已经在全屏里就不重复出现 */
  showFullscreen?: boolean
}>()

const emit = defineEmits<{
  fullscreen: []
  delete: []
  close: []
}>()
</script>

<template>
  <PopoverMenu :anchor="props.anchor" @close="emit('close')">
    <button v-if="props.showFullscreen !== false" class="pop-item" type="button" @click="emit('fullscreen')">
      <AppIcon name="max" :size="14" />
      全屏编辑
    </button>
    <div class="pop-sep" />
    <button class="pop-item danger" type="button" @click="emit('delete')">
      <AppIcon name="trash" :size="14" />
      删除
    </button>
  </PopoverMenu>
</template>
