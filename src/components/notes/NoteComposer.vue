<script setup lang="ts">
import { ref } from 'vue'
import NoteEditor from './NoteEditor.vue'
import NoteToolbar from './NoteToolbar.vue'
import type { SaveImage } from '../../services/attachmentSrc'

const props = defineProps<{
  html: string
  empty: boolean
  saveImage?: SaveImage
}>()

const emit = defineEmits<{
  update: [html: string]
  publish: []
  addImage: []
  fullscreen: []
}>()

const editorRef = ref<InstanceType<typeof NoteEditor> | null>(null)

/** 这条面永远写草稿，落盘时 noteId 给空（文件只暂存，发布才补附件记录） */
const saveImageToDraft = async (source: File | string) => (await props.saveImage?.(source, null)) ?? null

const focus = () => editorRef.value?.focusEnd()
const insertImage = (src: string) => editorRef.value?.insertImage(src)

defineExpose({ focus, insertImage })

/** 放弃草稿：清空正文（父层 draftHtml 随之落空）。本就没落库，无需回退。 */
const discard = () => {
  emit('update', '')
  ;(document.activeElement as HTMLElement | null)?.blur()
}
</script>

<template>
  <section class="composer">
    <NoteEditor
      ref="editorRef"
      variant="composer"
      :initial-content="props.html"
      :save-image="saveImageToDraft"
      placeholder="此刻的想法… 用 #标签 归类"
      @update="emit('update', $event)"
      @submit="emit('publish')"
    />
    <div class="composer-bar">
      <NoteToolbar
        plain
        :note="null"
        primary-label="保存"
        :primary-disabled="props.empty"
        :cancel-label="props.empty ? '' : '放弃'"
        @add-image="emit('addImage')"
        @fullscreen="emit('fullscreen')"
        @cancel="discard"
        @primary="emit('publish')"
      >
        <template #hint>
          <span class="composer-hint"><span class="kbd">/</span> 命令 · <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span></span>
        </template>
      </NoteToolbar>
    </div>
  </section>
</template>

<style scoped>
/* 三行书写面常驻，聚焦时突出当前输入区域。 */
.composer {
  background: var(--bg-surface);
  border: 1px solid var(--border-composer);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  transition: background-color var(--transition), border-color var(--transition), box-shadow var(--transition);
  margin-bottom: var(--space-5);
}
/* 焦点态：容器描边转主色 + 3px 光圈，指明当前唯一的书写面 */
.composer:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring), var(--shadow-sm); }

/* 工具栏固定占位，聚焦、失焦和清空内容时都保持可见。 */
.composer-bar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--border);
}
.composer-hint { font-size: var(--text-xs); color: var(--text-muted); margin-left: var(--space-1); }
</style>
