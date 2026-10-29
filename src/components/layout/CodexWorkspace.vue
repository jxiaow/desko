<script setup lang="ts">
import { computed, provide } from 'vue'
import { useRoute } from 'vue-router'
import { hasWorkspaceDirectory, workspaceDirectoryKey, workspaceLayoutKey } from './workspaceLayout'
import AppIcon from '../shared/AppIcon.vue'
import { usePageHeadStore } from '../../stores/pageHead'

const props = defineProps<{ directoryVisible: boolean; directoryCompact: boolean; directoryPinned: boolean }>()
const emit = defineEmits<{ closeDirectory: []; toggleDirectory: []; toggleDirectoryPin: [] }>()
provide(workspaceLayoutKey, true)
provide(workspaceDirectoryKey, { visible: computed(() => props.directoryVisible), toggle: () => emit('toggleDirectory') })
const route = useRoute()
const pageHead = usePageHeadStore()
const hasDirectory = computed(() => hasWorkspaceDirectory(String(route.name)))
const directoryLabel = computed(() => pageHead.directoryLabel || (route.name === 'notes' ? '视图与标签' : '收藏分类'))
function onDirectoryClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('[data-workspace-directory-keep-open]')) return
  if (props.directoryCompact && !props.directoryPinned && (event.target as HTMLElement).closest('#workspace-directory-content button, #workspace-directory-content [role="button"]')) {
    emit('closeDirectory')
  }
}
</script>

<template>
  <div id="workspace-surface" class="workspace-surface" :class="{ 'directory-docked': directoryVisible, 'workspace-notes': route.name === 'notes' }">
    <main class="main-area workspace-main">
      <div class="workspace-body">
        <div class="main-content"><slot /></div>
      </div>
    </main>
    <aside id="workspace-directory" v-show="directoryVisible && hasDirectory" class="workspace-directory" :aria-label="directoryLabel" @click="onDirectoryClick">
      <div class="workspace-directory-heading">
        <span class="workspace-directory-title">{{ directoryLabel }}</span>
        <div class="workspace-directory-actions">
          <button class="ib" type="button" :class="{ on: directoryPinned }" :aria-pressed="directoryPinned" :aria-label="directoryPinned ? '取消固定目录' : '固定目录'" :title="directoryPinned ? '取消固定目录' : '固定目录'" @click="emit('toggleDirectoryPin')"><AppIcon :name="directoryPinned ? 'unpin' : 'pin'" :size="15" /></button>
          <button class="ib" type="button" aria-label="关闭辅助侧栏" title="关闭辅助侧栏" @click="emit('closeDirectory')"><AppIcon name="x" :size="15" /></button>
        </div>
      </div>
      <div id="workspace-directory-content"></div>
    </aside>
  </div>
</template>

<style>
.codex-layout {
  --sidebar-rail-w: 56px;
  --workspace-directory-width: clamp(200px, 19vw, 248px);
  --workspace-directory-offset: 0px;
  --workspace-toolbar-height: 48px;
  --workspace-gutter: 48px;
  --workspace-content-max: 1120px;
  --workspace-main-width: calc(100vw - var(--sidebar-rail-w) - var(--workspace-directory-offset));
  --workspace-content-padding: max(var(--workspace-gutter), calc((var(--workspace-main-width) - var(--scrollbar-track) - var(--workspace-content-max)) / 2));
  --workspace-content-left: calc(var(--sidebar-rail-w) + var(--workspace-content-padding));
  --workspace-content-right: calc(var(--workspace-directory-offset) + var(--workspace-content-padding) + var(--scrollbar-track));
  /* 页名与页内操作和正文共用同一条阅读列，目录展开时一起让位；
     目录开关单独挂在窗口右侧工具位，不会从点击它的指针下方移走。 */
  --workspace-toolbar-left: var(--workspace-content-left);
  --workspace-toolbar-right: var(--workspace-content-right);
  --workspace-heading-width: 120px;
  --workspace-heading-gap: 24px;
  --page-search-max: 300px;
}
@media (max-width: 900px) {
  .codex-layout { --workspace-heading-width: 112px; --workspace-heading-gap: 12px; }
}
/* 桌面默认使用可读的宽导航；Web 自己管理 216px 导航，不参与这两档。 */
.app-root.codex-layout:not(.web-runtime) { --sidebar-rail-w: 148px; }
.app-root.codex-layout:not(.web-runtime).sidebar-collapsed { --sidebar-rail-w: 56px; }
/* 最小桌面窗先让导航收起成图标轨，把宽度留给搜索与页内动作；偏好本身不改。 */
@media (max-width: 899px) {
  .app-root.codex-layout:not(.web-runtime) { --sidebar-rail-w: 56px; }
}
.app-root.codex-layout:has(.workspace-surface.directory-docked) { --workspace-directory-offset: var(--workspace-directory-width); }
.app-root.codex-layout:not(.locked-bg) { background: var(--bg-workspace); background-attachment: fixed; }
/* 导轨氛围光整列只画一层：品牌格与侧栏本体透明，透出这同一层光，
   接缝处天然连续。不再让品牌格自带 background-attachment: fixed——
   fixed 附着层叠上 flex 子项的 z-index 堆叠上下文后，会在 WebView2
   合成器里被提升到弹窗遮罩之上（左上角白格从遮罩里穿出）。 */
