<script setup lang="ts">
import PopoverMenu from '../shared/PopoverMenu.vue'
import AppIcon from '../shared/AppIcon.vue'
import type { Entry } from '../../types'

const props = defineProps<{
  anchor: HTMLElement | null
  entry: Entry
}>()

const emit = defineEmits<{
  detail: []
  edit: []
  duplicate: []
  openUrl: [url: string]
  delete: []
  close: []
}>()
</script>

<template>
  <PopoverMenu :anchor="props.anchor" @close="emit('close')">
    <button class="pop-item" type="button" @click="emit('detail')">
      <AppIcon name="eye" :size="14" />
      查看详情
    </button>
    <button class="pop-item" type="button" @click="emit('edit')">
      <AppIcon name="edit" :size="14" />
      编辑
    </button>
    <button
      v-if="props.entry.url"
      class="pop-item"
      type="button"
      @click="emit('openUrl', props.entry.url!)"
    >
      <AppIcon name="external" :size="14" />
      在浏览器打开
    </button>
    <button class="pop-item" type="button" @click="emit('duplicate')">
      <AppIcon name="copy" :size="14" />
      复制卡片
    </button>
    <div class="pop-sep" />
    <button class="pop-item danger" type="button" @click="emit('delete')">
      <AppIcon name="trash" :size="14" />
      删除
    </button>
  </PopoverMenu>
</template>
