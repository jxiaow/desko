<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { entriesApi } from '../../services/api/entries'
import { urlPathsApi } from '../../services/api/urlPaths'
import { normalizeSubPath } from '../../utils/urlPath'
import type { Entry, CreateEntryInput, UpdateEntryInput } from '../../types'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../shared/AppIcon.vue'

interface LocalPath {
  id: string
  path: string
  label: string
  notes: string
  isNew: boolean
  isDeleted: boolean
  /** 库里存的是旧格式（整条地址），保存时改写回库 */
  dirty: boolean
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

const nameRef = ref<HTMLInputElement | null>(null)
const categoryRef = ref<HTMLInputElement | null>(null)
const urlRef = ref<HTMLInputElement | null>(null)

type RequiredField = 'name' | 'category' | 'url'
const invalid = ref<Record<RequiredField, boolean>>({ name: false, category: false, url: false })
const fieldRefs: Record<RequiredField, typeof nameRef> = { name: nameRef, category: categoryRef, url: urlRef }

/** 无位移红框微光：先摘类再逼一次重排，连续点击保存也能重播脉冲 */
function flash(el: HTMLInputElement) {
  el.classList.remove('field-alert')
  void el.offsetWidth
  el.classList.add('field-alert')
}

function clearInvalid(key: RequiredField) {
  if (!invalid.value[key]) return
  invalid.value[key] = false
  fieldRefs[key].value?.classList.remove('field-alert')
}

const localPaths = ref<LocalPath[]>([])
let tempIdCounter = 0
const generateTempId = () => `temp-${++tempIdCounter}`

const showCategoryDropdown = ref(false)
const dropdownPos = ref({ top: 0, left: 0, width: 0 })

const filteredCategories = computed(() => {
  const kw = form.value.category.trim().toLowerCase()
  if (!kw) return props.categories
  return props.categories.filter(c => c.toLowerCase().includes(kw))
})

/** 键入无命中时列表只剩「创建」项；有命中时尾追一项，均可点选或回车落定 */
const showCreateOption = computed(() => {
  const kw = form.value.category.trim()
  return !!kw && !props.categories.some(c => c === kw)
})

const selectCategory = (cat: string) => {
  form.value.category = cat
  showCategoryDropdown.value = false
  clearInvalid('category')
}

const commitCategory = () => {
  const kw = form.value.category.trim()
  if (!kw) {
    invalid.value.category = true
    flash(categoryRef.value!)
    return
  }
  const exact = props.categories.find(c => c === kw) ?? props.categories.find(c => c.toLowerCase() === kw.toLowerCase())
  if (exact) form.value.category = exact
  showCategoryDropdown.value = false
  clearInvalid('category')
}

const updateDropdownPos = () => {
  if (categoryRef.value) {
    const rect = categoryRef.value.getBoundingClientRect()
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
  nextTick(() => nameRef.value?.focus())
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
      localPaths.value = existingPaths.map(p => {
        const normalized = normalizeSubPath(p.path)
        return {
          id: p.id,
          path: normalized ?? p.path,
          label: p.label || '',
          notes: p.notes || '',
          isNew: false,
          isDeleted: false,
          dirty: !!normalized && normalized !== p.path,
        }
      })
    } catch {
      localPaths.value = []
    }
  } else {
    form.value = { name: '', url: '', username: '', password: '', notes: '', category: '' }
    localPaths.value = []
  }
}, { immediate: true })

/* ---------- 子路径：列表只读呈现，追加走底部添加行 ---------- */

const draft = ref({ label: '', path: '' })
const addPathRef = ref<HTMLInputElement | null>(null)
const pathAddLabelRef = ref<HTMLInputElement | null>(null)

const activePaths = computed(() => localPaths.value.filter(p => !p.isDeleted))

const pathLabel = (p: LocalPath) => {
  if (!p.label) return '未命名'
  return p.label.length > 8 ? p.label.slice(0, 8) + '…' : p.label
}

const addPath = () => {
  const raw = draft.value.path.trim()
  if (!raw) {
    addPathRef.value?.focus()
    return
  }
  const path = normalizeSubPath(raw)
  if (!path) {
    toastStore.showToast('只需填主机名之后的路径，例如 /builds/linux', 'error')
    addPathRef.value?.focus()
    return
  }
  localPaths.value.push({
    id: generateTempId(),
    path,
    label: draft.value.label.trim(),
    notes: '',
    isNew: true,
    isDeleted: false,
    dirty: false,
  })
  draft.value = { label: '', path: '' }
  nextTick(() => {
    if (pathListRef.value) pathListRef.value.scrollTop = pathListRef.value.scrollHeight
    addPathRef.value?.focus()
  })
}

const pathListRef = ref<HTMLElement | null>(null)

const removePath = (index: number) => {
  const path = activePaths.value[index]
  const at = localPaths.value.indexOf(path)
  if (at < 0) return
  if (path.isNew) localPaths.value.splice(at, 1)
  else path.isDeleted = true
}

