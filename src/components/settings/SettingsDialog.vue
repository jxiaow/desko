<script setup lang="ts">
import BrandLogo from '../shared/BrandLogo.vue'
import BackupPane from './BackupPane.vue'
import { ref, onMounted } from 'vue'
import { settingsApi } from '../../services/api/settings'
import { THEMES, chooseTheme, readTheme } from '../../services/theme'
import type { ThemeId } from '../../services/theme'
import { useToastStore } from '../../stores/toast'
import { useEscapeClose } from '../../composables/useEscapeClose'

const toastStore = useToastStore()

const emit = defineEmits<{
  close: []
  openChangePassword: []
  entriesRefreshed: []
}>()

const show = ref(true)
const TAB_LABELS = {
  appearance: '外观',
  backup: '数据与备份',
  security: '安全',
  about: '关于',
} as const
type TabId = keyof typeof TAB_LABELS
const tab = ref<TabId>('appearance')
// 存 0 表示不开自动锁定，useAutoLock 读到 0 直接跳过这一轮
const autoLockEnabled = ref(false)
const autoLockTimeout = ref(5)
const lockOnClose = ref(false)
const theme = ref<ThemeId>('cool')

const loadSettings = async () => {
  theme.value = await readTheme()
  try {
    const timeout = await settingsApi.getSetting('auto_lock_timeout')
    const minutes = parseInt(timeout)
    if (!isNaN(minutes) && minutes > 0) {
      autoLockEnabled.value = true
      autoLockTimeout.value = Math.min(60, minutes)
    }
    const lockClose = await settingsApi.getSetting('lock_on_close')
    lockOnClose.value = lockClose === 'true'
  } catch { /* 读不到就保持默认 */ }
}

const saveAutoLock = async () => {
  if (autoLockEnabled.value) {
    // 关掉再打开要回到原来的分钟数，所以关闭时不动这个值，只在落盘时写 0
    autoLockTimeout.value = Math.max(1, Math.min(60, autoLockTimeout.value))
  }
  const value = autoLockEnabled.value ? autoLockTimeout.value : 0
  try {
    await settingsApi.setSetting('auto_lock_timeout', value.toString())
    toastStore.showToast(value ? '设置已保存' : '已关闭自动锁定')
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

const pickTheme = async (id: ThemeId) => {
  if (id === theme.value) return
  theme.value = id
  // chooseTheme 会先把 data-theme 挂上再落盘，所以这里失败只是"下次回来还是旧的"
  const saved = await chooseTheme(id)
  toastStore.showToast(saved ? '已切换主题' : '已切换，但没能保存，重启后会回到原样', saved ? 'success' : 'error')
}

const close = () => {
  show.value = false
  emit('close')
}

useEscapeClose(close)

onMounted(() => { loadSettings() })
</script>

<template>
  <Transition name="dialog">
    <div v-if="show" class="dialog-overlay">
      <div class="settings-dialog">
        <aside class="settings-nav">
          <div class="nav-brand">
            <BrandLogo />
            <h2>设置</h2>
          </div>
          <button class="nav-tab" :class="{ on: tab === 'appearance' }" @click="tab = 'appearance'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="13.5" cy="6.5" r=".5"/>
              <circle cx="17.5" cy="10.5" r=".5"/>
              <circle cx="8.5" cy="7.5" r=".5"/>
              <circle cx="6.5" cy="12.5" r=".5"/>
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.436-.657-.436-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
            </svg>
            <span>{{ TAB_LABELS.appearance }}</span>
          </button>
          <button class="nav-tab" :class="{ on: tab === 'backup' }" @click="tab = 'backup'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3"/>
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
            </svg>
            <span>{{ TAB_LABELS.backup }}</span>
          </button>
          <button class="nav-tab" :class="{ on: tab === 'security' }" @click="tab = 'security'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span>{{ TAB_LABELS.security }}</span>
          </button>
          <button class="nav-tab" :class="{ on: tab === 'about' }" @click="tab = 'about'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <span>{{ TAB_LABELS.about }}</span>
          </button>
        </aside>

        <div class="settings-main">
          <header class="settings-head">
            <h3>{{ TAB_LABELS[tab] }}</h3>
            <button class="close-btn" @click="close" title="关闭">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </header>

          <!-- 外观 -->
          <section v-show="tab === 'appearance'" class="settings-pane">
            <div class="theme-row">
              <button
                v-for="t in THEMES"
                :key="t.id"
                class="theme-chip"
                :class="{ on: theme === t.id }"
                type="button"
                @click="pickTheme(t.id)"
              >
                <span class="theme-prev" :style="{ background: t.prev.page, borderColor: t.prev.edge }">
                  <span class="tp-rail" :style="{ background: t.prev.card, borderColor: t.prev.edge }" />
                  <span class="tp-dot" :style="{ background: t.prev.accent }" />
                  <span class="tp-line" :style="{ background: t.prev.ink }" />
                  <span class="tp-line short" :style="{ background: t.prev.ink }" />
                  <span class="tp-body" :style="{ background: t.prev.ink }" />
                  <span class="tp-body mid" :style="{ background: t.prev.ink }" />
                  <span class="tp-body narrow" :style="{ background: t.prev.ink }" />
                </span>
                <span class="theme-chip-name">{{ t.name }}</span>
              </button>
            </div>
          </section>

          <!-- 数据与备份 -->
          <section v-show="tab === 'backup'" class="settings-pane">
            <BackupPane @restored="emit('entriesRefreshed')" />
          </section>

          <!-- 安全 -->
          <section v-show="tab === 'security'" class="settings-pane">
            <div class="group-content">
              <div class="setting-item clickable" @click="emit('openChangePassword')">
                <div class="setting-info">
                  <span class="setting-name">修改主密码</span>
                </div>
                <svg class="arrow-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-name">自动锁定</span>
                </div>
                <div class="setting-control">
                  <input
                    type="number"
                    class="number-input"
                    v-model.number="autoLockTimeout"
                    min="1"
                    max="60"
                    :disabled="!autoLockEnabled"
                    @change="saveAutoLock"
                  />
                  <span class="unit">分钟</span>
                  <label class="switch">
                    <input type="checkbox" v-model="autoLockEnabled" @change="saveAutoLock" />
                    <span class="switch-slider"></span>
                  </label>
                </div>
              </div>
              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-name">关闭窗口时锁定</span>
                </div>
                <label class="switch">
                  <input type="checkbox" v-model="lockOnClose" @change="saveLockOnClose" />
                  <span class="switch-slider"></span>
                </label>
              </div>
            </div>
          </section>

          <!-- 关于 -->
          <section v-show="tab === 'about'" class="settings-pane">
            <div class="settings-about">
              <div class="about-logo">
                <BrandLogo />
              </div>
              <div class="about-name">案头 Desko</div>
              <div class="about-version">v1.0.0</div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.settings-dialog {
  display: flex;
  background: var(--panel-bg);
  border-radius: var(--radius-lg);
  width: min(720px, 92vw);
  height: min(540px, 84vh);
  overflow: hidden;
  box-shadow: var(--shadow-pop);
  border: 1px solid var(--border);
}

/* 左菜单 / 右内容。菜单取侧栏那套令牌，跟应用主窗口的导航同构。 */
.settings-nav {
  flex-shrink: 0;
  width: 152px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-3) var(--space-2);
  background: var(--sidebar-bg);
  border-right: 1px solid var(--sidebar-border);
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-2) var(--space-3);
  margin-bottom: var(--space-2);
  border-bottom: 1px solid var(--sidebar-border);
}

