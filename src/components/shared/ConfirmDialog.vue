<script setup lang="ts">
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  dialog: { show: boolean; title: string; message: string }
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

// 常驻组件，注册时机跟着可见性走，否则它在栈里的位置是"应用启动那一下"，
// 叠在它上面的设置弹窗反而会先被 Esc 关掉
useEscapeClose(() => emit('cancel'), () => props.dialog.show)
</script>

<template>
  <Transition name="dialog">
    <div v-if="dialog.show" class="dialog-overlay">
    <div class="dialog confirm-dialog" role="dialog" aria-modal="true" :aria-label="dialog.title">
      <div class="dialog-header">
        <h3>{{ dialog.title }}</h3>
        <button  class="dialog-close" @click="emit('cancel')" title="关闭">
          <AppIcon name="x" :size="18" />
        </button>
      </div>
      <div class="dialog-body">
        <p>{{ dialog.message }}</p>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" @click="emit('cancel')">取消</button>
        <button class="btn-danger" @click="emit('confirm')">确定</button>
      </div>
    </div>
    </div>
  </Transition>
</template>

<style scoped>
.confirm-dialog {
  width: 360px;
}
</style>
