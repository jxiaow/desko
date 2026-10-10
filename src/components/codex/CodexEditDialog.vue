<script setup lang="ts">
import { computed, ref } from 'vue'
import { codexApi, type CodexAccount } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import { refreshAccounts } from '../../services/codexState'
import { useToastStore } from '../../stores/toast'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{ account: CodexAccount }>()
const emit = defineEmits<{ close: [] }>()
const toastStore = useToastStore()
useEscapeClose(() => emit('close'))

const name = ref(props.account.account_name ?? '')
const note = ref(props.account.account_note ?? '')
const tagsText = ref((props.account.tags ?? []).join('，'))
const busy = ref(false)

const tagList = computed(() =>
  tagsText.value
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
)

async function save() {
  if (busy.value) return
  busy.value = true
  const id = props.account.id
  try {
    await codexApi.setName(id, name.value.trim())
    await codexApi.setNote(id, note.value.trim())
    await codexApi.setTags(id, tagList.value)
    await refreshAccounts()
    toastStore.showToast('账号信息已保存')
    emit('close')
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog edit-dialog" role="dialog" aria-modal="true" aria-label="编辑账号信息">
      <div class="dialog-header">
        <h3>编辑账号信息</h3>
        <button class="dialog-close" type="button" title="关闭" @click="emit('close')">
          <AppIcon name="x" :size="16" />
        </button>
      </div>
      <div class="dialog-body">
        <div class="mail mono" :title="account.email">{{ account.email }}</div>
        <label class="field">
          <span class="field-label">显示名称</span>
          <input v-model="name" class="input" type="text" maxlength="40" placeholder="留空则显示邮箱" @keyup.enter="save" />
        </label>
        <label class="field">
          <span class="field-label">标签（逗号分隔）</span>
          <input v-model="tagsText" class="input" type="text" placeholder="如 主力，工作，备用" />
        </label>
        <label class="field">
          <span class="field-label">备注</span>
          <textarea v-model="note" class="input note-box" rows="4" placeholder="订阅档位、到期时间、注意事项…" />
        </label>
        <p v-if="tagList.length" class="tag-preview">
          <span v-for="t in tagList" :key="t" class="chip">{{ t }}</span>
        </p>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" type="button" @click="emit('close')">取消</button>
        <button class="btn-primary" type="button" :disabled="busy" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.edit-dialog { width: 460px; --font-mono: Consolas, 'Cascadia Mono', monospace; }
.mono { font-family: var(--font-mono); }

.mail {
  font-size: var(--text-xs);
  color: var(--text-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.field { display: flex; flex-direction: column; gap: 6px; margin-top: 12px }
.field-label { font-size: var(--text-xs); color: var(--text-secondary) }
.field .input { height: 28px }
.note-box { height: auto; padding: 8px 10px; line-height: 1.7; resize: vertical; font-family: inherit }
.tag-preview { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0 }
</style>
