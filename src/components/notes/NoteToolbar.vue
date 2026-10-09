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
  /** 编辑态顶栏：置顶/收藏/删除这类状态动作退回只读悬停排，编辑条只管写作 */
  showStateActions?: boolean
  /** 非空则主钮左侧多一颗次级「取消/放弃」钮：自动保存模型下它表达回退/丢弃，不是伪保存 */
  cancelLabel?: string
  /** 全屏书写面才给撤销/重做：胶囊输入和卡片就地编辑不留这排 */
  showHistory?: boolean
  canUndo?: boolean
  canRedo?: boolean
}>(), {
  saveState: '',
  primaryDisabled: false,
  defaultHint: '',
  plain: false,
  showFullscreen: true,
  dense: false,
  showStateActions: true,
  cancelLabel: '',
  showHistory: false,
  canUndo: false,
  canRedo: false,
})

const emit = defineEmits<{
  addImage: []
  insertTag: []
  fullscreen: []
  togglePin: []
  toggleStar: []
  delete: []
  cancel: []
  primary: []
  undo: []
  redo: []
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
    <!-- 撤销/重做只给图标不给字：这一排已有图片/标签/置顶/收藏，再挂两组字会把主钮挤到换行。
         两颗都是「一枚字形即语义」，靠 title 读得出。没得退时灰着，不藏钮——
         藏起来会让人以为这里根本不能撤销。 -->
    <template v-if="props.showHistory">
      <button class="eb" type="button" :disabled="!props.canUndo" title="撤销 (Ctrl+Z)" aria-label="撤销" @click="emit('undo')">
        <AppIcon name="undo" :size="12" />
      </button>
      <button class="eb" type="button" :disabled="!props.canRedo" title="重做 (Ctrl+Shift+Z)" aria-label="重做" @click="emit('redo')">
        <AppIcon name="redo" :size="12" />
      </button>
    </template>
    <button  :class="btnCls" type="button" title="添加图片" aria-label="添加图片" @click="emit('addImage')">
      <AppIcon name="image" :size="iconSize" /><span v-if="!props.dense">图片</span>
    </button>
    <!-- 胶囊输入那一栏自带 #标签 插入芯片，这里再放一颗就是同一个动作摆两次 -->
    <button v-if="!props.plain" :class="btnCls" type="button" title="在正文插入 #标签" aria-label="在正文插入 #标签" @click="emit('insertTag')">
      <AppIcon name="tag" :size="iconSize" /><span v-if="!props.dense">标签</span>
    </button>

    <template v-if="props.note && props.showStateActions">
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
      :class="[btnCls, 'tb-fs']"
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
      v-if="props.note && props.showStateActions"
      :class="[btnCls, 'danger']"
      type="button"
      title="删除这条小记"
      aria-label="删除这条小记"
      @click="emit('delete')"
    >
      <AppIcon name="trash" :size="iconSize" /><span v-if="!props.dense">删除</span>
    </button>

    <button
      v-if="props.cancelLabel"
      :class="[btnCls, 'tb-cancel']"
      type="button"
      :title="props.cancelLabel"
      :aria-label="props.cancelLabel"
      @click="emit('cancel')"
    >
      <AppIcon name="x" :size="iconSize" /><span v-if="!props.dense">{{ props.cancelLabel }}</span>
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
.note-toolbar.dense .ib { width: 24px; height: 24px; border-radius: var(--radius-ib); }
.toolbar-flex {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 24px;
}
.go { height: 28px; padding: 0 var(--space-4); font-size: var(--text-sm); }
</style>
