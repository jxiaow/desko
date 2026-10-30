<script setup lang="ts">
import BrandLogo from '../shared/BrandLogo.vue'
import WebAccessPane from './WebAccessPane.vue'
import BackupPane from './BackupPane.vue'
import ProfilesPane from './ProfilesPane.vue'
import { ref, computed, onMounted, reactive, watch } from 'vue'
import { getVersion } from '@tauri-apps/api/app'
import { settingsApi } from '../../services/api/settings'
import { THEMES, ACCENTS, WORKSPACE_THEMES, WORKSPACE_ACCENTS, appearance, chooseTheme, chooseAccent, chooseBackgroundAtmosphere, polarityOf } from '../../services/theme'
import type { ThemeId, AccentId } from '../../services/theme'
import { moduleFlags, loadModuleFlags } from '../../modules/state'
import { MODULES, moduleById, type ModuleId, type SettingsTabId } from '../../modules/registry'
import { toggleModule } from '../../modules/runtime'
import { errText } from '../../services/api/backup'
import { useToastStore } from '../../stores/toast'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'

const toastStore = useToastStore()

const emit = defineEmits<{
  close: []
  openChangePassword: []
  openChangeNoteKey: [mode: 'unlock' | 'change']
  entriesRefreshed: []
}>()

const show = ref(true)
const FIXED_TAB_LABELS = {
  web: 'Web 访问',
  profiles: '档案',
  modules: '模块',
  appearance: '外观',
  backup: '数据与备份',
  security: '安全',
  about: '关于',
} as const

const props = defineProps<{ initialTab?: SettingsTabId; workspaceLayout?: boolean }>()
const themes = computed(() => props.workspaceLayout ? WORKSPACE_THEMES : THEMES)
const accents = computed(() => props.workspaceLayout ? WORKSPACE_ACCENTS : ACCENTS)

const isValidTab = (id?: SettingsTabId): id is SettingsTabId => {
  if (!id) return false
  if (id in FIXED_TAB_LABELS) return true
  const m = MODULES.find((x) => x.id === id)
  return !!m?.settings
}

const tab = ref<SettingsTabId>(isValidTab(props.initialTab) ? props.initialTab : 'appearance')
// 弹窗已经开着时换页签不会重挂，得跟着 external 请求走
watch(() => props.initialTab, (value) => {
  if (isValidTab(value)) tab.value = value
})
// 存 0 表示不开自动锁定，useAutoLock 读到 0 直接跳过这一轮
const autoLockEnabled = ref(false)
const autoLockTimeout = ref(5)
const lockOnClose = ref(false)
const lockOnSystemLock = ref(false)
const savingAtmosphere = ref(false)
/** 关于页的版本号取自运行时应用版本，取不到就不显示，别再写死一个假版本 */
const appVersion = ref('')

const enabledSettingsModules = computed(() => MODULES.filter((m) => moduleFlags[m.id] && m.settings))
const tabLabel = computed(() => {
  if (tab.value in FIXED_TAB_LABELS) {
    return FIXED_TAB_LABELS[tab.value as keyof typeof FIXED_TAB_LABELS]
  }
  return moduleById(tab.value as ModuleId).settings?.label ?? ''
})

// 模块配置面板：首次点开才加载，之后 v-show 常驻
const loadedPanes = ref<Set<ModuleId>>(new Set())
const paneCache = reactive<Partial<Record<ModuleId, Awaited<ReturnType<NonNullable<(typeof MODULES)[number]['settings']>['pane']>>>>>({})

watch(
  tab,
  async (id) => {
    const m = MODULES.find((x) => x.id === id && x.settings)
    if (m && !loadedPanes.value.has(id as ModuleId)) {
      paneCache[id as ModuleId] = await m.settings!.pane()
      loadedPanes.value.add(id as ModuleId)
    }
  },
  { immediate: true },
)

