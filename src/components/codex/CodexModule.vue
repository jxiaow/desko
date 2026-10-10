<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { codexApi, type CodexAccount } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import {
  accounts,
  currentId,
  loaded,
  busyId,
  switchStep,
  applySwitchProgress,
  type SwitchProgress,
  refreshAccounts,
  refreshQuotas,
  runOn,
  switchTo,
} from '../../services/codexState'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'
import AppIcon from '../shared/AppIcon.vue'
import PopoverMenu from '../shared/PopoverMenu.vue'
import CodexAuthDialog from './CodexAuthDialog.vue'
import CodexEditDialog from './CodexEditDialog.vue'
import ResetCreditDialog from './ResetCreditDialog.vue'

const toastStore = useToastStore()
const confirmStore = useConfirmStore()

const pickMode = ref(false)
const selected = ref<Set<string>>(new Set())
const menuAnchor = ref<HTMLElement | null>(null)
const menuAccount = ref<CodexAccount | null>(null)
const showAuth = ref(false)
const editAccount = ref<CodexAccount | null>(null)
const resetAccount = ref<CodexAccount | null>(null)

const isBatchMode = computed(() => pickMode.value || selected.value.size > 0)

const initial = (a: CodexAccount) => (a.account_name || a.email || '?').trim().charAt(0).toUpperCase()
const picked = (id: string) => selected.value.has(id)

/** 等级徽标：官方凭据里的档位优先，账号档位兜底 */
const tier = (a: CodexAccount) => (a.auth_file_plan_type || a.plan_type || '').trim().toUpperCase()

