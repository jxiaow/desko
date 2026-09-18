<script setup lang="ts">
import { reactive } from 'vue'
import AppIcon from '../shared/AppIcon.vue'
import type { Attachment } from '../../types'

const props = defineProps<{
  attachments: Attachment[]
}>()

const emit = defineEmits<{
  remove: [attachmentId: string]
}>()

// asset: 协议未在本项目开启，图片可能加载失败——失败时退回文件名色块，不留破图
const broken = reactive(new Set<string>())
</script>

<template>
  <div v-if="props.attachments.length" class="att-row">
    <div v-for="att in props.attachments" :key="att.id" class="att">
      <div class="att-thumb">
        <img
          v-if="att.mime_type.startsWith('image/') && !broken.has(att.id)"
          :src="'asset://localhost/' + att.file_path"
          :alt="att.file_name"
          @error="broken.add(att.id)"
        />
        <span v-else class="att-ext">{{ att.file_name.split('.').pop()?.slice(0, 4).toUpperCase() }}</span>
      </div>
      <div  class="att-name" :title="att.file_path">{{ att.file_name }}</div>
      <div class="att-size">{{ (att.file_size / 1024).toFixed(1) }} KB</div>
      <button  class="att-del" type="button" title="删除附件" aria-label="删除附件" @click="emit('remove', att.id)">
        <AppIcon name="x" :size="10" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.att-row {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.att {
  position: relative;
  width: 76px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  transition: all var(--transition);
}
.att:hover { border-color: var(--border-strong); box-shadow: var(--shadow-sm); }
.att-thumb {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--accent-light), var(--accent-soft));
}
.att-thumb img { width: 100%; height: 100%; object-fit: cover; }
.att-ext { font-size: 11px; font-weight: 600; color: var(--accent); letter-spacing: 0.02em; }
.att-name {
  font-size: 9.5px;
  color: var(--text-secondary);
  padding: 2px var(--space-1) 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.att-size { font-size: 9.5px; color: var(--text-muted); padding: 0 var(--space-1) var(--space-1); }
.att-del {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 4px;
  background: rgba(17, 24, 39, 0.6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition);
  padding: 0;
}
.att:hover .att-del { opacity: 1; }
.att-del:hover { background: var(--danger); }
</style>
