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
} from '../../services/codexState'
import { codexApi } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../../components/shared/AppIcon.vue'
import OptionSelect from '../../components/shared/OptionSelect.vue'
import { isWebRuntime } from '../../services/runtime'

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
    ? '已关闭，只在进页面或手动点「刷新配额」时取数'
    : `开着 Codex 页时每 ${quotaRefreshMinutes.value} 分钟静默取一次数，离开页面即停`
)

async function pickRefresh(minutes: string | number) {
  await saveQuotaSettings(Number(minutes), quotaAlertThreshold.value)
  syncQuotaTicker()
}

async function pickAlert(threshold: string | number) {
  await saveQuotaSettings(quotaRefreshMinutes.value, Number(threshold))
}

void loadStoragePaths()
void loadQuotaSettings()
if (!isWebRuntime()) void loadDirs()
</script>

<template>
  <div class="group-content">
    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-name">备份范围</span>
        <span class="setting-desc">Codex 只备份账号与账号配置；会话、历史和用量仅在本机，不参与坚果云备份、迁移导出或恢复。</span>
      </div>
    </div>
    <div v-if="storagePaths?.authPath" class="setting-item">
      <div class="setting-info">
        <span class="setting-name">官方凭据路径</span>
        <span class="setting-desc">当前账号的授权文件位置</span>
        <div class="codex-path">
          <code :title="storagePaths.authPath">{{ storagePaths.authPath }}</code>
          <button v-if="!isWebRuntime()" class="action-btn" type="button" @click="openCodexConfig">
            <AppIcon name="file" :size="13" />打开 config.toml
          </button>
        </div>
      </div>
    </div>
    <div v-else class="setting-item">
      <div class="setting-info">
        <span class="setting-name">官方凭据路径</span>
        <span class="setting-desc">还没有配置 Codex 账号</span>
      </div>
    </div>

    <div v-if="!isWebRuntime()" class="setting-item codex-wsl-setting">
      <div class="setting-info">
        <span class="setting-name">自动统计 WSL 会话</span>
        <span class="setting-desc">Windows 下默认开启，自动纳入正在运行的 WSL 发行版中用户目录和 root 下的 .codex。</span>
      </div>
      <label class="switch">
        <input type="checkbox" role="switch" aria-label="自动统计 WSL 会话" :checked="autoWsl" :disabled="!dirsReady || wslSaving" @change="toggleAutoWsl" />
        <span class="switch-slider"></span>
      </label>
    </div>

    <div v-if="!isWebRuntime()" class="setting-item codex-usage-dirs">
      <div class="setting-info">
        <label class="setting-name" for="codex-usage-extra-dirs">额外统计目录</label>
        <span id="codex-usage-dirs-desc" class="setting-desc">默认目录与自动识别的 WSL 目录无需填写。自定义 CODEX_HOME 或其他目录可在这里补充，每行一个绝对路径，用于「用量」页汇总。</span>
        <span class="setting-desc">手动补充 WSL 路径示例：<code>{{ wslExample }}</code>，请替换发行版和用户名。</span>
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
        <span class="setting-desc">填写包含 sessions / archived_sessions 的上级目录；留空不添加手动目录。</span>
        <span v-if="dirsError" class="codex-dirs-error" role="alert">{{ dirsError }}</span>
        <div class="codex-dirs-actions">
          <button v-if="!dirsReady && dirsError" type="button" class="action-btn" @click="loadDirs">重新读取目录配置</button>
          <button type="button" class="action-btn" :disabled="!dirsReady || dirsSaving || extraDirs === savedExtraDirs" @click="saveDirs">{{ dirsSaving ? '保存中…' : '保存统计目录' }}</button>
        </div>
      </div>
    </div>

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
        <span class="setting-desc">当前账号的 5 小时或周窗口低于阈值时提示一次，同一档位不重复打扰</span>
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
</template>

<style scoped>
.codex-usage-dirs .setting-desc, .codex-wsl-setting .setting-desc { white-space: normal; overflow-wrap: anywhere; line-height: 1.6; }
.codex-usage-dirs code { font-family: var(--font-mono); }
.codex-dirs-input {
  box-sizing: border-box;
  width: 100%;
  margin: var(--space-2) 0;
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
.codex-dirs-actions { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-2); }
.codex-dirs-error { color: var(--danger); font-size: var(--text-xs); overflow-wrap: anywhere; }
.codex-path {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.codex-path code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-secondary);
}
.codex-path .action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}
</style>
