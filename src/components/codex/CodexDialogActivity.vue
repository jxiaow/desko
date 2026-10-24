<script setup lang="ts">
import { computed } from 'vue'
import type { DialogItem } from '../../services/api/codexDialog'
import AppIcon from '../shared/AppIcon.vue'
const props = defineProps<{ item: DialogItem }>()
const emit = defineEmits<{ inspect: [path: string] }>()
const failed = computed(() => ['failed', 'declined'].includes(props.item.status || '') || (props.item.exitCode != null && props.item.exitCode !== 0))
const running = computed(() => props.item.status === 'inProgress')
const title = computed(() => {
  const item = props.item
  if (item.type === 'commandExecution') return item.command || '运行命令'
  if (item.type === 'fileChange') return `修改 ${item.changes?.length || 0} 个文件`
  if (item.type === 'mcpToolCall') return `${item.server} / ${item.tool}`
  if (item.type === 'webSearch') return `搜索 ${item.query || ''}`
  if (item.type === 'plan') return '执行计划'
  if (item.type === 'reasoning') return '思考摘要'
  if (item.type === 'contextCompaction') return '整理会话上下文'
  return '工具执行'
})
const body = computed(() => props.item.text || (Array.isArray(props.item.summary) ? props.item.summary.join('\n') : props.item.summary) || JSON.stringify(props.item.result || props.item.arguments || {}, null, 2))
</script>

<template>
  <details class="dialog-activity" :class="{ failed, running }">
    <summary>
      <AppIcon :name="running ? 'refresh' : failed ? 'alert' : item.type === 'commandExecution' ? 'code' : item.type === 'fileChange' ? 'file' : item.type === 'webSearch' ? 'search' : 'panel'" :size="15" />
      <code v-if="item.type === 'commandExecution'" class="command">{{ title }}</code><span v-else>{{ title }}</span>
      <small v-if="item.status || item.exitCode != null">{{ running ? '执行中' : item.status === 'declined' ? '已拒绝' : failed ? '失败' : '完成' }}</small>
      <AppIcon class="activity-chevron" name="chevRight" :size="12" />
    </summary>
    <div class="activity-content">
      <template v-if="item.type === 'commandExecution'">
        <pre class="activity-command">{{ item.command }}</pre>
        <pre>{{ item.aggregatedOutput || (running ? '等待输出…' : '命令未返回文本输出') }}</pre>
        <p v-if="item.exitCode != null" class="activity-exit">退出码 {{ item.exitCode }}</p>
      </template>
      <template v-else-if="item.type === 'fileChange'">
        <div v-for="(change, index) in item.changes" :key="index" class="activity-file">
          <button type="button" data-workspace-directory-trigger @click="emit('inspect', change.path)"><AppIcon name="file" :size="14" /><span>{{ change.path }}</span><AppIcon name="arrowRight" :size="13" /></button>
          <pre v-if="change.diff">{{ change.diff }}</pre>
          <p v-else>{{ change.kind?.type || '文件已更新' }}</p>
        </div>
      </template>
      <pre v-else>{{ body }}</pre>
    </div>
  </details>
</template>

<style scoped>
.dialog-activity { color: var(--text-secondary); font-size: var(--text-sm); margin: 4px 0; border-radius: 8px; }
summary { display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 8px 10px; cursor: pointer; list-style: none; border-radius: 8px; }
summary::-webkit-details-marker { display: none; }
summary:hover, details[open] > summary { background: var(--hover); color: var(--text); }
summary > svg { flex-shrink: 0; }
summary > span, summary > code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.command { font: 13px var(--font-mono); }
small { font-size: var(--text-xs); flex-shrink: 0; }
.activity-chevron { transition: transform 120ms ease; }
details[open] .activity-chevron { transform: rotate(90deg); }
.running summary > svg:first-child { color: var(--accent); }
.failed summary { color: var(--danger); }
.activity-content { margin: 4px 0 12px 34px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--hover); }
pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 320px; overflow: auto; margin: 0; color: var(--text); font: 13px/1.7 var(--font-mono); }
.activity-command { margin-bottom: 12px; color: var(--text-secondary); }
.activity-exit { font-size: var(--text-xs); margin: 10px 0 0; }
.activity-file + .activity-file { margin-top: 16px; }
.activity-file button { display: flex; gap: 8px; align-items: center; width: 100%; padding: 0 0 10px; background: none; border: 0; color: var(--text); font: inherit; cursor: pointer; text-align: left; }
.activity-file button span { flex: 1; overflow-wrap: anywhere; }
.activity-file p { margin: 0; }
summary:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-ring); }
@media (prefers-reduced-motion: reduce) { .activity-chevron { transition: none; } }
@media (max-width: 600px) { summary { min-height: 44px; padding-inline: 4px; gap: 8px; } .activity-content { margin-left: 0; } }
</style>
