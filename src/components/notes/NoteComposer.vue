<script setup lang="ts">
import { computed, ref } from 'vue'
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

/** 工具条只在展开时出现；有草稿时保持展开，免得失焦把内容挤成一行 */
const focused = ref(false)
const open = computed(() => focused.value || !props.empty)

defineExpose({ focus })
</script>

<template>
  <section class="composer" :class="{ open }" @focusin="focused = true" @focusout="focused = false">
    <NoteEditor
      ref="editorRef"
      variant="composer"
      :initial-content="props.html"
      placeholder="此刻的想法… 用 #标签 归类"
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

/* 收起时工具条整条让位，只留一行输入；展开才滑出来。
   visibility 不能省：max-height:0 只裁掉绘制，按钮仍可命中，会在输入框下面吃掉一截点击 */
.composer-bar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  max-height: 0;
  overflow: hidden;
  visibility: hidden;
  padding: 0 var(--space-3);
  border-top: 1px solid transparent;
  transition: max-height var(--transition-slow), padding var(--transition-slow), border-color var(--transition), visibility var(--transition-slow);
}
.composer.open .composer-bar {
  max-height: 48px;
  visibility: visible;
  padding: var(--space-2) var(--space-3);
  border-top-color: var(--border);
}
.composer-hint { font-size: 11px; color: var(--text-muted); margin-left: var(--space-1); }
</style>
