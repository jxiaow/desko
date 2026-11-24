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
  <div id="workspace-surface" class="workspace-surface" :class="{ 'directory-docked': directoryVisible }">
    <main class="main-area workspace-main">
      <header class="workspace-head">
        <div id="workspace-page-toolbar" class="workspace-page-toolbar"></div>
      </header>
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
  /* 标题栏是窗口 chrome：品牌、页名与条数、侧栏开关、窗口按钮。
     页级动作仍住内容区页头，跟正文同一条阅读列。
     34px 是 Windows 标题栏的常见档，再高就是一条空带子。 */
  --window-bar-height: 34px;
  /* 页头里那一行控件的高度（搜索框/动作钮），不再是整条标题栏的高度。 */
  --workspace-toolbar-height: 32px;
  --workspace-gutter: 48px;
  /* 导轨使用侧栏主题色，结构分明清晰 */
  --bg-rail: var(--sidebar-bg);
  --rail-field-veil: color-mix(in srgb, var(--bg-rail) 55%, transparent);
  --sheet-field-veil: color-mix(in srgb, var(--bg-sheet) 75%, transparent);
  /* 阅读列封顶 1200：窗口 1280→1600 逐档变宽，1600 起停住并居中。
     再宽的部分留给两侧留白——不把单行文字拉成一条长河。
     内容面本身仍贴边拉满，所以宽窗不会退回「白板停在中间」的老样子。 */
  --workspace-content-max: 1200px;
  --workspace-main-width: calc(100vw - var(--sidebar-rail-w) - var(--workspace-directory-offset) - var(--sheet-gutter));
  --workspace-content-padding: max(var(--workspace-gutter), calc((var(--workspace-main-width) - var(--scrollbar-track) - var(--workspace-content-max)) / 2));
  --workspace-content-left: calc(var(--sidebar-rail-w) + var(--sheet-inset-left) + var(--workspace-content-padding));
  --workspace-content-right: calc(var(--workspace-directory-offset) + var(--sheet-inset-right) + var(--workspace-content-padding) + var(--scrollbar-track));
  /* 页头与正文共用同一条阅读列：标题栏的页名行、内容区的动作带都按这一列对齐，
     目录展开时一起让位；目录开关单独挂在窗口右侧工具位，不会从指针下方移走。 */
  --workspace-toolbar-left: var(--workspace-content-left);
  --workspace-toolbar-right: var(--workspace-content-right);
  --page-search-max: 300px;
  /* 浮片取消后，四周不再预留窗框内距：这两个令牌归零，版心计算保持原公式。 */
  --sheet-inset-left: 0px;
  --sheet-inset-right: 0px;
  --sheet-gutter: 0px;
}
/* 桌面默认使用可读的宽导航；Web 自己管理 216px 导航，不参与这两档。
   176 是「模块名 + 计数」两段仍读得开、又不抢正文的下限：208 时正文列被压掉一整格网格。 */
.app-root.codex-layout:not(.web-runtime) { --sidebar-rail-w: 176px; }
.app-root.codex-layout:not(.web-runtime).sidebar-collapsed { --sidebar-rail-w: 56px; }
/* 最小桌面窗先让导航收起成图标轨，把宽度留给搜索与页内动作；偏好本身不改。 */
@media (max-width: 899px) {
  .app-root.codex-layout:not(.web-runtime) { --sidebar-rail-w: 56px; }
}
/* 阅读列不再分模块取宽：小记与 Codex 曾经各锁 940，其余模块 1120，
   最大化时同一外壳里差出 180px，换页正文整列横跳 90px。全模块同用一条 1120 的列。 */
.app-root.codex-layout:has(.workspace-surface.directory-docked) { --workspace-directory-offset: var(--workspace-directory-width); }
.app-root.codex-layout:not(.locked-bg) {
  background-color: var(--bg-workspace);
  background-image: var(--bg-aura);
  background-attachment: fixed;
}
/* 深底侧栏使用深色导轨中性底 */
:root[data-base="dark"] .app-root.codex-layout:not(.web-runtime) {
  --bg-rail: var(--sidebar-bg);
  --rail-field-veil: color-mix(in srgb, var(--bg-rail) 65%, transparent);
}
.codex-layout .app-layout { padding: 0; }

/* 浮片：内容区是一块内嵌的圆角面板，坐在窗框的柔光上。
   框比片深一级、片比卡深一级——三层明度各差一档，层级由明度与影子承担，不靠边到边的分割线。 */
