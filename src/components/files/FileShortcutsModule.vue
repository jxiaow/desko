<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
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
  /** 上一次加载的失败原因；非空时显示「加载失败 · 重试」而不是空态 */
  loadError?: string | null
  filteredShortcuts: FileShortcut[]
  totalShortcuts: number
}>()

const toastStore = useToastStore()
const confirmStore = useConfirmStore()

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
    await navigator.clipboard.writeText(shortcut.path)
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

/* ── Ctrl/Cmd+K 聚焦搜索：与收藏/小记页同一条快捷键，只在本页挂载期间监听 ── */
const searchRef = ref<HTMLInputElement | null>(null)
const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const kbdHint = computed(() => (isMac ? '⌘K' : 'Ctrl K'))

const onGlobalKey = (e: KeyboardEvent) => {
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
</script>

<template>
  <div class="content-inner">
    <div class="page-bar">
      <div class="search-box">
        <span class="search-icon"><AppIcon name="search" :size="15" /></span>
        <input ref="searchRef" :value="searchKeyword" placeholder="搜索快捷方式…" @input="emit('update:searchKeyword', ($event.target as HTMLInputElement).value)" />
        <kbd v-if="!searchKeyword" class="search-kbd">{{ kbdHint }}</kbd>
        <button v-if="searchKeyword" class="search-clear" @click="emit('update:searchKeyword', '')" title="清除搜索">
          <AppIcon name="x" :size="13" />
        </button>
      </div>
      <button class="btn-primary" @click="showAddDialog = true">
        <AppIcon name="plus" :size="14" />
        新增条目
      </button>
    </div>

    <div v-if="loading" class="loading-list">
      <div class="skeleton-row" v-for="n in 6" :key="n">
        <span class="skeleton-block"></span>
        <span class="skeleton-line w40"></span>
        <span class="skeleton-line w24"></span>
      </div>
    </div>

    <div v-else-if="filteredShortcuts.length > 0" class="shortcut-list">
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
        <!-- 第一段：图标 + 名称/路径两行，靠左聚拢吃掉中间空白（大方化轮） -->
        <div class="cell-name">
          <span v-if="shortcut.shortcut_type === 'folder'" class="ft-ico folder" aria-hidden="true">
            <AppIcon name="folder" :size="18" />
          </span>
          <span v-else class="ft-ico toned" :style="{ '--ftc': extVar(getFileExt(shortcut.path)) }">{{ getFileExt(shortcut.path) || 'FILE' }}</span>
          <div class="fs-text">
            <span class="row-name" :title="shortcut.name">{{ shortcut.name }}</span>
            <span class="cell-path"><span class="path-chip" :title="shortcut.path">{{ pathTail(shortcut.path) }}</span></span>
          </div>
        </div>

        <!-- 第二段：类型胶囊 + 添加时间 -->
        <div class="fs-tags">
          <span class="cell-type">{{ typeLabel(shortcut) }}</span>
          <span class="cell-time">{{ formatRelativeTime(shortcut.created_at) }}</span>
        </div>

        <!-- 动作栏常驻占位，行点亮才淡入 -->
        <div class="row-acts">
          <button class="ib" type="button" title="打开所在目录" @click.stop="openContainingFolder(shortcut)">
            <AppIcon name="folder" :size="14" />
          </button>
          <button class="ib" type="button" title="在终端中打开" @click.stop="openInTerminal(shortcut)">
            <AppIcon name="terminal" :size="14" />
          </button>
          <button class="ib" :class="{ copied: copiedId === shortcut.id }" type="button" :title="copiedId === shortcut.id ? '已复制' : '复制地址'" @click.stop="copyPathToClipboard(shortcut)">
            <AppIcon :name="copiedId === shortcut.id ? 'check' : 'copy'" :size="14" />
          </button>
          <button class="ib" type="button" title="编辑" @click.stop="openEdit(shortcut)">
            <AppIcon name="edit" :size="14" />
          </button>
        </div>
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
        <AppIcon :name="searchKeyword ? 'searchEmpty' : 'folder'" :size="24" />
      </div>
      <div class="empty-title">{{ searchKeyword ? '未找到匹配结果' : '暂无快捷方式' }}</div>
      <div class="empty-desc">{{ searchKeyword ? '试试其他关键词' : '点击「新增条目」开始' }}</div>
    </div>

    <!-- Add/Edit Dialog -->
    <Transition name="dialog">
      <div v-if="showAddDialog" class="dialog-overlay">
        <div class="dialog shortcut-dialog">
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
                <span class="path-acts">
                  <button class="path-act" type="button" title="从剪贴板粘贴" @click="pastePath">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
                  </button>
                  <button  class="path-act" @click="pickFile" title="选择文件">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  </button>
                  <button  class="path-act" @click="pickFolder" title="选择文件夹">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
                  </button>
                </span>
              </div>
            </div>
            <div class="form-group">
              <label>名称</label>
              <input v-model="addForm.name" placeholder="快捷方式名称" />
            </div>
            <div class="form-group">
              <label>类型</label>
              <div class="type-seg">
                <span class="seg-thumb" :class="{ right: addForm.type === 'folder' }" aria-hidden="true"></span>
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
/* .content-inner / .page-bar / 搜索框 / 主按钮 / 骨架行形全部走 global.css 的页面骨架；
   本页没有分类标签，动作钮顶到右缘 */
.page-bar .btn-primary { margin-left: auto; }

/* 与收藏页同款单列行卡流：行间 10px，灰底浮白卡靠阴影分层 */
.shortcut-list { display: flex; flex-direction: column; gap: var(--space-3); padding-top: var(--space-2); }

.shortcut-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: 64px;
  padding: 0 var(--space-4);
  background: var(--bg-surface);
  border: 1px solid transparent;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  cursor: pointer;
  position: relative;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}
