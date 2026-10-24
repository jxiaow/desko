<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useNotesStore } from '../../stores/notes'
import AppIcon from '../../components/shared/AppIcon.vue'

const emit = defineEmits<{
  openChangeNoteKey: [mode: 'unlock' | 'change']
}>()

const notesStore = useNotesStore()
const { noteKey, notePasteCleanup } = storeToRefs(notesStore)
const pasteSaving = ref(false)

async function togglePasteCleanup(event: Event) {
  const input = event.target as HTMLInputElement
  pasteSaving.value = true
  await notesStore.setNotePasteCleanup(input.checked)
  input.checked = notePasteCleanup.value
  pasteSaving.value = false
}
</script>

<template>
  <div class="group-content">
    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-name">粘贴时整理格式</span>
        <span class="setting-desc">合并多余空行，粘贴链接时提示转换为标题。</span>
      </div>
      <label class="switch">
        <input type="checkbox" aria-label="粘贴时整理格式" :checked="notePasteCleanup" :disabled="pasteSaving" @change="togglePasteCleanup">
        <span class="switch-slider"></span>
      </label>
    </div>
    <button
      v-if="noteKey.is_set"
      class="setting-item clickable"
      type="button"
      aria-label="修改小记口令"
      @click="emit('openChangeNoteKey', noteKey.is_open ? 'change' : 'unlock')"
    >
      <div class="setting-info">
        <span class="setting-name">修改小记口令</span>
        <span v-if="!noteKey.is_open" class="setting-desc">需先解锁再修改</span>
      </div>
      <AppIcon class="arrow-icon" name="chevRight" :size="16" />
    </button>
    <div v-else class="setting-item">
      <div class="setting-info">
        <span class="setting-name">小记口令</span>
        <span class="setting-desc">首次加密小记时设置，所有加密小记共用。</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
button.setting-item { width: 100%; border: 0; background: transparent; text-align: left; font: inherit; }
.switch input { position: absolute; inset: -12px -4px; width: 44px; height: 44px; margin: 0; z-index: 1; cursor: pointer; }
.switch input:focus-visible + .switch-slider { outline: 2px solid var(--accent); outline-offset: 2px; }
.arrow-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}
</style>
