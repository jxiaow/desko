<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  storagePaths,
  loadStoragePaths,
  quotaRefreshMinutes,
  quotaAlertThreshold,
  QUOTA_REFRESH_CHOICES,
  QUOTA_ALERT_CHOICES,
  loadQuotaSettings,
  saveQuotaSettings,
  syncQuotaTicker,
  loadUsageExtraDirs,
  saveUsageExtraDirs,
  loadUsageAutoWsl,
  saveUsageAutoWsl,
  loadSwitchRestart,
  saveSwitchRestart,
  switchRestartWindows,
  switchRestartReady,
  switchRestartSaving,
  switchingId,
} from '../../services/codexState'
import { codexApi } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../../components/shared/AppIcon.vue'
import OptionSelect from '../../components/shared/OptionSelect.vue'
import CodexHudSprite from '../../components/codex/hud/CodexHudSprite.vue'
import { isWebRuntime } from '../../services/runtime'
import { appearance, polarityOf } from '../../services/theme'
import {
  hudEnabled,
  hudSkin,
  hudAmbient,
  hudPinned,
  loadHudSettings,
  saveHudEnabled,
  saveHudSkin,
  saveHudAmbient,
  saveHudPinned,
} from '../../services/codexHud'
import { HUD_SKINS, type CodexHudSkin, type CodexHudState } from '../../utils/codexHud'

const toastStore = useToastStore()
const extraDirs = ref('')
const savedExtraDirs = ref('')
const dirsReady = ref(false)
const dirsSaving = ref(false)
const dirsError = ref('')
const autoWsl = ref(true)
const wslSaving = ref(false)
const wslExample = String.raw`\\wsl.localhost\Ubuntu\home\用户名\.codex`

async function loadDirs() {
  dirsReady.value = false
  dirsError.value = ''
  try {
    const [dirs, enabled] = await Promise.all([loadUsageExtraDirs(), loadUsageAutoWsl()])
    extraDirs.value = dirs.join('\n')
    autoWsl.value = enabled
    savedExtraDirs.value = extraDirs.value
    dirsReady.value = true
  } catch (e) {
    dirsError.value = errText(e)
  }
}

async function toggleAutoWsl(event: Event) {
  const previous = autoWsl.value
  autoWsl.value = (event.target as HTMLInputElement).checked
  wslSaving.value = true
  dirsError.value = ''
  try {
    await saveUsageAutoWsl(autoWsl.value)
    toastStore.showToast(autoWsl.value ? '已开启 WSL 自动统计' : '已关闭 WSL 自动统计')
  } catch (e) {
    autoWsl.value = previous
    dirsError.value = errText(e)
  } finally {
    wslSaving.value = false
  }
}

async function saveDirs() {
  if (!dirsReady.value || dirsSaving.value) return
  dirsSaving.value = true
  dirsError.value = ''
  try {
    const dirs = [...new Set(extraDirs.value.split(/\r?\n/).map(dir => dir.trim()).filter(Boolean))]
    await saveUsageExtraDirs(dirs)
    extraDirs.value = dirs.join('\n')
    savedExtraDirs.value = extraDirs.value
    toastStore.showToast('额外统计目录已保存')
  } catch (e) {
    dirsError.value = errText(e)
  } finally {
    dirsSaving.value = false
  }
}

async function toggleSwitchRestart(event: Event) {
  const input = event.target as HTMLInputElement
  try { await saveSwitchRestart(input.checked) }
  catch (e) { toastStore.showToast(errText(e), 'error') }
  input.checked = switchRestartWindows.value
}

