<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '../shared/AppIcon.vue'
import type { Note } from '../../types'
import type { NoteSaveState } from '../../stores/notes'

const props = withDefaults(defineProps<{
  /** null 表示还没发布的小记：置顶/收藏/删除都无处可存，于是不出现 */
  note: Note | null
  saveState?: NoteSaveState
  primaryLabel: string
  primaryDisabled?: boolean
  defaultHint?: string
  /** 新建态用无边框轻量按钮，编辑态用描边按钮 */
  plain?: boolean
  /** 已经在全屏书写面里时不再提供全屏入口 */
  showFullscreen?: boolean
  /** 就地展开的底栏：状态类动作交给卡片本体，次要动作退成图标 */
  dense?: boolean
}>(), {
  saveState: '',
  primaryDisabled: false,
  defaultHint: '',
  plain: false,
  showFullscreen: true,
  dense: false,
})

const emit = defineEmits<{
  addImage: []
  insertTag: []
  fullscreen: []
  togglePin: []
  toggleStar: []
  delete: []
  primary: []
}>()

const saveText: Record<NoteSaveState, string> = {
  '': '',
  saving: '保存中…',
  saved: '已保存',
}

const hintText = computed(() =>
  saveText[props.saveState] || props.defaultHint || (props.note ? '自动保存' : ''))
/** 就地展开的底栏：所有动作退成同尺寸图标按钮，靠 title/aria-label 读出含义 */
const btnCls = computed(() => (props.dense ? 'ib' : props.plain ? 'mini-btn' : 'eb'))
const iconSize = computed(() => (props.dense ? 14 : props.plain ? 13 : 12))
</script>

<template>
  <div class="note-toolbar" :class="{ dense: props.dense }">
    <button  :class="btnCls" type="button" title="添加图片" aria-label="添加图片" @click="emit('addImage')">
      <AppIcon name="image" :size="iconSize" /><span v-if="!props.dense">图片</span>
    </button>
    <button  :class="btnCls" type="button" title="在正文插入 #标签" aria-label="在正文插入 #标签" @click="emit('insertTag')">
      <AppIcon name="tag" :size="iconSize" /><span v-if="!props.dense">标签</span>
    </button>

    <template v-if="props.note">
      <button
        :class="[btnCls, { on: props.note.pinned }]"
        type="button"
        :title="props.note.pinned ? '取消置顶' : '置顶'"
        :aria-label="props.note.pinned ? '取消置顶' : '置顶'"
        @click="emit('togglePin')"
      >
        <AppIcon name="pin" :size="iconSize" /><span v-if="!props.dense">{{ props.note.pinned ? '已置顶' : '置顶' }}</span>
      </button>
      <button
        :class="[btnCls, { on: props.note.starred, warn: props.note.starred }]"
        type="button"
        :title="props.note.starred ? '取消收藏' : '收藏'"
        :aria-label="props.note.starred ? '取消收藏' : '收藏'"
        @click="emit('toggleStar')"
      >
        <AppIcon name="star" :size="iconSize" :filled="props.note.starred" /><span v-if="!props.dense">{{ props.note.starred ? '已收藏' : '收藏' }}</span>
      </button>
    </template>

    <button
      v-if="props.showFullscreen"
      :class="btnCls"
      type="button"
      title="全屏书写"
      aria-label="全屏书写"
      @click="emit('fullscreen')"
    >
      <AppIcon name="max" :size="iconSize" /><span v-if="!props.dense">全屏</span>
    </button>

    <span class="toolbar-flex">
      <slot name="hint">
        <span class="save-hint" :class="props.saveState">{{ hintText }}</span>
      </slot>
    </span>

    <button
      v-if="props.note"
      :class="[btnCls, 'danger']"
      type="button"
      title="删除这条小记"
      aria-label="删除这条小记"
      @click="emit('delete')"
    >
      <AppIcon name="trash" :size="iconSize" /><span v-if="!props.dense">删除</span>
    </button>

    <button
      v-if="props.plain"
      class="btn-primary go"
      type="button"
      :disabled="props.primaryDisabled"
      @click="emit('primary')"
    >{{ props.primaryLabel }}</button>
    <button
      v-else
      class="eb primary"
      type="button"
      :disabled="props.primaryDisabled"
      @click="emit('primary')"
    >{{ props.primaryLabel }}</button>
  </div>
</template>

<style scoped>
.note-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: 1;
  flex-wrap: wrap;
  min-width: 0;
}
/* 就地展开的底栏里，图标按钮与描边按钮同高，视觉上是一条线 */
.note-toolbar.dense .ib { width: 26px; height: 26px; border-radius: var(--radius-sm); }
.toolbar-flex {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 24px;
}
.go { height: 28px; padding: 0 var(--space-4); font-size: 12.5px; }
</style>
