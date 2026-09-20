<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { fileShortcutsApi as api } from '../../services/api/fileShortcuts'
import type { FileShortcut } from '../../types'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'
import { formatRelativeTime } from '../../utils/format'

defineProps<{
  searchKeyword: string
  loading: boolean
  filteredShortcuts: FileShortcut[]
}>()

const toastStore = useToastStore()
const confirmStore = useConfirmStore()

const emit = defineEmits<{
  'update:searchKeyword': [value: string]
  addShortcut: [name: string, path: string, type: 'file' | 'folder']
  updateShortcut: [id: string, name: string, path: string, type: 'file' | 'folder']
  removeShortcut: [id: string]
}>()

const showAddDialog = ref(false)
const editingId = ref<string | null>(null)
const addForm = ref({ name: '', path: '', type: 'file' as 'file' | 'folder' })

const contextMenu = ref({ show: false, x: 0, y: 0, shortcut: null as FileShortcut | null })

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
    await api.openFile(shortcut.path)
  } catch {
    toastStore.showToast('无法打开，文件可能不存在', 'error')
  }
}

const onContextMenu = (event: MouseEvent, shortcut: FileShortcut) => {
  event.preventDefault()
  contextMenu.value = { show: true, x: event.clientX, y: event.clientY, shortcut }
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
  confirmStore.showConfirm('确认删除', `确定删除「${shortcut.name}」快捷方式？`, () => {
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
  } catch {
    toastStore.showToast('无法打开终端', 'error')
  }
}

const copyPathToClipboard = async (shortcut: FileShortcut) => {
  try {
    await navigator.clipboard.writeText(shortcut.path)
    toastStore.showToast('地址已复制')
  } catch {
    toastStore.showToast('复制失败', 'error')
  }
}

const getFileExt = (path: string) => {
  const parts = path.split('.')
  return parts.length > 1 ? parts.pop()!.toLowerCase() : ''
}

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

/** 行列表的「类型」列说人话：色块已经给了具体扩展名，这里只给归类 */
const SLOT_LABEL: Record<string, string> = {
  pdf: '文档', doc: '文档', sheet: '表格', deck: '演示', arch: '归档',
  code: '代码', mark: '文本', img: '图片', unk: '文件',
}
const typeLabel = (s: FileShortcut) =>
  s.shortcut_type === 'folder' ? '文件夹' : (SLOT_LABEL[EXT_SLOT[getFileExt(s.path)] || 'unk'] ?? '文件')

/** 路径只保留尾部：行宽有限，盘符和上层目录是噪音，完整路径在 title 里 */
const pathTail = (path: string) => {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 2) return parts.join('/')
  return `…/${parts.slice(-2).join('/')}`
}

onMounted(() => {
  document.addEventListener('click', closeContextMenu)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeContextMenu)
})
</script>

