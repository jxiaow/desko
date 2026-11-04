<script setup lang="ts">
import type { CodexSessionRecord, CodexSessionTokenStats } from '../../services/api/codex'
import { formatTokenCount as compact, formatUsageCost, formatUsageCostDetail } from '../../utils/codexUsage'
import AppIcon from '../shared/AppIcon.vue'

defineProps<{
  session: CodexSessionRecord; updatedLabel: string
  stats?: CodexSessionTokenStats; facts: Array<[string, number]>
  ready: boolean; loading: boolean; busy: boolean; webRuntime: boolean
}>()
const emit = defineEmits<{
  copy: [value: string, label: string]; location: []; file: []; trash: []
}>()
const num = (value: number) => value.toLocaleString()
</script>

<template>
  <section class="sess-detail" aria-label="会话详情">
      <div class="sess-card">
              <h3 class="sess-section-title">会话信息</h3>
              <dl class="sess-info" aria-label="会话信息">
                <div class="sess-location">
                  <dt>工作目录</dt>
                  <dd class="sess-cwd" :class="{ mono: !!session.cwd }" :title="session.cwd">{{ session.cwd || '未知' }}</dd>
                </div>
                <div class="sess-identity">
                  <dt>会话 ID</dt>
                  <dd class="mono" :title="session.sessionId">{{ session.sessionId }}</dd>
                </div>
                <div v-if="session.updatedAt">
                  <dt>更新时间</dt>
                  <dd>{{ updatedLabel }}</dd>
                </div>
              </dl>
              <h3 class="sess-section-title usage-section-title">用量明细</h3>
              <dl v-if="facts.length" class="sess-facts" aria-label="会话用量明细">
                <div v-for="[k, v] in facts" :key="k">
                  <dt>{{ k }}</dt>
                  <dd :title="`${num(v)} Token`">{{ compact(v) }}</dd>
                </div>
                <div><dt>请求数</dt><dd>{{ num(stats!.requestCount) }}</dd></div>
                <div><dt>估算金额（USD）</dt><dd :title="formatUsageCostDetail(stats!.estimatedCostUsd)">{{ formatUsageCost(stats!.estimatedCostUsd) }}</dd></div>
              </dl>
              <p v-else-if="!ready" class="sess-no-usage" role="status">{{ loading ? '正在读取这条会话的用量…' : '用量尚未读取，请重试统计。' }}</p>
              <p v-else class="sess-no-usage">这条会话没有 Token 记录</p>
              <div class="sess-acts">
                <button class="action-btn" type="button" @click="emit('copy', session.sessionId, '会话 ID')"><AppIcon name="copy" :size="13" />复制会话 ID</button>
                <button v-if="session.cwd" class="action-btn" type="button" @click="emit('copy', session.cwd, '工作目录')"><AppIcon name="copy" :size="13" />复制工作目录</button>
                <button
                  class="action-btn"
                  type="button"
                  :disabled="busy"
                  v-if="!webRuntime"
                  @click="emit('location')"
                >
                  <AppIcon name="folder" :size="13" />打开位置
                </button>
                <button
                  class="action-btn"
                  type="button"
                  :disabled="busy"
                  @click="emit('file')"
                >
                  <AppIcon name="file" :size="13" />{{ webRuntime ? '查看会话文件' : '打开会话文件' }}
                </button>
                <button
                  class="action-btn danger trash-btn"
                  type="button"
                  :disabled="busy"
                  @click="emit('trash')"
                >
                  <AppIcon name="trash" :size="13" />移到回收站
                </button>
              </div>
      </div>
  </section>
</template>

<style scoped>
.sess-detail { min-width: 0; margin: 0 20px; border-top: 1px solid var(--border); }
.sess-card { padding: 18px 0 20px; }
.sess-section-title { margin: 0 0 14px; font-size: var(--text-sm); font-weight: 600; color: var(--text-secondary); }
.usage-section-title { margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--border); }
.sess-info { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin: 0; }
.sess-info > div { min-width: 0; display: grid; gap: 4px; }
.sess-info dt, .sess-facts dt { font-size: var(--text-xs); color: var(--text-muted); line-height: 1.5; }
.sess-info dd, .sess-facts dd { min-width: 0; margin: 0; font-size: var(--text-sm); line-height: 1.6; color: var(--text-secondary); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.mono { font-family: var(--font-mono); }
.sess-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 0; }
.sess-facts > div { min-width: 0; display: grid; gap: 4px; }
.sess-facts dd { font-size: var(--text-base); font-weight: 500; }
.sess-no-usage { font-size: var(--text-xs); color: var(--text-muted); }
.sess-acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--border); }
.sess-acts .trash-btn { margin-left: auto; }
@container codex-sessions (max-width: 600px) {
  .sess-info { grid-template-columns: 1fr; }
  .sess-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sess-acts .trash-btn { margin-left: 0; }
}
@media (max-width: 600px) { .sess-acts .action-btn { min-height: 40px; } }
</style>