/** 订阅到期字段两种形状都会出现：ISO 串，或 unix 秒的字符串 */
function parseWhen(raw?: string | null): number | null {
  const v = (raw || '').trim()
  if (!v) return null
  if (/^\d+$/.test(v)) return Number(v) * 1000
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

const pad = (n: number) => String(n).padStart(2, '0')
const clockOf = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const dateTimeOf = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const shortId = (v?: string | null) => {
  const s = (v || '').trim()
  if (!s) return ''
  return s.length > 9 ? `${s.slice(0, 8)}…` : s
}

/** Team Name：personal 或非 team 计划一律「个人账户」，team 计划退到组织 ID */
function teamName(a: CodexAccount): string {
  const structure = (a.account_structure || '').trim().toLowerCase()
  const plan = (a.plan_type || '').trim().toLowerCase()
  const teamLike = plan === 'team' || plan === 'business' || plan === 'enterprise'
  if (structure.includes('personal') || (!structure && !teamLike)) return '个人账户'
  return shortId(a.organization_id) || '团队账户'
}

/** 官方 id_token 根部的 auth_provider 才说明当初是用什么登进去的（Password/Google/…） */
function decodeAuthProvider(idToken?: string | null): string {
  if (!idToken) return ''
  try {
    const seg = idToken.split('.')[1]
    if (!seg) return ''
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
    const raw = String(json?.auth_provider ?? '').trim()
    if (!raw) return ''
    const known: Record<string, string> = {
      google: 'Google', github: 'GitHub', microsoft: 'Microsoft', apple: 'Apple', password: 'Password',
    }
    return known[raw.toLowerCase()] ?? raw
  } catch {
    return ''
  }
}

const loginWith = (a: CodexAccount) =>
  a.auth_mode === 'apikey' ? 'API Key' : decodeAuthProvider(a.tokens?.id_token) || 'OAuth'

const expiryAt = (a: CodexAccount) => (a.auth_mode === 'apikey' ? null : parseWhen(a.subscription_active_until))
const expiryText = (a: CodexAccount) => {
  const at = expiryAt(a)
  if (!at) return ''
  return at <= Date.now() ? '订阅已过期' : `有效期至 ${dateTimeOf(at)}`
}
const expiryBad = (a: CodexAccount) => {
  const at = expiryAt(a)
  return !!at && at <= Date.now()
}

const resetCount = (a: CodexAccount) => a.quota?.reset_credits_available ?? 0
const updatedText = (a: CodexAccount) =>
  a.usage_updated_at ? `更新于 ${clockOf(a.usage_updated_at * 1000)}` : ''

/** 底行只跟"更紧的那条窗口"走：剩余更少的那个才是用户真正的约束 */
function quotaWhen(a: CodexAccount): string {
  const q = a.quota
  if (!q) return ''
  const hourlyTighter = q.hourly_percentage <= q.weekly_percentage
  const ts = hourlyTighter ? q.hourly_reset_time : q.weekly_reset_time
  if (!ts) return ''
  const ms = ts * 1000 - Date.now()
  if (ms <= 0) return `${hourlyTighter ? '5h' : '周'}即将重置`
  const mins = Math.round(ms / 60000)
  const h = Math.floor(mins / 60)
  const rel =
    h >= 24
      ? h % 24 === 0
        ? `${h / 24}d`
        : `${Math.floor(h / 24)}d ${h % 24}h`
      : h >= 1
        ? mins % 60 === 0
          ? `${h}h`
          : `${h}h ${mins % 60}m`
        : `${mins}m`
  return `${hourlyTighter ? '5h' : '周'}重置 ${rel} · ${clockOf(ts * 1000)}`
}

function toggleSelect(id: string) {
  const s = new Set(selected.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selected.value = s
}

function togglePick() {
  if (isBatchMode.value) {
    pickMode.value = false
    selected.value = new Set()
  } else {
    pickMode.value = true
  }
}

function openMenu(el: HTMLElement, a: CodexAccount) {
  menuAnchor.value = el
  menuAccount.value = a
}

function closeMenu() {
  menuAnchor.value = null
  menuAccount.value = null
}

/** 行点击只在批量态有意义；非批量态点行不做核心动作，避免误触切号 */
function onRowClick(a: CodexAccount) {
  if (isBatchMode.value) toggleSelect(a.id)
}

async function doSwitch(a: CodexAccount) {
  if (busyId.value) return
  // 切号会覆写 ~/.codex 官方凭据文件，属破坏性动作，与档案切换同级先过确认
  confirmStore.showConfirm(
    '切换账号',
    `将把「${a.email}」写入官方凭据文件 ~/.codex。若 Codex 客户端还开着，请先退出它，否则运行中的会话可能继续用旧凭据。`,
    () => switchTo(a.id),
  )
}

async function copyEmail(a: CodexAccount) {
  try {
    await navigator.clipboard.writeText(a.email)
    toastStore.showToast('邮箱已复制')
  } catch {
    toastStore.showToast('复制失败', 'error')
  }
}

async function exportJson(ids: string[]) {
  if (!ids.length) return
  try {
    const json = await codexApi.exportJson(ids)
    await navigator.clipboard.writeText(json)
    toastStore.showToast(`已导出 ${ids.length} 条账号的 JSON 到剪贴板`)
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
}

function askResetCredit(a: CodexAccount) {
  // 额度重置一按即扣且不可撤销，先开弹窗把可用次数与明细摆出来看清楚
  resetAccount.value = a
}

function askDelete(a: CodexAccount) {
  confirmStore.showConfirm('删除账号', `删除 ${a.email}？官方凭据不受影响，只移除 desko 里的这条记录。`, async () => {
    await runOn(a.id, () => codexApi.remove(a.id), '已删除')
  })
}

function askBatchDelete() {
  const ids = Array.from(selected.value)
  if (!ids.length) return
  confirmStore.showConfirm('删除账号', `删除选中的 ${ids.length} 条账号？官方凭据不受影响。`, async () => {
    try {
      await codexApi.removeMany(ids)
      selected.value = new Set()
      pickMode.value = false
      toastStore.showToast(`已删除 ${ids.length} 条账号`)
    } catch (e) {
      toastStore.showToast(errText(e), 'error')
    } finally {
      await refreshAccounts()
    }
  })
}

let unlisten: UnlistenFn[] = []

onMounted(async () => {
  void refreshAccounts()
  unlisten = (
    await Promise.all([
      listen<SwitchProgress>('codex:switch-progress', (e) => applySwitchProgress(e.payload)),
      listen<{ current_email: string; lowest_percentage: number; threshold: number }>(
        'quota:alert',
        (e) => {
          toastStore.showToast(
            `${e.payload.current_email} 剩余 ${e.payload.lowest_percentage}%，低于 ${e.payload.threshold}% 阈值`,
            'error'
          )
        }
      ),
    ])
  ).filter(Boolean)
})

onUnmounted(() => unlisten.forEach((f) => f()))
</script>

<template>
  <div class="content-inner">
    <div v-if="!loaded" class="rowlist" aria-hidden="true">
      <div class="skeleton-row" v-for="n in 3" :key="n">
        <span class="skeleton-block"></span>
        <span class="skeleton-line w40"></span>
      </div>
    </div>

    <template v-else>
      <div class="page-bar">
        <button class="btn-secondary bar-btn" type="button" :disabled="!accounts.length" @click="refreshQuotas(accounts.map((a) => a.id))">
          <AppIcon name="refresh" :size="13" />
          刷新配额
        </button>
        <button class="btn-secondary bar-btn" type="button" :disabled="!accounts.length" @click="togglePick">
          <AppIcon :name="isBatchMode ? 'check' : 'checkall'" :size="13" />
          {{ isBatchMode ? '退出选择' : '选择' }}
        </button>
        <button class="btn-primary add-btn" type="button" @click="showAuth = true">
          <AppIcon name="plus" :size="13" />
          添加账号
        </button>
      </div>

      <p v-if="switchStep" class="switch-line">
        <AppIcon name="refresh" :size="12" />
        {{ switchStep }}
      </p>

      <section class="clean-group-card">
        <div class="group-head">
          账号
          <span class="head-cnt">{{ accounts.length }} 个</span>
        </div>

        <div
          v-for="a in accounts"
          :key="a.id"
          class="group-row acc-row"
          :class="{ cur: a.id === currentId, picked: picked(a.id) }"
          :data-email="a.email"
          @click="onRowClick(a)"
        >
          <span v-if="isBatchMode" class="pick-box" :class="{ on: picked(a.id) }" aria-hidden="true">
            <AppIcon v-if="picked(a.id)" name="check" :size="12" />
          </span>
          <span class="grid-slot acc-ico" :class="{ on: a.id === currentId }">{{ initial(a) }}</span>

          <div class="acc-main">
            <div class="acc-l1">
              <span class="mail" :title="a.email">{{ a.account_name || a.email }}</span>
              <span v-if="a.id === currentId" class="chip on">当前</span>
              <span v-if="a.requires_reauth" class="chip warn">需重新登录</span>
              <span v-if="a.auth_mode === 'apikey'" class="chip">API Key</span>
              <span v-if="tier(a)" class="tier">{{ tier(a) }}</span>
            </div>

            <div class="acc-l2">
              <span v-if="a.auth_mode !== 'apikey'">Team Name：{{ teamName(a) }}</span>
              <span v-if="a.auth_mode === 'apikey' && a.api_provider_name">供应商：{{ a.api_provider_name }}</span>
              <span>使用 {{ loginWith(a) }} 登录</span>
              <span v-if="shortId(a.user_id) || shortId(a.account_id)">
                用户 ID：<b class="mono">{{ shortId(a.user_id) || shortId(a.account_id) }}</b>
              </span>
              <span v-if="a.auth_mode === 'apikey' && a.api_base_url">
                Base URL：<b class="mono">{{ a.api_base_url }}</b>
              </span>
            </div>

            <div class="acc-l3">
              <span v-if="expiryText(a)" :class="{ bad: expiryBad(a) }">{{ expiryText(a) }}</span>
              <span v-if="resetCount(a) > 0">重置 <b class="mono">{{ resetCount(a) }}</b> 次</span>
              <span v-if="a.tags?.length">标签：{{ a.tags.join(' / ') }}</span>
              <span v-if="updatedText(a)">{{ updatedText(a) }}</span>
            </div>
          </div>

          <div v-if="a.quota" class="acc-quota">
            <div class="q" :class="{ low: a.quota.hourly_percentage <= 20, mid: a.quota.hourly_percentage <= 40 && a.quota.hourly_percentage > 20 }">
              <span class="q-tag">5h</span>
              <span class="q-bar"><i :style="{ width: Math.max(0, Math.min(100, a.quota.hourly_percentage)) + '%' }"></i></span>
              <span class="q-num">{{ a.quota.hourly_percentage }}%</span>
            </div>
            <div class="q" :class="{ low: a.quota.weekly_percentage <= 20, mid: a.quota.weekly_percentage <= 40 && a.quota.weekly_percentage > 20 }">
              <span class="q-tag">周</span>
              <span class="q-bar"><i :style="{ width: Math.max(0, Math.min(100, a.quota.weekly_percentage)) + '%' }"></i></span>
              <span class="q-num">{{ a.quota.weekly_percentage }}%</span>
            </div>
            <span class="q-when">{{ quotaWhen(a) }}</span>
          </div>
          <div v-else class="acc-quota">
            <span class="q-when">未取到配额</span>
          </div>

          <span class="acc-acts">
            <button
              v-if="!isBatchMode && a.id !== currentId"
              class="action-btn primary"
              type="button"
              :disabled="!!busyId"
              @click.stop="doSwitch(a)"
            >
              {{ busyId === a.id ? '切换中' : '切换' }}
            </button>
            <span v-else-if="!isBatchMode" class="cur-mark"><AppIcon name="check" :size="15" /></span>
            <button class="ib acc-more" type="button" title="更多操作" aria-label="更多操作" @click.stop="openMenu($event.currentTarget as HTMLElement, a)">
              <AppIcon name="dots" :size="15" />
            </button>
          </span>
        </div>

        <div v-if="!accounts.length" class="empty-state">
          <div class="empty-icon"><AppIcon name="navCodex" :size="24" /></div>
          <div class="empty-title">还没有 Codex 账号</div>
          <div class="empty-desc">「添加账号」走官方 OAuth；也可以把本机 ~/.codex 里的凭据导进来</div>
        </div>

        <div v-else class="group-note">
          <AppIcon name="info" :size="13" />
          切号只改写官方凭据文件，desko 不代你重启 Codex。
        </div>

        <PopoverMenu v-if="menuAccount" :anchor="menuAnchor" :width="176" @close="closeMenu">
          <button class="pop-item" type="button" @click="runOn(menuAccount!.id, () => codexApi.refreshQuota(menuAccount!.id), '配额已刷新'); closeMenu()">
            <AppIcon name="refresh" :size="14" />刷新这一条配额
          </button>
          <button class="pop-item" type="button" @click="runOn(menuAccount!.id, () => codexApi.refreshProfile(menuAccount!.id), '账号信息已刷新'); closeMenu()">
            <AppIcon name="user" :size="14" />刷新订阅信息
          </button>
          <button class="pop-item" type="button" @click="runOn(menuAccount!.id, () => codexApi.forceRefreshTokens(menuAccount!.id), '令牌已刷新'); closeMenu()">
            <AppIcon name="shield" :size="14" />强制刷新令牌
          </button>
          <button
            v-if="(menuAccount.quota?.reset_credits_available ?? 0) > 0"
            class="pop-item"
            type="button"
            @click="askResetCredit(menuAccount!); closeMenu()"
          >
            <AppIcon name="undo" :size="14" />重置 5 小时额度
          </button>
          <span class="pop-sep"></span>
          <button class="pop-item" type="button" @click="editAccount = menuAccount; closeMenu()">
            <AppIcon name="edit" :size="14" />名称与备注
          </button>
          <button class="pop-item" type="button" @click="copyEmail(menuAccount!); closeMenu()">
            <AppIcon name="copy" :size="14" />复制邮箱
          </button>
          <button class="pop-item" type="button" @click="exportJson([menuAccount!.id]); closeMenu()">
            <AppIcon name="download" :size="14" />导出这一条 JSON
          </button>
          <span class="pop-sep"></span>
          <button class="pop-item danger" type="button" @click="askDelete(menuAccount!); closeMenu()">
            <AppIcon name="trash" :size="14" />删除
          </button>
        </PopoverMenu>
      </section>

      <div v-if="selected.size" class="batch-dock">
        <span class="dock-count">已选 {{ selected.size }} 条</span>
        <button class="dock-btn" type="button" @click="selected = new Set(accounts.map((a) => a.id))">
          <AppIcon name="checkall" :size="12" />全选
        </button>
        <button class="dock-btn" type="button" @click="refreshQuotas(Array.from(selected))">
          <AppIcon name="refresh" :size="12" />刷新配额
        </button>
        <button class="dock-btn" type="button" @click="exportJson(Array.from(selected))">
          <AppIcon name="download" :size="12" />导出所选 JSON
        </button>
        <span class="dock-sep"></span>
        <button class="dock-btn danger" type="button" @click="askBatchDelete">
          <AppIcon name="trash" :size="12" />删除选中
        </button>
        <button class="dock-btn" type="button" @click="togglePick">
          <AppIcon name="check" :size="12" />完成
        </button>
      </div>
    </template>

    <CodexAuthDialog v-if="showAuth" @close="showAuth = false" />
    <CodexEditDialog v-if="editAccount" :account="editAccount" @close="editAccount = null" />
    <ResetCreditDialog v-if="resetAccount" :account="resetAccount" @close="resetAccount = null" />
  </div>
</template>

<style scoped>
.content-inner { --font-mono: Consolas, 'Cascadia Mono', monospace; }
.mono { font-family: var(--font-mono); }

.add-btn { margin-left: auto }

/* 切号进度：只在切的那几秒出现，一行字，不遮罩整页 */
.switch-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 0;
  font-size: var(--text-xs);
  color: var(--accent);
}

.clean-group-card {
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  margin-bottom: var(--space-4);
}
.group-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 10px 16px 9px;
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
}
.head-cnt {
  margin-left: auto;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--text-faint);
  font-size: var(--text-2xs);
}
.group-note {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  border-top: 1px solid var(--border);
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.group-row { display: flex; align-items: center; gap: 10px; padding: 11px 16px }
.group-row + .group-row { border-top: 1px solid var(--border) }
/* 账号行三行事实，比其余页的 60px 轨加高 */
.acc-row { height: 88px; padding: 0 16px; cursor: default }
.acc-row.picked, .acc-row.cur { background: var(--accent-soft) }

.pick-box {
  width: 18px; height: 18px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border-strong, var(--border));
  border-radius: 5px; color: var(--accent-on);
}
.pick-box.on { background: var(--accent); border-color: var(--accent) }