.app-root.codex-layout:not(.locked-bg):not(.web-runtime)::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: var(--sidebar-rail-w, 56px);
  background: var(--bg-workspace-rail);
  /* 光锚在视口上而不是这条窄栏上：不写 fixed（会被提升到弹窗遮罩之上），
     改用整窗尺寸的图并对齐左上角，宽度与画布那边的视口光逐像素一致。 */
  background-size: 100vw 100vh;
  background-position: 0 0;
  background-repeat: no-repeat;
  pointer-events: none;
}
.codex-layout .app-layout { padding: 0; }

.workspace-surface { position: relative; display: flex; flex: 1; min-width: 0; overflow: hidden; background: var(--bg-workspace); background-attachment: fixed; }
.workspace-surface :is(.content-inner, .stream, .fs-scroll, #workspace-directory-content)::-webkit-scrollbar-track { margin: 0; }
/* 全屏接管整个内容面；原页保留滚动和目录状态，隐藏后也不会进入 Tab 焦点序列。
   页级控件住在顶栏里，不在内容面内，同样要在全屏时让位。 */
.workspace-surface:has(> .fs) > :is(.workspace-main, .workspace-directory) { visibility: hidden; }
.app-root.codex-layout:has(.workspace-surface > .fs) { --workspace-directory-offset: 0px; }
.app-root.codex-layout:has(.workspace-surface > .fs) #workspace-page-toolbar > :not([data-workspace-toolbar="exclusive"]) { display: none; }
/* 目录开关挂在窗口工具位，不属于页栏容器；全屏接管时同样要跟着原页面让位。 */
.app-root.codex-layout:has(.workspace-surface > .fs) #workspace-directory-toggle { display: none; }
.workspace-body { position: relative; display: flex; flex: 1; min-height: 0; overflow: hidden; }
.workspace-body > .main-content { flex: 1; min-width: 0; }
/* 悬停沿用主题中性色，轻微改变卡面明暗；强调色留给选中、编辑和焦点。
   纸底取 8%：对白卡仍在上限 7.5ΔE 内，落到画布上也有清楚的色阶差。 */
.workspace-main { --bg-surface-hover: color-mix(in srgb, var(--text) 8%, var(--bg-surface)); position: relative; min-width: 0; background: var(--bg-workspace); background-attachment: fixed; }
/* 顶沿护边：滚动内容在标题栏下沿淡出，而不是被切成一条硬边。
   画布底与 .workspace-main 同一条 fixed 配方，叠在内容上时颜色完全对齐，只做遮罩淡出。 */
.workspace-main::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  z-index: 25;
  height: 12px;
  pointer-events: none;
  background: var(--bg-workspace);
  background-attachment: fixed;
  -webkit-mask-image: linear-gradient(to bottom, #000 70%, transparent);
  mask-image: linear-gradient(to bottom, #000 70%, transparent);
}
:root[data-base="dark"] .workspace-main { --bg-surface-hover: color-mix(in srgb, var(--text) 4.8%, var(--bg-surface)); }
/* 辅助目录融入同一画布，用留白和浅色选中块建立层次。 */
.workspace-directory { display: flex; flex-direction: column; flex: 0 0 var(--workspace-directory-width); min-width: 0; overflow: hidden; background: var(--bg-inspector); background-attachment: fixed; }
.workspace-directory-heading { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 48px; padding: 0 16px 0 22px; }
.workspace-directory-title { font-size: var(--text-sm); font-weight: 600; color: var(--text); }
.workspace-directory-actions { display: flex; gap: 2px; color: var(--text-muted); }
.workspace-directory-actions .ib { width: 28px; height: 28px; border-radius: 8px; }
.workspace-directory-actions .on { color: var(--text-brand); background: var(--bg-inspector-active); }
#workspace-directory-content { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; padding: 4px 12px 16px; }
#workspace-directory .directory-notes { display: flex; flex-direction: column; width: 100%; min-height: 100%; height: auto; overflow: visible; scrollbar-gutter: auto; border: 0; background: transparent; padding: 0; }
#workspace-directory .directory-list { display: flex; flex-direction: column; align-items: stretch; gap: 0; width: 100%; height: auto; margin: 0; padding: 0; border: 0; background: transparent; overflow: visible; }
#workspace-directory .directory-list > .directory-link:first-of-type:not(:last-child) { margin-bottom: 12px; }
#workspace-directory .directory-link { position: relative; display: flex; flex-shrink: 0; align-items: center; justify-content: flex-start; gap: 10px; width: 100%; height: 36px; min-height: 36px; padding: 0 10px; margin: 0 0 4px; border: 0; border-radius: 9px; background: transparent; color: var(--text-secondary); text-align: left; font: inherit; font-size: var(--text-sm); font-weight: 400; cursor: pointer; transition: background-color var(--transition-fast), color var(--transition-fast); }
#workspace-directory .directory-link svg { width: 16px; height: 16px; flex-shrink: 0; color: var(--text-muted); }
#workspace-directory .directory-link.active { background: var(--sidebar-active); color: var(--text-brand); font-weight: 600; }
#workspace-directory .directory-link.active svg { color: inherit; }
#workspace-directory .directory-link.active::before { display: none; }
#workspace-directory .directory-link:hover:not(.active) { background: var(--bg-inspector-hover); color: var(--text); }
#workspace-directory .directory-link.danger { color: var(--danger); }
#workspace-directory .directory-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#workspace-directory .tab-count, .workspace-directory .directory-count { flex-shrink: 0; margin-left: auto; color: var(--text-muted); font-family: var(--font-ui); font-size: var(--text-xs); font-weight: 400; font-variant-numeric: tabular-nums; }
#workspace-directory .directory-link.active .tab-count { color: var(--text-brand); }
#workspace-directory .directory-section-heading { display: flex; flex-shrink: 0; align-items: center; margin-top: 24px; padding: 0 10px 10px; color: var(--text-muted); font-size: var(--text-xs); font-weight: 500; }
#workspace-directory .rail-empty { padding: 4px 10px; color: var(--text-muted); font-size: var(--text-xs); }
#workspace-directory .directory-reset { margin-top: 16px; color: var(--text-muted); }
#workspace-directory .rail-foot { margin-top: auto; padding: 24px 10px 0; border: 0; color: var(--text-muted); font-size: var(--text-xs); line-height: 1.6; }
.workspace-directory .tab-thumb { display: none; }
.codex-layout .workspace-main .day-head { background: var(--bg-workspace); background-attachment: fixed; top: 0; }

/* 保留通栏控制带和无边框卡面，正文只约束阅读宽度；目录开关不切换内距档位。 */
.codex-layout .workspace-main .content-inner { padding: 16px var(--workspace-content-padding) 22px; }
/* 第一行归内容区自己的内距管；网格的 12px 只用于组与组之间，不再和首行呼吸叠成 28px。 */
.codex-layout .workspace-main .content-inner > .card-grid:first-child { margin-top: 0; }
.codex-layout .workspace-main .content-inner:has(> .cx-tabs-row) { padding-top: 0; }
.codex-layout .workspace-main .content-inner:has(> .cx-tabs-row:empty) { padding-top: 16px; }
.codex-layout .workspace-main .content-inner.codex-dialog-view { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 0; overflow: hidden; scrollbar-gutter: auto; }
.codex-layout .workspace-main .content-inner.codex-dialog-view:has(> .cx-tabs-row:empty) { padding-top: 0; }
.codex-layout .workspace-main .stream-inner { padding: 8px var(--workspace-content-padding) 22px; }

/* 页级筛选：贴着内容的一行导航，只有一根底线，不形成第二层工具条。 */
.workspace-workbar {
  display: flex;
  align-items: center;
  gap: 20px;
  min-width: 0;
  height: 42px;
  min-height: 42px;
  margin: 8px 0 12px;
  border-bottom: 1px solid var(--border);
}
.workspace-workbar-tabs,
.workspace-workbar .wb-tags {
  display: flex;
  align-items: stretch;
  gap: 20px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.workspace-workbar .wb-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  height: 42px;
  padding: 0 1px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 400;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--transition-fast);
}
.workspace-workbar .wb-tab:hover { color: var(--text); }
.workspace-workbar .wb-tab.active { color: var(--text-brand); font-weight: 600; }
.workspace-workbar .wb-tab.active::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  border-radius: 1px 1px 0 0;
  background: var(--accent);
  transform-origin: left center;
  animation: wb-underline-in 180ms cubic-bezier(.2, .8, .2, 1);
}
@keyframes wb-underline-in {
  from { transform: scaleX(.25); opacity: .4; }
  to { transform: scaleX(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .workspace-workbar .wb-tab.active::after { animation: none; }
}
.workspace-workbar .wb-count {
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.workspace-workbar .wb-divider {
  flex: none;
  width: 1px;
  height: 15px;
  background: var(--border);
}
.workspace-workbar .wb-more { color: var(--text-muted); }
.workspace-workbar .wb-more.active { color: var(--text-brand); }

/* 通栏控制带里的页栏：脱掉吸顶与底色，控件直接坐在顶栏上。
   空白处不吃指针，拖窗仍然落在下面的 .titlebar-drag。 */
#workspace-page-toolbar > :is(.page-bar, .cx-band-controls) {
  position: static;
  flex: 1;
  min-width: 0;
  height: var(--workspace-toolbar-height);
  min-height: var(--workspace-toolbar-height);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
  pointer-events: none;
}
#workspace-page-toolbar :is(.page-bar, .cx-band-controls) > * { pointer-events: auto; }
/* 搜索框与动作钮都吃页栏那档（32px / --bg-canvas-input / 9px 圆角 / --text-xs），
   宽度仍由各模块的 max-width: var(--page-search-max) 决定——带子里不再抄一遍令牌。 */
#workspace-page-toolbar :is(.page-bar, .cx-band-controls) > :first-child:not(.page-actions) { margin-left: var(--workspace-heading-gap); }
#workspace-page-toolbar .page-bar > .search-box:first-child { margin-left: var(--workspace-heading-gap); }
#workspace-page-toolbar .search-box { flex: 1 1 120px; min-width: 120px; max-width: 360px; margin-right: 6px; container: workspace-search / inline-size; }
#workspace-page-toolbar .search-box input { font-size: var(--text-sm); }
#workspace-page-toolbar :is(.btn-primary, .btn-secondary) { font-size: var(--text-sm); }
#workspace-page-toolbar .page-actions { margin-left: auto; flex-shrink: 0; gap: 6px; }
#workspace-page-toolbar :is(.btn-primary, .btn-secondary, .bar-btn) { white-space: nowrap; }
#workspace-page-toolbar .btn-primary:where(:not(.ghost-danger)):not(:disabled) {
  background: var(--bg-workspace-primary);
  color: var(--text-workspace-primary);
  border: 1px solid transparent;
  border-radius: var(--radius-ib);
  font-weight: 600;
  box-shadow: none;
}
#workspace-page-toolbar .btn-primary:hover:not(:disabled):not(.ghost-danger) {
  background: var(--bg-workspace-primary-hover);
  color: var(--text-workspace-primary);
  transform: none;
  box-shadow: none;
}
#workspace-page-toolbar .btn-primary:active:not(:disabled):not(.ghost-danger) {
  background: var(--bg-workspace-primary-active);
  color: var(--text-workspace-primary);
  transform: none;
}
/* 带子里的动作一律无描边：描边留给弹窗表单，这里只靠淡染和字色分层。 */
#workspace-page-toolbar :is(.btn-secondary, .btn-primary.ghost-danger) { border-color: transparent; }
#workspace-page-toolbar .btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-ib);
  padding-inline: var(--toolbar-action-padding, 10px);
}
#workspace-page-toolbar .btn-secondary:hover:not(:disabled) { background: var(--hover-chrome); border-color: transparent; color: var(--text); }
#workspace-page-toolbar .btn-secondary:active:not(:disabled) { transform: none; }
#workspace-page-toolbar .btn-secondary.active { background: var(--accent-soft); border-color: transparent; color: var(--text-brand); }

