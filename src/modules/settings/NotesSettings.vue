<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useNotesStore } from '../../stores/notes'
import AppIcon from '../../components/shared/AppIcon.vue'

const emit = defineEmits<{
  openChangeNoteKey: [mode: 'unlock' | 'change']
}>()

const notesStore = useNotesStore()
const { noteKey } = storeToRefs(notesStore)
</script>

<template>
  <div class="group-content">
    <div
      v-if="noteKey.is_set"
      class="setting-item clickable"
      @click="emit('openChangeNoteKey', noteKey.is_open ? 'change' : 'unlock')"
    >
      <div class="setting-info">
        <span class="setting-name">修改小记口令</span>
      </div>
      <AppIcon class="arrow-icon" name="chevRight" :size="16" />
    </div>
    <div v-else class="setting-item">
      <div class="setting-info">
        <span class="setting-name">小记口令</span>
        <span class="setting-desc">还没有给任何小记设置口令</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.arrow-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}
</style>
