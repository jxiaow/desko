<script setup lang="ts">
import PopoverMenu from '../shared/PopoverMenu.vue'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{
  anchor: HTMLElement | null
}>()

const emit = defineEmits<{
  detail: []
  edit: []
  duplicate: []
  delete: []
  close: []
}>()
</script>

<template>
  <PopoverMenu :anchor="props.anchor" :width="136" @close="emit('close')">
    <button class="pop-item" type="button" @click="emit('detail')">
      <AppIcon name="eye" :size="14" />
      查看详情
    </button>
    <button class="pop-item" type="button" @click="emit('edit')">
      <AppIcon name="edit" :size="14" />
      编辑条目
    </button>
    <button class="pop-item" type="button" @click="emit('duplicate')">
      <AppIcon name="copy" :size="14" />
      创建副本
    </button>
    <span class="pop-sep"></span>
    <button class="pop-item danger" type="button" @click="emit('delete')">
      <AppIcon name="trash" :size="14" />
      删除条目
    </button>
  </PopoverMenu>
</template>
