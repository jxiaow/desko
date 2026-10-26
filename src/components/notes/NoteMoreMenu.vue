<script setup lang="ts">
import { ref } from 'vue'
import AppIcon from '../shared/AppIcon.vue'
import PopoverMenu from '../shared/PopoverMenu.vue'
import { NOTE_EXPORT_FORMATS, type NoteExportFormat } from '../../utils/noteExport'
import { isWebRuntime } from '../../services/runtime'
import type { Note } from '../../types'

const props = withDefaults(defineProps<{
  note: Note
  /** ib = 卡头 26px 图标钮，bar = 全屏首栏 32px 图标钮 */
  variant?: 'ib' | 'bar'
  /** 本卡渲染在归档视图里：排上占了「取消归档」，置顶搬回菜单 */
  archivedView?: boolean
  exportDisabled?: boolean
  /** 没解锁的加密条：对密文只有导出有意义，入口本身就是导出钮 */
  sealed?: boolean
  mobileActions?: boolean
}>(), {
  variant: 'ib',
  archivedView: false,
  exportDisabled: false,
  sealed: false,
  mobileActions: false,
})

const emit = defineEmits<{
  togglePin: []
  toggleStar: []
  toggleArchive: []
  export: [format: NoteExportFormat]
  encrypt: []
  relock: []
  removeLock: []
  delete: []
  view: []
  edit: []
  copy: []
}>()

const trigger = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const exportOpen = ref(false)

const toggleMain = () => {
  menuOpen.value = !menuOpen.value
  exportOpen.value = false
}
const toggleExport = () => {
  exportOpen.value = !exportOpen.value
  menuOpen.value = false
}

/** 菜单项一律先收面再派发：动作可能把整张卡换掉（归档、删除），留着浮层就是悬空锚点 */
const exec = (action: () => void) => {
  menuOpen.value = false
  exportOpen.value = false
  action()
}
</script>

<template>
  <button
    ref="trigger"
    :class="[props.variant === 'bar' ? 'bar-btn' : 'ib', 'more']"
    type="button"
    :title="props.sealed ? '导出' : '更多操作'"
    :aria-label="props.sealed ? '导出' : '更多操作'"
    :aria-expanded="menuOpen || exportOpen"
    :disabled="props.sealed && props.exportDisabled"
    @click.stop="props.sealed ? toggleExport() : toggleMain()"
  >
    <AppIcon :name="props.sealed ? 'download' : 'dots'" :size="props.variant === 'bar' ? 13 : 15" />
  </button>

  <PopoverMenu v-if="exportOpen" :anchor="trigger" :width="184" @close="exportOpen = false">
    <div class="export-menu-title" :title="`导出「${props.note.title || '小记'}」`">导出「{{ props.note.title || '小记' }}」</div>
    <button
      v-for="item in NOTE_EXPORT_FORMATS"
      :key="item.id"
      class="pop-item"
      type="button"
      role="menuitem"
      :aria-label="`${item.label} (.${item.extension})`"
      @click.stop="exec(() => emit('export', item.id))"
    >
      <AppIcon name="download" :size="14" />{{ item.label }}<span class="export-menu-extension">.{{ item.extension }}</span>
    </button>
    <span class="pop-sep"></span>
    <div class="export-menu-hint">图片附件随文件导出</div>
  </PopoverMenu>

  <PopoverMenu v-else-if="menuOpen" :anchor="trigger" :width="152" @close="menuOpen = false">
    <template v-if="props.mobileActions">
      <button class="pop-item note-mobile-action" type="button" aria-label="全屏查看" @click="exec(() => emit('view'))"><AppIcon name="eye" :size="14" />全屏查看</button>
      <button class="pop-item note-mobile-action" type="button" @click="exec(() => emit('edit'))"><AppIcon name="edit" :size="14" />编辑</button>
      <button v-if="!props.archivedView" class="pop-item note-mobile-action" type="button" @click="exec(() => emit('togglePin'))"><AppIcon :name="props.note.pinned ? 'unpin' : 'pin'" :size="14" />{{ props.note.pinned ? '取消置顶' : '置顶' }}</button>
    </template>
    <!-- 复制只住在卡头菜单：全屏阅读头已有带文字的复制钮，同一动作不留两个入口 -->
    <button v-if="props.variant === 'ib'" class="pop-item" type="button" @click="exec(() => emit('copy'))">
      <AppIcon name="copy" :size="14" />复制正文
    </button>
    <button class="pop-item" type="button" @click="exec(() => emit('toggleStar'))">
      <AppIcon name="star" :size="14" :filled="props.note.starred" />{{ props.note.starred ? '取消收藏' : '收藏' }}
    </button>
    <!-- 排上占了哪颗开关，菜单就只补另一颗：同一动作不留两个入口 -->
    <button v-if="props.archivedView" class="pop-item" type="button" @click="exec(() => emit('togglePin'))">
      <AppIcon :name="props.note.pinned ? 'unpin' : 'pin'" :size="14" />{{ props.note.pinned ? '取消置顶' : '置顶' }}
    </button>
    <button v-else-if="!props.note.archived" class="pop-item" type="button" @click="exec(() => emit('toggleArchive'))">
      <AppIcon name="archive" :size="14" />归档
    </button>
    <button v-else class="pop-item" type="button" @click="exec(() => emit('toggleArchive'))">
      <AppIcon name="unarchive" :size="14" />取消归档
    </button>
    <span class="pop-sep"></span>
    <button v-if="!isWebRuntime()" class="pop-item" type="button" :disabled="props.exportDisabled" @click.stop="toggleExport()">
      <AppIcon name="download" :size="14" />导出<span class="pop-caret"><AppIcon name="chevRight" :size="12" /></span>
    </button>
    <button v-if="!props.note.encrypted" class="pop-item" type="button" @click="exec(() => emit('encrypt'))">
      <AppIcon name="lock" :size="14" />加密
    </button>
    <template v-else>
      <button class="pop-item" type="button" @click="exec(() => emit('relock'))">
        <AppIcon name="lock" :size="14" />重新锁定
      </button>
      <button class="pop-item" type="button" @click="exec(() => emit('removeLock'))">
        <AppIcon name="lockOff" :size="14" />解除加密
      </button>
    </template>
    <span class="pop-sep"></span>
    <button class="pop-item danger" type="button" @click="exec(() => emit('delete'))">
      <AppIcon name="trash" :size="14" />删除
    </button>
  </PopoverMenu>
</template>

<style scoped>
.note-mobile-action { display: none; }
@media (max-width: 760px), (hover: none) and (max-width: 1024px) {
  .note-mobile-action { display: flex; min-height: 44px; }
}
/* 钮在别的组件里（本组件是多根，宿主 scoped 规则进不来），尺寸自己按宿主档位补齐 */
.ib.more { width: 26px; height: 26px; border-radius: 6px; }
.bar-btn.more { height: 32px; min-width: 32px; padding: 0 var(--space-2); }
.pop-caret { margin-left: auto; color: var(--text-faint); display: inline-flex; }
.export-menu-title { padding: 6px 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-xs); color: var(--text-muted); }
.export-menu-extension { margin-left: auto; font-size: var(--text-xs); color: var(--text-faint); }
.export-menu-hint { padding: 4px 10px 6px; font-size: var(--text-xs); color: var(--text-muted); }
</style>