<template>
  <div class="content-inner">
    <div class="page-bar">
      <div class="search-box">
        <span class="search-icon"><AppIcon name="search" :size="15" /></span>
        <input :value="searchKeyword" placeholder="搜索快捷方式…" @input="emit('update:searchKeyword', ($event.target as HTMLInputElement).value)" />
        <button v-if="searchKeyword" class="search-clear" @click="emit('update:searchKeyword', '')" title="清除搜索">
          <AppIcon name="x" :size="13" />
        </button>
      </div>
      <span class="bar-count">{{ filteredShortcuts.length }} 项</span>
      <button class="btn-primary" @click="showAddDialog = true">
        <AppIcon name="plus" :size="14" />
        添加快捷方式
      </button>
    </div>

    <div v-if="loading" class="loading-list">
      <div class="skeleton-row" v-for="n in 6" :key="n">
        <span class="skeleton-icon"></span>
        <span class="skeleton-line w40"></span>
        <span class="skeleton-line w24"></span>
      </div>
    </div>

    <div v-else-if="filteredShortcuts.length > 0" class="shortcut-list">
      <div class="list-head">
        <span>名称</span>
        <span>类型</span>
        <span>路径</span>
        <span>添加时间</span>
      </div>
      <div
        v-for="shortcut in filteredShortcuts"
        :key="shortcut.id"
        class="shortcut-row"
        role="button"
        tabindex="0"
        :aria-label="`打开 ${shortcut.name}`"
        @click="openShortcut(shortcut)"
        @keydown.enter.prevent="openShortcut(shortcut)"
        @contextmenu="onContextMenu($event, shortcut)"
      >
        <div class="cell-name">
          <span v-if="shortcut.shortcut_type === 'folder'" class="ft-ico folder" aria-hidden="true">
            <AppIcon name="folder" :size="14" />
          </span>
          <span v-else class="ft-ico" :style="{ color: extVar(getFileExt(shortcut.path)) }">{{ getFileExt(shortcut.path) || 'FILE' }}</span>
          <span class="row-name" :title="shortcut.name">{{ shortcut.name }}</span>
        </div>
        <span class="cell-type">{{ typeLabel(shortcut) }}</span>
        <span class="cell-path" :title="shortcut.path">{{ pathTail(shortcut.path) }}</span>
        <span class="cell-time">{{ formatRelativeTime(shortcut.created_at) }}</span>
        <div class="row-acts">
          <button class="ib" type="button" title="打开所在目录" @click.stop="openContainingFolder(shortcut)">
            <AppIcon name="folder" :size="13" />
          </button>
          <button class="ib" type="button" title="在终端中打开" @click.stop="openInTerminal(shortcut)">
            <AppIcon name="terminal" :size="13" />
          </button>
          <button class="ib" type="button" title="复制地址" @click.stop="copyPathToClipboard(shortcut)">
            <AppIcon name="copy" :size="13" />
          </button>
          <button class="ib" type="button" title="编辑" @click.stop="openEdit(shortcut)">
            <AppIcon name="edit" :size="13" />
          </button>
          <button class="ib danger" type="button" title="删除" @click.stop="confirmDelete(shortcut)">
            <AppIcon name="trash" :size="13" />
          </button>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon">
        <AppIcon :name="searchKeyword ? 'searchEmpty' : 'folder'" :size="24" />
      </div>
      <div class="empty-title">{{ searchKeyword ? '未找到匹配结果' : '暂无快捷方式' }}</div>
      <div class="empty-desc">{{ searchKeyword ? '试试其他关键词' : '点击「添加快捷方式」开始' }}</div>
    </div>

    <!-- Add/Edit Dialog -->
    <Transition name="dialog">
      <div v-if="showAddDialog" class="dialog-overlay">
        <div class="dialog">
          <div class="dialog-header">
            <div class="dialog-header-left">
              <h3>{{ isEditing() ? '编辑快捷方式' : '添加快捷方式' }}</h3>
            </div>
            <button  class="dialog-close" @click="cancelAdd" title="关闭">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="dialog-body">
            <div class="form-group">
              <label>路径</label>
              <div class="path-input-row">
                <input v-model="addForm.path" placeholder="粘贴文件/文件夹路径，或点击右侧浏览" @blur="onPathInput" />
                <div class="path-browse-btns">
                  <button  class="browse-btn" @click="pickFile" title="选择文件">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  </button>
                  <button  class="browse-btn" @click="pickFolder" title="选择文件夹">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
                  </button>
                </div>
              </div>
            </div>
            <div class="form-group">
              <label>名称</label>
              <input v-model="addForm.name" placeholder="快捷方式名称" />
            </div>
            <div class="form-group">
              <label>类型</label>
              <div class="type-toggle">
                <button class="type-btn" :class="{ active: addForm.type === 'file' }" @click="addForm.type = 'file'">文件</button>
                <button class="type-btn" :class="{ active: addForm.type === 'folder' }" @click="addForm.type = 'folder'">文件夹</button>
              </div>
            </div>
          </div>
          <div class="dialog-footer">
            <button class="btn-secondary" @click="cancelAdd">取 消</button>
            <button class="btn-primary" @click="doAdd">{{ isEditing() ? '保 存' : '添 加' }}</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Context Menu -->
    <div v-if="contextMenu.show" class="popover" :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }">
      <div class="pop-item" @click="editFromMenu">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        编辑
      </div>
      <div class="pop-item" @click="runOnMenu(openContainingFolder)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
        打开所在目录
      </div>
      <div class="pop-item" @click="runOnMenu(openInTerminal)">
        <AppIcon name="terminal" :size="14" />
        在终端中打开
      </div>
      <div class="pop-item" @click="runOnMenu(copyPathToClipboard)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        复制地址
      </div>
      <div class="pop-item danger" @click="deleteFromMenu">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        删除
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 顶部不留内边距：滚动容器带 padding-top 时 sticky 的 top:0 会贴在它下面，露出一条能看见内容的缝 */
.content-inner { flex: 1; overflow-y: auto; padding: 0 var(--space-5) 96px; }

