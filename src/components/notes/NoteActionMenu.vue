<script setup lang="ts">
import PopoverMenu from '../shared/PopoverMenu.vue'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{
  anchor: HTMLElement | null
  /** 全屏入口在卡片/只读态才有意义；已经在全屏里就不重复出现 */
  showFullscreen?: boolean
  /** 加密小记换一组动作：锁着的只剩删除，解锁后的多重锁与解除加密 */
  encrypted?: boolean
  locked?: boolean
}>()

const emit = defineEmits<{
  fullscreen: []
  encrypt: []
  relock: []
  removeLock: []
  delete: []
  close: []
}>()
</script>

<template>
  <PopoverMenu :anchor="props.anchor" @close="emit('close')">
    <template v-if="!props.locked">
      <button v-if="props.showFullscreen !== false" class="pop-item" type="button" @click="emit('fullscreen')">
        <AppIcon name="max" :size="14" />
        全屏编辑
      </button>
      <template v-if="props.encrypted">
        <button class="pop-item" type="button" @click="emit('relock')">
          <AppIcon name="lock" :size="14" />
          重新锁定
        </button>
        <button class="pop-item" type="button" @click="emit('removeLock')">
          <AppIcon name="unlock" :size="14" />
          解除加密
        </button>
      </template>
      <button v-else class="pop-item" type="button" @click="emit('encrypt')">
        <AppIcon name="lock" :size="14" />
        加密
      </button>
    </template>
    <div class="pop-sep" />
    <button class="pop-item danger" type="button" @click="emit('delete')">
      <AppIcon name="trash" :size="14" />
      删除
    </button>
  </PopoverMenu>
</template>
