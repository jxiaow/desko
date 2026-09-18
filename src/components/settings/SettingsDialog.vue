<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { settingsApi } from '../../services/api/settings'
import { dataApi } from '../../services/api/data'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'

const toastStore = useToastStore()
const confirmStore = useConfirmStore()

const emit = defineEmits<{
  close: []
  openChangePassword: []
  entriesRefreshed: []
}>()

const show = ref(true)
const dbPath = ref('')
const autoLockTimeout = ref(5)
const lockOnClose = ref(false)

const loadSettings = async () => {
  try {
    dbPath.value = await dataApi.getDbPath()
    const timeout = await settingsApi.getSetting('auto_lock_timeout')
    if (timeout) {
      autoLockTimeout.value = parseInt(timeout) || 5
    }
    const lockClose = await settingsApi.getSetting('lock_on_close')
    lockOnClose.value = lockClose === 'true'
  } catch (e) {
    dbPath.value = 'Unknown'
  }
}

const saveAutoLockTimeout = async () => {
  const value = Math.max(1, Math.min(60, autoLockTimeout.value))
  autoLockTimeout.value = value
  try {
    await settingsApi.setSetting('auto_lock_timeout', value.toString())
    toastStore.showToast('设置已保存')
  } catch (e: any) {
    toastStore.showToast('保存失败: ' + e.message, 'error')
  }
}

const saveLockOnClose = async () => {
  try {
    await settingsApi.setSetting('lock_on_close', lockOnClose.value.toString())
    toastStore.showToast('设置已保存')
  } catch (e: any) {
    toastStore.showToast('保存失败: ' + e.message, 'error')
  }
}

const doExportSql = async () => {
  try {
    const sql = await dataApi.exportSql()
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
    toastStore.showToast('导出成功')
  } catch (e: any) {
    toastStore.showToast('导出失败: ' + e.message, 'error')
  }
}

