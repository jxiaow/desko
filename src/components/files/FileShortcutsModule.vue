<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { fileShortcutsApi as api } from '../../services/api/fileShortcuts'
import type { FileShortcut } from '../../types'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'
import { useEscapeClose } from '../../composables/useEscapeClose'
import { useGridKeys } from '../../composables/useGridKeys'
import AppIcon from '../shared/AppIcon.vue'
import CreateAction from '../shared/CreateAction.vue'
import PopoverMenu from '../shared/PopoverMenu.vue'
import { usePageHeadStore } from '../../stores/pageHead'
import { isWebRuntime } from '../../services/runtime'
import { writeClipboardText } from '../../utils/clipboard'
import { isPageShortcutBlocked } from '../../utils/pageShortcuts'
import { downloadWebFile } from './webFiles'
import WebFilesDialog from './WebFilesDialog.vue'

const props = defineProps<{
  searchKeyword: string
  loading: boolean
  /** 上一次加载的失败原因；非空时显示「加载失败 · 重试」而不是空态 */
  loadError?: string | null
  filteredShortcuts: FileShortcut[]
  totalShortcuts: number
}>()

const toastStore = useToastStore()
const confirmStore = useConfirmStore()
const webRuntime = isWebRuntime()
const browsingShortcut = ref<FileShortcut | null>(null)

const emit = defineEmits<{
  'update:searchKeyword': [value: string]
  addShortcut: [name: string, path: string, type: 'file' | 'folder']
  updateShortcut: [id: string, name: string, path: string, type: 'file' | 'folder']
  removeShortcut: [id: string]
  retryLoad: []
}>()

const showAddDialog = ref(false)
const editingId = ref<string | null>(null)
const addForm = ref({ name: '', path: '', type: 'file' as 'file' | 'folder' })

const contextMenu = ref({ show: false, x: 0, y: 0, shortcut: null as FileShortcut | null })
const ctxPanel = ref<HTMLElement | null>(null)

/* 「更多操作」浮层：只放删除，其余动作已在 hover 钮上 */
const moreMenu = ref({ anchor: null as HTMLElement | null, shortcut: null as FileShortcut | null })

const openMoreMenu = (el: HTMLElement, shortcut: FileShortcut) => {
  if (moreMenu.value.shortcut?.id === shortcut.id) {
    closeMoreMenu()
    return
  }
  moreMenu.value = { anchor: el, shortcut }
}

const closeMoreMenu = () => {
  moreMenu.value = { anchor: null, shortcut: null }
}

/** ⋯ 菜单项复用行内动作：先取当前条目，再收起菜单 */
const runOnMoreMenu = (fn: (shortcut: FileShortcut) => void) => {
  const shortcut = moreMenu.value.shortcut
  closeMoreMenu()
  if (shortcut) fn(shortcut)
}

const pickFile = async () => {
  try {
    const selected = await dialogOpen({
      multiple: false,
      directory: false,
    })
    if (selected && typeof selected === 'string') {
      addForm.value.path = selected
      const parts = selected.replace(/\\/g, '/').split('/')
      addForm.value.name = parts[parts.length - 1] || selected
      addForm.value.type = 'file'
    }
  } catch (e) {
    console.error('Failed to pick file:', e)
    toastStore.showToast('选择文件失败', 'error')
  }
}

const pickFolder = async () => {
  try {
    const selected = await dialogOpen({
      multiple: false,
      directory: true,
    })
    if (selected && typeof selected === 'string') {
      addForm.value.path = selected
      const parts = selected.replace(/\\/g, '/').split('/')
      const filtered = parts.filter(Boolean)
      addForm.value.name = filtered[filtered.length - 1] || selected
      addForm.value.type = 'folder'
    }
  } catch (e) {
    console.error('Failed to pick folder:', e)
    toastStore.showToast('选择文件夹失败', 'error')
  }
}

const onPathInput = () => {
  const path = addForm.value.path.trim()
  if (!path) return
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  const name = parts[parts.length - 1] || ''
  if (!addForm.value.name || addForm.value.name === addForm.value.path) {
    addForm.value.name = name
  }
  // Auto detect type based on extension or trailing slash
  if (normalized.endsWith('/') || !name.includes('.')) {
    addForm.value.type = 'folder'
  } else {
    addForm.value.type = 'file'
  }
}

