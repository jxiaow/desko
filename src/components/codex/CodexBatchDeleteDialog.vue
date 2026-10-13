<script setup lang="ts">
import { computed } from 'vue'
import {
  abandonBatchDelete,
  batchDeleteEmailOf,
  batchDeleteErrors,
  batchDeleteJob,
  closeBatchDeleteDialog,
  pauseBatchDelete,
  resumeBatchDelete,
  retryFailedBatchDelete,
} from '../../services/codexState'
import { useToastStore } from '../../stores/toast'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'

const toast = useToastStore()
/** 关掉是收窗不是收作业：终态才顺手把 jobId 与盘快照清掉 */
useEscapeClose(() => void closeBatchDeleteDialog())

const job = computed(() => batchDeleteJob.value)
const errors = batchDeleteErrors

const pct = computed(() => {
  const j = job.value
  if (!j || j.total <= 0) return '0%'
  return `${Math.min(100, Math.round((j.completed / j.total) * 100))}%`
})

/** completed 是「已处理」计数（失败也 +1），所以这里只说处理了多少，不说删了多少 */
const stateLine = computed(() => {
  switch (job.value?.status) {
    case 'paused':
      return '已暂停。按下「继续」接着删剩下的，正在跑的那一条不会被打断。'
    case 'completed':
      return '这一批已经处理完，删掉的账号都进了回收站，随时能原样恢复。'
    case 'failed':
      return '这一批跑完了，但有几条没删掉。可以只重试失败的那几条。'
    default:
      return '正在逐条删除，每一条都会先留一份加密底再移出账号列表。'
  }
})

async function onAbandon() {
  toast.showToast(await abandonBatchDelete())
}
</script>

<template>
  <div v-if="job" class="dialog-overlay" @click.self="closeBatchDeleteDialog()">
    <div
      class="dialog batch-delete-dialog"
      :data-status="job.status"
      role="dialog"
      aria-modal="true"
      aria-label="批量删除账号"
    >
      <div class="dialog-header">
        <h3>批量删除账号</h3>
        <span class="sub">共 {{ job.total }} 条</span>
        <button class="dialog-close" type="button" title="关闭" @click="closeBatchDeleteDialog()">
          <AppIcon name="x" :size="16" />
        </button>
      </div>
      <div class="dialog-body">
        <p class="bd-count">
          已处理 <span class="num bd-done">{{ job.completed }}</span> / <span class="num bd-total">{{ job.total }}</span> 条
          <span v-if="job.failed" class="bd-fail">· 失败 <span class="num bad">{{ job.failed }}</span> 条</span>
        </p>
        <div class="bd-bar" role="progressbar" :aria-valuenow="job.completed" :aria-valuemax="job.total">
          <i :style="{ width: pct }"></i>
        </div>
        <p class="lead">{{ stateLine }}</p>

        <div class="bd-details">
          <div class="bd-details-title">失败明细</div>
          <div v-if="!errors.length" class="bd-empty">这一轮还没有失败</div>
          <div v-else class="bd-list">
            <div v-for="(row, i) in errors" :key="`${row.accountId}-${i}`" class="bd-row">
              <span class="bd-status">失败</span>
              <span class="bd-mail">{{ batchDeleteEmailOf(row.accountId) }}</span>
              <span class="bd-err">{{ row.error }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <template v-if="job.status === 'paused'">
          <button class="btn-danger" type="button" @click="onAbandon">放弃任务</button>
          <button class="btn-primary" type="button" @click="resumeBatchDelete()">继续</button>
        </template>
        <template v-else-if="job.status === 'failed'">
          <button class="btn-secondary" type="button" @click="closeBatchDeleteDialog()">完成</button>
          <button class="btn-primary" type="button" @click="retryFailedBatchDelete()">重试失败</button>
        </template>
        <button
          v-else-if="job.status === 'completed'"
          class="btn-secondary"
          type="button"
          @click="closeBatchDeleteDialog()"
        >
          关闭
        </button>
        <button v-else class="btn-primary" type="button" @click="pauseBatchDelete()">暂停</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 定高不随内容收：失败明细会一条条长出来，壳跟着涨就把进度条和底栏一起顶走 */
.batch-delete-dialog {
  width: 460px;
  height: min(480px, 84vh);
  --font-mono: Consolas, 'Cascadia Mono', monospace;
}
.num { font-family: var(--font-mono); font-weight: 600; color: var(--text) }
.num.bad { color: var(--danger) }

.bd-count {
  margin: 0;
  font-size: var(--text-xs);
  line-height: 18px;
  color: var(--text-secondary);
}
.bd-fail { margin-left: 6px; color: var(--danger) }

.bd-bar {
  margin-top: 10px;
  height: 6px;
  border-radius: 3px;
  background: var(--fill);
  overflow: hidden;
}
.bd-bar i { display: block; height: 100%; border-radius: 3px; background: var(--accent) }

.bd-details { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border) }
.bd-details-title {
  font-size: var(--text-2xs);
  font-weight: 600;
  letter-spacing: .04em;
  color: var(--text-muted);
}
.bd-empty { margin-top: 8px; font-size: var(--text-xs); color: var(--text-muted) }
.bd-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  max-height: 210px;
  overflow-y: auto;
  scrollbar-gutter: stable;
}
.bd-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-height: 30px;
  padding: 5px 0;
  border-bottom: 1px solid var(--border);
  font-size: var(--text-xs);
  line-height: 18px;
}
.bd-row:last-child { border-bottom: none }
.bd-status {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--danger-soft);
  font-size: var(--text-2xs);
  font-weight: 600;
  line-height: 18px;
  color: var(--danger);
}
.bd-mail {
  flex-shrink: 0;
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.bd-err { min-width: 0; flex: 1; color: var(--text-secondary) }
</style>
