<script setup lang="ts">
import BrandLogo from '../shared/BrandLogo.vue'
import BackupPane from './BackupPane.vue'
import OptionSelect from '../shared/OptionSelect.vue'
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { settingsApi } from '../../services/api/settings'
import { THEMES, DEFAULT_THEME, chooseTheme, readTheme } from '../../services/theme'
import type { ThemeId } from '../../services/theme'
import { TERMINALS, readTerminal, saveTerminal } from '../../services/terminal'
import type { TerminalId } from '../../services/terminal'
import { readMfaFeature, saveMfaFeature } from '../../services/mfaFeature'
import { fileshareEnabled, readFileshareFeature, saveFileshareFeature } from '../../services/fileshareFeature'
import { fsBusy, fsConfig, fsHasPassword, fsRefresh, fsSaveConfig, fsSetPassword } from '../../services/fileshareSettings'
import { errText } from '../../services/api/backup'
import { useToastStore } from '../../stores/toast'
import { useNotesStore } from '../../stores/notes'
import { useEscapeClose } from '../../composables/useEscapeClose'

const toastStore = useToastStore()
// 口令行只在设过小记口令时出现；设置页可能先于小记模块打开，自己拉一次状态
const notesStore = useNotesStore()
const { noteKey } = storeToRefs(notesStore)
void notesStore.refreshNoteKey()

const emit = defineEmits<{
  close: []
  openChangePassword: []
  openChangeNoteKey: []
  entriesRefreshed: []
}>()

const show = ref(true)
const TAB_LABELS = {
  general: '通用',
  fileshare: '局域网传输',
  appearance: '外观',
  backup: '数据与备份',
  security: '安全',
  about: '关于',
} as const
type TabId = keyof typeof TAB_LABELS
const props = defineProps<{ initialTab?: TabId }>()
const tab = ref<TabId>(props.initialTab ?? 'general')
// 存 0 表示不开自动锁定，useAutoLock 读到 0 直接跳过这一轮
const autoLockEnabled = ref(false)
const autoLockTimeout = ref(5)
const lockOnClose = ref(false)
const lockOnSystemLock = ref(false)
const theme = ref<ThemeId>(DEFAULT_THEME)
const terminal = ref<TerminalId>('auto')
const mfaOn = ref(false)
const fileshareOn = ref(false)
// 局域网传输的服务设置（页签内），状态走 fileshareSettings 单例与模块页共享
const fsPortInput = ref(8000)
const fsLocalOnly = ref(false)
const fsShowPwInput = ref(false)
const fsPasswordInput = ref('')

const syncFileshareForm = () => {
  const cfg = fsConfig.value
  if (!cfg) return
  fsPortInput.value = cfg.port
  fsLocalOnly.value = cfg.localOnly
}
const route = useRoute()
const router = useRouter()
const terminalDesc = computed(
  () => TERMINALS.find((t) => t.id === terminal.value)?.desc ?? ''
)
const terminalOptions = TERMINALS.map((t) => ({ value: t.id, label: t.name }))

