<script setup lang="ts">
import { ref } from 'vue'
import EntryFields from './EntryFields.vue'
import { useEscapeClose } from '../../composables/useEscapeClose'

defineProps<{ categories: string[] }>()

const emit = defineEmits<{
  close: []
  saved: [id: string]
}>()

const fields = ref<InstanceType<typeof EntryFields> | null>(null)

const onSaved = (id: string) => {
  emit('saved', id)
  emit('close')
}

useEscapeClose(() => emit('close'))
</script>

<template>
  <Transition name="dialog">
    <div v-if="true" class="dialog-overlay">
      <div class="dialog">
        <div class="dialog-header">
          <h3>新增条目</h3>
          <button class="dialog-close" type="button" title="关闭 (Esc)" @click="emit('close')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="dialog-body">
          <EntryFields ref="fields" :entry="null" :categories="categories" @saved="onSaved" />
        </div>
        <div class="dialog-footer">
          <button class="btn-secondary" type="button" @click="emit('close')">取 消</button>
          <button class="btn-primary" type="button" @click="fields?.save()">保 存</button>
        </div>
      </div>
    </div>
  </Transition>
</template>
