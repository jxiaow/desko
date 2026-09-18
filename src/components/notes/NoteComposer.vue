<script setup lang="ts">
import { ref } from 'vue'
import NoteEditor from './NoteEditor.vue'
import NoteToolbar from './NoteToolbar.vue'

const props = defineProps<{
  html: string
  empty: boolean
}>()

const emit = defineEmits<{
  update: [html: string]
  publish: []
  addImage: []
  fullscreen: []
}>()

const editorRef = ref<InstanceType<typeof NoteEditor> | null>(null)

const focus = () => editorRef.value?.focusEnd()
const insertTag = () => editorRef.value?.insertText(' #')

defineExpose({ focus })
</script>

<template>
  <section class="composer">
    <NoteEditor
      ref="editorRef"
      variant="composer"
      :initial-content="props.html"
      placeholder="此刻的想法… 用 #标签 归类，Ctrl+Enter 发布"
      @update="emit('update', $event)"
      @submit="emit('publish')"
    />
    <div class="composer-bar">
      <NoteToolbar
        plain
        :note="null"
        primary-label="发布"
        :primary-disabled="props.empty"
        @add-image="emit('addImage')"
        @insert-tag="insertTag"
        @fullscreen="emit('fullscreen')"
        @primary="emit('publish')"
      >
        <template #hint>
          <span class="composer-hint"><span class="kbd">/</span> 命令 · <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> 发布</span>
        </template>
      </NoteToolbar>
    </div>
  </section>
</template>

<style scoped>
.composer {
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  transition: all var(--transition);
  margin-bottom: var(--space-5);
}
/* 焦点态：容器描边转主色 + 3px 光圈，指明当前唯一的书写面 */
.composer:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring), var(--shadow-sm); }
.composer-bar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--border);
}
.composer-hint { font-size: 11px; color: var(--text-muted); margin-left: var(--space-1); }
</style>
