<script setup lang="ts">
import { computed, provide } from 'vue'
import { useRoute } from 'vue-router'
import { hasWorkspaceDirectory, workspaceDirectoryKey, workspaceLayoutKey } from './workspaceLayout'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{ directoryVisible: boolean; directoryCompact: boolean; directoryPinned: boolean }>()
const emit = defineEmits<{ closeDirectory: []; toggleDirectory: []; toggleDirectoryPin: [] }>()
provide(workspaceLayoutKey, true)
provide(workspaceDirectoryKey, { visible: computed(() => props.directoryVisible), toggle: () => emit('toggleDirectory') })
const route = useRoute()
const hasDirectory = computed(() => hasWorkspaceDirectory(String(route.name)))
const directoryLabel = computed(() => route.name === 'notes' ? '视图与标签' : '收藏分类')
function onDirectoryClick(event: MouseEvent) {
  if (props.directoryCompact && !props.directoryPinned && (event.target as HTMLElement).closest('#workspace-directory-content button, #workspace-directory-content [role="button"]')) {
    emit('closeDirectory')
  }
}
</script>

<template>
  <div id="workspace-surface" class="workspace-surface" :class="{ 'directory-docked': directoryVisible, 'workspace-notes': route.name === 'notes' }">
    <main class="main-area workspace-main">
      <div id="workspace-page-toolbar" class="workspace-page-toolbar"></div>
      <div class="workspace-body">
        <div class="main-content"><slot /></div>
        <aside id="workspace-directory" v-show="directoryVisible && hasDirectory" class="workspace-directory" :aria-label="directoryLabel" @click="onDirectoryClick">
          <div class="workspace-directory-heading">
            <span class="workspace-directory-title">{{ route.name === 'notes' ? '小记' : '收藏' }}</span>
            <div class="workspace-directory-actions">
              <button class="ib" type="button" :class="{ on: directoryPinned }" :aria-pressed="directoryPinned" :aria-label="directoryPinned ? '取消固定目录' : '固定目录'" :title="directoryPinned ? '取消固定目录' : '固定目录'" @click="emit('toggleDirectoryPin')"><AppIcon :name="directoryPinned ? 'unpin' : 'pin'" :size="15" /></button>
              <button class="ib" type="button" aria-label="关闭辅助侧栏" title="关闭辅助侧栏" @click="emit('closeDirectory')"><AppIcon name="x" :size="15" /></button>
            </div>
          </div>
          <div id="workspace-directory-content"></div>
        </aside>
      </div>
    </main>
  </div>
</template>

