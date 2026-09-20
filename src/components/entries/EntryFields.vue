<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { entriesApi } from '../../services/api/entries'
import { urlPathsApi } from '../../services/api/urlPaths'
import type { Entry, CreateEntryInput, UpdateEntryInput } from '../../types'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../shared/AppIcon.vue'

interface LocalPath {
  id: string
  path: string
  label: string
  isNew: boolean
  isDeleted: boolean
}

const props = defineProps<{
  /** null 表示新建条目 */
  entry: Entry | null
  categories: string[]
}>()

const emit = defineEmits<{ saved: [id: string] }>()

const toastStore = useToastStore()

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

// 浮层是 fixed 定位，滚动或缩放后要与输入框重新对齐
onMounted(() => {
  window.addEventListener('scroll', updateDropdownPos, true)
  window.addEventListener('resize', updateDropdownPos)
})

onUnmounted(() => {
  window.removeEventListener('scroll', updateDropdownPos, true)
  window.removeEventListener('resize', updateDropdownPos)
})

watch(() => props.entry, async (entry) => {
  if (entry) {
    form.value = {
      name: entry.name,
      url: entry.url || '',
      username: entry.username || '',
      password: '',
      notes: entry.notes || '',
      category: entry.category || '',
    }
    try {
      const existingPaths = await urlPathsApi.listUrlPaths(entry.id)
      localPaths.value = existingPaths.map(p => ({
        id: p.id,
        path: p.path,
        label: p.label || '',
        isNew: false,
        isDeleted: false,
      }))
    } catch {
      localPaths.value = []
    }
  } else {
    form.value = { name: '', url: '', username: '', password: '', notes: '', category: '' }
    localPaths.value = []
  }
}, { immediate: true })

const addPath = () => {
  localPaths.value.push({ id: generateTempId(), path: '', label: '', isNew: true, isDeleted: false })
}

const removePath = (index: number) => {
  const path = localPaths.value[index]
  if (path.isNew) localPaths.value.splice(index, 1)
  else path.isDeleted = true
}

const activePaths = computed(() => localPaths.value.filter(p => !p.isDeleted))

const save = async () => {
  if (!form.value.name) {
    toastStore.showToast('名称必填', 'error')
    return
  }

  const paths = activePaths.value.filter(p => p.path)
  const labels = paths.map(p => p.label).filter(Boolean)
  if (labels.length !== new Set(labels).size) {
    toastStore.showToast('路径标签不能重复', 'error')
    return
  }
  const values = paths.map(p => p.path)
  if (values.length !== new Set(values).size) {
    toastStore.showToast('路径不能重复', 'error')
    return
  }

  try {
    let entryId: string

    if (props.entry) {
      const input: UpdateEntryInput = {
        name: form.value.name,
        url: form.value.url || undefined,
        username: form.value.username || undefined,
        notes: form.value.notes || undefined,
        category: form.value.category || undefined,
      }
      if (form.value.password) input.password = form.value.password
      await entriesApi.updateEntry(props.entry.id, input)
      entryId = props.entry.id
    } else {
      const input: CreateEntryInput = {
        name: form.value.name,
        url: form.value.url || undefined,
        username: form.value.username || undefined,
        password: form.value.password,
        notes: form.value.notes || undefined,
        category: form.value.category || '未分类',
      }
      entryId = (await entriesApi.createEntry(input)).id
    }

    for (const p of localPaths.value.filter(p => p.isDeleted && !p.isNew)) {
      await urlPathsApi.deleteUrlPath(p.id)
    }
    for (const p of localPaths.value.filter(p => p.isNew && !p.isDeleted && p.path)) {
      await urlPathsApi.createUrlPath({ entry_id: entryId, path: p.path, label: p.label || undefined })
    }

    emit('saved', entryId)
    toastStore.showToast(props.entry ? '已更新' : '已添加')
  } catch (e: any) {
    toastStore.showToast(e.message || '保存失败', 'error')
  }
}

defineExpose({ save })
</script>

<template>
  <div class="entry-fields">
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
        <label>密码{{ props.entry ? '（留空则不修改）' : '' }}</label>
        <input v-model="form.password" type="password" placeholder="登录密码" />
      </div>
    </div>
    <div class="form-group">
      <label>备注</label>
      <textarea v-model="form.notes" placeholder="可选" rows="2"></textarea>
    </div>

    <div class="paths-section">
      <div class="paths-header">
        <label>URL 路径</label>
        <span class="paths-hint">同一网站不同页面共享用户名和密码</span>
      </div>

      <div class="path-list">
        <div v-for="(path, index) in activePaths" :key="path.id" class="path-row">
          <input v-model="path.path" class="path-input path-mono" placeholder="路径，如 /dashboard" />
          <input v-model="path.label" class="path-input" placeholder="标签" />
          <button class="ib danger" type="button" title="删除路径" @click="removePath(index)">
            <AppIcon name="x" :size="13" />
          </button>
        </div>
      </div>

      <button class="btn-add-path" type="button" @click="addPath">
        <AppIcon name="plus" :size="13" />
        添加路径
      </button>
    </div>
  </div>
</template>

<style scoped>
.paths-section { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); }
.paths-header { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2); margin-bottom: var(--space-3); }
.paths-header label { margin-bottom: 0; }
.paths-hint { font-size: 11.5px; color: var(--text-muted); }

.path-list { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-3); }
.path-row { display: flex; align-items: center; gap: var(--space-2); padding: 6px 6px 6px 10px; background: var(--sunken); border: 1px solid var(--border); border-radius: var(--radius-sm); }
.path-input { flex: 1; min-width: 0; padding: 6px 9px; border: 1px solid var(--border); border-radius: 4px; font-size: 13px; outline: none; background: var(--bg); font-family: inherit; color: var(--text); }
.path-input:focus { border-color: var(--accent); }
.path-mono { font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace; flex: 1.6; }

.btn-add-path {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; font-size: 12.5px; font-weight: 500;
  color: var(--text-secondary); background: transparent;
  border: 1px dashed var(--border-strong); border-radius: var(--radius-sm);
  cursor: pointer; transition: all var(--transition); font-family: inherit;
}
.btn-add-path:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
</style>