const loadSettings = async () => {
  await loadModuleFlags()
  // 如果当前页签属于一个已关掉的模块，回落到外观
  if (!(tab.value in FIXED_TAB_LABELS) && !moduleFlags[tab.value as ModuleId]) {
    tab.value = 'appearance'
  }
  await Promise.all(enabledSettingsModules.value.map((m) => m.settings!.load?.()))
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
  if (id === appearance.theme) return
  const saved = await chooseTheme(id)
  toastStore.showToast(saved ? '已切换主题' : '保存失败，重启后将恢复原设置', saved ? 'success' : 'error')
}

const pickAccent = async (id: AccentId) => {
  if (id === appearance.accent) return
  const saved = await chooseAccent(id)
  toastStore.showToast(saved ? '已切换强调色' : '保存失败，重启后将恢复原设置', saved ? 'success' : 'error')
}

const saveBackgroundAtmosphere = async (event: Event) => {
  savingAtmosphere.value = true
  const saved = await chooseBackgroundAtmosphere((event.target as HTMLInputElement).checked)
  savingAtmosphere.value = false
  toastStore.showToast(saved ? '设置已保存' : '保存失败，重启后将恢复原设置', saved ? 'success' : 'error')
}

/** 开关只有一条路径：落库成功才认，失败由状态层扳回；路由与页面跟着收 */
const onToggleModule = async (id: ModuleId, e: Event) => {
  const on = (e.target as HTMLInputElement).checked
  try {
    await toggleModule(id, on)
    if (!on && tab.value === id) tab.value = 'appearance'
    toastStore.showToast(on ? moduleById(id).title + '已开启' : '设置已保存')
  } catch (err: any) {
    toastStore.showToast((on ? '开启失败: ' : '关闭失败: ') + errText(err), 'error')
  }
}

const close = () => {
  show.value = false
  emit('close')
}

useEscapeClose(close)

onMounted(() => {
  loadSettings()
  getVersion()
    .then((v) => (appVersion.value = v))
    .catch(() => {})
})
</script>

