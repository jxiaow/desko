<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { usePageActive } from '../../composables/usePageActive'
import { entriesApi } from '../../services/api/entries'
import { urlPathsApi } from '../../services/api/urlPaths'
import { normalizeSubPath } from '../../utils/urlPath'
import type { Entry, LocalPath, CreateEntryInput, UpdateEntryInput } from '../../types'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../shared/AppIcon.vue'
import PathsDialog from './PathsDialog.vue'

const pageActive = usePageActive()
const props = defineProps<{
  /** null 表示新建条目 */
  entry: Entry | null
  categories: string[]
}>()

const emit = defineEmits<{ saved: [id: string]; openUrl: [url: string] }>()

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
/** 密码明文只在本次编辑内可见；换条目时收回，不留显示态 */
const showPwd = ref(false)
const showPaths = ref(false)

const showCategoryDropdown = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)
const categoryOptionIndex = ref(-1)
const dropdownPos = ref({ top: 0, left: 0, width: 0, maxHeight: 202 })

const filteredCategories = computed(() => {
  const kw = form.value.category.trim().toLowerCase()
  if (!kw) return props.categories
  return props.categories.filter(c => c.toLowerCase().includes(kw))
})

/** 键入无命中时列表只剩「创建」项；有命中时尾追一项，均可点选或回车落定 */
const showCreateOption = computed(() => {
  const kw = form.value.category.trim()
  return !!kw && !props.categories.some(c => c.toLowerCase() === kw.toLowerCase())
})
const categoryChoices = computed(() => [
  ...filteredCategories.value,
  ...(showCreateOption.value ? [form.value.category.trim()] : []),
])

async function moveCategory(direction: number) {
  if (!showCategoryDropdown.value) onCategoryFocus()
  const count = categoryChoices.value.length
  if (!count) return
  categoryOptionIndex.value = categoryOptionIndex.value < 0
    ? (direction > 0 ? 0 : count - 1)
    : (categoryOptionIndex.value + direction + count) % count
  await nextTick()
  dropdownRef.value?.querySelector<HTMLElement>(`[data-index="${categoryOptionIndex.value}"]`)?.scrollIntoView({ block: 'nearest' })
}

function chooseCategory() {
  const choice = categoryChoices.value[categoryOptionIndex.value]
  if (showCategoryDropdown.value && choice !== undefined && categoryOptionIndex.value < filteredCategories.value.length) selectCategory(choice)
  else commitCategory()
}

function dismissCategory(event: KeyboardEvent) {
  if (!showCategoryDropdown.value) return
  event.preventDefault()
  event.stopPropagation()
  showCategoryDropdown.value = false
}

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
    const below = window.innerHeight - rect.bottom - 8
    const above = rect.top - 8
    const upwards = below < 202 && above > below
    const rows = Math.max(1, Math.min(6, Math.floor(((upwards ? above : below) - 10) / 32)))
    const maxHeight = rows * 32 + 10
    const height = Math.min(maxHeight, Math.max(1, categoryChoices.value.length) * 32 + 10)
    dropdownPos.value = { top: upwards ? rect.top - height - 2 : rect.bottom + 2, left: rect.left, width: rect.width, maxHeight }
  }
}

