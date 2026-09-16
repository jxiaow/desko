<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '../services/api'

const emit = defineEmits<{
  close: []
  openChangePassword: []
  showToast: [msg: string, type?: 'success' | 'error' | 'info']
  showConfirm: [title: string, msg: string, cb: () => void]
  entriesRefreshed: []
}>()

const show = ref(true)
const dbPath = ref('')
const autoLockTimeout = ref(5)
const lockOnClose = ref(false)

const loadSettings = async () => {
  try {
    dbPath.value = await api.getDbPath()
    const timeout = await api.getSetting('auto_lock_timeout')
    if (timeout) {
      autoLockTimeout.value = parseInt(timeout) || 5
    }
    const lockClose = await api.getSetting('lock_on_close')
    lockOnClose.value = lockClose === 'true'
  } catch (e) {
    dbPath.value = 'Unknown'
  }
}

const saveAutoLockTimeout = async () => {
  const value = Math.max(1, Math.min(60, autoLockTimeout.value))
  autoLockTimeout.value = value
  try {
    await api.setSetting('auto_lock_timeout', value.toString())
    emit('showToast', '设置已保存')
  } catch (e: any) {
    emit('showToast', '保存失败: ' + e.message, 'error')
  }
}

const saveLockOnClose = async () => {
  try {
    await api.setSetting('lock_on_close', lockOnClose.value.toString())
    emit('showToast', '设置已保存')
  } catch (e: any) {
    emit('showToast', '保存失败: ' + e.message, 'error')
  }
}

const doExportSql = async () => {
  try {
    const sql = await api.exportSql()
    const blob = new Blob([sql], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'desko-export.sql'
    try {
      a.click()
    } finally {
      URL.revokeObjectURL(url)
    }
    emit('showToast', '导出成功')
  } catch (e: any) {
    emit('showToast', '导出失败: ' + e.message, 'error')
  }
}

const doImportSql = async () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.sql'
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    
    emit('showConfirm', '确认导入', '导入将覆盖现有数据，确定继续吗？', async () => {
      try {
        const sql = await file.text()
        await api.importSql(sql)
        emit('entriesRefreshed')
        emit('showToast', '导入成功')
      } catch (e: any) {
        emit('showToast', '导入失败: ' + e.message, 'error')
      }
    })
  }
  input.click()
}

const doCreateTestData = async () => {
  emit('showConfirm', '确认生成', '将生成 20 条测试数据，确定继续吗？', async () => {
    try {
      await api.createTestData()
      emit('entriesRefreshed')
      emit('showToast', '测试数据已生成')
    } catch (e: any) {
      emit('showToast', '生成失败: ' + e.message, 'error')
    }
  })
}

const close = () => {
  show.value = false
  emit('close')
}

onMounted(() => { loadSettings() })
</script>

<template>
  <Transition name="dialog">
    <div v-if="show" class="dialog-overlay" @click.self="close">
    <div class="dialog">
      <div class="dialog-header">
        <div class="dialog-header-left">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <h3>设置</h3>
        </div>
        <button class="dialog-close" @click="close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="dialog-body">
        <div class="settings-section">
          <div class="settings-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            数据存储
          </div>
          <div class="settings-path">{{ dbPath }}</div>
          <div class="settings-actions">
            <button class="btn-secondary" @click="doExportSql">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              导出 SQL
            </button>
            <button class="btn-secondary" @click="doImportSql">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              导入 SQL
            </button>
          </div>
        </div>
        <div class="settings-divider"></div>
        <div class="settings-section">
          <div class="settings-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            安全
          </div>
          <button class="btn-secondary" @click="emit('openChangePassword')">修改主密码</button>
          <div class="setting-row">
            <label class="setting-label">自动锁定超时</label>
            <div class="setting-control">
              <input
                type="number"
                class="setting-input"
                v-model.number="autoLockTimeout"
                min="1"
                max="60"
                @change="saveAutoLockTimeout"
              />
              <span class="setting-unit">分钟</span>
            </div>
          </div>
          <div class="setting-row">
            <label class="setting-label">关闭窗口时锁定</label>
            <label class="toggle">
              <input type="checkbox" v-model="lockOnClose" @change="saveLockOnClose" />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
        <div class="settings-divider"></div>
        <div class="settings-section">
          <div class="settings-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            开发
          </div>
          <button class="btn-secondary" @click="doCreateTestData">生成测试数据</button>
        </div>
        <div class="settings-divider"></div>
        <div class="settings-about">案头 Desko v1.0.0</div>
      </div>
    </div>
    </div>
  </Transition>
</template>

<style scoped>
.settings-section { margin-bottom: 14px; }

.settings-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text);
}

.settings-title svg { width: 12px; height: 12px; color: var(--accent); flex-shrink: 0; }

.settings-path {
  background: var(--hover);
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  font-size: 11px;
  color: var(--text-secondary);
  word-break: break-all;
  margin-bottom: 8px;
  line-height: 1.5;
}

.settings-actions { display: flex; gap: 6px; flex-wrap: wrap; }

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}

.setting-row:last-child { border-bottom: none; }
.setting-label { font-size: 12px; color: var(--text); font-weight: 400; }

.setting-control { display: flex; align-items: center; gap: 6px; }

.setting-input {
  width: 60px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  text-align: right;
  outline: none;
  transition: border-color 0.15s;
}

.setting-input:focus { border-color: var(--accent); }
.setting-unit { font-size: 12px; color: var(--text-secondary); }

.toggle { position: relative; display: inline-block; width: 36px; height: 20px; }
.toggle input { opacity: 0; width: 0; height: 0; }

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: var(--border);
  transition: 0.2s;
  border-radius: 20px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  transition: 0.2s;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}

.toggle input:checked + .toggle-slider { background-color: var(--accent); }
.toggle input:checked + .toggle-slider:before { transform: translateX(16px); }

.settings-divider { height: 1px; background: var(--border); margin: 14px 0; }

.settings-about {
  text-align: center;
  color: var(--text-muted);
  font-size: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  margin-top: 8px;
}
</style>
