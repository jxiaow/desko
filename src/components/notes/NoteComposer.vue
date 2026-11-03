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
      placeholder="记一条…"
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
/* 便签条：默认就是三行书写面 + 工具栏，空着、失焦、清空都不再收起。
   质感与小记卡同一档（落地档，docs/design/notes/13-slip-landed.md §3）：
   它就是同一叠纸里最上面那张空的，不该长得像一个输入框。 */
.composer {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-slip);
  box-shadow: none;
  container-type: inline-size;
  container-name: slip;
  transition: background-color var(--transition), border-color var(--transition), box-shadow var(--transition);
  margin-bottom: 0;
}
.composer:hover { border-color: var(--card-line-hover); }
/* 焦点态：容器描边转主色 + 3px 光圈，指明当前唯一的书写面 */
.composer:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }

/* 工具栏不画分隔线：书写面本身就是一张卡，卡里再切一刀会把它读成两个控件。 */
.composer-bar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border-top: 0;
}
.composer-hint { font-size: var(--text-xs); color: var(--text-muted); margin-left: var(--space-1); }
/* 快捷键提示只是提示，不是键帽收藏：去掉立体底与加粗下边框，留字即可。
   书写卡里已经有三个实底控件（图片 / 全屏 / 保存），再叠两枚键帽就变工具箱。 */
.composer-hint .kbd {
  padding: 0;
  border: 0;
  background: none;
  line-height: inherit;
  color: var(--text-muted);
}

/* 宽窗：书写列与小记卡正文同宽（同一张纸的读写两态，列不该错位）。
   阈值与 NoteCard 同一推导，默认 1040 窗口下不激活。 */
@container slip (min-width: 960px) {
  .composer > :deep(.note-editor),
  .composer-bar { max-width: 720px; }
}
</style>
