<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { entriesApi } from '../../services/api/entries'
import { urlPathsApi } from '../../services/api/urlPaths'
import type { Entry, CreateEntryInput, UpdateEntryInput } from '../../types'
import { useToastStore } from '../../stores/toast'

interface LocalPath {
  id: string // 临时 ID 或真实 ID
  path: string
  label: string
  isNew: boolean
  isDeleted: boolean
}

const props = defineProps<{
  editEntry: Entry | null
  categories: string[]
}>()

const toastStore = useToastStore()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const form = ref({
  name: '',
  url: '',
  username: '',
  password: '',
  notes: '',
  category: '',
})

const localPaths = ref<LocalPath[]>([])
let tempIdCounter = 0

const generateTempId = () => `temp-${++tempIdCounter}`

const showCategoryDropdown = ref(false)
const categoryInputRef = ref<HTMLInputElement | null>(null)
const dropdownPos = ref({ top: 0, left: 0, width: 0 })

const filteredCategories = computed(() => {
  const kw = form.value.category.toLowerCase()
  if (!kw) return props.categories
  return props.categories.filter(c => c.toLowerCase().includes(kw))
})

const selectCategory = (cat: string) => {
  form.value.category = cat
  showCategoryDropdown.value = false
}

const updateDropdownPos = () => {
  if (categoryInputRef.value) {
    const rect = categoryInputRef.value.getBoundingClientRect()
    dropdownPos.value = { top: rect.bottom + 2, left: rect.left, width: rect.width }
  }
}

const onCategoryFocus = () => {
  updateDropdownPos()
  showCategoryDropdown.value = true
}

const onCategoryBlur = () => {
  setTimeout(() => { showCategoryDropdown.value = false }, 200)
}

// Update position on scroll and resize
onMounted(() => {
  window.addEventListener('scroll', updateDropdownPos, true)
  window.addEventListener('resize', updateDropdownPos)
})

onUnmounted(() => {
  window.removeEventListener('scroll', updateDropdownPos, true)
  window.removeEventListener('resize', updateDropdownPos)
})

watch(() => props.editEntry, async (entry) => {
  if (entry) {
    form.value = {
      name: entry.name,
      url: entry.url || '',
      username: entry.username || '',
      password: '',
      notes: entry.notes || '',
      category: entry.category || '',
    }
    // Load existing paths
    if (entry.id) {
      try {
        const existingPaths = await urlPathsApi.listUrlPaths(entry.id)
        localPaths.value = existingPaths.map(p => ({
          id: p.id,
          path: p.path,
          label: p.label || '',
          isNew: false,
          isDeleted: false,
        }))
      } catch (e) {
        localPaths.value = []
      }
    } else {
      localPaths.value = []
    }
  } else {
    form.value = { name: '', url: '', username: '', password: '', notes: '', category: '' }
    localPaths.value = []
  }
}, { immediate: true })

const addPath = () => {
  localPaths.value.push({
    id: generateTempId(),
    path: '',
    label: '',
    isNew: true,
    isDeleted: false,
  })
}

const removePath = (index: number) => {
  const path = localPaths.value[index]
  if (path.isNew) {
    // 新增的路径直接移除
    localPaths.value.splice(index, 1)
  } else {
    // 已有的路径标记为删除
    path.isDeleted = true
  }
}