<style>
.codex-layout { --workspace-directory-width: 200px; --workspace-frame-right: 6px; }
.app-root.codex-layout:not(.locked-bg) { background: var(--bg-workspace-frame); background-attachment: fixed; }
.codex-layout .app-layout { padding: 0 var(--workspace-frame-right) 3px 0; }
.codex-layout .sidebar { background: transparent; padding-top: 8px; }
.codex-layout .sidebar .nav-item.active { background: var(--bg-workspace-selected); }
.codex-layout .sidebar .nav-item:hover:not(.active) { background: var(--bg-workspace-hover); }
.workspace-surface { --workspace-docked-width: 0px; --workspace-toolbar-max: var(--content-max); position: relative; display: flex; flex: 1; min-width: 0; overflow: hidden; border-radius: 14px; background: var(--bg-workspace); background-attachment: fixed; box-shadow: 0 2px 8px rgb(0 0 0 / 6%); }
/* 全屏接管整个内容面；原页保留滚动和目录状态，隐藏后也不会进入 Tab 焦点序列。 */
.workspace-surface:has(> .fs) > .workspace-main { visibility: hidden; }
.workspace-surface.directory-docked { --workspace-docked-width: var(--workspace-directory-width); }
.workspace-surface.workspace-notes { --workspace-toolbar-max: var(--stream-max); }
.workspace-page-toolbar { flex-shrink: 0; padding-left: max(var(--page-gutter), calc((100% - var(--workspace-docked-width) - var(--workspace-toolbar-max)) / 2)); padding-right: var(--page-gutter); }
.workspace-body { position: relative; display: flex; flex: 1; min-height: 0; overflow: hidden; }
.workspace-body > .main-content { min-width: 0; }
.workspace-directory { display: flex; flex-direction: column; flex: 0 0 var(--workspace-directory-width); min-width: 0; overflow: hidden; border-left: 1px solid var(--border); background: var(--bg-inspector); }
.workspace-directory-heading { height: 40px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 10px 0 16px; }
.workspace-directory-title { font-size: 12px; font-weight: 500; color: var(--text-muted); }
.workspace-directory-actions { display: flex; gap: 2px; }
.workspace-directory-actions .ib { width: 24px; height: 24px; }
.workspace-directory-actions .on { color: var(--text-brand); }
#workspace-directory-content { flex: 1; min-height: 0; overflow: auto; padding: 0 8px 12px; }
.workspace-main { min-width: 0; background: var(--bg-workspace); background-attachment: fixed; }
#workspace-directory .directory-notes { display: block; width: 100%; min-height: 100%; height: auto; overflow: visible; scrollbar-gutter: auto; border: 0; background: transparent; padding: 0; }
#workspace-directory .directory-list { display: flex; flex-direction: column; align-items: stretch; gap: 2px; width: 100%; height: auto; margin: 0; padding: 0; border: 0; background: transparent; overflow: visible; }
#workspace-directory .directory-link { position: relative; display: flex; align-items: center; justify-content: flex-start; gap: 8px; width: 100%; height: 32px; min-height: 32px; padding: 0 10px; margin: 0 0 2px; border: 0; border-radius: 6px; background: transparent; color: var(--text-secondary); text-align: left; font: inherit; font-size: 13px; font-weight: 400; cursor: pointer; }
#workspace-directory .directory-link svg { width: 14px; height: 14px; flex-shrink: 0; color: var(--text-muted); }
#workspace-directory .directory-link.active { background: var(--bg-surface); color: var(--text); font-weight: 500; }
#workspace-directory .directory-link.active::before { content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 2px; border-radius: 2px; background: var(--accent); }
#workspace-directory .directory-link:hover:not(.active) { background: var(--bg-workspace-hover); }
#workspace-directory .directory-link.danger { color: var(--danger); }
#workspace-directory .directory-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#workspace-directory .tab-count, .workspace-directory .directory-count { margin-left: auto; color: var(--text-muted); font-size: 12px; font-weight: 400; font-variant-numeric: tabular-nums; }
#workspace-directory .directory-section-heading { display: flex; align-items: center; margin-top: 20px; padding: 0 10px 8px; color: var(--text-muted); font-size: 12px; font-weight: 400; letter-spacing: normal; }
#workspace-directory .rail-empty { padding: 0 10px; color: var(--text-muted); font-size: 12px; }
#workspace-directory .directory-reset { margin-top: 12px; }
#workspace-directory .rail-foot { margin-top: 20px; padding: 0 10px; border: 0; color: var(--text-muted); font-size: 12px; }
.workspace-directory .tab-thumb { display: none; }
.codex-layout .workspace-main .page-bar, .codex-layout .workspace-main .day-head { background: var(--bg-workspace); background-attachment: fixed; }
.codex-layout .workspace-main .day-head { top: 0; }
.codex-layout .workspace-main .page-bar { flex-wrap: wrap; height: auto; min-height: 48px; }
.codex-layout .workspace-main .search-box { flex: 1 1 150px; min-width: 120px; max-width: 360px; }
.codex-layout .workspace-main .page-bar .search-box { background: var(--bg-workspace-search); }
.codex-layout .workspace-main .page-bar > .btn-primary { margin-left: auto; }
.codex-layout .workspace-main .page-bar .btn-primary { background: var(--bg-workspace-primary); color: var(--text-workspace-primary); }
.codex-layout .workspace-main .page-bar .btn-primary:hover:not(:disabled) { background: var(--bg-workspace-primary-hover); }
.codex-layout .workspace-main .page-bar .btn-primary:active:not(:disabled) { background: var(--bg-workspace-primary-active); }
</style>