.acc-ico.on { background: var(--accent); color: var(--accent-on) }
.acc-main { flex: 1; min-width: 0 }

/* L1 身份 · L2 身份事实（Team/登录方式/用户 ID） · L3 时效事实（有效期/重置/标签/更新于） */
.acc-l1 { display: flex; align-items: center; gap: 7px; min-width: 0 }
.acc-l1 .mail {
  font-size: var(--text-base); font-weight: 600; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chip.warn { background: var(--warning-soft); color: var(--warning) }
.chip.on { background: var(--accent-soft); color: var(--accent) }
.tier {
  flex-shrink: 0;
  font-family: var(--font-mono); font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.06em;
  line-height: 18px; padding: 1px 7px; border-radius: var(--radius-xs);
  background: var(--fill); color: var(--text-secondary);
}
.acc-l2, .acc-l3 { display: flex; align-items: center; gap: 6px; margin-top: 4px; min-width: 0 }
.acc-l2 { font-size: var(--text-xs); color: var(--text-muted) }
.acc-l3 { font-size: var(--text-xs); color: var(--text-secondary) }
.acc-l2 > span, .acc-l3 > span {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.acc-l2 > span + span::before, .acc-l3 > span + span::before {
  content: '·'; margin-right: 6px; color: var(--text-faint);
}
.acc-l3 .bad { color: var(--warning) }
.acc-l3 b { font-weight: 600; color: var(--text) }

.acc-quota { flex-shrink: 0; width: 196px; display: flex; flex-direction: column; gap: 4px }
.q { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-secondary) }
.q-tag { width: 18px; font-family: var(--font-mono); color: var(--text-faint) }
.q-bar {
  flex: 1; height: 4px; border-radius: 2px; background: var(--fill); overflow: hidden;
}
.q-bar i { display: block; height: 100%; background: var(--success); border-radius: 2px }
.q.mid .q-bar i { background: var(--warning) }
.q.low .q-bar i { background: var(--danger) }
.q-num { width: 34px; text-align: right; font-family: var(--font-mono) }
.q-when { font-size: var(--text-2xs); color: var(--text-faint) }

/* 行尾动作：不给 .grid-acts（那是条目卡的 hover 才显影的一档），这里必须常显 */
.acc-acts { display: flex; align-items: center; gap: 6px; flex-shrink: 0 }
.cur-mark { color: var(--accent); width: 30px; display: flex; justify-content: center }

.empty-state { padding: 34px 16px 30px; text-align: center }
.empty-icon { display: flex; justify-content: center; color: var(--text-muted); margin-bottom: 8px }
.empty-title { font-size: var(--text-sm); font-weight: 600; color: var(--text) }
.empty-desc { margin-top: 4px; font-size: var(--text-xs); color: var(--text-muted) }
</style>