<template>
  <Transition name="dialog">
    <div v-if="show" class="dialog-overlay">
      <div class="settings-dialog" role="dialog" aria-modal="true" aria-label="设置">
        <aside class="settings-nav">
          <div class="nav-brand">
            <BrandLogo />
            <h2>设置</h2>
          </div>
          <div class="settings-nav-scroll">
            <div class="nav-group" role="group" aria-label="通用">
              <div class="nav-group-label">通用</div>
              <button class="nav-tab" :class="{ on: tab === 'appearance' }" @click="tab = 'appearance'">
                <AppIcon name="palette" :size="16" />
                <span>{{ FIXED_TAB_LABELS.appearance }}</span>
              </button>
              <button class="nav-tab" :class="{ on: tab === 'modules' }" @click="tab = 'modules'">
                <AppIcon name="bulletlist" :size="16" />
                <span>{{ FIXED_TAB_LABELS.modules }}</span>
              </button>
            </div>
            <div v-if="enabledSettingsModules.length" class="nav-group" role="group" aria-label="模块配置">
              <div class="nav-group-label">模块配置</div>
              <button
                v-for="m in enabledSettingsModules"
                :key="m.id"
                class="nav-tab"
                :class="{ on: tab === m.id }"
                @click="tab = m.id"
              >
                <AppIcon :name="m.settings!.icon" :size="16" />
                <span>{{ m.settings!.label }}</span>
              </button>
            </div>
            <div class="nav-group" role="group" aria-label="数据与安全">
              <div class="nav-group-label">数据与安全</div>
              <button class="nav-tab" :class="{ on: tab === 'web' }" @click="tab = 'web'">
                <AppIcon name="navLan" :size="16" /><span>{{ FIXED_TAB_LABELS.web }}</span>
              </button>
              <button class="nav-tab" :class="{ on: tab === 'profiles' }" @click="tab = 'profiles'">
                <AppIcon name="user" :size="16" />
                <span>{{ FIXED_TAB_LABELS.profiles }}</span>
              </button>
              <button class="nav-tab" :class="{ on: tab === 'backup' }" @click="tab = 'backup'">
                <AppIcon name="database" :size="16" />
                <span>{{ FIXED_TAB_LABELS.backup }}</span>
              </button>
              <button class="nav-tab" :class="{ on: tab === 'security' }" @click="tab = 'security'">
                <AppIcon name="lock" :size="16" />
                <span>{{ FIXED_TAB_LABELS.security }}</span>
              </button>
            </div>
          </div>
          <div class="nav-footer">
            <button class="nav-tab" :class="{ on: tab === 'about' }" @click="tab = 'about'">
              <AppIcon name="info" :size="16" />
              <span>{{ FIXED_TAB_LABELS.about }}</span>
            </button>
          </div>
        </aside>

        <div class="settings-main">
          <header class="settings-head">
            <h3>{{ tabLabel }}</h3>
            <button class="dialog-close" @click="close" title="关闭">
              <AppIcon name="x" :size="16" />
            </button>
          </header>

          <!-- 模块 -->
          <section v-show="tab === 'modules'" class="settings-pane">
            <p class="pane-hint">关闭模块会隐藏入口，保留数据和口令。</p>
            <div class="group-content">
              <div v-for="m in MODULES" :key="m.id" class="setting-item">
                <div class="setting-info">
                  <span class="setting-name">{{ m.title }}</span>
                  <span class="setting-desc">{{ m.desc }}</span>
                </div>
                <label class="switch">
                  <input type="checkbox" :checked="moduleFlags[m.id]" @change="onToggleModule(m.id, $event)" />
                  <span class="switch-slider"></span>
                </label>
              </div>
            </div>
          </section>

          <section v-if="tab === 'web'" class="settings-pane"><WebAccessPane /></section>

          <!-- 档案 -->
          <section v-show="tab === 'profiles'" class="settings-pane">
            <ProfilesPane />
          </section>

          <!-- 模块配置面板：首开挂载，之后常驻 -->
          <template v-for="m in enabledSettingsModules" :key="m.id">
            <section v-show="tab === m.id" v-if="loadedPanes.has(m.id)" class="settings-pane">
              <component :is="paneCache[m.id]" @open-change-note-key="emit('openChangeNoteKey', $event)" />
            </section>
          </template>

          <!-- 外观 -->
          <section v-show="tab === 'appearance'" class="settings-pane">
            <h4 class="settings-section-label">底色</h4>
            <div class="theme-row" :class="{ 'workspace-theme-row': workspaceLayout }">
              <button
                v-for="t in themes"
                :key="t.id"
                class="theme-chip"
                :class="{ on: appearance.theme === t.id }"
                type="button"
                @click="pickTheme(t.id)"
              >
                <span
                  class="theme-prev theme-scope"
                  :class="{ 'workspace-theme-prev': workspaceLayout }"
                  :data-theme="t.id"
                  :data-base="polarityOf(t.id)"
                  data-accent="graphite"
                  data-atmosphere="off"
                >
                  <span class="tp-rail">
                    <span class="tp-rail-dot" />
                    <span class="tp-rail-line" />
                    <span class="tp-rail-line short" />
                  </span>
                  <span v-if="workspaceLayout" class="tp-sheet" aria-hidden="true" />
                  <span class="tp-rows">
                    <span class="tp-row">
                      <span class="tp-row-ink" />
                      <span class="tp-row-tag" />
                    </span>
                    <span class="tp-row">
                      <span class="tp-row-ink" />
                      <span class="tp-row-tag" />
                    </span>
                    <span class="tp-row">
                      <span class="tp-row-ink" />
                      <span class="tp-row-tag" />
                    </span>
                  </span>
                  <span v-if="workspaceLayout" class="tp-workspace-context" />
                </span>
                <span class="theme-chip-name">{{ t.name }}</span>
              </button>
            </div>
            <h4 class="settings-section-label">强调色</h4>
            <div class="accent-row" role="radiogroup" aria-label="强调色">
              <button
                v-for="a in accents"
                :key="a.id"
                class="accent-pill"
                :class="{ on: appearance.accent === a.id }"
                type="button"
                role="radio"
                :aria-checked="appearance.accent === a.id"
                :data-accent-id="a.id"
                @click="pickAccent(a.id)"
              >
                <span class="accent-dot" :data-base="polarityOf(appearance.theme)" :data-accent="a.id" />
                <span class="accent-name">{{ a.name }}</span>
              </button>
            </div>
            <h4 class="settings-section-label">效果</h4>
            <div class="group-content">
              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-name">背景氛围</span>
                  <span id="background-atmosphere-desc" class="setting-desc">随强调色为背景叠加柔光</span>
                </div>
                <label class="switch">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label="背景氛围"
                    aria-describedby="background-atmosphere-desc"
                    :checked="appearance.backgroundAtmosphere"
                    :disabled="savingAtmosphere"
                    @change="saveBackgroundAtmosphere"
                  />
                  <span class="switch-slider"></span>
                </label>
              </div>
            </div>
          </section>

          <!-- 数据与备份 -->
          <section v-show="tab === 'backup'" class="settings-pane">
            <BackupPane @restored="emit('entriesRefreshed')" />
          </section>

          <!-- 安全 -->
          <section v-show="tab === 'security'" class="settings-pane">
            <h4 class="settings-section-label">口令</h4>
            <div class="group-content">
              <div class="setting-item clickable" @click="emit('openChangePassword')">
                <div class="setting-info">
                  <span class="setting-name">修改主密码</span>
                </div>
                <AppIcon class="arrow-icon" name="chevRight" :size="16" />
              </div>
            </div>
            <h4 class="settings-section-label">锁定</h4>
            <div class="group-content">
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
              <div class="about-brand">
                <div class="about-logo">
                  <BrandLogo />
                </div>
                <div class="about-info">
                  <div class="about-name">案头 Desko</div>
                  <div class="about-tagline">本地个人工作台</div>
                </div>
              </div>
              <div v-if="appVersion" class="setting-item">
                <div class="setting-info">
                  <span class="setting-name">版本</span>
                </div>
                <div class="setting-control">
                  <span class="about-version">v{{ appVersion }}</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* 遮罩统一走 global.css 的 .dialog-overlay（纯色压暗 + 四周收拢）；
   这里不再另写一份磨砂，避免同一个遮罩在页内/弹窗两处表现不一致。 */

