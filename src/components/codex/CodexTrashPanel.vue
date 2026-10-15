<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { CodexRecycledAccount, CodexTrashedSessionRecord } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import {
  deleteRecycledAccount,
  deleteTrashedSession,
  emptyRecycledAccounts,
  emptySessionTrash,
  loadRecycled,
  loadTrash,
  recycledAccounts,
  recycledBusy,
  recycledError,
  recycledLoaded,
  restoreRecycledAccount,
  restoreTrashedSession,
  trashBusy,
  trashError,
  trashLoaded,
  trashSessions,
} from '../../services/codexState'
import { useConfirmStore } from '../../stores/confirm'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../shared/AppIcon.vue'

const toastStore = useToastStore()
const confirmStore = useConfirmStore()
let active = true
onUnmounted(() => { active = false })

/** 两份留底清单都是本地目录扫描：进这一档才扫，扫过留在内存 */
onMounted(() => {
  if (!trashLoaded.value) void loadTrash()
  if (!recycledLoaded.value) void loadRecycled()
})

const busyId = ref('')

async function run(id: string, fn: () => Promise<string>) {
  if (!active || busyId.value) return
  busyId.value = id
  try {
    const message = await fn()
    if (active) toastStore.showToast(message)
  } catch (e) {
    if (active) toastStore.showToast(errText(e), 'error')
  } finally {
    busyId.value = ''
  }
}

const scanning = computed(() => (trashBusy.value || recycledBusy.value) && !rows.value)
const rows = computed(() => trashSessions.value.length + recycledAccounts.value.length)
/** 两次扫描各说各的失败，一行了断：有清单就不抢戏，全空才占位 */
const errorText = computed(() => [recycledError.value, trashError.value].filter(Boolean).join('；'))
const failed = computed(() => !rows.value && !!errorText.value)

function reloadBoth(): void {
  void loadRecycled()
  void loadTrash()
}

/** 后端没标题时把整条 UUID 原样填进 title，这里与「会话」档同一读法收成短 ID */
function labelOf(s: CodexTrashedSessionRecord): string {
  const t = s.title.trim()
  return !t || t === s.sessionId ? `${s.sessionId.slice(0, 8)}…` : t
}

function askRestore(s: CodexTrashedSessionRecord) {
  confirmStore.showConfirm(
    '恢复会话',
    `把「${labelOf(s)}」的会话文件写回官方 Codex 目录，并补回会话索引？Codex 若在运行，需重启后其侧栏才显示。`,
    () => {
      void run(s.sessionId, () => restoreTrashedSession(s.sessionId))
    },
  )
}

function askDelete(s: CodexTrashedSessionRecord) {
  confirmStore.showConfirm(
    '彻底删除',
    `删除「${labelOf(s)}」在 desko 里的留底？官方目录已经不含这条会话，这一步之后无法再恢复。`,
    () => {
      void run(s.sessionId, () => deleteTrashedSession(s.sessionId))
    },
  )
}

function askEmptyTrash() {
  const n = trashSessions.value.length
  confirmStore.showConfirm(
    '清空会话留底',
    `彻底删除回收站里的 ${n} 条会话留底？官方目录这时候已经不含这些会话，这一步之后无法再恢复。`,
    () => {
      void run('sessions', emptySessionTrash)
    },
  )
}

/** 账号留底那一行先摆名字，没名字才退回邮箱 */
function accLabel(r: CodexRecycledAccount): string {
  return r.account_name?.trim() || r.email
}

function askRestoreAccount(r: CodexRecycledAccount) {
  confirmStore.showConfirm(
    '恢复账号',
    `把「${accLabel(r)}」写回 Desko 的账号列表？官方凭据从头到尾没被动过，恢复只是让这条号重新可选。`,
    () => {
      void run(r.id, () => restoreRecycledAccount(r.id))
    },
  )
}

function askDeleteAccount(r: CodexRecycledAccount) {
  confirmStore.showConfirm(
    '彻底删除',
    `删除「${accLabel(r)}」在 desko 里的加密留底？这一步之后无法再恢复。`,
    () => {
      void run(r.id, () => deleteRecycledAccount(r.id))
    },
  )
}

function askEmptyRecycled() {
  const n = recycledAccounts.value.length
  confirmStore.showConfirm(
    '清空账号留底',
    `彻底删除回收站里的 ${n} 条账号留底？这一步之后无法再恢复。`,
    () => {
      void run('accounts', emptyRecycledAccounts)
    },
  )
}

const pad = (n: number) => String(n).padStart(2, '0')