/* 与小记页同一条工具条 */
.page-bar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bg);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: calc(var(--space-5) + var(--space-1)) 0 var(--space-3);
}
.page-bar .search-box { flex: 1; min-width: 80px; max-width: 440px; }

/* 高密度行列表：一屏能看十几条，比原来的卡片网格密一倍 */
.shortcut-list { border-top: 1px solid var(--border-subtle); }
.list-head,
.shortcut-row {
  display: grid;
  /* 最后一列给行内动作常驻留位，hover 时才切换显示，行内容不会左右跳动 */
  grid-template-columns: minmax(200px, 1.5fr) 78px minmax(150px, 1fr) 96px 124px;
  gap: var(--space-3);
  align-items: center;
}
.list-head {
  padding: var(--space-2) var(--space-3);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.shortcut-row {
  position: relative;
  padding: 7px var(--space-3);
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--transition), box-shadow var(--transition);
}
.shortcut-row:hover { background: var(--panel-bg); box-shadow: inset 0 0 0 1px var(--border); }
.shortcut-row:focus-visible { background: var(--panel-bg); box-shadow: inset 0 0 0 2px var(--accent-ring); }

.cell-name { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.ft-ico {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--fill);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: -0.02em;
}
.ft-ico.folder { background: var(--warning-soft); color: var(--warning); }
.row-name { font-size: 13px; font-weight: 500; color: var(--text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cell-type,
.cell-path,
.cell-time { font-size: 11.5px; color: var(--text-muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cell-path { font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace; }
.cell-time { font-variant-numeric: tabular-nums; }

.row-acts { display: flex; gap: 1px; justify-content: flex-end; opacity: 0; pointer-events: none; transition: opacity var(--transition); }
.shortcut-row:hover .row-acts, .shortcut-row:focus-within .row-acts { opacity: 1; pointer-events: auto; }
html.hover-suppressed .shortcut-row:hover .row-acts { opacity: 0; pointer-events: none; }

/* Loading skeleton */
.loading-list { display: flex; flex-direction: column; gap: var(--space-1); }
.skeleton-row { display: flex; align-items: center; gap: var(--space-3); padding: 9px var(--space-3); }
.skeleton-icon { width: 26px; height: 26px; border-radius: 7px; background: var(--hover); flex-shrink: 0; }
.skeleton-line { height: 10px; border-radius: 4px; background: var(--hover); }
.skeleton-line.w40 { width: 40%; }
.skeleton-line.w24 { width: 24%; margin-left: auto; }

/* Add dialog（输入框本体用 global.css 的 .form-group） */
.path-input-row { display: flex; gap: var(--space-1); align-items: stretch; }
.path-input-row input { flex: 1; font-size: 13px; }
.path-browse-btns { display: flex; gap: var(--space-1); }
.browse-btn { width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--panel-bg); cursor: pointer; color: var(--text-muted); transition: all var(--transition); flex-shrink: 0; }
.browse-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }

.type-toggle { display: flex; gap: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.type-btn { flex: 1; padding: 7px 13px; font-size: 13px; font-weight: 500; border: none; background: var(--panel-bg); color: var(--text-muted); cursor: pointer; transition: all var(--transition); font-family: inherit; }
.type-btn:not(:last-child) { border-right: 1px solid var(--border); }
.type-btn.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.type-btn:hover:not(.active) { background: var(--hover); color: var(--text-secondary); }

</style>
