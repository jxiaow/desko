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
import CodexHudSprite from '../../components/codex/hud/CodexHudSprite.vue'
import { isWebRuntime } from '../../services/runtime'
import { appearance, polarityOf } from '../../services/theme'
import {
  hudEnabled,
  hudSkin,
  hudWalk,
  loadHudSettings,
  saveHudEnabled,
  saveHudSkin,
  saveHudWalk,
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
    : `每 ${quotaRefreshMinutes.value} 分钟静默取一次数；Codex 页或桌面挂件开着时生效`
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

async function toggleHudWalk(event: Event) {
  const input = event.target as HTMLInputElement
  const next = input.checked
  hudSaving.value = true
  try {
    await saveHudWalk(next)
    toastStore.showToast(next ? '角色会在桌面慢走' : '角色停在原地')
  } catch (e) {
    input.checked = !next
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
  void loadWslAuthStatus()
  void loadHudSettings()
}
</script>

<template>
  <div class="codex-pane">
    <p class="pane-hint">Codex 只备份账号与账号配置；会话、历史和用量仅在本机，不参与坚果云备份、迁移导出或恢复。</p>

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
      <h4 class="settings-section-label">会话统计</h4>
      <div class="group-content">
        <div class="setting-item codex-wsl-setting">
          <div class="setting-info">
            <span class="setting-name">自动统计 WSL 会话</span>
            <span class="setting-desc">自动纳入正在运行的 WSL 发行版里用户目录和 root 下的 .codex</span>
          </div>
          <label class="switch">
            <input type="checkbox" role="switch" aria-label="自动统计 WSL 会话" :checked="autoWsl" :disabled="!dirsReady || wslSaving" @change="toggleAutoWsl" />
            <span class="switch-slider"></span>
          </label>
        </div>

        <div class="setting-item stacked-row codex-wsl-auth-setting">
          <div class="row-head">
            <div class="setting-info">
              <span class="setting-name">WSL 登录态同步</span>
              <span class="setting-desc">把 Windows 侧的登录凭据写进运行中的 WSL，只动 auth.json、不碰 config.toml。开关打开后，切号成功或进入 Codex 页时自动同步一次，10 分钟内不重复。</span>
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

          <div class="row-detail">
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

            <div class="row-actions">
              <span v-if="wslSyncSummary" class="wsl-auth-result">{{ wslSyncSummary }}</span>
              <button type="button" class="action-btn" :disabled="wslAuthStatusBusy || wslAuthSyncing" @click="reloadWslAuthStatus">刷新状态</button>
              <button type="button" class="action-btn" :disabled="!canSyncWslAuth" @click="syncWslAuthNow">
                {{ wslAuthSyncing ? '同步中…' : '立即同步' }}
              </button>
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
        </div>

        <div class="setting-item stacked-row codex-usage-dirs">
          <div class="row-head">
            <div class="setting-info">
              <label class="setting-name" for="codex-usage-extra-dirs">额外统计目录</label>
              <span id="codex-usage-dirs-desc" class="setting-desc">默认目录与自动识别的 WSL 目录无需填写，这里只补自定义 CODEX_HOME 或其他目录；每行一个绝对路径，留空即只用自动目录。</span>
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
            <span class="codex-dirs-example">示例 <code>{{ wslExample }}</code>，把发行版和用户名换成你自己的；填包含 sessions / archived_sessions 的上级目录。</span>
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

    <div v-if="!isWebRuntime()" class="codex-hud-group">
      <h4 class="settings-section-label">桌面挂件</h4>
      <div class="group-content">
        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-name">桌面额度挂件</span>
            <span class="setting-desc">在桌面常驻一枚 Codex 额度角色：鼠标停上去展开额度与今日用量，移开收起；点角色钉住，点面板打开 Codex。系统托盘菜单里有同一颗开关。</span>
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
            <span class="setting-name">桌面走动</span>
            <span class="setting-desc">角色绕着你放的位置左右各 48px 慢走，鼠标一靠近就停；记下的位置仍是你放置的那一处。</span>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="桌面走动"
              :checked="hudWalk"
              :disabled="hudSaving"
              @change="toggleHudWalk"
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

      <p class="hud-note">预览为展开态示例数据 · 实际大小；额度取当前账号，今日用量为本机全部账号汇总。</p>
      <p v-if="quotaRefreshMinutes === 0" class="hud-warning">配额自动刷新已关闭，挂件额度不会自动更新。</p>
    </div>
  </div>
</template>

<style scoped>
.codex-wsl-auth-setting .setting-desc,
.codex-usage-dirs .setting-desc { overflow-wrap: anywhere; }
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
/* 目标列表是这一行的状态，不是另一层卡片：只用留白分行，不加线 */
.wsl-auth-targets { display: flex; flex-direction: column; gap: var(--space-2); }
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
.wsl-auth-result { font-size: var(--text-xs); color: var(--text-secondary); }
.wsl-auth-details { display: flex; flex-direction: column; gap: 2px; }
.wsl-auth-details span { font-size: var(--text-xs); line-height: 1.6; overflow-wrap: anywhere; }
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
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.codex-dirs-example code { font-family: var(--font-mono); font-size: var(--text-2xs); }
.codex-dirs-error { color: var(--danger); font-size: var(--text-xs); overflow-wrap: anywhere; }
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
.hud-note { margin: 0 0 6px; font-size: var(--text-xs); line-height: 1.6; color: var(--text-muted); }
.hud-warning { margin: 0; font-size: var(--text-xs); line-height: 1.6; color: var(--warning); }
</style>
