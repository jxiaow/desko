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
  loadWslAuthStatus,
  saveWslAuthAutoSync,
  syncWslAuth,
  wslAuthStatus,
  wslAuthStatusBusy,
  wslAuthStatusError,
  wslAuthSyncing,
  wslAuthResults,
} from '../../services/codexState'
import { codexApi, type CodexWslAuthTarget, type CodexWslAuthTargetState } from '../../services/api/codex'
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

const wslAuthSaving = ref(false)
const wslAutoSync = computed(() => wslAuthStatus.value?.autoSync === true)
const wslSourceExpired = computed(() => wslAuthStatus.value?.source.expired === true)
const canSyncWslAuth = computed(() => {
  const status = wslAuthStatus.value
  return !!status
    && status.source.available
    && !status.source.expired
    && status.targets.length > 0
    && !wslAuthStatusBusy.value
    && !wslAuthSyncing.value
})

const WSL_TARGET_STATE_TEXT: Record<CodexWslAuthTargetState, string> = {
  empty: '未登录 · 待写入',
  same: '同账号 · 已最新',
  outdated: '同账号 · 待同步',
  newer: '同账号 · WSL 更新',
  'different-account': '其他账号 · 待同步',
  unreadable: '不可读 · 待替换',
  unknown: '待确认',
}

const WSL_TARGET_STATE_CLASS: Record<CodexWslAuthTargetState, string> = {
  empty: 'wsl-state-pending',
  same: 'wsl-state-ok',
  outdated: 'wsl-state-pending',
  newer: 'wsl-state-ok',
  'different-account': 'wsl-state-pending',
  unreadable: 'wsl-state-danger',
  unknown: 'wsl-state-muted',
}