.workspace-surface {
  position: relative; display: flex; flex: 1; min-width: 0; overflow: hidden;
  /* 彻底通透无界，透出天空微光 */
  margin: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.workspace-surface :is(.content-inner, .stream, .fs-scroll, #workspace-directory-content)::-webkit-scrollbar-track { margin: 0; }
/* 全屏接管整个内容面；原页保留滚动和目录状态，隐藏后也不会进入 Tab 焦点序列。
   页级控件住在顶栏里，不在内容面内，同样要在全屏时让位。 */
.workspace-surface:has(> .fs) > :is(.workspace-main, .workspace-directory) { visibility: hidden; }
/* 全屏小记保持与普通页面一致的标准标题栏高度（34px），消除高度跳变 */
.app-root.codex-layout:has(.workspace-surface > .fs) { --workspace-directory-offset: 0px; }
.app-root.codex-layout:has(.workspace-surface > .fs) #workspace-page-toolbar > * { display: none; }
/* 目录开关挂在窗口工具位，不属于页栏容器；全屏接管时同样要跟着原页面让位。 */
.app-root.codex-layout:has(.workspace-surface > .fs) #workspace-directory-toggle { display: none; }
.workspace-body { position: relative; display: flex; flex: 1; min-height: 0; overflow: hidden; }
.workspace-body > .main-content { flex: 1; min-width: 0; }
/* 悬停沿用主题中性色，轻微改变卡面明暗；强调色留给选中、编辑和焦点。
   纸底取 8%：对白卡仍在上限 7.5ΔE 内，落到画布上也有清楚的色阶差。 */
.workspace-main { --bg-surface-hover: color-mix(in srgb, var(--text) 8%, var(--bg-surface)); position: relative; min-width: 0; background: transparent; display: flex; flex-direction: column; }
/* 页头：动作栏横向贯通整条阅读列，控件与正文列左对齐/右对齐 */
.workspace-head {
  position: relative;
  z-index: 26;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  padding: 8px var(--workspace-content-padding) 6px;
}
.workspace-head:not(:has(#workspace-page-toolbar > *)) { display: none; }
.workspace-page-toolbar {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  /* 窄窗（手机 Web 390）一条装不下页签＋动作带：允许换行，让动作带自己落到第二排。
     单排页面永远只有一行，这条不影响其它模块。
     别删这一条：动作带（.cx-band-controls）内联轴是容器查询、内在宽度被算成 0，
     nowrap 下它既不换行也不撑开，只会带着自己的件儿从右缘向左溢出、直接压在页签上。 */
  flex-wrap: wrap;
  align-items: center;
  row-gap: 6px;
  container: workspace-toolbar / inline-size;
  pointer-events: none;
}
/* 顶沿护边：滚动内容在标题栏下沿淡出，而不是被切成一条硬边。
   片内是同一个实色，直接用片色做遮罩即可（不再需要 fixed 附着层对齐视口光）。 */
.workspace-main::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  z-index: 25;
  height: 12px;
  pointer-events: none;
  background: transparent;
  -webkit-mask-image: linear-gradient(to bottom, #000 70%, transparent);
  mask-image: linear-gradient(to bottom, #000 70%, transparent);
}
:root[data-base="dark"] .workspace-main { --bg-surface-hover: color-mix(in srgb, var(--text) 4.8%, var(--bg-surface)); }
/* 辅助目录同一片内，用留白和浅色选中块建立层次，不再自带画布底色。 */
.workspace-directory { display: flex; flex-direction: column; flex: 0 0 var(--workspace-directory-width); min-width: 0; overflow: hidden; background: transparent; }
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

/* 保留通栏控制带和无边框卡面，正文只约束阅读宽度；目录开关不切换内距档位。 */
.codex-layout .workspace-main .content-inner { padding: 16px var(--workspace-content-padding) 22px; }
/* 第一行归内容区自己的内距管；网格的 12px 只用于组与组之间，不再和首行呼吸叠成 28px。 */
.codex-layout .workspace-main .content-inner > .card-grid:first-child { margin-top: 0; }
.codex-layout .workspace-main .codex-content { padding-top: 4px; }
.codex-layout .workspace-main .stream-inner {
  max-width: 760px;
  width: 100%;
  margin: 0 auto;
  padding: 8px 16px 40px;
  box-sizing: border-box;
}
/* 小记便签模块：顶栏动作区与 760px 单列阅读纸卷保持一致的轴线与边距，杜绝两端拉散 */
.codex-layout .workspace-main:has(.notes-page) .workspace-page-toolbar {
  max-width: 760px;
  margin: 0 auto;
  width: 100%;
  padding: 0 16px;
}
.codex-layout .workspace-main:has(.notes-page) .workspace-head {
  padding-inline: 0;
}

/* 页级筛选：贴着内容的一行导航。不再画整条底线——一条横贯阅读列的线
   会在视觉上把页面切成两截；选中项自己的下划线已经够定位。 */
.workspace-workbar {
  display: flex;
  align-items: center;
  gap: 20px;
  min-width: 0;
  height: 42px;
  min-height: 42px;
  margin: 6px 0 14px;
  border-bottom: 0;
}
/* 两段都按内容宽排：谁也不撑满，标签才紧贴在视图页签后面。
   页签一律不可收缩（视图只有四枚，裁掉任何一枚都是丢功能）；标签条留一份可收缩
   只当保险丝——真正的放不下由 NotesModule 整组收起处理，不允许在这里裁出半截列表。
   注意：标签条可收缩不等于里面的按钮可收缩，收起判据量的就是它的 scrollWidth，
   按钮要是跟着一起缩，整组就永远「放得下」。 */
.workspace-workbar-tabs {
  display: flex;
  align-items: stretch;
  gap: 20px;
  flex: 0 0 auto;
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
  bottom: 0;
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
/* 标签搬过来之后，这根线是「视图」和「标签」唯一的分组线索。
   --border（纸底 #e6e6e6 对 #fafafa 约 1.18:1）等于不存在，按 --text 混一档。 */
.workspace-workbar .wb-divider {
  flex: none;
  width: 1px;
  height: 16px;
  background: color-mix(in srgb, var(--text) 16%, transparent);
}
.workspace-workbar .wb-more { color: var(--text-muted); }
.workspace-workbar .wb-more.active { color: var(--text-brand); }

/* 页头里的页栏：脱掉吸顶与底色，控件直接坐在页头里。
   左端放本页的「读」控件（视图页签、服务状态），右端放搜索与动作，两端都贴轴（见下方 .page-lead）。 */
#workspace-page-toolbar > :is(.page-bar, .cx-band-controls) {
  position: static;
  /* 基准取内容宽（auto）而不是 0：窄窗里页签＋动作带放不下时，这一排整段换到第二行，
     而不是缩到 min-content 后把件儿从左边溢出、压在页签底下（390 手机档实测
     动作带被缩到 78px，统计窗口落在 x=-256）。 */
  flex: 1 1 auto;
  min-width: 0;
  height: var(--workspace-toolbar-height);
  min-height: var(--workspace-toolbar-height);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
  pointer-events: none;
}
#workspace-page-toolbar :is(.page-bar, .cx-band-controls) > * { pointer-events: auto; }
/* 搜索框与动作钮是同一组，靠右端收拢。
   搜索框不再 flex 撑满——撑满会把动作钮推到边缘、把搜索框一个人丢在中间。
   Codex 页头的搜索带整组靠右（见 .cx-band-controls），不参与这一档。 */
#workspace-page-toolbar :is(.page-bar, .cx-band-controls) > :first-child:not(.page-actions):not(.page-lead) { margin-left: auto; }
#workspace-page-toolbar .page-bar > .search-box:first-child { margin-left: auto; }
/* 页名上标题栏之后，整排一律靠右会把左半空成一整块空气（1040 实测 336px、1440 实测 736px）。
   .page-lead 把本页的「读」控件钉在左轴并撑满剩下的宽度，右端那组因此自然落到右缘，一排两端都有落点。
   带里还挂着视图页签：正文前那条 42px 工作栏整条搬进页头，正文因此少占一行。
   这一排不换行——放不下由各组自己收口（标签收成「标签 N ▾」、分类按实测宽度收到「更多」），
   换行会把搜索与动作甩到第二排，右端有落点、左端又空出一整块。
   宽度契约：搜索与动作组都不可收缩，溢出全部由 .page-lead 吸收，所以它撑出的宽度只跟整排宽有关、
   与自己装了多少内容无关——收口判据量的就是这个宽度。它要是跟着内容一起缩，
   「放得下」会永远成立，保险丝再也不触发；收完又变宽、变宽又放开，还会来回抖。 */
#workspace-page-toolbar .page-bar:has(> .page-lead) { height: auto; min-height: 28px; }
#workspace-page-toolbar .page-bar > .page-lead { flex: 1 1 auto; min-width: 0; }
#workspace-page-toolbar .page-lead > .workspace-workbar { flex: 1 1 auto; min-width: 0; height: auto; min-height: 0; margin: 0; overflow: hidden; }
#workspace-page-toolbar .page-lead .wb-tab { height: 26px; }
#workspace-page-toolbar .search-box { flex: 0 0 auto; width: 175px; min-width: 110px; max-width: 210px; margin-right: 6px; height: 26px; container: workspace-search / inline-size; }
#workspace-page-toolbar .search-box input { font-size: 11.5px; }
#workspace-page-toolbar :is(.btn-primary, .btn-secondary) { font-size: 11.5px; height: 26px; border-radius: 6px; }
/* 动作组在页头里不再吃 auto 外边距：搜索框自己撑开，两组之间保持轻柔呼吸 */
#workspace-page-toolbar .page-actions { margin-left: 0; flex-shrink: 0; gap: 4px; }
/* Codex 页头的搜索与动作同为一条动作带：搜索在左、页级动作在右，全部压在页签同一排。
   账号搜索以前独占第二排，只装一个输入框、右边全空，页头白多出 38px；现在收回到这一排。 */
#workspace-page-toolbar > .cx-band-controls { order: 1; }

/* Codex 的页签是页名的一部分，靠左跟在页名后面；搜索与筛选留在右端。 */
#workspace-page-toolbar > .cx-header-tabs { margin-right: auto; }
#workspace-page-toolbar :is(.btn-primary, .btn-secondary, .bar-btn) { white-space: nowrap; }
#workspace-page-toolbar .btn-primary:where(:not(.ghost-danger)):not(:disabled) {
  background: var(--bg-workspace-primary);
  color: var(--text-workspace-primary);
  border: none;
  border-radius: 6px;
  font-weight: 600;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 20%, transparent);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
#workspace-page-toolbar .btn-primary:hover:not(:disabled):not(.ghost-danger) {
  background: var(--bg-workspace-primary-hover);
  color: var(--text-workspace-primary);
  transform: translateY(-0.5px);
  filter: none;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);
}
#workspace-page-toolbar .btn-primary:active:not(:disabled):not(.ghost-danger) {
  background: var(--bg-workspace-primary-active);
  color: var(--text-workspace-primary);
  transform: translateY(0);
}
/* 带子里的动作一律无描边：描边留给弹窗表单，这里只靠淡染和字色分层。 */
#workspace-page-toolbar :is(.btn-secondary, .btn-primary.ghost-danger) { border-color: transparent; }
#workspace-page-toolbar .btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border-radius: 8px;
  padding-inline: var(--toolbar-action-padding, 10px);
}
#workspace-page-toolbar .btn-secondary:hover:not(:disabled) { background: var(--hover-chrome); border-color: transparent; color: var(--text); }
#workspace-page-toolbar .btn-secondary:active:not(:disabled) { transform: none; }
#workspace-page-toolbar .btn-secondary.active { background: var(--accent-soft); border-color: transparent; color: var(--text-brand); }