.shortcut-row:hover {
  border-color: var(--border-card-hover);
  box-shadow: var(--shadow-card-hover);
}
.shortcut-row:focus-visible { border-color: var(--border-focus); box-shadow: 0 0 0 3px var(--accent-ring); }

/* 主列靠左聚拢：图标 + 名/路径两行，flex:1 吃掉中间空白 */
.cell-name { display: flex; align-items: center; gap: 14px; flex: 1 1 auto; min-width: 0; }
.fs-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.ft-ico {
  width: 36px;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: var(--radius-badge);
  background: var(--fill);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: var(--text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: -0.02em;
}
.ft-ico.folder { background: var(--warning-soft); color: var(--warning); }
/* 扩展名色底：字色取 --ft-* 槽，底/描边是同色的淡水洗——类型一眼可辨，又不炸成彩色贴纸 */
.ft-ico.toned {
  color: var(--ftc);
  background: color-mix(in srgb, var(--ftc) 10%, var(--panel-bg));
  border-color: color-mix(in srgb, var(--ftc) 25%, var(--panel-bg));
}
.row-name { font-size: var(--text-md); font-weight: 600; color: var(--text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 路径进 meta 行：等宽小字，与收藏页 URL 同档 */
.cell-path {
  min-width: 0;
  display: flex;
  align-items: center;
}
.path-chip {
  display: inline-block;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-url);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color var(--transition);
}
.shortcut-row:hover .path-chip { color: var(--text-secondary); }

.fs-tags { flex: 0 0 auto; display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); min-width: 0; }
/* 与收藏页 .ec-cat 同款胶囊：同一档圆角（tag）与内距 */
.cell-type {
  display: inline-flex;
  align-items: center;
  height: 24px;
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--badge-cat-text);
  background: var(--badge-cat-bg);
  border: 1px solid var(--badge-cat-border);
  padding: 0 10px;
  border-radius: var(--radius-tag);
  flex-shrink: 0;
  white-space: nowrap;
}
.cell-time { font-size: var(--text-xs); color: var(--text-muted); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 四枚 30px 动作钮：定宽占位、平时五成透明常驻，行点亮升到全不透明；删除收进右键菜单 */
.row-acts {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  flex: 0 0 132px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.row-acts .ib { width: 30px; height: 30px; }
/* 复制回执态：对勾 + 成功色，1.2s 后转回 */
.row-acts .ib.copied { color: var(--success); }
.shortcut-row:hover .row-acts, .shortcut-row:focus-within .row-acts { opacity: 1; }

/* 骨架行形/方块/呼吸走 global.css，此处只留宽度分配 */
.loading-list { display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-2); }
.skeleton-line.w40 { width: 40%; }
.skeleton-line.w24 { width: 24%; margin-left: auto; }

/* Add dialog：440px 紧凑壳；底栏浅底色 + 28px 按钮档走 global.css .dialog-footer */
.shortcut-dialog { width: 440px; }

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
.path-input-row:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); background: var(--panel-bg); }
.path-input-row input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  padding: 0 10px;
  font-family: var(--font-mono);
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

/* 分段控制器：凹槽轨道 + 浮白滑块（与页面 .tab / 侧栏同一套浮卡语言，无边框靠阴影） */
.type-seg {
  position: relative;
  display: flex;
  padding: 3px;
  background: var(--sunken);
  border-radius: var(--radius);
}
.seg-thumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc(50% - 3px);
  background: var(--bg-surface);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-xs);
  transition: transform var(--transition);
}
.seg-thumb.right { transform: translateX(100%); }
.type-btn {
  position: relative;
  z-index: 1;
  flex: 1;
  padding: 6px 0;
  font-size: var(--text-sm);
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--transition);
  font-family: inherit;
}
.type-btn.active { color: var(--text); font-weight: 600; }
.type-btn:hover:not(.active) { color: var(--text-secondary); }

</style>
