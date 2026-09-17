<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { fileShortcutsApi as api } from '../../services/api/fileShortcuts'
import type { FileShortcut } from '../../types'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'

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

const deleteFromMenu = () => {
  if (contextMenu.value.shortcut) {
    const s = contextMenu.value.shortcut
    confirmStore.showConfirm('确认删除', `确定删除「${s.name}」快捷方式？`, () => {
      emit('removeShortcut', s.id)
      toastStore.showToast('已删除')
    })
  }
  closeContextMenu()
}

const openContainingFolder = async () => {
  if (contextMenu.value.shortcut) {
    const path = contextMenu.value.shortcut.path.replace(/\\/g, '/')
    const folder = path.substring(0, path.lastIndexOf('/'))
    if (folder) {
      try {
        await api.openFile(folder)
      } catch {
        toastStore.showToast('无法打开所在目录', 'error')
      }
    }
  }
  closeContextMenu()
}

const getFileExt = (path: string) => {
  const parts = path.split('.')
  return parts.length > 1 ? parts.pop()!.toLowerCase() : ''
}

const getExtColor = (ext: string) => {
  const colors: Record<string, string> = {
    pdf: '#dc2626', doc: '#2563eb', docx: '#2563eb',
    xls: '#16a34a', xlsx: '#16a34a', ppt: '#ea580c', pptx: '#ea580c',
    zip: '#7c3aed', rar: '#7c3aed', '7z': '#7c3aed',
    js: '#ca8a04', ts: '#2563eb', py: '#16a34a', rs: '#ea580c',
    md: '#64748b', txt: '#64748b', json: '#ca8a04',
    png: '#db2777', jpg: '#db2777', jpeg: '#db2777', svg: '#db2777', gif: '#db2777',
  }
  return colors[ext] || '#94a3b8'
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
    <div class="toolbar">
      <div class="search-box">
        <span class="search-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </span>
        <input :value="searchKeyword" @input="emit('update:searchKeyword', ($event.target as HTMLInputElement).value)" placeholder="搜索快捷方式..." />
        <button v-if="searchKeyword" class="search-clear" @click="emit('update:searchKeyword', '')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="toolbar-actions">
        <button class="btn-primary" @click="showAddDialog = true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          添加快捷方式
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading-grid">
      <div class="skeleton-card" v-for="n in 6" :key="n">
        <div class="skeleton-icon"></div>
        <div class="skeleton-line w60"></div>
        <div class="skeleton-line w80"></div>
      </div>
    </div>

    <div v-else-if="filteredShortcuts.length > 0" class="shortcuts-grid">
      <div v-for="shortcut in filteredShortcuts" :key="shortcut.id"
           class="shortcut-card"
           @click="openShortcut(shortcut)"
           @contextmenu="onContextMenu($event, shortcut)">
        <div class="shortcut-icon" :class="shortcut.shortcut_type">
          <svg v-if="shortcut.shortcut_type === 'folder'" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
          <span v-else class="file-ext" :style="{ color: getExtColor(getFileExt(shortcut.path)) }">{{ getFileExt(shortcut.path) || 'FILE' }}</span>
        </div>
        <div class="shortcut-info">
          <div class="shortcut-name">{{ shortcut.name }}</div>
          <div class="shortcut-path" :title="shortcut.path">{{ shortcut.path }}</div>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon">
        <svg v-if="searchKeyword" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <svg v-else width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div class="empty-title">{{ searchKeyword ? '未找到匹配结果' : '暂无快捷方式' }}</div>
      <div class="empty-desc">{{ searchKeyword ? '试试其他关键词' : '点击「添加快捷方式」开始' }}</div>
    </div>

    <!-- Add/Edit Dialog -->
    <Transition name="dialog">
      <div v-if="showAddDialog" class="dialog-overlay" @click.self="cancelAdd">
        <div class="dialog">
          <div class="dialog-header">
            <div class="dialog-header-left">
              <h3>{{ isEditing() ? '编辑快捷方式' : '添加快捷方式' }}</h3>
            </div>
            <button class="dialog-close" @click="cancelAdd">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="dialog-body">
            <div class="form-group">
              <label>路径</label>
              <div class="path-input-row">
                <input v-model="addForm.path" placeholder="粘贴文件/文件夹路径，或点击右侧浏览" @blur="onPathInput" />
                <div class="path-browse-btns">
                  <button class="browse-btn" @click="pickFile" title="选择文件">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  </button>
                  <button class="browse-btn" @click="pickFolder" title="选择文件夹">
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
    <div v-if="contextMenu.show" class="context-menu" :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }">
      <div class="context-menu-item" @click="editFromMenu">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        编辑
      </div>
      <div class="context-menu-item" @click="openContainingFolder">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
        打开所在目录
      </div>
      <div class="context-menu-item danger" @click="deleteFromMenu">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        删除
      </div>
    </div>
  </div>