const save = async () => {
  const missing = (['name', 'category', 'url'] as const).filter(k => !form.value[k].trim())
  if (missing.length) {
    for (const k of missing) invalid.value[k] = true
    const first = fieldRefs[missing[0]].value!
    flash(first)
    first.focus()
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
        category: form.value.category,
      }
      entryId = (await entriesApi.createEntry(input)).id
    }

    for (const p of localPaths.value.filter(p => p.isDeleted && !p.isNew)) {
      await urlPathsApi.deleteUrlPath(p.id)
    }
    for (const p of localPaths.value.filter(p => p.dirty && !p.isDeleted)) {
      await urlPathsApi.updateUrlPath(p.id, { path: p.path, label: p.label || undefined, notes: p.notes || undefined })
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
    <div class="form-row row-meta">
      <div class="form-group">
        <label>条目名称 <span class="req">*</span></label>
        <input ref="nameRef" v-model="form.name" placeholder="例如：OA系统" :class="{ 'field-invalid': invalid.name }" @input="clearInvalid('name')" />
      </div>
      <div class="form-group category-group">
        <label>所属分类 <span class="req">*</span></label>
        <div class="category-input-wrapper">
          <input
            ref="categoryRef"
            v-model="form.category"
            placeholder="选择或输入新分类"
            :class="{ 'field-invalid': invalid.category }"
            @focus="onCategoryFocus"
            @blur="onCategoryBlur"
            @input="showCategoryDropdown = true; clearInvalid('category')"
            @keydown.enter.prevent="commitCategory"
          />
          <svg class="cat-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5 6 7.5 9 4.5"/></svg>
          <Teleport to="body">
            <div
              v-if="showCategoryDropdown"
              class="category-dropdown-teleported"
              :style="{ top: dropdownPos.top + 'px', left: dropdownPos.left + 'px', width: dropdownPos.width + 'px' }"
            >
              <div
                v-for="cat in filteredCategories"
                :key="cat"
                class="category-option"
                :class="{ active: form.category === cat }"
                @mousedown.prevent="selectCategory(cat)"
              >{{ cat }}</div>
              <div
                v-if="showCreateOption"
                class="category-option category-create"
                @mousedown.prevent="commitCategory()"
              >创建「{{ form.category.trim() }}」</div>
              <div v-if="!filteredCategories.length && !showCreateOption" class="category-empty">无匹配，键入后回车新建</div>
            </div>
          </Teleport>
        </div>
      </div>
    </div>

    <div class="form-group">
      <label>主机地址 <span class="req">*</span></label>
      <input ref="urlRef" v-model="form.url" class="url-mono" :class="{ 'field-invalid': invalid.url }" placeholder="https://..." @input="clearInvalid('url')" />
    </div>

    <div class="form-row cred-row">
      <div class="form-group">
        <label>用户名</label>
        <input v-model="form.username" placeholder="登录用户名" />
      </div>
      <div class="form-group">
        <label>密码{{ props.entry ? '（留空则不修改）' : '' }}</label>
        <input v-model="form.password" type="password" placeholder="登录密码" />
      </div>
    </div>

    <div class="paths-section">
      <div class="paths-header">
        <label>子路径</label>
        <span class="paths-count">{{ activePaths.length }} 个路径</span>
      </div>

      <div class="paths-card">
        <div ref="pathListRef" class="path-list">
          <div v-if="!activePaths.length" class="path-empty">暂无子路径</div>
          <div v-for="(path, index) in activePaths" :key="path.id" class="path-row">
            <span class="path-tag" :title="path.label || undefined">{{ pathLabel(path) }}</span>
            <span class="path-sep">/</span>
            <span class="path-value" :title="path.path">{{ path.path.replace(/^\//, '') }}</span>
            <button class="path-del" type="button" title="删除路径" @click="removePath(index)">
              <AppIcon name="x" :size="11" />
            </button>
          </div>
        </div>

        <div class="path-add">
          <input ref="pathAddLabelRef" v-model="draft.label" class="add-label" placeholder="标签" maxlength="20" @keydown.enter.prevent="addPath" />
          <span class="path-sep">/</span>
          <input ref="addPathRef" v-model="draft.path" class="add-path" placeholder="dashboard" @keydown.enter.prevent="addPath" />
          <button class="btn-add-path" type="button" @click="addPath">添加</button>
        </div>
      </div>
    </div>

    <div class="form-group notes-group">
      <label>备注说明</label>
      <textarea v-model="form.notes" placeholder="可选" rows="2"></textarea>
    </div>
  </div>
</template>

<style scoped>
/* 弹窗表单控件轴：32px 输入行高，只收进本表单 */
.entry-fields input,
.entry-fields textarea {
  height: 32px;
  padding: 0 10px;
  font-size: 13px;
}
/* 呼吸节奏：标签下距 6px、组距 12px（对齐已验收原型）；行高钉 14px 防全局 18px 撑高 */
.entry-fields label { font-size: 12px; line-height: 14px; margin-bottom: 6px; }
.entry-fields .form-group { margin-bottom: 12px; }
.entry-fields .form-row { margin-bottom: 12px; gap: 12px; }
.entry-fields textarea { height: 52px; padding: 6px 10px; resize: none; line-height: 17px; }
.entry-fields .cred-row { margin: 12px 0; }
.entry-fields .notes-group { margin-bottom: 0; }
.url-mono { font-family: var(--font-mono); }
.req { color: var(--danger); font-style: normal; }

/* 名称/分类 1:1 双列 */
.row-meta { grid-template-columns: 1fr 1fr; }

/* 分类输入带下拉：右侧 chevron 提示可点选 */
.category-input-wrapper { position: relative; }
.category-input-wrapper input { padding-right: 26px; }
.cat-chevron {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  pointer-events: none; color: var(--text-faint);
}

/* 必填未落：红框常驻 + 无位移辉光脉冲（不碰 border 宽度，零位移） */
.entry-fields input.field-invalid { border-color: var(--danger); }
@keyframes field-alert {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--danger) 40%, transparent); }
  60% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--danger) 18%, transparent); }
  100% { box-shadow: 0 0 0 6px transparent; }
}
.entry-fields input.field-alert { animation: field-alert 0.5s ease-out 2; }

