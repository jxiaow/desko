<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { fileShortcutsApi as api } from '../../services/api/fileShortcuts'
import type { FileShortcut } from '../../types'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'
import { useEscapeClose } from '../../composables/useEscapeClose'
import { useGridKeys } from '../../composables/useGridKeys'
import AppIcon from '../shared/AppIcon.vue'
import PopoverMenu from '../shared/PopoverMenu.vue'

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
    await api.openFile(shortcut.path)
  } catch {
    toastStore.showToast('无法打开，文件可能不存在', 'error')
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

/* 二维游走 + C 复制路径：列数按网格实测，Enter/Space 的开启动作留在卡片自身 */
const { onGridKeydown } = useGridKeys({
  cardSelector: '.shortcut-row',
  onCopy: (id) => {
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
  /* Ctrl/Cmd+Enter：弹窗开着即为保存，优先于其它键位 */
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (showAddDialog.value) {
      e.preventDefault()
      doAdd()
    }
    return
  }
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
        添加快捷方式
      </button>
    </div>

    <div v-if="loading" class="card-grid">
      <div class="skeleton-card" v-for="n in 6" :key="n">
        <div class="sc-top">
          <span class="skeleton-slot"></span>
          <div class="sc-id">
            <div class="skeleton-line name"></div>
            <div class="skeleton-line note"></div>
          </div>
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
        :aria-label="`打开 ${shortcut.name}`"
        @click="openShortcut(shortcut)"
        @keydown.enter.prevent="openShortcut(shortcut)"
        @keydown.space.prevent="openShortcut(shortcut)"
        @contextmenu="onContextMenu($event, shortcut)"
      >
        <!-- 头部：34px 类型档 + 名称/路径两行；动作列钉卡右上角，hover 显形 -->
        <div class="sc-top">
          <span v-if="shortcut.shortcut_type === 'folder'" class="ft-ico grid-slot grid-slot--folder" aria-hidden="true">
            <AppIcon name="folder" :size="18" />
          </span>
          <span v-else class="ft-ico toned grid-slot" :style="{ '--ftc': extVar(getFileExt(shortcut.path)) }">{{ getFileExt(shortcut.path) || 'FILE' }}</span>
          <div class="sc-id">
            <span class="row-name" :title="shortcut.name">{{ shortcut.name }}</span>
            <span class="cell-path"><span class="path-chip" :title="shortcut.path">{{ pathTail(shortcut.path) }}</span></span>
          </div>
        </div>
        <div class="row-acts grid-acts sc-acts">
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

        <PopoverMenu v-if="moreMenu.shortcut?.id === shortcut.id" :anchor="moreMenu.anchor" :width="136" @close="closeMoreMenu">
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
        <AppIcon :name="searchKeyword ? 'searchEmpty' : 'folder'" :size="24" />
      </div>
      <div class="empty-title">{{ searchKeyword ? '未找到匹配结果' : '暂无快捷方式' }}</div>
      <div class="empty-desc">{{ searchKeyword ? '试试其他关键词' : '点击「添加快捷方式」开始' }}</div>
    </div>

    <!-- Add/Edit Dialog：与收藏表单弹窗同一套骨架（居中悬浮 + 42px 头 + 32px 字段轴 + 46px 底栏带快捷键徽标） -->
    <Transition name="dialog">
      <div v-if="showAddDialog" class="dialog-overlay form-overlay">
        <div class="dialog shortcut-dialog" role="dialog" aria-modal="true" :aria-label="isEditing() ? '编辑快捷方式' : '添加快捷方式'">
          <div class="dialog-header">
            <div class="dialog-header-left">
              <h3>{{ isEditing() ? '编辑快捷方式' : '添加快捷方式' }}</h3>
            </div>
            <button class="dialog-close" type="button" title="关闭" @click="cancelAdd">
              <AppIcon name="x" :size="18" />
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
              <div class="type-seg">
                <span class="seg-thumb" :class="{ right: addForm.type === 'folder' }" aria-hidden="true"></span>
                <button class="type-btn" :class="{ active: addForm.type === 'file' }" @click="addForm.type = 'file'">文件</button>
                <button class="type-btn" :class="{ active: addForm.type === 'folder' }" @click="addForm.type = 'folder'">文件夹</button>
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
    <div v-if="contextMenu.show" ref="ctxPanel" class="popover" :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }">
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
  </div>

</template>

<style scoped>
/* .content-inner / .page-bar / 搜索框 / 主按钮 / 骨架行形全部走 global.css 的页面骨架；
   本页没有分类标签，动作钮顶到右缘 */
.page-bar .btn-primary { margin-left: auto; }

/* 卡皮、抬影、焦点环与动作显形都在 global.css 的 .grid-card 一节；
   这里只留文件卡自己的排版与类型着色 */

/* 头部：34px 类型档 + 名称/路径两行；只有名字行给动作列让位，路径行保整幅 */
.sc-top { display: flex; align-items: flex-start; gap: 11px; min-width: 0; }
.sc-id { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 5px; }

/* 动作列：钉卡右上角、与名字行居中（15 内距 + (18−24)/2），不压路径行；hover 显形走 global.css */
.sc-acts { position: absolute; top: 12px; right: 15px; }

/* 档面的尺寸/圆角/中性底色走 global.css .grid-slot，目录档与局域网共享目录共用
   .grid-slot--folder，这里只叠扩展名类型色。
   选择器带 .grid-card 一层是为了压过 .grid-slot 的中性底（同名权重看先后，不赌构建顺序）。 */
.grid-card .ft-ico {
  font-size: var(--text-2xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: -0.02em;
}
/* 扩展名色底：字色取 --ft-* 槽，底是同色的淡水洗——类型一眼可辨，又不炸成彩色贴纸 */
.grid-card .ft-ico.toned {
  color: color-mix(in srgb, var(--ftc) 55%, var(--text));
  background: color-mix(in srgb, var(--ftc) 10%, var(--panel-bg));
}

.row-name { font-size: var(--text-sm); font-weight: 600; color: var(--text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 84px; }

/* 路径：等宽 12px 灰字，尾部优先截断（保文件名，盘符与上层目录是噪音） */
.cell-path { min-width: 0; display: flex; align-items: center; }
.path-chip {
  display: inline-block;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.35;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color var(--transition);
}
.shortcut-row:hover .path-chip { color: var(--text-secondary); }

/* 复制回执态：对勾 + 成功色，1.2s 后转回 */
.row-acts .ib.copied { color: var(--success); }

/* 骨架卡的皮与呼吸走 global.css，此处只留宽度分配 */
.skeleton-line.name { width: 118px; }
.skeleton-line.note { width: 172px; height: 6px; }

/* ---------- 添加/编辑弹窗：与收藏表单弹窗同一套骨架 ----------
   520px 壳、居中悬浮（遮罩走全局居中基线，只把磨砂提到 6px 与首页同档）、42px 头、46px 底栏（浅底 + 28px 钮走 global.css .dialog-footer） */
.form-overlay {
  background: var(--overlay);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.shortcut-dialog {
  width: 520px;
  max-height: 91vh;
  border: 1px solid var(--border);
  box-shadow: var(--shadow-pop);
}
.shortcut-dialog .dialog-header { height: 42px; padding: 0 20px; }
.shortcut-dialog .dialog-header h3 { font-size: var(--text-base); }
.shortcut-dialog .dialog-body { overflow: hidden; padding: 16px 20px 12px; }
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
.path-input-row:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); background: var(--panel-bg); }
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

/* 分段控制器：凹槽轨道 + 浮白滑块（与页面 .tab / 侧栏同一套浮卡语言，无边框靠阴影）；
   整体钉 32px 与输入框同轴 */
.type-seg {
  position: relative;
  display: flex;
  height: 32px;
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
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
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