</template>

<style scoped>
.content-inner { flex: 1; overflow-y: auto; padding: 20px; }

.toolbar { display: flex; gap: 8px; margin-bottom: 14px; align-items: center; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
.toolbar-actions { display: flex; gap: 8px; margin-left: auto; flex-shrink: 0; }

.search-box {
  flex: 1; max-width: 440px; min-width: 160px; display: flex; align-items: center; gap: 6px;
  background: var(--panel-bg); border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 0 10px; height: 34px; transition: all 0.15s;
}
.search-box:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
.search-box input { flex: 1; border: none; background: none; padding: 0; font-size: 12px; outline: none; font-family: inherit; color: var(--text); height: 100%; }
.search-box input::placeholder { color: var(--text-muted); }

.shortcuts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}

.shortcut-card {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; background: var(--panel-bg);
  border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; transition: all 0.12s;
}
.shortcut-card:hover { border-color: var(--border-strong); box-shadow: var(--shadow-sm); }
.shortcut-card:active { transform: scale(0.98); }

.shortcut-icon {
  width: 40px; height: 40px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.shortcut-icon.folder { background: #fff7ed; color: #ea580c; }
.shortcut-icon.file { background: var(--hover); }

.file-ext {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em;
}

.shortcut-info { flex: 1; min-width: 0; }
.shortcut-name { font-size: 14px; font-weight: 600; color: var(--text); margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shortcut-path { font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Loading skeleton */
.loading-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.skeleton-card { padding: 14px 16px; background: var(--panel-bg); border: 1px solid var(--border); border-radius: var(--radius); display: flex; flex-direction: column; gap: 8px; }
.skeleton-icon { width: 40px; height: 40px; border-radius: 10px; background: var(--hover); }
.skeleton-line { height: 10px; border-radius: 4px; background: var(--hover); }
.skeleton-line.w60 { width: 60%; }
.skeleton-line.w80 { width: 80%; }

/* Add dialog */
.form-group { margin-bottom: 12px; }
.form-group label { display: block; font-size: 13px; font-weight: 500; color: var(--text-secondary); margin-bottom: 5px; }
.form-group input { width: 100%; padding: 8px 11px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 14px; outline: none; transition: all 0.15s; font-family: inherit; background: var(--bg); }
.form-group input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); background: #fff; }

.path-input-row { display: flex; gap: 6px; align-items: stretch; }
.path-input-row input { flex: 1; font-size: 13px; }
.path-browse-btns { display: flex; gap: 4px; }
.browse-btn { width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--panel-bg); cursor: pointer; color: var(--text-muted); transition: all 0.12s; flex-shrink: 0; }
.browse-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }

.type-toggle { display: flex; gap: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.type-btn { flex: 1; padding: 7px 13px; font-size: 13px; font-weight: 500; border: none; background: var(--panel-bg); color: var(--text-muted); cursor: pointer; transition: all 0.12s; font-family: inherit; }
.type-btn:not(:last-child) { border-right: 1px solid var(--border); }
.type-btn.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.type-btn:hover:not(.active) { background: var(--hover); color: var(--text-secondary); }

/* Context menu */
.context-menu {
  position: fixed; background: var(--panel-bg); border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm); box-shadow: var(--shadow-pop);
  padding: 4px; min-width: 160px; z-index: 1000;
}
.context-menu-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; font-size: 12px; color: var(--text);
  cursor: pointer; border-radius: 4px; transition: background 0.1s;
}
.context-menu-item:hover { background: var(--hover); }
.context-menu-item.danger { color: var(--danger); }
.context-menu-item.danger:hover { background: var(--danger-soft); }
</style>