.settings-dialog {
  display: flex;
  background: var(--bg-dialog);
  background-attachment: var(--dialog-background-attachment);
  border-radius: var(--radius-xl);
  width: min(760px, 92vw);
  /* 固定高度，切页时壳体不跳动；小窗口自动收缩，长页在面板内滚动。 */
  height: min(560px, 84vh);
  overflow: hidden;
  box-shadow: var(--shadow-pop);
  border: 1px solid var(--border);
}

/* 左菜单 / 右内容。菜单取侧栏那套令牌，跟应用主窗口的导航同构。 */
.settings-nav {
  flex-shrink: 0;
  min-height: 0;
  width: 176px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-3);
  background: var(--bg-sidebar);
  border-right: 1px solid var(--sidebar-border);
}

.nav-brand {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-2);
  margin-bottom: var(--space-3);
}

.nav-brand :deep(.brand-logo) {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.nav-brand h2 {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.settings-nav-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  /* 列表底部留一口气：滚到底时最后一行不贴着页脚 */
  padding-bottom: var(--space-1);
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-group + .nav-group { margin-top: var(--space-2); }
.nav-group-label {
  padding: 0 var(--space-2) 2px;
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text-nav-section);
}

/* 关于常驻在菜单底部，不跟列表一起滚走 */
.nav-footer {
  flex-shrink: 0;
  margin-top: var(--space-2);
}
.nav-footer .nav-tab { width: 100%; }

.nav-tab {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 7px var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  font-family: inherit;
  font-size: var(--text-base);
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
  color: var(--text-brand);
  font-weight: 600;
}

.nav-tab.on svg {
  color: inherit;
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
  height: 48px;
  padding: 0 var(--space-6);
}

.settings-head h3 {
  font-size: var(--text-dialog-title);
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

/* 面板用 v-show 而非 v-if：切页时 number-input 不卸载，@change 才不会被切页吞掉。
   弹窗定高，各页同高，切页不跳。
   横向内距 24 是标题、预览与设置行共同的对齐基准；顶部 12 让每个页签的首行
   （说明句或分组标题）落在同一条起跑线上，头与内容之间不再各页悬空不同的一截。 */
.settings-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: scroll;
  scrollbar-gutter: stable;
  padding: var(--space-3) var(--space-6) var(--space-6);
  display: flex;
  flex-direction: column;
}
.settings-pane::-webkit-scrollbar-thumb { background-color: var(--scrollbar-hover); }

/* 面板是 flex column 滚动容器：直接子项会被压扁再溢出，「模块」页 8 行的末两行
   就是这么消失的。子项一律保持自然高度，超出交给面板滚。 */
.settings-pane > * {
  flex-shrink: 0;
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
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
}
.workspace-theme-row { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: 364px; }

/* accent 色丸：一颗色点 + 名字，选中加 ring，尺寸落 28px action-btn 档 */
.accent-row {
  display: grid;
  grid-template-columns: repeat(6, max-content);
  gap: var(--space-2);
}
.accent-pill {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 12px;
  border-radius: 99px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--transition-fast, 0.15s), background 0.15s;
}
.accent-pill:hover { border-color: var(--border-strong); background: var(--hover); }
.accent-pill.on {
  border-color: var(--accent);
  color: var(--text);
  box-shadow: 0 0 0 2px var(--accent-ring);
}
.accent-dot {
  background: var(--accent);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex: none;
}
.accent-name { line-height: 1; }