/* 按实际可用宽度收紧间距，兼顾目录、Web 状态与云同步同时出现。 */
@container workspace-toolbar (max-width: 400px) {
  #workspace-page-toolbar .page-actions { gap: 4px; }
  #workspace-page-toolbar .btn-primary { padding-inline: 10px; gap: 6px; }
  #workspace-page-toolbar .bar-div { margin-inline: 2px; }
}
/* 输入区变窄后优先保留搜索文字；快捷键仍然可用。 */
@container workspace-search (max-width: 180px) {
  #workspace-page-toolbar .search-kbd { display: none; }
}

/* 卡面用一根安静的边界与画布分层，不靠常态投影；悬停只加深边界和极轻的色温。 */
.app-root.codex-layout .workspace-main :is(.memo, .composer, .grid-card, .mfa-card, .rcard, .tn-card, .clean-group-card, .drop-card, .rowlist):where(:not(.editing):not(.selected):not(.is-sel):not(:focus-visible)) {
  border-color: var(--border);
  box-shadow: none;
  border-radius: 12px;
}
/* 对象卡的两行内容留出清晰间隔，网格与工具栏继续共用阅读列。 */
.codex-layout .workspace-main .grid-card { min-height: 88px; padding-block: 14px; padding-right: 16px; gap: 10px; }
/* 宽导航吃掉 92px 后仍让默认窗保留三列，卡片不会被撑成两块大字板。 */
.codex-layout .workspace-main .card-grid { grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: 12px; }
.codex-layout .workspace-main .grid-card:not(.batching) { padding-left: 16px; }
.codex-layout .workspace-main .grid-card .card-check { top: 17px; }
.codex-layout .workspace-main .grid-card:not(.batching) .card-check { left: 17px; }
/* 空态不是卡：mock 里它直接坐在画布上，图标块换成淡染。 */
.codex-layout .workspace-main .rcard.empty-state {
  background: transparent;
  border: 0;
  box-shadow: none;
  padding: 72px 24px 64px;
}
.codex-layout .workspace-main .empty-icon { background: var(--fill); border-color: transparent; opacity: 1; color: var(--text-faint); }
/* 空态在内容区垂直居中：条目/文件这类页面只有一块空态时，贴着顶部会把整页
   压成「上重下空」，看着像没做完。Codex 的 .rcard.empty-state 有自己的内距，不在此列。 */