.nav-brand :deep(.brand-logo) {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.nav-brand h2 {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.nav-tab {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 7px var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  font-family: inherit;
  font-size: 13px;
  color: var(--sidebar-text);
  text-align: left;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.nav-tab svg {
  flex-shrink: 0;
  opacity: 0.7;
}

.nav-tab:hover {
  background: var(--sidebar-hover);
  color: var(--text);
}

.nav-tab.on {
  background: var(--sidebar-active);
  color: var(--sidebar-text-active);
  font-weight: 600;
}

.nav-tab.on svg {
  opacity: 1;
}

.settings-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.settings-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  height: 44px;
  padding: 0 var(--space-3) 0 var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
}

.settings-head h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.close-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  transition: background var(--transition), color var(--transition);
}

.close-btn:hover {
  background: var(--hover);
  color: var(--text);
}

/* 面板用 v-show 而非 v-if：切页时 number-input 不卸载，@change 才不会被切页吞掉。
   弹窗定高，各页同高，切页不跳。 */
.settings-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
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
  gap: var(--space-4);
  min-height: 60px;
  padding: 12px var(--space-4);
  border-bottom: 1px solid var(--border);
  transition: background var(--transition);
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

.number-input:disabled {
  color: var(--text-muted);
  background: transparent;
  border-color: transparent;
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
  background-color: var(--panel-bg);
  transition: 0.2s;
  border-radius: 50%;
  box-shadow: var(--shadow-xs);
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

/* 主题选择：四块迷你预览，点一下整套色就换。
   预览里的色直接取自该主题的令牌，所见即所得，不再配文字解释。
   三套浅色在小图里几乎看不出差别，所以放大到两列。 */
.theme-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-2);
}

.theme-chip {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--space-2);
  border: 1px solid var(--border);
  background: var(--panel-bg);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: all var(--transition);
}
.theme-chip:hover { border-color: var(--border-strong); background: var(--hover); }
.theme-chip.on { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-ring); }

.theme-prev {
  position: relative;
  display: block;
  height: 92px;
  border: 1px solid;
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.tp-rail {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 30%;
  border-right: 1px solid;
}
.tp-dot {
  position: absolute;
  left: 5px;
  top: 5px;
  width: 7px;
  height: 7px;
  border-radius: 2px;
}
.tp-line {
  position: absolute;
  left: calc(30% + 7px);
  top: 11%;
  width: 46%;
  height: 3px;
  border-radius: 2px;
  opacity: 0.85;
}
.tp-line.short { top: 21%; width: 30%; opacity: 0.35; }
/* 页头两条 + 正文三行的假文档，用百分比排，预览块尺寸变了也不会挤成一坨 */
.tp-body {
  position: absolute;
  left: calc(30% + 7px);
  top: 39%;
  width: 56%;
  height: 3px;
  border-radius: 2px;
  opacity: 0.2;
}
.tp-body.mid { top: 53%; width: 50%; }
.tp-body.narrow { top: 67%; width: 38%; }

.theme-chip-name { font-size: 12.5px; font-weight: 600; color: var(--text); line-height: 1.3; }

/* 关于面板只有三行内容，居中排成一块，比顶格加一屏空白更像介绍页。 */
.settings-about {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  text-align: center;
}

/* 品牌标全站只有一种呈现：裸标 + 品牌渐变。
   这里原先额外套了一块紫色渐变底，等于第二套品牌渐变，切主题时它会跟不上标本身。 */
.about-logo {
  width: 72px;
  height: 72px;
  flex-shrink: 0;
}

.about-name {
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
}

.about-version {
  font-size: 13px;
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
