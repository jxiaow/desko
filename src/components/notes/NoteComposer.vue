<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import NoteEditor from './NoteEditor.vue'
import NoteToolbar from './NoteToolbar.vue'
import AppIcon from '../shared/AppIcon.vue'
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

/**
 * 收起只认「这一轮还没落笔」：指针按下或第一次改动算落笔，正文清空（发布 / 放弃 / 删干净）重新收。
 * 焦点不参与——失焦当场收高度，会把同一颗点击的 mouseup 从钮底下抽走（卡排就在这种点击里点不中）。
 */
const touched = ref(false)
const collapsed = computed(() => props.empty && !touched.value)
watch(() => props.empty, empty => { if (empty) touched.value = false })

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
  <section class="composer" :class="{ 'is-empty': props.empty, 'is-collapsed': collapsed }" @pointerdown="touched = true">
    <NoteEditor
      ref="editorRef"
      variant="composer"
      :initial-content="props.html"
      :save-image="saveImageToDraft"
      placeholder="记一条…"
      @update="emit('update', $event)"
      @submit="emit('publish')"
    />
    <!-- 空白便签条右端一枚淡加号：说明这是入口，不是一条空小记；点它等于点书写条 -->
    <span v-if="collapsed" class="composer-plus" aria-hidden="true"><AppIcon name="plus" :size="15" /></span>
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
/* 便签条：空且失焦时收成一行，聚焦或有内容时才是三行书写面。 */
.composer {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border-composer);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  transition: background-color var(--transition), border-color var(--transition), box-shadow var(--transition);
  margin-bottom: 0;
}
/* 焦点态：容器描边转主色 + 3px 光圈，指明当前唯一的书写面 */
.composer:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring), var(--shadow-sm); }

/* 空白便签条右端一枚淡加号：不接指针（点它等于点书写条） */
.composer-plus {
  position: absolute;
  top: 11px;
  right: 14px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--text-faint);
  pointer-events: none;
}
.composer:focus-within .composer-plus { display: none; }
/* 收起态（本轮未落笔）：46px 一行，工具栏一起收起；右内距给加号留位。
   带 .is-empty 是为了压过 NoteEditor 里 v-composer 的三行地板。 */
.composer.is-empty.is-collapsed :deep(.ProseMirror) {
  min-height: 46px;
  max-height: 46px;
  padding: 11px 44px 11px var(--space-4);
  overflow: hidden;
}
.composer.is-empty.is-collapsed .composer-bar { display: none; }

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
</style>
