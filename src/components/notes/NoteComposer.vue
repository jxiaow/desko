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
  background: var(--bg-card, #ffffff);
  border: 1px solid var(--border-card, rgba(0, 0, 0, 0.05));
  border-radius: 12px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02), 0 6px 18px -4px rgba(0, 0, 0, 0.04);
  container-type: inline-size;
  container-name: slip;
  transition: all 0.24s cubic-bezier(0.16, 1, 0.3, 1);
  margin-top: 4px;
  margin-bottom: 12px;
}
.composer:hover {
  border-color: var(--card-line-hover, rgba(37, 99, 235, 0.25));
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.03), 0 10px 24px -4px rgba(37, 99, 235, 0.06);
}
/* 焦点态：纤细 1px 微边框，无外散粗环 */
.composer:focus-within {
  border-color: var(--accent);
  box-shadow: none;
}

/* 工具栏不画分隔线：书写面本身就是一张卡，卡里再切一刀会把它读成两个控件。 */
.composer-bar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 4px 12px 6px;
  border-top: 0;
}
.composer-hint { font-size: 11px; color: var(--text-faint); margin-left: var(--space-1); }
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
   本卡内边距挂在 .ProseMirror 上，内容盒=卡宽−2，所以 960 就是卡宽 962 翻转，
   与 NoteCard 那条 916 同一卡宽生效。
   工具条不收：阅读卡的动作本来就贴卡右缘（时间/动作 margin-left:auto），
   书写条跟着贴才不空半张；把条一起收进 720 会让保存悬在卡中间。 */
@container slip (min-width: 960px) {
  .composer > :deep(.note-editor) { max-width: 100%; }
}
</style>