const pastePath = async () => {
  try {
    const text = (await navigator.clipboard.readText()).trim()
    if (!text) {
      toastStore.showToast('剪贴板为空')
      return
    }
    addForm.value.path = text
    onPathInput()
  } catch {
    toastStore.showToast('读取剪贴板失败', 'error')
  }
}

const isEditing = () => editingId.value !== null

const openEdit = (shortcut: FileShortcut) => {
  addForm.value = { name: shortcut.name, path: shortcut.path, type: shortcut.shortcut_type }
  editingId.value = shortcut.id
  showAddDialog.value = true
}

const doAdd = () => {
  if (!addForm.value.name || !addForm.value.path) {
    toastStore.showToast('请填写名称和路径', 'error')
    return
  }
  if (editingId.value) {
    emit('updateShortcut', editingId.value, addForm.value.name, addForm.value.path, addForm.value.type)
  } else {
    emit('addShortcut', addForm.value.name, addForm.value.path, addForm.value.type)
  }
  closeDialog()
}

const closeDialog = () => {
  showAddDialog.value = false
  editingId.value = null
  addForm.value = { name: '', path: '', type: 'file' }
}

const cancelAdd = () => {
  closeDialog()
}

useEscapeClose(cancelAdd, () => showAddDialog.value)

const openShortcut = async (shortcut: FileShortcut) => {
  try {
    if (webRuntime) {
      if (shortcut.shortcut_type === 'folder') {
        browsingShortcut.value = shortcut
      } else {
        await downloadWebFile(shortcut.id, '', shortcut.name)
      }
      return
    }
    await api.openFile(shortcut.path)
  } catch (cause) {
    toastStore.showToast(webRuntime && cause instanceof Error ? cause.message : '无法打开，文件可能不存在', 'error')
  }
}

const onContextMenu = async (event: MouseEvent, shortcut: FileShortcut) => {
  event.preventDefault()
  contextMenu.value = { show: true, x: event.clientX, y: event.clientY, shortcut }
  await nextTick()
  const el = ctxPanel.value
  if (!el) return
  /* 贴边钳制：底部/右缘的行右键时，菜单不得把「删除」顶出可视区 */
  const { width, height } = el.getBoundingClientRect()
  contextMenu.value.x = Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8))
  contextMenu.value.y = Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))
}

const closeContextMenu = () => {
  contextMenu.value.show = false
  contextMenu.value.shortcut = null
}

const editFromMenu = () => {
  if (contextMenu.value.shortcut) {
    openEdit(contextMenu.value.shortcut)
  }
  closeContextMenu()
}

/** 右键菜单项复用行内动作：先取当前条目，再收起菜单 */
const runOnMenu = (fn: (shortcut: FileShortcut) => void) => {
  if (contextMenu.value.shortcut) fn(contextMenu.value.shortcut)
  closeContextMenu()
}

const confirmDelete = (shortcut: FileShortcut) => {
  confirmStore.showConfirm('删除快捷方式', `「${shortcut.name}」将被移除，本机文件不受影响。`, () => {
    emit('removeShortcut', shortcut.id)
    toastStore.showToast('已删除')
  })
}

const deleteFromMenu = () => {
  if (contextMenu.value.shortcut) confirmDelete(contextMenu.value.shortcut)
  closeContextMenu()
}

const openContainingFolder = async (shortcut: FileShortcut) => {
  const path = shortcut.path.replace(/\\/g, '/')
  const folder = path.substring(0, path.lastIndexOf('/'))
  if (!folder) return
  try {
    await api.openFile(folder)
  } catch {
    toastStore.showToast('无法打开所在目录', 'error')
  }
}

const openInTerminal = async (shortcut: FileShortcut) => {
  try {
    await api.openTerminal(shortcut.path)
  } catch (e: any) {
    const msg = typeof e === 'string' ? e : e?.message
    toastStore.showToast(msg || '无法打开终端', 'error')
  }
}

/* 复制 morph：成功后钮面短暂翻成对勾做回执，toast 照旧 */
const copiedId = ref<string | null>(null)
let copiedTimer: number | undefined
const copyPathToClipboard = async (shortcut: FileShortcut) => {
  try {
    await writeClipboardText(shortcut.path)
    toastStore.showToast('地址已复制')
    copiedId.value = shortcut.id
    if (copiedTimer) window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => { copiedId.value = null }, 1200)
  } catch {
    toastStore.showToast('复制失败', 'error')
  }
}

