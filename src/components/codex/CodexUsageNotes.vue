<script setup lang="ts">
import AppIcon from '../shared/AppIcon.vue'
withDefaults(defineProps<{ scope?: 'sessions' | 'usage' }>(), { scope: 'usage' })
</script>

<template>
  <details class="usage-notes">
    <summary><AppIcon name="info" :size="13" />统计说明<AppIcon class="notes-caret" name="chevDown" :size="12" /></summary>
    <div class="notes-body">
      <p v-if="scope === 'sessions'">仅统计默认目录中筛选的会话，不含回收站。其他目录及 WSL 请查看「用量」页。</p>
      <p v-else>统计默认目录、启用自动统计的 WSL 及手动添加的目录，不含回收站。</p>
      <p>输入含缓存，输出含推理。请求数按 Token 增量记录估算，不含未记录用量的请求。</p>
      <p>完整日志副本会去重；截断或重放的历史可能重复计数，缺失日志无法补全。</p>
      <p>金额按 API 单价估算（USD），不代表订阅扣费；未知模型未定价。</p>
      <p>金额明细分别四舍五入，合计可能有尾差；悬停金额可核对更高精度。</p>
    </div>
  </details>
</template>

<style scoped>
.usage-notes { min-width: 0; max-width: 100%; font-size: var(--text-description); color: var(--text-secondary); }
summary { display: flex; align-items: center; gap: 6px; width: fit-content; max-width: 100%; padding: 4px 0; font-weight: var(--weight-medium); line-height: var(--leading-ui); cursor: pointer; list-style: none; border-radius: 4px; }
summary::-webkit-details-marker { display: none; }
summary:hover { color: var(--text); }
summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
summary svg { flex-shrink: 0; }
.notes-caret { transition: transform var(--transition); }
.usage-notes[open] .notes-caret { transform: rotate(180deg); }
.notes-body { display: grid; gap: 6px; min-width: 0; max-width: 56em; padding: 8px 0 4px; line-height: var(--leading-copy); overflow-wrap: anywhere; }
p { margin: 0; }
</style>
