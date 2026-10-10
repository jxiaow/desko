<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useNotesStore } from '../../stores/notes'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{
  /** setup = 首次设全库口令；unlock = 输口令开全库；change = 换一把口令 */
  mode: 'setup' | 'unlock' | 'change'
}>()
const emit = defineEmits<{ close: []; done: [] }>()

const notesStore = useNotesStore()
const pw = ref('')
const pw2 = ref('')
const err = ref('')
const busy = ref(false)

// 设置页那条链会在同一个实例上从 unlock 续到 change，确认格必须是活的；
// 定死的 const 会让续上的改密格永远少一格，提交钮永远点不动
const needsConfirm = computed(() => props.mode !== 'unlock')
// unlock 续到 change 时把刚输的口令清掉：别让旧口令悄悄顶着"新口令"交上去
watch(() => props.mode, () => { pw.value = ''; pw2.value = ''; err.value = '' })
const MIN_LEN = 8

const title = computed(() =>
  props.mode === 'unlock' ? '解锁加密小记' : props.mode === 'setup' ? '设置小记口令' : '修改小记口令')

// 长度规矩只管立口令的时候：解锁那一格填的是既有口令，卡位数会把短口令挡在门外
const canSubmit = computed(() => {
  if (busy.value) return false
  if (props.mode === 'unlock') return pw.value.length > 0
  return [...pw.value].length >= MIN_LEN && pw.value === pw2.value
})

const run = async (fn: () => Promise<string | null>, ignoreField = false) => {
  if (busy.value) return
  if (!ignoreField && !canSubmit.value) return
  busy.value = true
  err.value = ''
  const msg = await fn()
  busy.value = false
  if (msg) {
    err.value = msg
    return
  }
  emit('done')
}

const submit = () => {
  if (props.mode === 'setup') void run(() => notesStore.setupNoteKey(pw.value))
  else if (props.mode === 'unlock') void run(() => notesStore.unlockNoteDomain(pw.value))
  else void run(() => notesStore.changeNoteKey(pw.value))
}

/** 兜底走主密钥封条：应用本来就开着，不必再输一遍，所以不受口令格子的校验拦 */
const recover = () => void run(notesStore.recoverNoteDomain, true)

useEscapeClose(() => emit('close'))
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog note-lock-dialog" role="dialog" aria-modal="true" :aria-label="title">
      <div class="dialog-header">
        <h3>{{ title }}</h3>
        <button class="dialog-close" type="button" title="关闭" @click="emit('close')">
          <AppIcon name="x" :size="16" />
        </button>
      </div>
      <div class="dialog-body" @keyup.enter="submit">
        <p v-if="props.mode === 'setup'" class="lock-tip">
          全库共用这一把口令，设一次就好：以后加密不再逐条问，解锁也是一次开全部。忘了可用主密码兜底。
        </p>
        <p v-else-if="props.mode === 'change'" class="lock-tip">
          换口令只改域密钥的封条，小记密文一条都不用动。
        </p>

        <div class="form-group">
          <label>{{ props.mode === 'unlock' ? '小记口令' : '新口令' }}</label>
          <input
            v-model="pw"
            type="password"
            :placeholder="props.mode === 'unlock' ? '当初设的那把小记口令' : `至少 ${MIN_LEN} 位，建议长短语`"
            autocomplete="off"
          />
        </div>
        <div v-if="needsConfirm" class="form-group">
          <label>确认口令</label>
          <input v-model="pw2" type="password" placeholder="再次输入" autocomplete="off" />
        </div>
        <p v-if="needsConfirm && pw2 && pw !== pw2" class="lock-error">两次口令不一致</p>

        <button v-if="props.mode === 'unlock'" class="link-btn" type="button" @click="recover">
          忘了口令？用主密码解开
        </button>
        <p v-if="err" class="lock-error">{{ err }}</p>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" type="button" @click="emit('close')">取消</button>
        <button class="btn-primary" type="button" :disabled="!canSubmit" @click="submit">
          {{ props.mode === 'unlock' ? '解锁' : props.mode === 'setup' ? '设好口令' : '改好口令' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.note-lock-dialog { width: 380px; }
.lock-tip { font-size: var(--text-sm); color: var(--text-secondary); line-height: 1.6; margin: 0 0 var(--space-3); }
.link-btn {
  border: none;
  background: none;
  color: var(--accent);
  font-size: var(--text-sm);
  cursor: pointer;
  padding: 0;
  margin-top: var(--space-2);
  font-family: inherit;
}
.link-btn:hover { text-decoration: underline; }
.lock-error { margin: var(--space-2) 0 0; font-size: var(--text-xs); color: var(--danger); }
</style>