/* 最小桌面窗（800，页头带实测 648）先收搜索框：一排要装视图页签＋标签＋搜索＋工具钮，
   搜索框是这排里唯一少几个字也不影响识别的件。默认 1040 窗口的页头带是 768，
   这一档必须留在 768 以下——不然常见的窗口白白丢掉搜索快捷键，还被判成回归。 */
@container workspace-toolbar (max-width: 700px) {
  #workspace-page-toolbar .search-box { width: 200px; }
}
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

/* 卡面浮在片色上：白卡 + 一条发丝线，内容区一律无影（docs/design/layering/02-content-shadow-retire.md）。
   卡面本地改绑 --bg-surface：组件自己的 `background: var(--bg-surface)` 与悬停
   `--bg-surface-hover` 都不必逐页改，弹窗与输入框仍读全局那一档。 */
.app-root.codex-layout .workspace-main :is(.grid-card, .mfa-card, .rcard, .tn-card, .clean-group-card, .drop-card, .rowlist):where(:not(.editing):not(.selected):not(.is-sel):not(:focus-visible)) {
  --bg-surface: var(--bg-card);
  --bg-surface-hover: color-mix(in srgb, var(--text) 7%, var(--bg-card));
  border-color: var(--border-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card-rest);
}
/* 小记卡片与便签条：Windows 11 Fluent 规范实体卡片与精致微投影 */
.app-root.codex-layout .workspace-main :is(.memo, .composer):where(:not(.editing):not(.selected):not(.is-sel):not(:focus-visible)) {
  --bg-surface: var(--bg-card);
  --bg-surface-hover: color-mix(in srgb, var(--text) 7%, var(--bg-card));
  box-shadow: var(--shadow-card-rest);
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
.codex-layout .workspace-main :not(.module-empty-state) > .empty-icon { background: var(--fill); border-color: transparent; opacity: 1; color: var(--text-faint); }
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
/* 身份列与额度列之间靠留白分开，mock 里不画这根竖线。
   20px 是两列之间仍读得出"分开"的下限：再宽就变成两簇信息各占一半、中间空一条带。 */
.codex-layout .workspace-main .acc-quota { border-left: 0; padding-left: 20px; }

/* 直连页探测行组合控件：整行卡片带清晰发丝边与聚焦态，内嵌无框输入框与右侧开始探测按钮 */
.codex-layout .workspace-main .bp-probe { padding-bottom: 0; border-bottom: 0; }
.codex-layout .workspace-main .bp-probe > .page-bar {
  height: 48px;
  padding: 4px 6px 4px 14px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--panel-bg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  transition: border-color var(--transition-fast);
}
.codex-layout .workspace-main .bp-probe > .page-bar:hover {
  border-color: var(--border-hover, rgba(0, 0, 0, 0.2));
}
.codex-layout .workspace-main .bp-probe > .page-bar:focus-within {
  border-color: var(--accent) !important;
  box-shadow: none !important;
}
.codex-layout .workspace-main .bp-probe .probe-box {
  height: 100% !important;
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  padding: 0 !important;
  margin: 0 !important;
  flex: 1 1 auto !important;
  min-width: 0 !important;
  max-width: none !important;
  width: auto !important;
}
.codex-layout .workspace-main .bp-probe .probe-box input,
.codex-layout .workspace-main .bp-probe .probe-box input:focus,
.codex-layout .workspace-main .bp-probe .probe-box input:focus-visible {
  border: none !important;
  outline: none !important;
  background: transparent !important;
  box-shadow: none !important;
}
.codex-layout .workspace-main .bp-probe .btn-primary {
  height: 38px;
  margin-left: auto;
  border-radius: 7px;
  padding: 0 16px;
}
.app-root.codex-layout .workspace-main :is(.grid-card, .mfa-card, .rcard, .tn-card, .clean-group-card, .drop-card, .rowlist):hover:where(:not(.selected):not(.is-sel):not(.picked):not(.editing):not(:focus-visible)):not(.empty-state) {
  border-color: var(--card-line-hover);
  box-shadow: var(--shadow-card-hover);
}
/* 各模块的列表统一中性悬停，分组列表只反馈指针所在的行；独立卡片（.rcard）悬停保持纯净底色、仅高亮边框 */
.codex-layout .workspace-main :is(.grp-head, .usg-model-row, .url-row, .dir-row, .svc-row, .tn-add) {
  transition: background-color var(--transition-fast);
}
.app-root.codex-layout .workspace-main :is(.grp-head, .usg-model-row, .url-row, .dir-row, .svc-row, .tn-add):hover:where(:not(.selected):not(.is-sel):not(.picked):not(.editing):not(.skeleton):not(:disabled):not([aria-disabled="true"])) {
  background-color: var(--bg-surface-hover);
}
.codex-layout .workspace-main .grid-acts { background: inherit; box-shadow: none; }
.codex-layout .workspace-main .memo.editing { background: var(--bg-surface); }
/* 置顶卡不再描一道 34% accent 的边：它已经把「置顶」写在分组标题上，同一列出现第二种
   边框色只会被读成"这张被选中"。彩色边框整页只留一个用途——选中/编辑。 */
.codex-layout .workspace-main .grid-card.selected { border-color: var(--accent); }
.codex-layout .workspace-main .memo.editing,
.codex-layout .workspace-main :is(.memo, .grid-card, .mfa-card):focus-visible { border-color: var(--accent); box-shadow: none; transform: none; }
.codex-layout .workspace-main .composer:focus-within { border-color: var(--accent); box-shadow: none; }

/* 带子替掉了 42px 标题栏，toast 跟着下移一档。 */
.codex-layout .toast { top: 66px; }
/* 页级工作栏存在时，提示落在工作栏下方，避免盖住筛选与当前视图。 */
.codex-layout:has(.workspace-workbar) .toast { top: 118px; }

</style>