/* ---------- 子路径：内陷滚动卡，视窗恒定 80px——增删条目弹窗总高零变化 ---------- */
.paths-section { margin: 12px 0; }
.paths-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
.paths-header label { margin-bottom: 0; }
.paths-count { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }

.paths-card {
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--sunken); padding: 6px 8px;
}

.path-list {
  display: flex; flex-direction: column; gap: 2px;
  height: 80px; max-height: 80px; overflow-y: auto; min-height: 0;
  margin: 0 -2px; padding: 0 2px;
  scrollbar-width: thin; scrollbar-color: transparent transparent;
}
.path-list:hover { scrollbar-color: var(--text-muted) transparent; }
.path-list::-webkit-scrollbar { width: 3px; }
.path-list::-webkit-scrollbar-track { background: transparent; }
.path-list::-webkit-scrollbar-thumb { background: transparent; border-radius: 2px; transition: background var(--transition-fast); }
.path-list:hover::-webkit-scrollbar-thumb { background: var(--text-muted); }

.path-empty {
  height: 100%; display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: var(--text-faint);
}

/* 行即扁平条目：微绿底悬停浮现，无独立卡壳 */
.path-row {
  display: flex; align-items: center; gap: 6px; flex-shrink: 0;
  height: 26px; padding: 0 5px; border-radius: 4px;
  background: transparent; transition: background var(--transition-fast);
}
.path-row:hover { background: var(--hover); }
/* 标签做成胶囊：与斜杠、路径形成「标签 / path」节奏 */
.path-tag {
  flex: 0 0 auto; max-width: 84px;
  height: 18px; line-height: 18px; padding: 0 7px; border-radius: 9px;
  font-size: 11px; font-weight: 500; color: var(--accent); background: var(--accent-soft);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.path-sep { flex-shrink: 0; font-size: 12px; color: var(--text-faint); }
.path-value {
  flex: 1; min-width: 0;
  font-family: var(--font-mono); font-size: 12px; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 删除是低频动作，悬停行才浮现 */
.path-del {
  flex-shrink: 0; width: 18px; height: 18px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 4px; background: transparent;
  color: var(--danger); cursor: pointer;
  opacity: 0; transition: opacity var(--transition-fast), background var(--transition-fast);
}
.path-row:hover .path-del { opacity: 1; }
.path-del:hover { background: var(--danger-soft, var(--hover)); }

/* 吸底录入栏：28px 紧凑档，与 32px 字段轴分层 */
.path-add {
  display: flex; align-items: center; gap: 8px;
  margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--border-divider);
}
.path-add input {
  height: 28px; padding: 0 8px; font-size: 12.5px;
  border: 1px solid var(--border-input, var(--border)); border-radius: var(--radius-sm);
  background: var(--panel-bg); color: var(--text);
}
/* input 的 min-width:auto 会回退到 UA 固有宽（≈190px），必须显式钉死才吃得到 72px */
.path-add .add-label { flex: 0 0 72px; min-width: 72px; }
.path-add .add-path { flex: 1; min-width: 0; font-family: var(--font-mono); }
.path-add .add-label:focus,
.path-add .add-path:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-ring); }
.btn-add-path {
  flex-shrink: 0; height: 28px; padding: 0 11px;
  font-size: 12px; font-weight: 500; font-family: inherit;
  color: var(--text-secondary); background: var(--panel-bg);
  border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
  cursor: pointer; transition: all var(--transition-fast);
}
.btn-add-path:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }

.category-create { color: var(--accent); }
</style>