const getFileExt = (path: string) => {
  const parts = path.split('.')
  return parts.length > 1 ? parts.pop()!.toLowerCase() : ''
}

/* 二维游走 + C 复制路径：列数按网格实测，Enter/Space 的开启动作留在卡片自身 */
const { onGridKeydown } = useGridKeys({
  cardSelector: '.shortcut-row',
  onCopy: (id) => {
    if (webRuntime) return
    const shortcut = props.filteredShortcuts.find(s => s.id === id)
    if (shortcut) void copyPathToClipboard(shortcut)
  },
})

/* 扩展名 → 文件类型槽位。这里只定"哪类文件归哪个槽"，
   具体什么颜色由当前主题给（global.css 的 --ft-*），切主题才会跟着换。 */
const EXT_SLOT: Record<string, string> = {
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', rtf: 'doc', pages: 'doc',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', numbers: 'sheet',
  ppt: 'deck', pptx: 'deck', key: 'deck',
  zip: 'arch', rar: 'arch', '7z': 'arch', tar: 'arch', gz: 'arch',
  js: 'code', jsx: 'code', ts: 'code', tsx: 'code', py: 'code', rs: 'code',
  go: 'code', java: 'code', c: 'code', h: 'code', cpp: 'code', sh: 'code', json: 'code',
  md: 'mark', markdown: 'mark', txt: 'mark',
  png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', svg: 'img', webp: 'img', ico: 'img',
}

const extVar = (ext: string) => `var(--ft-${EXT_SLOT[ext] || 'unk'})`

/** 路径只保留尾部：行宽有限，盘符和上层目录是噪音，完整路径在 title 里 */
const pathTail = (path: string) => {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 2) return parts.join('/')
  return `…/${parts.slice(-2).join('/')}`
}

/* ── Ctrl/Cmd+K 聚焦搜索：与收藏/小记页同一条快捷键，只在本页挂载期间监听 ── */
const searchRef = ref<HTMLInputElement | null>(null)
const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const kbdHint = computed(() => (isMac ? '⌘K' : 'Ctrl K'))

const onGlobalKey = (e: KeyboardEvent) => {
  if (e.defaultPrevented || e.isComposing) return
  /* Ctrl/Cmd+Enter：弹窗开着即为保存，优先于其它键位 */
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (showAddDialog.value && e.target instanceof Element && e.target.closest('.shortcut-dialog')) {
      e.preventDefault()
      doAdd()
    }
    return
  }
  if (isPageShortcutBlocked(e)) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    searchRef.value?.focus()
    searchRef.value?.select()
  }
}

onMounted(() => {
  document.addEventListener('click', closeContextMenu)
  window.addEventListener('keydown', onGlobalKey)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeContextMenu)
  window.removeEventListener('keydown', onGlobalKey)
})

const pageHead = usePageHeadStore()
watchEffect(() => pageHead.setHead('文件快捷', props.filteredShortcuts.length ? `${props.filteredShortcuts.length} 项` : ''))
</script>

