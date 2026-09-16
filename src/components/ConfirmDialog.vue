<script setup lang="ts">
defineProps<{
  dialog: { show: boolean; title: string; message: string }
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <Transition name="dialog">
    <div v-if="dialog.show" class="dialog-overlay" @click.self="emit('cancel')">
    <div class="dialog confirm-dialog">
      <div class="dialog-header">
        <h3>{{ dialog.title }}</h3>
        <button class="dialog-close" @click="emit('cancel')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="dialog-body">
        <p>{{ dialog.message }}</p>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" @click="emit('cancel')">取 消</button>
        <button class="btn-danger" @click="emit('confirm')">确 定</button>
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