const loadSettings = async () => {
  theme.value = await readTheme()
  terminal.value = await readTerminal()
  mfaOn.value = await readMfaFeature()
  fileshareOn.value = await readFileshareFeature()
  if (tab.value === 'fileshare' && !fileshareOn.value) tab.value = 'general'
  if (fileshareOn.value) {
    await fsRefresh()
    syncFileshareForm()
  }
  try {
    const timeout = await settingsApi.getSetting('auto_lock_timeout')
    const minutes = parseInt(timeout)
    if (!isNaN(minutes) && minutes > 0) {
      autoLockEnabled.value = true
      autoLockTimeout.value = Math.min(60, minutes)
    }
    const lockClose = await settingsApi.getSetting('lock_on_close')
    lockOnClose.value = lockClose === 'true'
    const lockSession = await settingsApi.getSetting('lock_on_system_lock')
    lockOnSystemLock.value = lockSession === 'true'
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

const saveLockOnSystemLock = async () => {
  try {
    await settingsApi.setSetting('lock_on_system_lock', lockOnSystemLock.value.toString())
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

const saveTerminalPref = async (id: TerminalId) => {
  if (id === terminal.value) return
  terminal.value = id
  const saved = await saveTerminal(id)
  toastStore.showToast(saved ? '已保存终端偏好' : '已设置，但没能保存，重启后会回到原样', saved ? 'success' : 'error')
}

const saveMfaFeaturePref = async () => {
  try {
    await saveMfaFeature(mfaOn.value)
    // 正停在验证码页时关掉，得把人带回去，不然留着一个没有入口的页面
    if (!mfaOn.value && route.path === '/mfa') await router.replace('/entries')
    toastStore.showToast('设置已保存')
  } catch (e: any) {
    toastStore.showToast('保存失败: ' + e.message, 'error')
  }
}

const saveFileshareFeaturePref = async () => {
  try {
    await saveFileshareFeature(fileshareOn.value)
    if (!fileshareOn.value && route.path === '/fileshare') await router.replace('/entries')
    if (!fileshareOn.value && tab.value === 'fileshare') tab.value = 'general'
    toastStore.showToast(fileshareOn.value ? '局域网传输已开启' : '设置已保存')
  } catch (e: any) {
    // saveFileshareFeature 内部已回滚单例，界面按单例扳回（开、关两个方向都可能失败）
    fileshareOn.value = fileshareEnabled.value
    toastStore.showToast((fileshareOn.value ? '关闭失败: ' : '开启失败: ') + e.message, 'error')
  }
}

const applyFsPort = async () => {
  const cfg = fsConfig.value
  if (!cfg || fsBusy.value) return
  const port = Math.max(1, Math.min(65535, fsPortInput.value || cfg.port))
  fsPortInput.value = port
  if (port === cfg.port) return
  try {
    await fsSaveConfig(cfg.shareDirs, port, cfg.localOnly)
    toastStore.showToast('端口已更新')
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    syncFileshareForm()
  }
}

const applyFsLocalOnly = async () => {
  const cfg = fsConfig.value
  if (!cfg || fsBusy.value) return
  const want = fsLocalOnly.value
  try {
    await fsSaveConfig(cfg.shareDirs, fsPortInput.value, want)
    toastStore.showToast(want ? '已切到仅本机访问' : '已对局域网开放')
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
    fsLocalOnly.value = !want
  } finally {
    syncFileshareForm()
  }
}

const applyFsPassword = async () => {
  if (fsBusy.value) return
  try {
    await fsSetPassword(fsPasswordInput.value)
    toastStore.showToast('访问口令已更新')
    fsPasswordInput.value = ''
    fsShowPwInput.value = false
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
}

const clearFsPassword = async () => {
  if (fsBusy.value) return
  try {
    await fsSetPassword('')
    toastStore.showToast('已清除访问口令')
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
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
          <button class="nav-tab" :class="{ on: tab === 'general' }" @click="tab = 'general'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
              <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
              <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
              <line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
            </svg>
            <span>{{ TAB_LABELS.general }}</span>
          </button>
          <button v-if="fileshareOn" class="nav-tab" :class="{ on: tab === 'fileshare' }" @click="tab = 'fileshare'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            <span>{{ TAB_LABELS.fileshare }}</span>
          </button>
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

          <!-- 通用 -->
          <section v-show="tab === 'general'" class="settings-pane">
            <div class="group-content">
              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-name">在终端中打开</span>
                  <span class="setting-desc">{{ terminalDesc }}</span>
                </div>
                <div class="setting-control">
                  <OptionSelect
                    :model-value="terminal"
                    :options="terminalOptions"
                    @update:model-value="saveTerminalPref($event as TerminalId)"
                  />
                </div>
              </div>
              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-name">验证码模块</span>
                  <span class="setting-desc">开启后侧栏出现「验证码」页，管理 TOTP 动态码</span>
                </div>
                <label class="switch">
                  <input type="checkbox" v-model="mfaOn" @change="saveMfaFeaturePref" />
                  <span class="switch-slider"></span>
                </label>
              </div>
              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-name">局域网文件传输</span>
                  <span class="setting-desc">开启后侧栏出现「局域网传输」页，同网段设备用浏览器互传文件</span>
                </div>
                <label class="switch">
                  <input type="checkbox" v-model="fileshareOn" @change="saveFileshareFeaturePref" />
                  <span class="switch-slider"></span>
                </label>
              </div>
            </div>
          </section>

          <!-- 局域网传输：服务设置（共享目录仍在模块页管理） -->
          <section v-show="tab === 'fileshare'" class="settings-pane">
            <div class="group-content">
              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-name">端口</span>
                  <span class="setting-desc">被占用时自动向后漂移，实际端口见传输页顶部</span>
                </div>
                <input
                  v-model.number="fsPortInput"
                  class="number-input fs-port-input"
                  type="number"
                  min="1"
                  max="65535"
                  @change="applyFsPort"
                  @keyup.enter="applyFsPort"
                />
              </div>
              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-name">仅本机访问</span>
                  <span class="setting-desc">只监听 127.0.0.1，其他设备无法连接</span>
                </div>
                <label class="switch">
                  <input type="checkbox" v-model="fsLocalOnly" @change="applyFsLocalOnly" />
                  <span class="switch-slider"></span>
                </label>
              </div>
              <div class="setting-item" :class="{ stacked: fsShowPwInput }">
                <div class="setting-info">
                  <span class="setting-name">访问口令</span>
                  <span class="setting-desc">启用后网页端所有页面都要先输口令</span>
                </div>
                <div class="fs-pw-ctl">
                  <span class="fs-tag" :class="{ on: fsHasPassword }">{{ fsHasPassword ? '已启用' : '未启用' }}</span>
                  <button v-if="!fsShowPwInput" class="action-btn" @click="fsShowPwInput = true">
                    {{ fsHasPassword ? '修改口令' : '设置口令' }}
                  </button>
                  <button v-if="fsHasPassword" class="action-btn" :disabled="fsBusy" @click="clearFsPassword">清除口令</button>
                </div>
                <div v-if="fsShowPwInput" class="fs-pw-row">
                  <input
                    v-model="fsPasswordInput"
                    class="fs-pw-input"
                    type="password"
                    placeholder="新口令"
                    autocomplete="new-password"
                    @keyup.enter="applyFsPassword"
                  />
                  <button class="action-btn primary" :disabled="fsBusy || !fsPasswordInput" @click="applyFsPassword">设置</button>
                  <button class="action-btn" @click="fsShowPwInput = false; fsPasswordInput = ''">取消</button>
                </div>
              </div>
            </div>
          </section>

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
                  <span class="tp-rail" :style="{ background: t.prev.sidebar, borderColor: t.prev.edge }">
                    <span class="tp-rail-dot" :style="{ background: t.prev.accent }" />
                    <span class="tp-rail-line" :style="{ background: t.prev.ink }" />
                    <span class="tp-rail-line short" :style="{ background: t.prev.ink }" />
                  </span>
                  <span class="tp-rows">
                    <span class="tp-row" :style="{ background: t.prev.card, borderColor: t.prev.edge }">
                      <span class="tp-row-ink" :style="{ background: t.prev.ink }" />
                      <span class="tp-row-tag" :style="{ background: t.prev.accent }" />
                    </span>
                    <span class="tp-row" :style="{ background: t.prev.rowHover, borderColor: t.prev.edge }">
                      <span class="tp-row-ink" :style="{ background: t.prev.ink }" />
                      <span class="tp-row-tag" :style="{ background: t.prev.accent }" />
                    </span>
                    <span class="tp-row" :style="{ background: t.prev.card, borderColor: t.prev.edge }">
                      <span class="tp-row-ink" :style="{ background: t.prev.ink }" />
                      <span class="tp-row-tag" :style="{ background: t.prev.accent }" />
                    </span>
                  </span>
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
              <div v-if="noteKey.is_set" class="setting-item clickable" @click="emit('openChangeNoteKey')">
                <div class="setting-info">
                  <span class="setting-name">修改小记口令</span>
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
              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-name">系统锁屏后锁定</span>
                  <span class="setting-desc">Windows 锁屏（Win+L）时自动锁定应用</span>
                </div>
                <label class="switch">
                  <input type="checkbox" v-model="lockOnSystemLock" @change="saveLockOnSystemLock" />
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
  width: min(640px, 92vw);
  height: min(480px, 84vh);
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

.stacked { flex-wrap: wrap; }
.fs-port-input { width: 84px; }
.fs-pw-ctl { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
.fs-tag {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 8px;
  border-radius: 99px;
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.fs-tag.on { border-color: var(--success); color: var(--success); }
.fs-pw-row { display: flex; align-items: center; gap: var(--space-2); width: 100%; padding-bottom: var(--space-1); }
.fs-pw-input {
  flex: 1;
  min-width: 140px;
  height: 28px;
  padding: 0 10px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
}
.fs-pw-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-ring); }

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

.arrow-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

/* 主题选择：每块卡里画一个等比缩小的微缩界面——侧栏、三行行卡
   （中间一行是悬浮态底色）、行尾一枚强调色小块。所见即所得，不配文字解释。
   边框固定 2px 占位，选中只换颜色，切换时不跳布局。 */
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
  border: 2px solid var(--border);
  background: var(--panel-bg);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: border-color var(--transition-slow), box-shadow var(--transition-slow), background var(--transition);
}
.theme-chip:hover { border-color: var(--border-strong); background: var(--hover); }
.theme-chip.on {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
  background: var(--panel-bg);
}

.theme-prev {
  position: relative;
  display: block;
  height: 92px;
  border: 1px solid;
  border-radius: var(--radius-sm);
  overflow: hidden;
}
/* 侧栏：占左边 30%，顶部一枚 accent 圆点当 logo，下面两条导航字条 */
.tp-rail {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 30%;
  border-right: 1px solid;
}
.tp-rail-dot {
  position: absolute;
  left: 5px;
  top: 5px;
  width: 7px;
  height: 7px;
  border-radius: 2px;
}
.tp-rail-line {
  position: absolute;
  left: 5px;
  top: 22px;
  width: 58%;
  height: 3px;
  border-radius: 2px;
  opacity: 0.55;
}
.tp-rail-line.short { top: 32px; width: 42%; opacity: 0.3; }
/* 内容区：三行行卡，行距 1px 靠描边色分离，中间一行呈悬浮态底色 */
.tp-rows {
  position: absolute;
  left: calc(30% + 7px);
  right: 6px;
  top: 6px;
  bottom: 6px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
}
.tp-row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 14px;
  padding: 0 5px;
  border: 1px solid;
  border-radius: 3px;
}
.tp-row-ink {
  width: 46%;
  height: 3px;
  border-radius: 2px;
  opacity: 0.75;
  position: relative;
}
.tp-row-tag {
  margin-left: auto;
  width: 9px;
  height: 5px;
  border-radius: 99px;
}
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