const doImportSql = async () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.sql'
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return

    confirmStore.showConfirm('确认导入', '导入将覆盖现有数据，确定继续吗？', async () => {
      try {
        const sql = await file.text()
        await dataApi.importSql(sql)
        emit('entriesRefreshed')
        toastStore.showToast('导入成功')
      } catch (e: any) {
        toastStore.showToast('导入失败: ' + e.message, 'error')
      }
    })
  }
  input.click()
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
      <div class="settings-dialog">
        <div class="settings-header">
          <div class="settings-header-content">
            <svg class="settings-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <h2>设置</h2>
          </div>
          <button  class="close-btn" @click="close" title="关闭">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="settings-body">
          <!-- 数据存储 -->
          <div class="settings-group">
            <div class="group-header">
              <svg class="group-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3"/>
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
              </svg>
              <span class="group-title">数据存储</span>
            </div>
            <div class="group-content">
              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-name">数据库路径</span>
                  <span class="setting-desc">{{ dbPath }}</span>
                </div>
              </div>
              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-name">数据备份</span>
                  <span class="setting-desc">导出或导入 SQL 文件</span>
                </div>
                <div class="setting-actions">
                  <button class="action-btn" @click="doExportSql">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    导出
                  </button>
                  <button class="action-btn" @click="doImportSql">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    导入
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 安全 -->
          <div class="settings-group">
            <div class="group-header">
              <svg class="group-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <span class="group-title">安全</span>
            </div>
            <div class="group-content">
              <div class="setting-item clickable" @click="emit('openChangePassword')">
                <div class="setting-info">
                  <span class="setting-name">修改主密码</span>
                  <span class="setting-desc">定期更换密码以提高安全性</span>
                </div>
                <svg class="arrow-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-name">自动锁定</span>
                  <span class="setting-desc">无操作后自动锁定应用</span>
                </div>
                <div class="setting-control">
                  <input
                    type="number"
                    class="number-input"
                    v-model.number="autoLockTimeout"
                    min="1"
                    max="60"
                    @change="saveAutoLockTimeout"
                  />
                  <span class="unit">分钟</span>
                </div>
              </div>
              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-name">关闭窗口时锁定</span>
                  <span class="setting-desc">关闭窗口时自动锁定应用</span>
                </div>
                <label class="switch">
                  <input type="checkbox" v-model="lockOnClose" @change="saveLockOnClose" />
                  <span class="switch-slider"></span>
                </label>
              </div>
            </div>
          </div>

          <!-- 关于 -->
          <div class="settings-about">
            <div class="about-logo">
              <svg viewBox="0 0 124 124" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="deskoGradientSettings" x1="32" y1="24" x2="95" y2="108" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stop-color="#6366f1"/>
                    <stop offset="0.48" stop-color="#4f46e5"/>
                    <stop offset="1" stop-color="#4338ca"/>
                  </linearGradient>
                </defs>
                <path d="M94 35 L51 49 C47.8 50.1 46 52.4 46 56 L46 98 C33.7 91.0 26 77.9 26 63 C26 40.9 43.9 23 66 23 C73.5 23 80.2 24.8 85.9 28.1 L94 35 Z" fill="url(#deskoGradientSettings)"/>
                <path d="M97 40 L65 51.8 C63 52.5 62 54.0 62 56.2 L62 105.5 C62 107.8 63.8 109.2 66 108.4 L95 98 C97.0 97.3 98 95.8 98 93.6 L98 42.5 C98 41.2 97.7 40.5 97 40 Z" fill="url(#deskoGradientSettings)"/>
                <circle cx="75" cy="79" r="5" fill="#FFFFFF"/>
              </svg>
            </div>
            <div class="about-info">
              <span class="about-name">案头 Desko</span>
              <span class="about-version">v1.0.0</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.settings-dialog {
  background: var(--panel-bg);
  border-radius: 12px;
  width: 100%;
  max-width: 480px;
  max-height: 80vh;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.settings-header-content {
  display: flex;
  align-items: center;
  gap: 10px;
}

.settings-icon {
  color: var(--accent);
}

.settings-header h2 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.close-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  transition: all 0.15s;
}

.close-btn:hover {
  background: var(--hover);
  color: var(--text);
}

.settings-body {
  padding: 16px;
  overflow-y: auto;
  max-height: calc(80vh - 56px);
}

.settings-group {
  margin-bottom: 16px;
}

.settings-group:last-of-type {
  margin-bottom: 0;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.group-icon {
  color: var(--accent);
  flex-shrink: 0;
}

.group-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.group-content {
  background: var(--bg);
  border-radius: 8px;
  border: 1px solid var(--border);
  overflow: hidden;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-item.clickable {
  cursor: pointer;
}

.setting-item.clickable:hover {
  background: var(--hover);
}

.setting-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.setting-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}

.setting-desc {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.setting-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}

.action-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.number-input {
  width: 56px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  font-size: 12px;
  text-align: right;
  outline: none;
  background: var(--panel-bg);
  color: var(--text);
  transition: border-color 0.15s;
  font-family: inherit;
}

.number-input:focus {
  border-color: var(--accent);
}

.unit {
  font-size: 11px;
  color: var(--text-muted);
}

.switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.switch-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: var(--border);
  transition: 0.2s;
  border-radius: 20px;
}

.switch-slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  transition: 0.2s;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.switch input:checked + .switch-slider {
  background-color: var(--accent);
}

.switch input:checked + .switch-slider:before {
  transform: translateX(16px);
}

.arrow-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.settings-about {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  margin-top: 24px;
  background: var(--bg);
  border-radius: 8px;
  border: 1px solid var(--border);
}

.about-logo {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--accent), #8b5cf6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  flex-shrink: 0;
}

.about-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.about-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.about-version {
  font-size: 11px;
  color: var(--text-muted);
}

/* Dialog transition */
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s ease;
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
</style>
