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
const insertImage = (src: string) => editorRef.value?.insertImage(src)

defineExpose({ focus, insertImage })

/**
 * 展开态是粘滞的：点开后失焦也不收回——失焦收起会把"只是点了别处"当成"不想写了"，
 * 书写面忽大忽小。收回只有一条路：内容为空时按 Esc，明确表达"我不写了"。
 * 有草稿时本来就必须展开（!empty），免得失焦把内容挤成一行。
 */
const focused = ref(false)
const expanded = ref(false)
const open = computed(() => !props.empty || expanded.value)

const onFocusIn = () => {
  focused.value = true
  expanded.value = true
}
const onFocusOut = () => {
  focused.value = false
}
const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.empty && focused.value) {
    expanded.value = false
    ;(document.activeElement as HTMLElement | null)?.blur()
  }
}

/** 收回一行：展开态是粘滞的，只有明确「不写了」才收。 */
const collapse = () => {
  expanded.value = false
  ;(document.activeElement as HTMLElement | null)?.blur()
}
/** 放弃草稿：清空正文（父层 draftHtml 随之落空）并收回一行。本就没落库，无需回退。 */
const discard = () => {
  emit('update', '')
  collapse()
}
</script>

<template>
  <section class="composer" :class="{ open }" @focusin="onFocusIn" @focusout="onFocusOut" @keydown="onKeydown">
    <NoteEditor
      ref="editorRef"
      variant="composer"
      :roomy="open"
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
        :cancel-label="props.empty ? '' : '放弃'"
        @add-image="emit('addImage')"
        @fullscreen="emit('fullscreen')"
        @cancel="discard"
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

/* 书写面高度逐键跟随内容，由 NoteEditor 自己落 min-height；这里只管展开/收起工具条 */

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
.composer-hint { font-size: var(--text-xs); color: var(--text-muted); margin-left: var(--space-1); }
</style>