<template>
  <div class="content-inner" :class="{ 'web-runtime': webRuntime }">
    <div class="page-bar">
      <div class="search-box">
        <span class="search-icon"><AppIcon name="search" :size="15" /></span>
        <input ref="searchRef" :value="searchKeyword" placeholder="搜索快捷方式…" @input="emit('update:searchKeyword', ($event.target as HTMLInputElement).value)" />
        <kbd v-if="!searchKeyword" class="search-kbd">{{ kbdHint }}</kbd>
        <button v-if="searchKeyword" class="search-clear" @click="emit('update:searchKeyword', '')" title="清除搜索">
          <AppIcon name="x" :size="13" />
        </button>
      </div>
      <div v-if="!webRuntime" class="page-actions">
        <CreateAction label="添加快捷方式" @click="showAddDialog = true" />
      </div>
    </div>

    <div v-if="loading" class="card-grid">
      <div class="skeleton-card" v-for="n in 6" :key="n">
        <div class="row1">
          <span class="skeleton-slot"></span>
          <div class="skeleton-line name"></div>
        </div>
        <div class="row2">
          <div class="skeleton-line foot"></div>
        </div>
      </div>
    </div>

    <!-- 浮岛网格：与收藏页同一层壳（global.css .grid-card），卡内只换内容排布 -->
    <div v-else-if="filteredShortcuts.length > 0" class="shortcut-list card-grid" @keydown="onGridKeydown">
      <div
        v-for="shortcut in filteredShortcuts"
        :key="shortcut.id"
        class="shortcut-row grid-card"
        :data-id="shortcut.id"
        role="button"
        tabindex="0"
        :aria-label="webRuntime ? `${shortcut.shortcut_type === 'folder' ? '浏览' : '下载'} ${shortcut.name}` : `打开 ${shortcut.name}`"
        @click="openShortcut(shortcut)"
        @keydown.enter.prevent="openShortcut(shortcut)"
        @keydown.space.prevent="openShortcut(shortcut)"
        @contextmenu="!webRuntime && onContextMenu($event, shortcut)"
      >
        <!-- 一行身份：24px 类型档 + 名称 + 右对齐类型标签；动作收进右下浮岛 -->
        <div class="row1">
          <span v-if="shortcut.shortcut_type === 'folder'" class="ft-ico grid-slot grid-slot--folder" aria-hidden="true">
            <AppIcon name="folder" :size="15" />
          </span>
          <span v-else class="ft-ico toned grid-slot" :style="{ '--ftc': extVar(getFileExt(webRuntime ? shortcut.name : shortcut.path)) }">{{ getFileExt(webRuntime ? shortcut.name : shortcut.path) || 'FILE' }}</span>
          <span class="row-name" :title="shortcut.name">{{ shortcut.name }}</span>
        </div>

        <!-- 二行副址：等宽路径缩进到名称起笔，尾部优先（保文件名） -->
        <div v-if="!webRuntime" class="row2">
          <span class="path-chip" :title="shortcut.path">{{ pathTail(shortcut.path) }}</span>
        </div>

        <div v-if="!webRuntime" class="row-acts grid-acts">
          <button class="ib" :class="{ copied: copiedId === shortcut.id }" type="button" :title="copiedId === shortcut.id ? '已复制' : '复制地址 (C)'" @click.stop="copyPathToClipboard(shortcut)">
            <AppIcon :name="copiedId === shortcut.id ? 'check' : 'copy'" :size="15" />
          </button>
          <button class="ib" type="button" title="编辑" @click.stop="openEdit(shortcut)">
            <AppIcon name="edit" :size="15" />
          </button>
          <button class="ib" type="button" title="更多操作" aria-label="更多操作" @click.stop="openMoreMenu($event.currentTarget as HTMLElement, shortcut)">
            <AppIcon name="dots" :size="15" />
          </button>
        </div>

        <PopoverMenu v-if="!webRuntime && moreMenu.shortcut?.id === shortcut.id" :anchor="moreMenu.anchor" :width="136" @close="closeMoreMenu">
          <button class="pop-item" type="button" @click="runOnMoreMenu(openContainingFolder)">
            <AppIcon name="folderOpen" :size="14" />
            打开所在目录
          </button>
          <button class="pop-item" type="button" @click="runOnMoreMenu(openInTerminal)">
            <AppIcon name="terminal" :size="14" />
            在终端中打开
          </button>
          <span class="pop-sep"></span>
          <button class="pop-item danger" type="button" @click="runOnMoreMenu(confirmDelete)">
            <AppIcon name="trash" :size="14" />
            删除
          </button>
        </PopoverMenu>
      </div>
    </div>

    <div v-else-if="loadError" class="error-state">
      <div class="empty-icon">
        <AppIcon name="alert" :size="24" />
      </div>
      <div class="empty-title">加载失败</div>
      <div class="empty-desc">{{ loadError }}</div>
      <button class="btn-secondary retry-btn" @click="emit('retryLoad')">重试</button>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon">
        <AppIcon :name="searchKeyword ? 'searchEmpty' : 'navFiles'" :size="24" />
      </div>
      <div class="empty-title">{{ searchKeyword ? '未找到匹配结果' : '暂无快捷方式' }}</div>
      <div class="empty-desc">{{ searchKeyword ? '试试其他关键词' : webRuntime ? '请在桌面端添加文件快捷方式' : '点击右上角 + 添加快捷方式' }}</div>
    </div>

    <!-- Add/Edit Dialog：与收藏表单弹窗同一套骨架（居中悬浮 + 42px 头 + 32px 字段轴 + 46px 底栏带快捷键徽标） -->
    <Transition name="dialog">
      <div v-if="!webRuntime && showAddDialog" class="dialog-overlay form-overlay">
        <div class="dialog shortcut-dialog" role="dialog" aria-modal="true" :aria-label="isEditing() ? '编辑快捷方式' : '添加快捷方式'">
          <div class="dialog-header">
            <div class="dialog-header-left">
              <h3>{{ isEditing() ? '编辑快捷方式' : '添加快捷方式' }}</h3>
            </div>
            <button class="dialog-close" type="button" title="关闭" @click="cancelAdd">
              <AppIcon name="x" :size="16" />
            </button>
          </div>
          <div class="dialog-body">
            <div class="form-group">
              <label>路径 <span class="req">*</span></label>
              <div class="path-input-row">
                <input v-model="addForm.path" placeholder="粘贴文件/文件夹路径，或点击右侧浏览" @blur="onPathInput" />
                <span class="path-acts">
                  <button class="path-act" type="button" title="从剪贴板粘贴" @click="pastePath">
                    <AppIcon name="clipboard" :size="14" />
                  </button>
                  <button class="path-act" type="button" title="选择文件" @click="pickFile">
                    <AppIcon name="file" :size="14" />
                  </button>
                  <button class="path-act" type="button" title="选择文件夹" @click="pickFolder">
                    <AppIcon name="folderOpen" :size="14" />
                  </button>
                </span>
              </div>
            </div>
            <div class="form-group">
              <label>名称 <span class="req">*</span></label>
              <input v-model="addForm.name" placeholder="快捷方式名称" />
            </div>
            <div class="form-group">
              <label>类型</label>
              <div class="seg">
                <button class="seg-btn" :class="{ on: addForm.type === 'file' }" type="button" @click="addForm.type = 'file'">文件</button>
                <button class="seg-btn" :class="{ on: addForm.type === 'folder' }" type="button" @click="addForm.type = 'folder'">文件夹</button>
              </div>
            </div>
          </div>
          <div class="dialog-footer">
            <div class="footer-hints">
              <span class="kbd">Ctrl</span><span class="kbd">Enter</span><span>保存</span>
              <span class="hints-dot">·</span>
              <span class="kbd">Esc</span><span>取消</span>
            </div>
            <div class="footer-actions">
              <button class="btn-secondary" type="button" @click="cancelAdd">取消</button>
              <button class="btn-primary" type="button" @click="doAdd">{{ isEditing() ? '保存' : '添加' }}</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Context Menu -->
    <div v-if="!webRuntime && contextMenu.show" ref="ctxPanel" class="popover" :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }">
      <div class="pop-item" @click="editFromMenu">
        <AppIcon name="edit" :size="14" />
        编辑
      </div>
      <div class="pop-item" @click="runOnMenu(openContainingFolder)">
        <AppIcon name="folderOpen" :size="14" />
        打开所在目录
      </div>
      <div class="pop-item" @click="runOnMenu(openInTerminal)">
        <AppIcon name="terminal" :size="14" />
        在终端中打开
      </div>
      <div class="pop-item" @click="runOnMenu(copyPathToClipboard)">
        <AppIcon name="copy" :size="14" />
        复制地址
      </div>
      <div class="pop-item danger" @click="deleteFromMenu">
        <AppIcon name="trash" :size="14" />
        删除
      </div>
    </div>
    <WebFilesDialog v-if="browsingShortcut" :shortcut="browsingShortcut" @close="browsingShortcut = null" />
  </div>