function wslAuthWhen(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function wslTargetMeta(target: CodexWslAuthTarget): string {
  const parts: string[] = []
  if (target.email) parts.push(target.email)
  if (target.accessExpiresAt) parts.push(`凭据 ${wslAuthWhen(target.accessExpiresAt)}`)
  if (target.expired) parts.push('已过期')
  return parts.join(' · ')
}

const wslSyncSummary = computed(() => {
  const results = wslAuthResults.value
  if (!results) return ''
  if (!results.length) return '未检测到运行中的 WSL'
  const synced = results.filter((result) => result.status === 'synced').length
  const skipped = results.filter((result) => result.status === 'skipped').length
  const failed = results.filter((result) => result.status === 'failed').length
  if (!synced && !failed) return '所有目标已是最新'
  const parts: string[] = []
  if (synced) parts.push(`已同步 ${synced} 个`)
  if (skipped) parts.push(`跳过 ${skipped} 个`)
  if (failed) parts.push(`失败 ${failed} 个`)
  return parts.join('，')
})

const wslSyncFailures = computed(() =>
  (wslAuthResults.value ?? []).filter((result) => result.status === 'failed')
)
const wslSyncNotes = computed(() =>
  (wslAuthResults.value ?? []).filter((result) => result.status === 'synced' && result.message)
)

async function toggleWslAuthAutoSync(event: Event) {
  const input = event.target as HTMLInputElement
  const previous = wslAutoSync.value
  wslAuthSaving.value = true
  wslAuthStatusError.value = ''
  try {
    await saveWslAuthAutoSync(input.checked)
    toastStore.showToast(input.checked ? '已开启 WSL 登录态自动同步' : '已关闭 WSL 登录态自动同步')
  } catch (e) {
    input.checked = previous
    wslAuthStatusError.value = errText(e)
  } finally {
    wslAuthSaving.value = false
  }
}

async function syncWslAuthNow() {
  await syncWslAuth()
}

async function reloadWslAuthStatus() {
  await loadWslAuthStatus()
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
if (!isWebRuntime()) {
  void loadDirs()
  void loadWslAuthStatus()
}
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
        </div>
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
        <span class="setting-desc">Codex 客户端使用的 config.toml</span>
        <div class="codex-path">
          <code :title="storagePaths.configPath">{{ storagePaths.configPath }}</code>
          <button class="action-btn" type="button" @click="openCodexConfig">
            <AppIcon name="file" :size="13" />打开 config.toml
          </button>
        </div>
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

    <div v-if="!isWebRuntime()" class="setting-item codex-wsl-auth-setting">
      <div class="setting-info">
        <span class="setting-name">WSL 登录态同步</span>
        <span class="setting-desc">把 Windows 侧 Codex 的登录凭据同步到运行中的 WSL；只写 auth.json，不动 config.toml。打开开关后，切号成功或进入 Codex 页时自动同步（10 分钟内最多一次）。</span>

        <div
          v-if="wslAuthStatusBusy && !wslAuthStatus"
          class="wsl-auth-summary"
        >正在读取 Windows 登录状态…</div>
        <div
          v-else-if="wslAuthStatusError"
          class="wsl-auth-summary wsl-auth-error"
          role="alert"
        >{{ wslAuthStatusError }}</div>
        <div
          v-else-if="wslAuthStatus"
          class="wsl-auth-summary"
          :class="{ 'wsl-auth-error': !wslAuthStatus.source.available }"
        >
          <template v-if="wslAuthStatus.source.available">
            Windows 登录：<strong>{{ wslAuthStatus.source.email || '未知账号' }}</strong>
            <template v-if="wslAuthStatus.source.plan"> · {{ wslAuthStatus.source.plan }}</template>
            <template v-if="wslAuthStatus.source.accessExpiresAt"> · 凭据 {{ wslAuthWhen(wslAuthStatus.source.accessExpiresAt) }}</template>
            <template v-if="wslAuthStatus.source.expired"> · </template><strong v-if="wslAuthStatus.source.expired" class="wsl-auth-expired">已过期</strong>
          </template>
          <template v-else>{{ wslAuthStatus.source.error || 'Windows 侧登录凭据不可用' }}</template>
        </div>

        <div
          v-if="wslAuthStatus?.targetError"
          class="wsl-auth-summary wsl-auth-error"
          role="alert"
        >读取 WSL 目标失败：{{ wslAuthStatus.targetError }}</div>
        <div v-else-if="wslAuthStatus?.targets.length" class="wsl-auth-targets">
          <div
            v-for="target in wslAuthStatus.targets"
            :key="`${target.distro}/${target.user}`"
            class="wsl-auth-target"
          >
            <div class="wsl-auth-target-head">
              <span class="wsl-auth-target-name">{{ target.distro }} / {{ target.user }}</span>
              <span class="wsl-auth-target-state" :class="WSL_TARGET_STATE_CLASS[target.state]">
                {{ WSL_TARGET_STATE_TEXT[target.state] }}
              </span>
            </div>
            <span v-if="wslTargetMeta(target)" class="wsl-auth-target-meta">{{ wslTargetMeta(target) }}</span>
          </div>
        </div>
        <div v-else-if="wslAuthStatus && !wslAuthStatusBusy" class="wsl-auth-summary wsl-auth-muted">
          未检测到运行中的 WSL。启动发行版后点「刷新状态」。
        </div>

        <span v-if="wslSourceExpired" class="wsl-auth-warning">
          Windows 侧凭据已过期，请先在 Codex 中刷新或重新登录，再回来同步。
        </span>

        <div class="wsl-auth-actions">
          <button type="button" class="action-btn" :disabled="!canSyncWslAuth" @click="syncWslAuthNow">
            {{ wslAuthSyncing ? '同步中…' : '立即同步' }}
          </button>
          <button
            type="button"
            class="action-btn"
            :disabled="wslAuthStatusBusy || wslAuthSyncing"
            @click="reloadWslAuthStatus"
          >刷新状态</button>
          <span v-if="wslSyncSummary" class="wsl-auth-result">{{ wslSyncSummary }}</span>
        </div>

        <div v-if="wslSyncFailures.length || wslSyncNotes.length" class="wsl-auth-details">
          <span
            v-for="failure in wslSyncFailures"
            :key="`failed/${failure.distro}/${failure.user}`"
            class="wsl-auth-error"
          >{{ failure.distro }} / {{ failure.user }}：{{ failure.message }}</span>
          <span
            v-for="note in wslSyncNotes"
            :key="`note/${note.distro}/${note.user}`"
            class="wsl-auth-warning"
          >{{ note.distro }} / {{ note.user }}：{{ note.message }}</span>
        </div>
      </div>
      <label class="switch">
        <input
          type="checkbox"
          role="switch"
          aria-label="自动同步 WSL 登录态"
          :checked="wslAutoSync"
          :disabled="!wslAuthStatus || wslAuthSaving"
          @change="toggleWslAuthAutoSync"
        />
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
.codex-wsl-auth-setting { align-items: flex-start; }
.codex-wsl-auth-setting .setting-info { gap: 4px; }
.codex-wsl-auth-setting .setting-desc { white-space: normal; overflow-wrap: anywhere; line-height: 1.6; }
.wsl-auth-summary {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.wsl-auth-error { color: var(--danger); }
.wsl-auth-expired { color: var(--danger); font-weight: 600; }
.wsl-auth-warning {
  font-size: var(--text-xs);
  color: var(--warning);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.wsl-auth-muted { color: var(--text-muted); }
.wsl-auth-targets {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 4px 0;
  padding: 6px 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.wsl-auth-target { padding: 3px 0; }
.wsl-auth-target-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.wsl-auth-target-name { font-size: var(--text-xs); color: var(--text); }
.wsl-auth-target-state { font-size: var(--text-xs); flex-shrink: 0; }
.wsl-auth-target-meta {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.wsl-state-ok { color: var(--success); }
.wsl-state-pending { color: var(--warning); }
.wsl-state-danger { color: var(--danger); }
.wsl-state-muted { color: var(--text-muted); }
.wsl-auth-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-top: 4px;
}
.wsl-auth-result { font-size: var(--text-xs); color: var(--text-secondary); }
.wsl-auth-details { display: flex; flex-direction: column; gap: 2px; }
.wsl-auth-details span { font-size: var(--text-xs); line-height: 1.6; overflow-wrap: anywhere; }
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