const openCodexConfig = async () => {
  try {
    await codexApi.openConfigToml()
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
}

const refreshOptions = computed(() =>
  QUOTA_REFRESH_CHOICES.map((m) => ({ value: m, label: m === 0 ? '不自动' : `${m} 分钟` }))
)
const alertOptions = computed(() =>
  QUOTA_ALERT_CHOICES.map((p) => ({ value: p, label: `剩余 ${p}%` }))
)

const refreshDesc = computed(() =>
  quotaRefreshMinutes.value === 0
    ? '仅手动刷新时更新'
    : 'Codex 页面或挂件开启时自动更新'
)

const hudSaving = ref(false)

const previewTheme = computed(() => ({
  theme: appearance.theme,
  base: polarityOf(appearance.theme),
  accent: appearance.accent,
  atmosphere: appearance.backgroundAtmosphere,
}))

const hudPreviews = computed(() =>
  HUD_SKINS.map((skin) => ({
    ...skin,
    state: {
      skin: skin.id,
      theme: previewTheme.value,
      primary: { label: '5h', percentage: 68 },
      secondary: { label: 'w', percentage: 42 },
      placeholder: null,
      severe: false,
      stale: false,
      placeholderAlert: false,
      today: { tokens: 1_942_000, costUsd: 12.34 },
      updatedAt: null,
    } satisfies CodexHudState,
  }))
)

async function toggleHud(event: Event) {
  const input = event.target as HTMLInputElement
  const next = input.checked
  hudSaving.value = true
  try {
    await saveHudEnabled(next)
    toastStore.showToast(next ? '桌面挂件已开启' : '桌面挂件已关闭')
  } catch (e) {
    input.checked = !next
    toastStore.showToast(errText(e), 'error')
  } finally {
    hudSaving.value = false
  }
}

async function toggleHudAmbient(event: Event) {
  const input = event.target as HTMLInputElement
  const next = input.checked
  hudSaving.value = true
  try {
    await saveHudAmbient(next)
    toastStore.showToast(next ? '角色会不时做小动作' : '角色保持安静')
  } catch (e) {
    input.checked = !next
    toastStore.showToast(errText(e), 'error')
  } finally {
    hudSaving.value = false
  }
}

async function toggleHudPinned(event: Event) {
  const input = event.target as HTMLInputElement
  hudSaving.value = true
  try {
    await saveHudPinned(input.checked)
  } catch (e) {
    input.checked = hudPinned.value
    toastStore.showToast(errText(e), 'error')
  } finally {
    hudSaving.value = false
  }
}

async function pickHudSkin(skin: CodexHudSkin) {
  if (skin === hudSkin.value) return
  try {
    await saveHudSkin(skin)
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
}

async function pickRefresh(minutes: string | number) {
  await saveQuotaSettings(Number(minutes), quotaAlertThreshold.value)
  syncQuotaTicker()
}

async function pickAlert(threshold: string | number) {
  await saveQuotaSettings(quotaRefreshMinutes.value, Number(threshold))
}

void loadStoragePaths()
void loadQuotaSettings()
if (!isWebRuntime()) {
  void loadDirs()
  void loadSwitchRestart().catch(e => toastStore.showToast(errText(e), 'error'))
  void loadHudSettings()
}
</script>

<template>
  <div class="codex-pane">
    <p class="pane-hint">Codex 备份与迁移仅含账号及配置，不含会话、历史和用量。</p>

    <h4 class="settings-section-label">凭据与文件</h4>
    <div class="group-content">
      <div v-if="storagePaths?.authPath" class="setting-item">
        <div class="setting-info">
          <span class="setting-name">官方凭据路径</span>
          <span class="setting-mono codex-path" :title="storagePaths.authPath"><code>{{ storagePaths.authPath }}</code></span>
        </div>
      </div>
      <div v-else class="setting-item">
        <div class="setting-info">
          <span class="setting-name">官方凭据路径</span>
          <span class="setting-desc">还没有配置 Codex 账号</span>
        </div>
      </div>

      <div v-if="storagePaths?.configPath && !isWebRuntime()" class="setting-item">
        <div class="setting-info">
          <span class="setting-name">配置文件</span>
          <span class="setting-mono codex-path" :title="storagePaths.configPath"><code>{{ storagePaths.configPath }}</code></span>
        </div>
        <div class="setting-actions">
          <button class="action-btn" type="button" @click="openCodexConfig">打开 config.toml</button>
        </div>
      </div>
    </div>

    <template v-if="!isWebRuntime()">
      <h4 class="settings-section-label">切换账号</h4>
      <div class="group-content">
        <div class="setting-item codex-restart-setting">
          <div class="setting-info">
            <span class="setting-name">切换账号时重启 Codex</span>
            <span class="setting-desc">{{ switchRestartWindows ? '重启 Windows 上的 Codex 应用与 CLI，CLI 返回原目录。' : '仅更新 Windows 登录账号，不重启 Codex。' }}</span>
            <span class="setting-desc">WSL 可在切换确认中单独勾选。</span>
            <span v-if="switchRestartWindows" class="codex-restart-warning"><AppIcon name="alert" :size="12" />正在运行的 Windows Codex 任务会中断。</span>
          </div>
          <label class="switch"><input type="checkbox" role="switch" aria-label="切换账号时重启 Codex" :checked="switchRestartWindows" :disabled="!switchRestartReady || switchRestartSaving || !!switchingId" @change="toggleSwitchRestart" /><span class="switch-slider"></span></label>
        </div>
      </div>
      <h4 class="settings-section-label">会话统计</h4>
      <div class="group-content">
        <div class="setting-item codex-wsl-setting">
          <div class="setting-info">
            <span class="setting-name">自动统计 WSL 会话</span>
            <span class="setting-desc">统计运行中 WSL 的用户和 root 目录下的 .codex 会话</span>
          </div>
          <label class="switch">
            <input type="checkbox" role="switch" aria-label="自动统计 WSL 会话" :checked="autoWsl" :disabled="!dirsReady || wslSaving" @change="toggleAutoWsl" />
            <span class="switch-slider"></span>
          </label>
        </div>

        <div class="setting-item stacked-row codex-usage-dirs">
          <div class="row-head">
            <div class="setting-info">
              <label class="setting-name" for="codex-usage-extra-dirs">额外统计目录</label>
              <span id="codex-usage-dirs-desc" class="setting-desc">每行一个 Codex 目录的绝对路径，自动识别的目录无需填写。</span>
            </div>
          </div>
          <div class="row-detail">
            <textarea
              id="codex-usage-extra-dirs"
              v-model="extraDirs"
              class="codex-dirs-input"
              rows="3"
              :placeholder="wslExample"
              :disabled="!dirsReady || dirsSaving"
              aria-describedby="codex-usage-dirs-desc"
              spellcheck="false"
            />
            <span class="codex-dirs-example">目录需包含 sessions 或 archived_sessions。WSL 路径请替换发行版与用户名。</span>
            <span v-if="dirsError" class="codex-dirs-error" role="alert">{{ dirsError }}</span>
            <div class="row-actions">
              <button v-if="!dirsReady && dirsError" type="button" class="action-btn" @click="loadDirs">重新读取目录配置</button>
              <button type="button" class="action-btn" :disabled="!dirsReady || dirsSaving || extraDirs === savedExtraDirs" @click="saveDirs">{{ dirsSaving ? '保存中…' : '保存统计目录' }}</button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <h4 class="settings-section-label">配额</h4>
    <div class="group-content">
      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-name">配额自动刷新</span>
          <span class="setting-desc">{{ refreshDesc }}</span>
        </div>
        <div class="setting-control">
          <OptionSelect
            :model-value="quotaRefreshMinutes"
            :options="refreshOptions"
            @update:model-value="pickRefresh"
          />
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-name">配额预警</span>
          <span class="setting-desc">当前账号的 5 小时或周额度低于阈值时提醒，同一档位仅提醒一次</span>
        </div>
        <div class="setting-control">
          <OptionSelect
            :model-value="quotaAlertThreshold"
            :options="alertOptions"
            @update:model-value="pickAlert"
          />
        </div>
      </div>
    </div>

    <div v-if="!isWebRuntime()" class="codex-hud-group">
      <h4 class="settings-section-label">桌面挂件</h4>
      <div class="group-content">
        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-name">桌面额度挂件</span>
            <span class="setting-desc">锁定后显示最近额度，解锁后恢复更新。</span>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="桌面额度挂件"
              :checked="hudEnabled"
              :disabled="hudSaving"
              @change="toggleHud"
            />
            <span class="switch-slider"></span>
          </label>
        </div>

        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-name">固定展开面板</span>
            <span class="setting-desc">关闭后悬停展开、移开收起；点击面板打开 Codex。</span>
          </div>
          <label class="switch">
            <input type="checkbox" role="switch" aria-label="固定展开面板" :checked="hudPinned" :disabled="hudSaving" @change="toggleHudPinned" />
            <span class="switch-slider"></span>
          </label>
        </div>

        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-name">桌面小动作</span>
            <span class="setting-desc">悬停或展开时暂停，点击角色切换动作。</span>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="桌面小动作"
              :checked="hudAmbient"
              :disabled="hudSaving"
              @change="toggleHudAmbient"
            />
            <span class="switch-slider"></span>
          </label>
        </div>
      </div>

      <div class="hud-skin-picker" role="radiogroup" aria-label="挂件皮肤">
        <button
          v-for="item in hudPreviews"
          :key="item.id"
          type="button"
          class="hud-skin"
          :class="{ active: hudSkin === item.id }"
          role="radio"
          :aria-checked="hudSkin === item.id"
          @click="pickHudSkin(item.id)"
        >
          <span class="hud-skin-frame">
            <CodexHudSprite :state="item.state" expanded idle />
            <span v-if="hudSkin === item.id" class="hud-skin-check" aria-hidden="true">
              <AppIcon name="check" :size="9" />
            </span>
          </span>
          <span class="hud-skin-name">{{ item.name }}</span>
          <span class="hud-skin-desc">{{ item.desc }}</span>
        </button>
      </div>

      <p class="hud-note">预览使用示例数据。额度来自当前账号，今日用量汇总本机全部账号。</p>
      <p v-if="quotaRefreshMinutes === 0" class="hud-warning">配额自动刷新已关闭，挂件额度不会自动更新。</p>
    </div>
  </div>
</template>

<style scoped>
.codex-usage-dirs .setting-desc, .codex-restart-setting .setting-desc { overflow-wrap: anywhere; }
.codex-restart-setting .setting-desc { display: block; overflow: visible; }
.codex-restart-warning { display: inline-flex; align-items: center; gap: 5px; margin-top: 5px; color: var(--warning); font-size: var(--text-description); line-height: 1.6; }
.codex-restart-setting .switch input { position: absolute; inset: -8px -4px; width: 44px; height: 36px; margin: 0; cursor: pointer; z-index: 1; }
.codex-restart-setting .switch input:focus-visible + .switch-slider { outline: 2px solid var(--accent); outline-offset: 2px; }
.codex-dirs-input {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.6;
  resize: vertical;
}
.codex-dirs-example {
  font-size: var(--text-description);
  line-height: 1.6;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.codex-dirs-example code { font-family: var(--font-mono); font-size: var(--text-2xs); }
.codex-dirs-error { color: var(--danger); font-size: var(--text-description); overflow-wrap: anywhere; }
/* 这一组被 .codex-hud-group 包着，组题成了父级的首子，
   全局「首子组题去掉上边距」会顺手吃掉组间 26px——留白改由包装器出。 */
.codex-hud-group { margin-top: 26px; }
/* 路径直接吃 .setting-mono 的单行省略；code 只是语义标签，别退回 UA 的 monospace */
.codex-path code { font-family: inherit; }
.hud-skin-picker { display: flex; gap: 10px; margin: 2px 0 10px; }
.hud-skin {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 136px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.hud-skin-frame {
  position: relative;
  display: grid;
  place-items: center;
  width: 136px;
  height: 144px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--fill);
  overflow: hidden;
}
.hud-skin.active .hud-skin-frame { border-color: var(--accent); }
.hud-skin:not(.active):hover .hud-skin-frame { border-color: var(--border-hover); }
.hud-skin:focus-visible { outline: none; }
.hud-skin:focus-visible .hud-skin-frame { outline: 2px solid var(--accent-ring); outline-offset: 2px; }
.hud-skin-check {
  position: absolute;
  top: 4px;
  right: 4px;
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-on);
}
.hud-skin-name { margin-top: 6px; font-size: var(--text-xs); font-weight: 500; color: var(--text); }
.hud-skin-desc { margin-top: 2px; font-size: var(--text-xs); line-height: 1.45; color: var(--text-muted); }
.hud-note { margin: 0 0 6px; font-size: var(--text-description); line-height: 1.6; color: var(--text-muted); }
.hud-warning { margin: 0; font-size: var(--text-description); line-height: 1.6; color: var(--warning); }
</style>
