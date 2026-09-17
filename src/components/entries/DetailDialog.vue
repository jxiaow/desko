<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import type { Entry } from '../../types'

defineProps<{
  entry: Entry
  visiblePasswords: Record<string, boolean>
  passwordCache: Record<string, { value: string; ts: number }>
}>()

const emit = defineEmits<{
  close: []
  edit: [entry: Entry]
  delete: [entry: Entry]
  togglePassword: [id: string]
  copyPassword: [id: string]
  copyText: [text: string, label: string]
  openUrl: [url: string]
}>()

const getAvatarClass = (id: string) => {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash)
  }
  return `c${Math.abs(hash) % 6}`
}

let handleEscape: ((e: KeyboardEvent) => void) | null = null

onMounted(() => {
  handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') emit('close')
  }
  window.addEventListener('keydown', handleEscape)
})

onUnmounted(() => {
  if (handleEscape) window.removeEventListener('keydown', handleEscape)
})
</script>

<template>
  <Transition name="dialog">
    <div v-if="true" class="dialog-overlay">
    <div class="dialog detail-dialog">
      <div class="dialog-header">
        <div class="detail-header-left">
          <div class="card-avatar" :class="getAvatarClass(entry.id)" style="width:38px;height:38px;font-size:15px;border-radius:10px;">
            {{ entry.name.charAt(0) }}
          </div>
          <div>
            <h3>{{ entry.name }}</h3>
            <span class="card-category">{{ entry.category || '未分类' }}</span>
          </div>
        </div>
        <button class="dialog-close" @click="emit('close')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="dialog-body">
        <div class="detail-section">
          <div class="detail-row">
            <svg class="detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <span class="detail-label">网址</span>
            <a v-if="entry.url" class="detail-value detail-link" @click.prevent="emit('openUrl', entry.url!)">{{ entry.url }}</a>
            <span v-else class="detail-value">-</span>
            <button v-if="entry.url" class="detail-action-btn" @click="emit('openUrl', entry.url!)" title="打开网址">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </button>
          </div>
        </div>
        <div class="detail-section">
          <div class="detail-row">
            <svg class="detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span class="detail-label">用户名</span>
            <span class="detail-value">{{ entry.username || '' }}</span>
            <button v-if="entry.username" class="detail-action-btn" @click="emit('copyText', entry.username, '用户名')" title="复制用户名">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <span class="detail-action-spacer" v-else></span>
          </div>
        </div>
        <div class="detail-section">
          <div class="detail-row">
            <svg class="detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span class="detail-label">密码</span>
            <span class="detail-value" :class="{ masked: !visiblePasswords[entry.id] }">
              {{ visiblePasswords[entry.id] ? (passwordCache[entry.id]?.value || '') : '' }}
            </span>
            <template v-if="passwordCache[entry.id]?.value">
              <button class="detail-action-btn toggle" @click="emit('togglePassword', entry.id)" :title="visiblePasswords[entry.id] ? '隐藏密码' : '显示密码'">
                <svg v-if="!visiblePasswords[entry.id]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
              <button class="detail-action-btn" @click="emit('copyPassword', entry.id)" title="复制密码">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </template>
            <span class="detail-action-spacer" v-else></span>
          </div>
        </div>
        <div v-if="entry.notes" class="detail-section">
          <div class="detail-row notes-row">
            <svg class="detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            <span class="detail-label">备注</span>
            <span class="detail-value detail-notes-full">{{ entry.notes }}</span>
          </div>
        </div>
        <div v-if="entry.paths && entry.paths.length > 0" class="detail-section">
          <div class="detail-row">
            <svg class="detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <span class="detail-label">路径</span>
            <span class="detail-value">{{ entry.paths.length }} 个</span>
          </div>
          <div class="paths-list">
            <a
              class="path-item"
              v-for="path in entry.paths"
              :key="path.id"
              @click.stop.prevent="emit('openUrl', entry.url ? entry.url.replace(/\/$/, '') + (path.path.startsWith('/') ? path.path : '/' + path.path) : path.path)"
              :title="path.label || path.path"
            >
              <span class="path-label" v-if="path.label">{{ path.label }}</span>
              <span class="path-path">{{ path.path }}</span>
              <svg class="path-open-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" @click="emit('edit', entry); emit('close')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> 编辑</button>
        <button class="btn-danger" @click="emit('delete', entry); emit('close')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> 删除</button>
      </div>
    </div>
    </div>
  </Transition>
</template>

<style scoped>
.detail-dialog { width: 460px; }
.detail-header-left { display: flex; align-items: center; gap: 12px; }
.detail-header-left h3 { margin: 0 0 3px 0; font-size: 16px; }
.detail-section { margin-bottom: 4px; }
.detail-section + .detail-section { border-top: 1px solid var(--border); padding-top: 6px; }
.detail-row { display: flex; align-items: center; gap: 6px; padding: 6px 0; }
.notes-row { align-items: flex-start; }
.detail-icon { width: 14px; height: 14px; color: var(--text-muted); flex-shrink: 0; }
.detail-label { font-size: 11px; color: var(--text-muted); width: 36px; flex-shrink: 0; }
.detail-action-spacer { width: 24px; flex-shrink: 0; }
.detail-value { flex: 1; font-size: 12px; color: var(--text); word-break: break-all; min-width: 0; }
.detail-value.masked { letter-spacing: 2px; color: var(--text-muted); }
.detail-link { color: var(--accent); cursor: pointer; text-decoration: none; }
.detail-link:hover { text-decoration: underline; }
.detail-notes-full { white-space: pre-wrap; line-height: 1.5; }

.detail-action-btn { width: 22px; height: 22px; padding: 0; border: none; background: transparent; border-radius: 4px; color: var(--text-muted); cursor: pointer; transition: all 0.12s; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.detail-action-btn:hover { background: var(--hover); color: var(--text-secondary); }
.detail-action-btn.toggle { color: var(--accent); }
.detail-action-btn.toggle:hover { background: var(--accent-soft); }

.paths-list { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; padding-left: 56px; }
.path-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--bg-secondary); border-radius: var(--radius-sm); border: 1px solid var(--border); font-size: 12px; cursor: pointer; text-decoration: none; color: inherit; transition: all 0.12s; }
.path-item:hover { background: var(--accent-soft); border-color: var(--accent); }
.path-label { font-weight: 500; color: var(--text-primary); }
.path-path { color: var(--text-secondary); font-family: monospace; flex: 1; }
.path-open-icon { color: var(--text-muted); flex-shrink: 0; }
.path-item:hover .path-open-icon { color: var(--accent); }
</style>