.theme-chip {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--space-2);
  border: 1px solid var(--border);
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  /* button 不带 font-size 会落回浏览器默认 13.333px，比相邻文字粗一档 */
  font-size: var(--text-sm);
  transition: border-color var(--transition-slow), box-shadow var(--transition-slow), background var(--transition);
}
.theme-chip:hover { border-color: var(--border-strong); background: var(--hover); }
.theme-chip.on {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-ring);
  background: var(--bg-surface);
}

.theme-prev {
  background: var(--bg-app);
  position: relative;
  display: block;
  height: 64px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
/* 侧栏：占左边 30%，顶部一枚 accent 圆点当 logo，下面两条导航字条 */
.tp-rail {
  background: var(--bg-sidebar);
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 30%;
  border-right: 1px solid var(--border-navigation);
}
.tp-rail-dot {
  background: var(--accent);
  position: absolute;
  left: 5px;
  top: 5px;
  width: 7px;
  height: 7px;
  border-radius: 2px;
}
.tp-rail-line {
  background: var(--text);
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
  background: var(--bg-surface);
  display: flex;
  align-items: center;
  gap: 4px;
  height: 14px;
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 3px;
}
.tp-row-ink {
  background: var(--text);
  width: 46%;
  height: 3px;
  border-radius: 2px;
  opacity: 0.75;
  position: relative;
}
.tp-row-tag {
  background: var(--accent);
  margin-left: auto;
  width: 9px;
  height: 5px;
  border-radius: var(--radius-pill);
}
.tp-row:nth-child(2) { background: var(--bg-surface-hover); }
.workspace-theme-prev { width: 100%; height: auto; aspect-ratio: 16 / 10; background: var(--bg-workspace); }
.workspace-theme-prev .tp-rail { width: 12%; background: transparent; border: 0; }
.workspace-theme-prev .tp-rail-dot { left: 3px; top: 12px; width: 4px; height: 5px; }
.workspace-theme-prev .tp-rail-line { left: 3px; top: 26px; width: 4px; }
.workspace-theme-prev .tp-rail-line.short { top: 37px; width: 4px; }
/* 缩略图按新骨架重画：框（有色）→ 片（浅灰、圆角、柔影）→ 卡（白 + 发丝线）。
   缩略图只有一百来像素，三层明度差要比真实界面更狠才读得出来；影也按比例缩，
   不能直接搬浮片那套 16/36 的影。 */
.workspace-theme-prev .tp-sheet {
  position: absolute;
  left: calc(12% + 2px);
  right: 2px;
  top: 5px;
  bottom: 2px;
  border-radius: 4px;
  background: var(--bg-sheet);
  box-shadow: 0 1px 1px rgb(15 23 42 / 8%), 0 3px 7px -3px rgb(15 23 42 / 22%);
}
.workspace-theme-prev[data-base="dark"] .tp-sheet {
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%), 0 1px 2px rgb(0 0 0 / 45%);
}
.workspace-theme-prev .tp-rows { left: 14%; right: 4px; top: 8px; bottom: 4px; padding: 4px 28% 4px 4px; gap: 4px; justify-content: center; }
.workspace-theme-prev .tp-row { height: 11px; flex-shrink: 0; padding: 0 3px; background: var(--bg-card); border-color: var(--border-card); box-shadow: 0 1px 1px rgb(15 23 42 / 6%); }
.workspace-theme-prev .tp-row:nth-child(2) { background: color-mix(in srgb, var(--text) 4%, var(--bg-card)); }
.workspace-theme-prev[data-base="dark"] .tp-row { box-shadow: 0 1px 1px rgb(0 0 0 / 40%); }
/* 目录栏在缩略图里只是一块空色块会显得没画完：给它两条行线，读成「一列条目」。 */
.tp-workspace-context { position: absolute; top: 16px; right: 3px; bottom: 2px; width: 20%; border-left: 1px solid var(--border-card); border-radius: 0 0 4px 0; background: transparent; }
.workspace-theme-prev .tp-workspace-context::before,
.workspace-theme-prev .tp-workspace-context::after {
  content: '';
  position: absolute;
  left: 3px;
  height: 2px;
  border-radius: 2px;
  background: var(--text);
  opacity: 0.18;
}
.workspace-theme-prev .tp-workspace-context::before { top: 8px; width: 60%; }
.workspace-theme-prev .tp-workspace-context::after { top: 15px; width: 44%; }
.theme-chip-name { font-size: var(--text-sm); font-weight: 600; color: var(--text); line-height: 1.3; }

