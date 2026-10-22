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
        <span class="setting-desc">{{ noteKey.is_open ? '口令已在手 · 点开直接设新口令' : '口令未解锁 · 点开先解锁再改' }}</span>
      </div>
      <AppIcon class="arrow-icon" name="chevRight" :size="16" />
    </div>
    <div v-else class="setting-item">
      <div class="setting-info">
        <span class="setting-name">小记口令</span>
        <span class="setting-desc">全库共用一把口令，第一次把小记设为加密时立起来；没立过就没有可改的，这一行也就没有动作</span>
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