function whenText(sec: number | null | undefined): string {
  if (!sec) return '删除时间未知'
  const d = new Date(sec * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

/** 目录末段当项目名，与「会话」档的分组标题同一个口径 */
function projectName(s: CodexTrashedSessionRecord): string {
  const seg = s.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
  return seg.length ? seg[seg.length - 1] : '工作目录未知'
}
</script>

<template>
  <div class="thr-view">
    <div v-if="scanning" class="rcard-list" aria-hidden="true">
      <div class="rcard thr-sk" v-for="n in 2" :key="n">
        <span class="skeleton-block"></span>
        <span class="skeleton-line w40"></span>
      </div>
    </div>

    <div v-else-if="failed" class="rcard empty-state">
      <div class="empty-icon"><AppIcon name="alert" :size="24" /></div>
      <div class="empty-title">读不到回收站清单</div>
      <div class="empty-desc" :title="errorText">{{ errorText }}</div>
      <button class="action-btn primary" type="button" @click="reloadBoth">重试</button>
    </div>

    <div v-else-if="!rows" class="rcard empty-state">
      <div class="empty-icon"><AppIcon name="trash" :size="24" /></div>
      <div class="empty-title">回收站是空的</div>
      <div class="empty-desc">删掉的 Codex 账号会自动留一份加密底；会话要在「会话」档展开一条，点「移到回收站」才留底</div>
    </div>

    <template v-else>
      <section v-if="recycledAccounts.length" class="thr-sec">
        <div class="thr-sec-head">
          <span class="thr-sec-title">账号留底</span>
          <span class="thr-sec-num mono-ish">{{ recycledAccounts.length }}</span>
          <button
            class="action-btn danger thr-sec-act"
            type="button"
            :disabled="!!busyId"
            @click="askEmptyRecycled()"
          >
            <AppIcon name="trash" :size="12" />清空
          </button>
        </div>
        <div class="rcard-list">
          <div v-for="r in recycledAccounts" :key="r.id" class="rcard thr-row" :data-rid="r.id">
            <span class="thr-l1">
              <span class="thr-title" :title="r.email">{{ accLabel(r) }}</span>
              <span class="badge off">{{ r.plan_type?.trim() || '档位未知' }}</span>
            </span>
            <span class="thr-l2">
              <span>{{ whenText(r.deleted_at) }} 删除</span>
              <!-- 没名字的留底标题就是邮箱，第二行再摆一遍是复读 -->
              <span v-if="r.account_name?.trim()" class="thr-sub" :title="r.account_id">{{ r.email }}</span>
            </span>
            <span class="thr-acts">
              <button
                class="action-btn"
                type="button"
                :disabled="!!busyId"
                @click="askRestoreAccount(r)"
              >
                <AppIcon name="undo" :size="13" />恢复
              </button>
              <button
                class="action-btn danger"
                type="button"
                :disabled="!!busyId"
                @click="askDeleteAccount(r)"
              >
                <AppIcon name="trash" :size="13" />彻底删除
              </button>
            </span>
          </div>
        </div>
      </section>

      <section v-if="trashSessions.length" class="thr-sec">
        <div class="thr-sec-head">
          <span class="thr-sec-title">会话留底</span>
          <span class="thr-sec-num mono-ish">{{ trashSessions.length }}</span>
          <button
            class="action-btn danger thr-sec-act"
            type="button"
            :disabled="!!busyId"
            @click="askEmptyTrash()"
          >
            <AppIcon name="trash" :size="12" />清空
          </button>
        </div>
        <div class="rcard-list">
          <div v-for="s in trashSessions" :key="s.sessionId" class="rcard thr-row" :data-sid="s.sessionId">
            <span class="thr-l1">
              <span class="thr-title" :title="s.title.trim() || s.sessionId">{{ labelOf(s) }}</span>
              <span class="badge off">{{ projectName(s) }}</span>
            </span>
            <span class="thr-l2">
              <span>{{ whenText(s.deletedAt) }} 删除</span>
              <span class="mono-ish">{{ sizeText(s.sizeBytes) }}</span>
            </span>
            <span class="thr-acts">
              <button
                class="action-btn"
                type="button"
                :disabled="!!busyId"
                @click="askRestore(s)"
              >
                <AppIcon name="undo" :size="13" />恢复
              </button>
              <button
                class="action-btn danger"
                type="button"
                :disabled="!!busyId"
                @click="askDelete(s)"
              >
                <AppIcon name="trash" :size="13" />彻底删除
              </button>
            </span>
          </div>
        </div>
      </section>

      <p class="page-note">
        <AppIcon name="info" :size="13" />
        两份留底都存放在 desko 的数据目录：账号留底是加密快照，会话留底是原文件副本。
        恢复账号只把它写回 Desko 的列表，恢复会话才会往官方目录写文件。
      </p>
    </template>
  </div>
</template>

<style scoped>
.page-note { font-size: var(--text-xs); }
.thr-sk {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 64px;
  padding: 0 14px;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}
/* 两段留底住在同一档里：小标题一行 + 细线分行的行卡，不做卡中卡 */
.thr-sec + .thr-sec {
  margin-top: var(--space-4);
}
.thr-sec-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 2px var(--space-2);
  border-bottom: 1px solid var(--border);
}
.thr-sec-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-muted);
}
.thr-sec-num {
  font-size: var(--text-xs);
  color: var(--text-faint);
}
.thr-sec-act {
  margin-left: auto;
}
.thr-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 64px;
  padding: 0 14px;
}
.thr-l1 {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
}
.thr-title {
  min-width: 0;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 时间与体积住在第二行，动作钉在右侧：一行的三件事不能抢同一段宽度 */
.thr-l2 {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 2px;
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-align: right;
}
.thr-sub {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-faint);
}
.thr-acts {
  display: flex;
  flex-shrink: 0;
  gap: var(--space-2);
}
.mono-ish {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: normal;
}
</style>