/* 关于页不再是一座居中小岛：品牌就是页面上的第一块，左边缘与其他页签的正文对齐，
   版本走同一条行语言。居中只会让这一页看起来像没做完的启动画面。 */
.settings-about {
  display: flex;
  flex-direction: column;
}

.about-brand {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2) 0 var(--space-5);
}

/* 品牌标全站只有一种呈现：裸标 + 品牌渐变。
   这里原先额外套了一块紫色渐变底，等于第二套品牌渐变，切主题时它会跟不上标本身。 */
.about-logo {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
}

.about-info { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }

.about-name {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
}

.about-tagline {
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--text-secondary);
}

.about-version {
  font-size: var(--text-xs);
  color: var(--text-secondary);
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

/* 背板淡入的同时，面板从 0.985 抬起：只动 transform，不参与布局。 */
.dialog-enter-active .settings-dialog,
.dialog-leave-active .settings-dialog {
  transition: transform 0.2s cubic-bezier(.2, .8, .2, 1), opacity 0.2s ease;
}
.dialog-enter-from .settings-dialog,
.dialog-leave-to .settings-dialog {
  opacity: 0;
  transform: translateY(8px) scale(0.985);
}
@media (prefers-reduced-motion: reduce) {
  .dialog-enter-active .settings-dialog,
  .dialog-leave-active .settings-dialog { transition: opacity 0.2s ease; }
  .dialog-enter-from .settings-dialog,
  .dialog-leave-to .settings-dialog { transform: none; }
}

/* 600px 高的窗口里对话框只剩 504px，压紧左侧行距，让全部页签不用滚动就露出来。 */
@media (max-height: 660px) {
  .settings-nav { padding: 8px 12px; }
  .nav-brand { margin-bottom: 4px; }
  .nav-group + .nav-group { margin-top: 4px; }
  .nav-group-label { padding-bottom: 0; }
  .nav-tab { padding: 5px var(--space-2); }
  .nav-footer { margin-top: 0; }
}
</style>
