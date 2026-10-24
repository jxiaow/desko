<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { codexApi, type CodexAccount } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import { refreshAccounts } from '../../services/codexState'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{ account: CodexAccount }>()
const emit = defineEmits<{ close: [] }>()
const toastStore = useToastStore()
const confirmStore = useConfirmStore()
useEscapeClose(close)
let active = true
onUnmounted(() => { active = false })

const name = ref(props.account.account_name ?? '')
const note = ref(props.account.account_note ?? '')
const tagsText = ref((props.account.tags ?? []).join('，'))
const busy = ref(false)

/** 只有 API Key 账号能换凭据；密钥为空表示这次不动它，Base URL 预填当前值免被清空 */
const isApiKey = computed(() => props.account.auth_mode === 'apikey')
const newKey = ref('')
const baseUrl = ref(props.account.api_base_url ?? '')

const tagList = computed(() =>
  tagsText.value
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
)

function close() {
  if (!busy.value) emit('close')
}

function save() {
  if (!active || busy.value) return
  const key = isApiKey.value ? newKey.value.trim() : ''
  const url = baseUrl.value.trim()
  if (isApiKey.value && !key && url !== (props.account.api_base_url ?? '').trim()) {
    toastStore.showToast('修改接口地址时请重新填写 API Key', 'error')
    return
  }
  const savedName = name.value.trim()
  const savedNote = note.value.trim()
  const savedTags = [...tagList.value]

  const apply = async () => {
    if (!active || busy.value) return
    busy.value = true
    let id = props.account.id
    try {
      if (key) {
        const updated = await codexApi.updateApiKey(id, key, url)
        if (!active) return
        // 换密钥会生成新 ID，后续档案写入必须跟到新 ID。
        id = updated.id
      }
      await codexApi.setName(id, savedName)
      if (!active) return
      await codexApi.setNote(id, savedNote)
      if (!active) return
      await codexApi.setTags(id, savedTags)
      if (!active) return
      await refreshAccounts()
      if (!active) return
      toastStore.showToast(key ? '账号凭据已更新' : '账号信息已保存')
      emit('close')
    } catch (e) {
      if (active) toastStore.showToast(errText(e), 'error')
    } finally {
      busy.value = false
    }
  }

  if (key) {
    confirmStore.showConfirm(
      '更换 API Key',
      `更换「${props.account.email}」的 API Key？将重建账号档案；若为当前账号，也会更新 Codex 凭据。请先退出使用此账号的 Codex。`,
      () => void apply(),
    )
  } else void apply()
}
</script>

<template>
  <div class="dialog-overlay" @click.self="close">
    <div class="dialog edit-dialog" role="dialog" aria-modal="true" aria-label="编辑账号信息">
      <div class="dialog-header">
        <h3>编辑账号信息</h3>
        <span class="sub mono" :title="account.email">{{ account.email }}</span>
        <button class="dialog-close" type="button" title="关闭" :disabled="busy" @click="close">
          <AppIcon name="x" :size="16" />
        </button>
      </div>
      <div class="dialog-body">
        <div class="form-group">
          <label for="cx-name">显示名称</label>
          <input id="cx-name" v-model="name" type="text" maxlength="40" placeholder="留空则显示邮箱" @keyup.enter="save" />
        </div>
        <div class="form-group">
          <label for="cx-tags">标签（逗号分隔）</label>
          <input id="cx-tags" v-model="tagsText" type="text" placeholder="如 主力，工作，备用" />
        </div>
        <div class="form-group">
          <label for="cx-note">备注</label>
          <textarea id="cx-note" v-model="note" class="note-box" :rows="isApiKey ? 3 : 4" placeholder="订阅档位、到期时间、注意事项…" />
        </div>
        <p v-if="tagList.length" class="tag-preview">
          <span v-for="t in tagList" :key="t" class="chip">{{ t }}</span>
        </p>

        <div v-if="isApiKey" class="key-box">
          <div class="form-group">
            <label for="cx-newkey">新 API Key</label>
            <input id="cx-newkey" v-model="newKey" class="mono" type="password" spellcheck="false" placeholder="sk-…，留空不改" />
          </div>
          <div class="form-group">
            <label for="cx-baseurl">接口地址</label>
            <input id="cx-baseurl" v-model="baseUrl" class="mono" type="text" spellcheck="false" placeholder="https://…/v1" />
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" type="button" :disabled="busy" @click="close">取消</button>
        <button class="btn-primary" type="button" :disabled="busy" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.edit-dialog { width: 460px; }
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: normal; }

.note-box { line-height: 1.7; resize: vertical }
.tag-preview { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0 }

/* 凭据区与元信息区之间要有肉眼可见的分界：两件事重量不同 */
.key-box {
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-strong, var(--border));
}
</style>