const doSave = async () => {
  if (!form.value.name) {
    toastStore.showToast('名称必填', 'error')
    return
  }
  
  // 验证路径的 label 和 path 不能重复
  const activePaths = localPaths.value.filter(p => !p.isDeleted && p.path)
  const labels = activePaths.map(p => p.label).filter(l => l)
  const paths = activePaths.map(p => p.path)
  
  const hasDuplicateLabels = labels.length !== new Set(labels).size
  const hasDuplicatePaths = paths.length !== new Set(paths).size
  
  if (hasDuplicateLabels) {
    toastStore.showToast('路径标签不能重复', 'error')
    return
  }
  
  if (hasDuplicatePaths) {
    toastStore.showToast('路径不能重复', 'error')
    return
  }
  
  try {
    let entryId: string

    if (props.editEntry) {
      // 更新条目
      const input: UpdateEntryInput = {
        name: form.value.name,
        url: form.value.url || undefined,
        username: form.value.username || undefined,
        notes: form.value.notes || undefined,
        category: form.value.category || undefined,
      }
      if (form.value.password) {
        input.password = form.value.password
      }
      await entriesApi.updateEntry(props.editEntry.id, input)
      entryId = props.editEntry.id
    } else {
      // 创建条目
      const input: CreateEntryInput = {
        name: form.value.name,
        url: form.value.url || undefined,
        username: form.value.username || undefined,
        password: form.value.password,
        notes: form.value.notes || undefined,
        category: form.value.category || '未分类',
      }
      const created = await entriesApi.createEntry(input)
      entryId = created.id
    }

    // 处理路径：删除标记为删除的，创建新增的
    const pathsToDelete = localPaths.value.filter(p => p.isDeleted && !p.isNew)
    const pathsToCreate = localPaths.value.filter(p => p.isNew && !p.isDeleted)

    for (const path of pathsToDelete) {
      await urlPathsApi.deleteUrlPath(path.id)
    }

    for (const path of pathsToCreate) {
      if (path.path) {
        await urlPathsApi.createUrlPath({
          entry_id: entryId,
          path: path.path,
          label: path.label || undefined,
        })
      }
    }

    emit('saved')
    emit('close')
    toastStore.showToast(props.editEntry ? '已更新' : '已添加')
  } catch (e: any) {
    toastStore.showToast(e.message || '保存失败', 'error')
  }
}

let handleEscape: ((e: KeyboardEvent) => void) | null = null

onMounted(() => {
  handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') emit('close')
  }
  window.addEventListener('keydown', handleEscape)
})

onUnmounted(() => {
  if (handleEscape) window.removeEventListener('keydown', handleEscape)
})
</script>

<template>
  <Transition name="dialog">
    <div v-if="true" class="dialog-overlay">
    <div class="dialog">
      <div class="dialog-header">
        <div class="dialog-header-left">
          <div class="dialog-logo">
            <svg viewBox="0 0 124 124" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="deskoPurpleDialog" x1="32" y1="24" x2="95" y2="108" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stop-color="#6A63FF"/>
                  <stop offset="0.48" stop-color="#554BE8"/>
                  <stop offset="1" stop-color="#3327B8"/>
                </linearGradient>
              </defs>
              <path d="M94 35 L51 49 C47.8 50.1 46 52.4 46 56 L46 98 C33.7 91.0 26 77.9 26 63 C26 40.9 43.9 23 66 23 C73.5 23 80.2 24.8 85.9 28.1 L94 35 Z" fill="url(#deskoPurpleDialog)"/>
              <path d="M97 40 L65 51.8 C63 52.5 62 54.0 62 56.2 L62 105.5 C62 107.8 63.8 109.2 66 108.4 L95 98 C97.0 97.3 98 95.8 98 93.6 L98 42.5 C98 41.2 97.7 40.5 97 40 Z" fill="url(#deskoPurpleDialog)"/>
              <circle cx="75" cy="79" r="5" fill="#FFFFFF"/>
            </svg>
          </div>
          <h3>{{ editEntry ? '编辑条目' : '新增条目' }}</h3>
        </div>
        <button class="dialog-close" @click="emit('close')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="dialog-body">
        <div class="form-row">
          <div class="form-group">
            <label>名称 *</label>
            <input v-model="form.name" placeholder="例如：OA系统" />
          </div>
          <div class="form-group category-group">
            <label>分类</label>
            <div class="category-input-wrapper">
              <input
                ref="categoryInputRef"
                v-model="form.category"
                placeholder="选择或输入新分类"
                @focus="onCategoryFocus"
                @blur="onCategoryBlur"
                @input="showCategoryDropdown = true"
              />
              <Teleport to="body">
                <div
                  v-if="showCategoryDropdown"
                  class="category-dropdown-teleported"
                  :style="{ top: dropdownPos.top + 'px', left: dropdownPos.left + 'px', width: dropdownPos.width + 'px' }"
                >
                  <div v-if="filteredCategories.length > 0">
                    <div
                      v-for="cat in filteredCategories"
                      :key="cat"
                      class="category-option"
                      :class="{ active: form.category === cat }"
                      @mousedown.prevent="selectCategory(cat)"
                    >{{ cat }}</div>
                  </div>
                  <div v-else class="category-empty">输入新分类名称</div>
                </div>
              </Teleport>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>网址</label>
          <input v-model="form.url" placeholder="https://..." />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>用户名</label>
            <input v-model="form.username" placeholder="登录用户名" />
          </div>
          <div class="form-group">
            <label>密码 {{ editEntry ? '(留空则不修改)' : '' }}</label>
            <input v-model="form.password" type="password" placeholder="登录密码" />
          </div>
        </div>
        <div class="form-group">
          <label>备注</label>
          <textarea v-model="form.notes" placeholder="可选" rows="2"></textarea>
        </div>

        <!-- URL Paths Section -->
        <div class="paths-section">
          <div class="paths-header">
            <label>URL 路径</label>
            <span class="paths-hint">同一网站不同页面可添加多个路径，共享用户名和密码</span>
          </div>

          <div class="path-list">
            <div class="path-item" v-for="(path, index) in localPaths.filter(p => !p.isDeleted)" :key="path.id">
              <div class="path-inputs">
                <input
                  v-model="path.path"
                  class="path-input"
                  placeholder="路径，如 /dashboard"
                />
                <input
                  v-model="path.label"
                  class="path-input"
                  placeholder="标签"
                />
              </div>
              <button class="btn-delete-path" @click="removePath(index)" title="删除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          <button class="btn-add-path" @click="addPath">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            添加路径
          </button>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" @click="emit('close')">取 消</button>
        <button class="btn-primary" @click="doSave">保 存</button>
      </div>
    </div>
    </div>
  </Transition>
