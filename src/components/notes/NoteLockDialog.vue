<script setup lang="ts">
import { computed, ref } from 'vue'
import { useNotesStore } from '../../stores/notes'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{
  noteId: string
  /** set = 给明文小记设口令上锁；unlock = 输口令（或主密码兜底）取回明文 */
  mode: 'set' | 'unlock'
}>()
const emit = defineEmits<{ close: []; done: [] }>()

const notesStore = useNotesStore()
const pw = ref('')
const pw2 = ref('')
const err = ref('')
const busy = ref(false)
const useMaster = ref(false)
const masterPw = ref('')

const canSubmit = computed(() => {
  if (busy.value) return false
  if (props.mode === 'set') return pw.value.length >= 4 && pw.value === pw2.value
  return useMaster.value ? masterPw.value.length > 0 : pw.value.length > 0
})

const submit = async () => {
  if (!canSubmit.value) return
  busy.value = true
  err.value = ''
  const msg = props.mode === 'set'
    ? await notesStore.lockNote(props.noteId, pw.value)
    : useMaster.value
      ? await notesStore.unlockNoteByMaster(props.noteId, masterPw.value)
      : await notesStore.unlockNote(props.noteId, pw.value)
  busy.value = false
  if (msg) {
    err.value = msg
    return
  }
  emit('done')
}

useEscapeClose(() => emit('close'))
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog note-lock-dialog" role="dialog" aria-modal="true"
      :aria-label="props.mode === 'set' ? '加密小记' : '解锁加密小记'">
      <div class="dialog-header">
        <h3>{{ props.mode === 'set' ? '加密这条小记' : '解锁加密小记' }}</h3>
        <button class="dialog-close" type="button" title="关闭" @click="emit('close')">
          <AppIcon name="x" :size="16" />
        </button>
      </div>
      <div class="dialog-body" @keyup.enter="submit">
        <template v-if="props.mode === 'set'">
          <p class="lock-tip">正文将用独立口令加密，应用一锁就重新锁上。忘了口令可用主密码解封。</p>
          <div class="form-group">
            <label>加密口令</label>
            <input v-model="pw" type="password" placeholder="至少 4 位" />
          </div>
          <div class="form-group">
            <label>确认口令</label>
            <input v-model="pw2" type="password" placeholder="再次输入" />
          </div>
          <p v-if="pw2 && pw !== pw2" class="lock-error">两次口令不一致</p>
        </template>
        <template v-else-if="!useMaster">
          <div class="form-group">
            <label>小记口令</label>
            <input v-model="pw" type="password" placeholder="加密这条小记时设的口令" />
          </div>
          <button class="link-btn" type="button" @click="useMaster = true; err = ''">忘了口令？用主密码解封</button>
        </template>
        <template v-else>
          <p class="lock-tip">输入应用主密码解封这一条，只解这一条。</p>
          <div class="form-group">
            <label>主密码</label>
            <input v-model="masterPw" type="password" />
          </div>
          <button class="link-btn" type="button" @click="useMaster = false; err = ''">返回用小记口令</button>
        </template>
        <p v-if="err" class="lock-error">{{ err }}</p>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" type="button" @click="emit('close')">取消</button>
        <button class="btn-primary" type="button" :disabled="!canSubmit" @click="submit">
          {{ props.mode === 'set' ? '加密' : '解锁' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.note-lock-dialog { width: 380px; }
.lock-tip { font-size: 12.5px; color: var(--text-secondary); line-height: 1.6; margin: 0 0 var(--space-3); }
.link-btn {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 12.5px;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}
.link-btn:hover { text-decoration: underline; }
.lock-error { margin: var(--space-2) 0 0; font-size: 12px; color: var(--danger); }
</style>