.codex-layout .workspace-main .content-inner:has(> :is(.empty-state, .error-state):not(.rcard)) { display: flex; flex-direction: column; }
.codex-layout .workspace-main .content-inner > :is(.empty-state, .error-state):not(.rcard) {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-block: 32px;
}
/* 身份列与额度列之间靠留白分开，mock 里不画这根竖线。 */
.codex-layout .workspace-main .acc-quota { border-left: 0; padding-left: 28px; }

/* 直连页的探测行按小记输入卡的方言画：整行是一块面，字段不再自带描边，段末不画规则线。 */
.codex-layout .workspace-main .bp-probe { padding-bottom: 0; border-bottom: 0; }
.codex-layout .workspace-main .bp-probe > .page-bar {
  height: 52px;
  padding: 0 6px 0 14px;
  border-radius: 12px;
  background: var(--bg-surface);
}
.codex-layout .workspace-main .bp-probe .probe-box { height: 100%; border: 0; background: transparent; }
.codex-layout .workspace-main .bp-probe .btn-primary { height: 40px; }
.codex-layout .workspace-main :is(.memo, .grid-card, .mfa-card, .rcard):hover:where(:not(.selected):not(.is-sel):not(.picked):not(.editing):not(:focus-visible)):not(.empty-state) {
  border-color: var(--border-hover);
  box-shadow: none;
  transform: none;
}
/* 各模块的列表统一中性悬停，分组列表只反馈指针所在的行。 */
.codex-layout .workspace-main :is(.acc-row, .grp-head, .sess-row, .thr-row, .usg-model-row, .rcard-row, .url-row, .dir-row, .svc-row, .tn-add) {
  transition: background-color var(--transition-fast);
}
.app-root.codex-layout .workspace-main :is(.memo, .grid-card, .mfa-card, .acc-row, .grp-head, .sess-row, .thr-row, .usg-model-row, .rcard-row, .url-row, .dir-row, .svc-row, .tn-add):hover:where(:not(.selected):not(.is-sel):not(.picked):not(.editing):not(.skeleton):not(.acc-sk):not(:disabled):not([aria-disabled="true"])) {
  background-color: var(--bg-surface-hover);
}
.codex-layout .workspace-main .grid-acts { background: inherit; box-shadow: none; }
.codex-layout .workspace-main .memo.editing { background: var(--bg-surface); }
.codex-layout .workspace-main .memo.pinned:where(:not(.editing):not(.is-sel):not(:focus-visible)) { border-color: color-mix(in srgb, var(--accent) 34%, var(--border)); }
.codex-layout .workspace-main .grid-card.selected { border-color: var(--accent); }
.codex-layout .workspace-main .memo.editing,
.codex-layout .workspace-main :is(.memo, .grid-card, .mfa-card):focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); transform: none; }
.codex-layout .workspace-main .composer:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }

/* 带子替掉了 42px 标题栏，toast 跟着下移一档。 */
.codex-layout .toast { top: 66px; }
/* 页级工作栏存在时，提示落在工作栏下方，避免盖住筛选与当前视图。 */
.codex-layout:has(.workspace-workbar) .toast { top: 118px; }

</style>
