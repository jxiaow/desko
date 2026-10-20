<script setup lang="ts">
import AppIcon from '../shared/AppIcon.vue'
</script>

<template>
  <details class="usage-notes">
    <summary><AppIcon name="info" :size="13" />统计说明<AppIcon class="notes-caret" name="chevDown" :size="12" /></summary>
    <div class="notes-body">
      <p>范围：默认目录、启用自动统计时识别的 WSL 目录及手动添加的目录，不含回收站。</p>
      <p>输入含缓存，推理计入输出；请求按有用量的 Token 记录去重。</p>
      <p>金额按模型 API 单价估算（USD），不代表订阅扣费；未知模型显示“未定价”。</p>
    </div>
  </details>
</template>

<style scoped>
.usage-notes { min-width: 0; max-width: 100%; font-size: var(--text-xs); color: var(--text-muted); }
summary { display: flex; align-items: center; gap: 6px; width: fit-content; max-width: 100%; padding: 4px 0; cursor: pointer; list-style: none; border-radius: 4px; }
summary::-webkit-details-marker { display: none; }
summary:hover { color: var(--text-secondary); }
.notes-caret { transition: transform var(--transition); }
.usage-notes[open] .notes-caret { transform: rotate(180deg); }
.notes-body { display: grid; gap: 4px; max-width: 72ch; padding: 6px 0 4px; line-height: 1.6; overflow-wrap: anywhere; }
p { margin: 0; }
</style>