</template>

<style scoped>
.form-group { margin-bottom: 12px; }
.form-group label { display: block; font-size: 13px; font-weight: 500; color: var(--text-secondary); margin-bottom: 5px; }
.form-group input, .form-group textarea { width: 100%; padding: 8px 11px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 14px; outline: none; transition: all 0.15s; font-family: inherit; background: var(--bg); }
.form-group input:focus, .form-group textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); background: #fff; }
.form-group textarea { resize: vertical; min-height: 56px; font-family: inherit; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.form-row .form-group { margin-bottom: 0; }

.category-group { position: relative; }
.category-input-wrapper { position: relative; }

/* URL Paths Section */
.paths-section { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }
.paths-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.paths-header label { margin-bottom: 0; }
.paths-hint { font-size: 12px; color: var(--text-muted); }

.path-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.path-item { display: flex; align-items: center; gap: 8px; padding: 10px; background: var(--bg-secondary); border-radius: var(--radius-sm); border: 1px solid var(--border); }
.path-inputs { display: flex; gap: 8px; flex: 1; min-width: 0; }
.path-input { flex: 1; padding: 7px 9px; border: 1px solid var(--border); border-radius: 4px; font-size: 13px; outline: none; background: var(--bg); font-family: inherit; }
.path-input:focus { border-color: var(--accent); }
.path-input:first-child { font-family: monospace; }
.btn-delete-path { padding: 4px; color: var(--text-secondary); background: none; border: none; cursor: pointer; border-radius: 4px; transition: all 0.15s; flex-shrink: 0; }
.btn-delete-path:hover { color: #ef4444; background: rgba(239, 68, 68, 0.1); }

.btn-add-path { display: flex; align-items: center; gap: 6px; padding: 7px 13px; font-size: 13px; color: var(--accent); background: none; border: 1px dashed var(--accent); border-radius: var(--radius-sm); cursor: pointer; transition: all 0.15s; }
.btn-add-path:hover { background: var(--accent-soft); }
</style>

<style>
.category-dropdown-teleported { position: fixed; z-index: 10000; background: var(--panel-bg); border: 1px solid var(--border); border-radius: var(--radius-sm); box-shadow: var(--shadow); max-height: 120px; overflow-y: auto; pointer-events: auto; }
.category-dropdown-teleported .category-option { padding: 7px 11px; font-size: 13px; cursor: pointer; transition: background 0.1s; }
.category-dropdown-teleported .category-option:hover { background: var(--accent-soft); }
.category-dropdown-teleported .category-option.active { background: var(--accent-soft); color: var(--accent); font-weight: 500; }
.category-dropdown-teleported .category-empty { padding: 7px 11px; font-size: 13px; color: var(--text-muted); }
</style>