const onCategoryFocus = () => {
  categoryOptionIndex.value = -1
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
  showPwd.value = false
  showPaths.value = false
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

/* ---------- 子路径：增删住独立弹窗，表单里只留一行摘要入口 ---------- */

const activePaths = computed(() => localPaths.value.filter(p => !p.isDeleted))

const pathsSummary = computed(() => activePaths.value.length
  ? activePaths.value.map(p => `${p.label || '未命名'} / ${p.path.replace(/^\//, '')}`).join(' · ')
  : '未添加 · 点击管理')

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
        <label for="entry-category">所属分类 <span class="req">*</span></label>
        <div class="category-input-wrapper">
          <input
            ref="categoryRef"
            id="entry-category"
            v-model="form.category"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="entry-category-options"
            :aria-expanded="showCategoryDropdown"
            :aria-activedescendant="showCategoryDropdown && categoryOptionIndex >= 0 ? `entry-category-${categoryOptionIndex}` : undefined"
            placeholder="选择或输入新分类"
            :class="{ 'field-invalid': invalid.category }"
            @focus="onCategoryFocus"
            @blur="onCategoryBlur"
            @input="showCategoryDropdown = true; categoryOptionIndex = -1; updateDropdownPos(); clearInvalid('category')"
            @keydown.down.prevent="moveCategory(1)"
            @keydown.up.prevent="moveCategory(-1)"
            @keydown.enter.prevent="chooseCategory"
            @keydown.esc="dismissCategory"
          />
          <AppIcon class="cat-chevron" name="chevDown" :size="12" />
          <Teleport to="body" :disabled="!pageActive">
            <div
              v-if="showCategoryDropdown"
              id="entry-category-options"
              ref="dropdownRef"
              role="listbox"
              aria-label="所属分类"
              class="category-dropdown-teleported"
              :style="{ top: dropdownPos.top + 'px', left: dropdownPos.left + 'px', width: dropdownPos.width + 'px', maxHeight: dropdownPos.maxHeight + 'px' }"
            >
              <div
                v-for="(cat, index) in filteredCategories"
                :key="cat"
                :id="`entry-category-${index}`"
                :data-index="index"
                role="option"
                :aria-selected="form.category === cat"
                class="category-option"
                :class="{ active: form.category === cat, highlighted: categoryOptionIndex === index }"
                :title="cat"
                @mousedown.prevent="selectCategory(cat)"
              >{{ cat }}</div>
              <div
                v-if="showCreateOption"
                :id="`entry-category-${filteredCategories.length}`"
                :data-index="filteredCategories.length"
                role="option"
                :aria-selected="false"
                class="category-option category-create"
                :class="{ highlighted: categoryOptionIndex === filteredCategories.length }"
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
        <input v-model="form.username" class="mono-field" placeholder="登录用户名" />
      </div>
      <div class="form-group">
        <label>密码{{ props.entry ? '（留空则不修改）' : '' }}</label>
        <div class="pwd-wrap">
          <input v-model="form.password" class="mono-field" :type="showPwd ? 'text' : 'password'" placeholder="登录密码" />
          <button class="pwd-act" type="button" :title="showPwd ? '隐藏密码' : '显示密码'" @click="showPwd = !showPwd">
            <AppIcon :name="showPwd ? 'eyeOff' : 'eye'" :size="14" />
          </button>
        </div>
      </div>
    </div>

    <div class="form-group paths-group">
      <label>子路径</label>
      <button class="paths-manage" type="button" @click="showPaths = true">
        <span class="pm-sum" :class="{ empty: !activePaths.length }">{{ pathsSummary }}</span>
        <span class="pm-go">管理<AppIcon name="chevRight" :size="12" /></span>
      </button>
    </div>

    <div class="form-group notes-group">
      <label>备注</label>
      <textarea v-model="form.notes" placeholder="可选" rows="2"></textarea>
    </div>

    <PathsDialog
      v-if="showPaths"
      :paths="localPaths"
      :entry-name="form.name"
      :base-url="form.url"
      @close="showPaths = false"
      @open-url="url => emit('openUrl', url)"
    />
  </div>
</template>

<style scoped>
/* 弹窗表单控件轴：32px 输入行高，只收进本表单 */
.entry-fields input,
.entry-fields textarea {
  height: 32px;
  padding: 0 10px;
  font-size: var(--text-content);
}
/* 标签与输入内容分一档，行距留足中文上下沿。 */
.entry-fields label { font-size: var(--text-label); line-height: 20px; margin-bottom: 6px; }
.entry-fields .form-group { margin-bottom: 12px; }
.entry-fields .form-row { margin-bottom: 12px; gap: 12px; }
.entry-fields textarea { height: 58px; padding: 6px 10px; resize: none; line-height: var(--leading-copy); }
.entry-fields .cred-row { margin: 12px 0; }
.entry-fields .notes-group { margin-bottom: 0; }
.url-mono { font-family: var(--font-mono); }
.mono-field { font-family: var(--font-mono); }
.req { color: var(--danger); font-style: normal; }

/* 密码显隐自绘：WebView2 注入的原生 ::-ms-reveal 改不动样式、深色下近乎隐形，只能关掉 */
.pwd-wrap { position: relative; }
.pwd-wrap input { padding-right: 32px; }
.pwd-wrap input::-ms-reveal { display: none; }
.pwd-act {
  position: absolute; right: 4px; top: 4px; width: 24px; height: 24px; padding: 0;
  display: grid; place-items: center; border: none; background: none;
  color: var(--text-faint); border-radius: var(--radius-xs); cursor: pointer;
  transition: color var(--transition-fast), background var(--transition-fast);
}
.pwd-act:hover { color: var(--accent); background: var(--hover); }

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

/* ---------- 子路径：整块住独立弹窗，表单里只留一行入口，与 32px 字段同轴 ---------- */
.paths-manage {
  width: 100%; height: 32px; padding: 0 8px 0 11px;
  display: flex; align-items: center; gap: 8px; text-align: left;
  font-family: inherit; font-size: var(--text-sm); color: var(--text);
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm);
  cursor: pointer; transition: border-color var(--transition-fast), background var(--transition-fast);
}
.paths-manage:hover { border-color: var(--border-strong); background: var(--bg-surface) }
.paths-manage:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring) }
.pm-sum {
  flex: 1; min-width: 0; font-family: var(--font-mono); font-size: var(--text-xs);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pm-sum.empty { font-family: inherit; color: var(--text-muted) }
.pm-go {
  flex: none; display: inline-flex; align-items: center; gap: 3px;
  font-size: var(--text-xs); color: var(--text-muted);
}

.category-create { color: var(--accent); }
</style>