</template>

<style scoped>
@media (max-width: 600px) {
  .web-runtime .page-bar .search-box { flex: 1 1 100%; width: 100%; margin-right: 0; }
}
/* .content-inner / .page-bar / 搜索框 / 主按钮 / 骨架行形全部走 global.css 的页面骨架；
   本页没有分类标签，动作钮顶到右缘 */
.web-runtime .shortcut-row { min-height: 56px; justify-content: center; }

/* 卡皮、双行壳（.row1/.row2）、24px 档、右下动作浮岛全在 global.css 的 .grid-card 一节；
   这里只留文件卡自己的类型着色与字档 */

/* 类型档：尺寸/圆角/中性底走 global.css .grid-slot（卡内收 24px），目录档共用 .grid-slot--folder，
   这里只叠扩展名类型色。选择器带 .grid-card 一层以压过 .grid-slot 的中性底。
   四字母扩展名（docx/xlsx）在 11px 要 25–27px，24px 方档装不下会被 overflow 裁字，
   所以档面横向让字撑开、竖向仍守 24px。 */
.grid-card .ft-ico {
  width: auto;
  min-width: 24px;
  padding: 0 3px;
  font-size: var(--text-2xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: -0.02em;
}
/* 扩展名色底：底是同色淡水洗（13% 掺卡面），字在色相上掺 35% 墨压深一档——
   纯色字压同色淡底只有 3.5–4.1:1，掺墨后回到 4.5 以上，色相仍一眼可辨。 */
.grid-card .ft-ico.toned {
  color: color-mix(in srgb, var(--ftc) 65%, var(--text));
  background: color-mix(in srgb, var(--ftc) 13%, var(--bg-surface));
}

/* 名字：14px，字重跟随卡片角色；类型由左侧图标表达。 */
.row-name { flex: 1 1 auto; min-width: 0; font-size: var(--text-base); font-weight: var(--weight-card-title); letter-spacing: -0.01em; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 路径：等宽 12px 灰字，缩进由 global .row2 给，尾部优先截断（保文件名，盘符与上层目录是噪音） */
.path-chip {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.35;
  color: var(--text-url);
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color var(--transition);
}
.shortcut-row:hover .path-chip { color: var(--text-secondary); }

/* 复制回执态：对勾 + 成功色，1.2s 后转回 */
.row-acts .ib.copied { color: var(--success); }

/* 骨架行的宽度分配（皮与呼吸在 global.css） */
.skeleton-line.name { width: 118px; }
.skeleton-line.foot { width: 156px; }


/* ---------- 添加/编辑弹窗：与收藏表单弹窗同一套骨架 ----------
   520px 壳、居中悬浮（遮罩走全局居中基线，只把磨砂提到 6px 与首页同档）、44px 头（无底描边）、
   46px 透明底栏 + 一道顶线 + 28px 钮，壳/头/底全走 global.css 的 .dialog-* */
.form-overlay {
  background: var(--overlay);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.shortcut-dialog {
  width: 520px;
  max-height: 91vh;
}
.shortcut-dialog .dialog-body { overflow: hidden; }
.shortcut-dialog .dialog-footer { justify-content: space-between; }

/* 字段轴：标签 12px/行高 14px 下距 6px，组距 12px（钉住全局 18px 行高防撑高） */
.shortcut-dialog label { font-size: var(--text-xs); line-height: 14px; margin-bottom: 6px; }
.shortcut-dialog .form-group { margin-bottom: 12px; }
.shortcut-dialog .form-group:last-child { margin-bottom: 0; }
.req { color: var(--danger); font-style: normal; }

/* 底栏快捷键徽标走 global.css 的 .footer-hints / .kbd，本页不再 scoped 一份 */
.footer-actions { display: flex; align-items: center; gap: 8px; }

/* 输入组：外框归容器（底色/描边与全局 .form-group input 同皮肤），
   :focus-within 点亮 accent；路径文本等宽、13px 与收藏弹窗字段档一致 */
.path-input-row {
  display: flex;
  align-items: stretch;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  overflow: hidden;
  transition: border-color var(--transition), box-shadow var(--transition);
}
.path-input-row:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); background: var(--bg-surface); }
.path-input-row input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  padding: 0 10px;
  /* 路径框走 UI 字体（继承全局 .form-group input）：Windows 路径常混中文，
     Consolas 拉丁 + HarmonyOS 汉字混排时字重字面打架 */
  font-size: var(--text-sm);
  color: var(--text);
  box-shadow: none; /* 高亮环归容器（:focus-within），别在输入框本体上再画一圈 */
}
.path-input-row input:focus { background: transparent; border: none; box-shadow: none; }
.path-acts { display: flex; flex-shrink: 0; border-left: 1px solid var(--border); }
.path-act {
  width: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition);
}
.path-act + .path-act { border-left: 1px solid var(--border); }
.path-act:hover { color: var(--accent); background: var(--accent-soft); }

/* 类型段控件走 global.css 的 .dialog .seg：凹槽+滑块那一套是第四种「哪个是选中的」读法 */

</style>
