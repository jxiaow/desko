<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { CodexSessionRecord, CodexSessionTokenStats } from '../../services/api/codex'
import { codexApi } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import {
  loadSessionTokens,
  loadSessions,
  moveSessionToTrash,
  sessionOpenGroups,
  sessionOpenId,
  sessionQuery,
  sessionSearchMode,
  sessionTokens,
  sessionTokensLoaded,
  sessionTokensPending,
  sessionTokensError,
  sessions,
  sessionsBusy,
  sessionsError,
  sessionsLoaded,
} from '../../services/codexState'
import { useConfirmStore } from '../../stores/confirm'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../shared/AppIcon.vue'
import CodexUsageNotes from './CodexUsageNotes.vue'
import CodexLoadingSkeleton from './CodexLoadingSkeleton.vue'
import { formatTokenCount as compact, formatUsageCost, formatUsageCostDetail } from '../../utils/codexUsage'
import { isWebRuntime } from '../../services/runtime'
import { invoke } from '../../services/transport'
import { useEscapeClose } from '../../composables/useEscapeClose'
import { usePageAutoRefresh } from '../../composables/usePageAutoRefresh'
import { writeClipboardText } from '../../utils/clipboard'

const props = defineProps<{ locateSessionId?: string }>()
const emit = defineEmits<{ located: [] }>()

const toastStore = useToastStore()
const confirmStore = useConfirmStore()
let active = true
const webRuntime = isWebRuntime()
const sessionFile = ref<{ title: string; content: string } | null>(null)
useEscapeClose(() => { sessionFile.value = null }, () => sessionFile.value !== null)
async function readSessionFile(session: CodexSessionRecord) {
  await runOnSession(session.sessionId, async () => {
    try {
      const content = await invoke<string>('web_codex_read_session', { sessionId: session.sessionId })
      if (active) sessionFile.value = { title: titleText(session), content }
    } catch (e) { if (active) toastStore.showToast(errText(e), 'error') }
  })
}
function downloadSessionFile() {
  if (!sessionFile.value) return
  const url = URL.createObjectURL(new Blob([sessionFile.value.content], { type: 'application/x-ndjson' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'codex-session.jsonl'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** 重进页面与后台轮询保留已有读数、分组及会话展开态。 */
let locationReady = false
let locationHandled = false
async function locateRequestedSession() {
  const id = props.locateSessionId
  if (!active || !locationReady || locationHandled || !id || sessionsBusy.value || sessionsError.value) return
  locationHandled = true
  const target = sessions.value.find(session => session.sessionId === id)
  if (target) {
    sessionOpenGroups.value = new Set([...sessionOpenGroups.value, target.cwd.trim() || '∅'])
    sessionOpenId.value = id
    await nextTick()
    if (!active) return
    const row = document.querySelector<HTMLButtonElement>(`.sess-row[data-sid="${CSS.escape(id)}"]`)
    row?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: 'center' })
  } else {
    sessionOpenId.value = ''
    toastStore.showToast('这条会话已不在当前本地目录中', 'error')
  }
  emit('located')
}
onMounted(async () => {
  await loadSessions({ background: sessionsLoaded.value })
  locationReady = true
  void locateRequestedSession()
})
watch([sessionsBusy, sessions, sessionsError], () => { void locateRequestedSession() }, { flush: 'post' })
usePageAutoRefresh(() => loadSessions({ background: true }), () => sessionsBusy.value || sessionTokensPending.value.size > 0 || !!busyId.value || debounce !== null)

/** token 合计：known 用来区分「一条都没取到」与「真的没有用量」 */
interface TokenSum {
  input: number
  cached: number
  cacheWrite: number
  output: number
  reasoning: number
  total: number
  known: number
  requests: number
  cost: number | null
}

const emptySum = (): TokenSum => ({
  input: 0,
  cached: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
  total: 0,
  known: 0,
  requests: 0,
  cost: 0,
})

function addSum(acc: TokenSum, t: CodexSessionTokenStats): void {
  acc.input += t.inputTokens
  acc.cached += t.cachedInputTokens
  acc.cacheWrite += t.cacheWriteInputTokens
  acc.output += t.outputTokens
  acc.reasoning += t.reasoningOutputTokens
  acc.total += t.totalTokens
  acc.known += 1
  acc.requests += t.requestCount
  acc.cost = acc.cost != null && t.estimatedCostUsd != null ? acc.cost + t.estimatedCostUsd : null
}

const groups = computed(() => {
  const byCwd = new Map<
    string,
    { key: string; name: string; cwd: string; items: CodexSessionRecord[]; recent: number; sum: TokenSum }
  >()
  for (const s of sessions.value) {
    const key = s.cwd.trim() || '∅'
    let g = byCwd.get(key)
    if (!g) {
      g = { key, name: groupName(s), cwd: s.cwd.trim(), items: [], recent: 0, sum: emptySum() }
      byCwd.set(key, g)
    }
    g.items.push(s)
    g.recent = Math.max(g.recent, s.updatedAt ?? 0)
    const t = sessionTokens.value[s.sessionId]
    if (t) addSum(g.sum, t)
    else if (sessionTokensLoaded.value.has(s.sessionId)) g.sum.known += 1
  }
  for (const g of byCwd.values()) g.items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  return [...byCwd.values()].sort((a, b) => b.recent - a.recent)
})

const allSum = computed(() => {
  const acc = emptySum()
  for (const g of groups.value) {
    acc.input += g.sum.input
    acc.cached += g.sum.cached
    acc.cacheWrite += g.sum.cacheWrite
    acc.output += g.sum.output
    acc.reasoning += g.sum.reasoning
    acc.total += g.sum.total
    acc.known += g.sum.known
    acc.requests += g.sum.requests
    acc.cost = acc.cost != null && g.sum.cost != null ? acc.cost + g.sum.cost : null
  }
  return acc
})

/** 分组标题优先官方项目名，缺失时回退目录末段——与官方客户端的侧栏同一读法 */
function groupName(s: CodexSessionRecord): string {
  const named = (s.projectName || '').trim()
  if (named) return named
  const seg = s.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
  return seg.length ? seg[seg.length - 1] : '未知目录'
}

/** 展开态住在 store：切去用量再回来不该把翻开的组一起丢掉 */
const searching = computed(() => sessionQuery.value.trim() !== '')

function isOpen(key: string) {
  // 有搜索词时命中即展开：折叠态会把搜索结果藏在水下
  return searching.value || sessionOpenGroups.value.has(key)
}

function toggleGroup(key: string, ids: string[]) {
  const next = new Set(sessionOpenGroups.value)
  if (next.has(key)) {
    next.delete(key)
    if (sessionOpenId.value && ids.includes(sessionOpenId.value)) sessionOpenId.value = ''
  } else {
    next.add(key)
    // 进档时已按全量预取过；这里只补预取失败或新出现在列表里的 id
    void loadSessionTokens(ids)
  }
  sessionOpenGroups.value = next
}

const kindLabel = (kind: string) => (kind === 'subagent' ? '子代理' : kind === 'external' ? '外部' : '')

/** 没有标题时显示完整会话 ID，空间不足时由布局自动换行。 */
const idAsTitle = (s: CodexSessionRecord) => {
  const t = s.title.trim()
  return !t || t === s.sessionId
}
const titleText = (s: CodexSessionRecord) => (idAsTitle(s) ? s.sessionId : s.title.trim())
const titleTip = (s: CodexSessionRecord) => (idAsTitle(s) ? s.sessionId : s.title.trim())

const pad = (n: number) => String(n).padStart(2, '0')

/** 上次使用只到分：秒级抖动在这一档没有信息量 */
function whenText(sec: number | null | undefined): string {
  if (!sec) return ''
  const d = new Date(sec * 1000)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function recentText(rsec: number): string {
  if (!rsec) return '时间未知'
  const now = new Date()
  const then = new Date(rsec * 1000)
  const days = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
    - Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())) / 86_400_000)
  if (days < 1) return '今天'
  if (days < 2) return '昨天'
  if (days < 30) return `${days} 天前`
  return `${Math.floor(days / 30)} 个月前`
}

const statsOf = (id: string) => sessionTokens.value[id]
const tokensBusy = computed(() => sessionTokensPending.value.size > 0)
const tokensRead = (id: string) => !!statsOf(id) || sessionTokensLoaded.value.has(id)

/** 官方把每轮重发的上下文全记进 inputTokens；减掉缓存命中得到未命中缓存的输入，并不等同于用户新写的内容 */
const netInput = (t: NonNullable<ReturnType<typeof statsOf>>) => Math.max(t.inputTokens - t.cachedInputTokens, 0)
const num = (v: number) => v.toLocaleString()

/** 明细同样换算单位，完整计数放在数字提示里用于核对。 */
function tokenFacts(id: string): Array<[string, number]> {
  const t = statsOf(id)
  if (!t) return []
  return [
    ['净输入', netInput(t)],
    ['缓存命中', t.cachedInputTokens],
    ['缓存写入', t.cacheWriteInputTokens],
    ['输出', t.outputTokens],
    ['其中推理', t.reasoningOutputTokens],
    ['累计用量', t.totalTokens],
  ]
}

/** 组头只在整组都有数时给合计，半截数会被读成这一组的真实用量 */
function groupTokText(g: { items: CodexSessionRecord[]; sum: TokenSum }): string {
  if (!g.items.length || g.sum.known < g.items.length) return ''
  return `累计 ${compact(g.sum.total)} tokens（净输入 ${compact(g.sum.input - g.sum.cached)} · 输出 ${compact(g.sum.output)}）· ${num(g.sum.requests)} 次请求 · 估算金额 ${formatUsageCost(g.sum.cost)}`
}

const sumReady = computed(() => sessions.value.length > 0 && allSum.value.known === sessions.value.length)
const sumText = computed(() => {
  const a = allSum.value
  return `累计 ${compact(a.total)} tokens（净输入 ${compact(a.input - a.cached)} · 输出 ${compact(a.output)} · 缓存命中 ${compact(a.cached)}）· ${num(a.requests)} 次请求 · 估算金额 ${formatUsageCost(a.cost)}`
})
const heroSub = computed(() => {
  const a = allSum.value
  return `净输入 ${compact(a.input - a.cached)} · 输出 ${compact(a.output)} · 缓存命中 ${compact(a.cached)}`
})

let debounce: ReturnType<typeof setTimeout> | null = null
watch([sessionQuery, sessionSearchMode], () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    debounce = null
    void loadSessions()
  }, 300)
})
onUnmounted(() => {
  active = false
  if (debounce) clearTimeout(debounce)
})

/** 删除与开文件都是重 I/O 的官方目录动作：一次只允许一条在飞 */
const busyId = ref('')

async function runOnSession(id: string, fn: () => Promise<void>) {
  if (!active || busyId.value) return
  busyId.value = id
  try {
    await fn()
  } finally {
    busyId.value = ''
  }
}

/** 确认框与列表使用同一标题，便于核对要删除的会话。 */
function rowLabel(s: CodexSessionRecord): string {
  return titleText(s)
}

function askTrash(s: CodexSessionRecord) {
  confirmStore.showConfirm(
    '移到回收站',
    `将「${rowLabel(s)}」移入回收站？可恢复。运行中的 Codex 需重启后同步列表。`,
    () => {
      void runOnSession(s.sessionId, async () => {
        try {
          const message = await moveSessionToTrash(s.sessionId)
          if (!active) return
          toastStore.showToast(message)
          if (sessionOpenId.value === s.sessionId) sessionOpenId.value = ''
        } catch (e) {
          if (active) toastStore.showToast(errText(e), 'error')
        }
      })
    },
  )
}

function openVia(fn: (id: string) => Promise<void>, id: string, failText: string) {
  void runOnSession(id, async () => {
    try {
      await fn(id)
    } catch (e) {
      if (active) toastStore.showToast(errText(e) || failText, 'error')
    }
  })
}

async function copySessionValue(value: string, label: string) {
  try {
    await writeClipboardText(value)
    if (active) toastStore.showToast(`${label}已复制`)
  } catch (error) {
    if (active) toastStore.showToast(errText(error), 'error')
  }
}
</script>

<template>
  <div class="sess-view" :aria-busy="sessionsBusy || tokensBusy">
    <CodexLoadingSkeleton v-if="sessionsBusy && !groups.length" variant="sessions" />

    <div v-else-if="sessionsError && !groups.length" class="rcard empty-state">
      <div class="empty-icon"><AppIcon name="alert" :size="24" /></div>
      <h1 class="empty-title">读不到官方会话目录</h1>
      <div class="empty-desc" :title="sessionsError">{{ sessionsError }}</div>
      <button class="action-btn primary" type="button" @click="loadSessions()">重试</button>
    </div>

    <div v-else-if="!groups.length" class="rcard empty-state">
      <div class="empty-icon"><AppIcon name="navCodex" :size="24" /></div>
      <h1 class="empty-title">
        {{ sessionQuery.trim() ? (sessionSearchMode === 'content' ? '没有正文匹配的会话' : '没有标题匹配的会话') : '官方 Codex 还没有会话记录' }}
      </h1>
      <div class="empty-desc">
        {{ sessionQuery.trim() ? '更换关键词或清空搜索。' : '使用 Codex 后会显示在这里。' }}
      </div>
    </div>

    <div v-else class="rcard-list">
      <p v-if="sessionsError" class="page-note" role="status">刷新失败，显示上次结果：{{ sessionsError }}</p>
      <p v-if="sessionTokensError" class="page-note token-error" role="status">
        用量读取失败，已有读数保留。<button type="button" class="action-btn" :disabled="tokensBusy" @click="loadSessionTokens(sessions.map(s => s.sessionId), true)">重试统计</button>
      </p>
      <div class="rcard sess-hero" :title="sumReady ? sumText : undefined">
        <div class="hero-line">
          <h1 class="hero-scope">会话 <span>{{ groups.length }} 个项目 · {{ sessions.length }} 条</span></h1>
          <template v-if="sumReady">
            <span class="hero-num" :title="`${num(allSum.total)} Token`">{{ compact(allSum.total) }}</span>
            <span class="hero-unit">累计 Token</span>
          </template>
          <span v-else class="hero-placeholder" aria-hidden="true"></span>
        </div>
        <dl v-if="sumReady" class="sess-billing" aria-label="会话金额与请求数">
          <div><dt>估算金额（USD）</dt><dd :title="formatUsageCostDetail(allSum.cost)">{{ formatUsageCost(allSum.cost) }}</dd></div>
          <div><dt>请求数</dt><dd>{{ num(allSum.requests) }}</dd></div>
        </dl>
        <p class="hero-sub">
          <span v-if="sumReady">{{ heroSub }}</span>
          <span v-if="tokensBusy" class="hero-pending" role="status">{{ sumReady ? '更新用量中…' : '正在读取用量…' }}</span>
          <span v-else-if="!sumReady" class="hero-pending">部分用量未读取</span>
        </p>
      </div>

      <section v-for="g in groups" :key="g.key" class="rcard sess-group">
        <button
          class="grp-head"
          type="button"
          :aria-expanded="isOpen(g.key)"
          @click="toggleGroup(g.key, g.items.map((s) => s.sessionId))"
        >
          <AppIcon class="grp-folder" name="folder" :size="18" />
          <span class="grp-info">
            <span class="grp-l1">
              <span class="grp-name" :title="[g.name, g.cwd].filter(Boolean).join('\n')">{{ g.name }}</span>
              <span class="grp-meta">{{ g.items.length }} 条 · {{ recentText(g.recent) }}</span>
            </span>
            <span class="grp-path" :title="g.cwd">{{ g.cwd || '未知目录' }}</span>
            <span v-if="groupTokText(g)" class="grp-tok" :title="groupTokText(g)">
              <span>累计 <b>{{ compact(g.sum.total) }}</b> Token</span>
              <span>请求 <b>{{ num(g.sum.requests) }}</b> 次</span>
              <span>估算 <b :title="formatUsageCostDetail(g.sum.cost)">{{ formatUsageCost(g.sum.cost) }}</b></span>
            </span>
          </span>
          <AppIcon class="grp-caret" name="chevDown" :size="14" />
        </button>

        <div v-if="isOpen(g.key)" class="grp-body">
          <div v-for="s in g.items" :key="s.sessionId" class="sess">
            <button
              class="sess-row"
              type="button"
              :aria-expanded="sessionOpenId === s.sessionId"
              :data-sid="s.sessionId"
              :aria-label="`${titleTip(s)}，${sessionOpenId === s.sessionId ? '收起详情' : '展开详情'}`"
              @click="sessionOpenId = sessionOpenId === s.sessionId ? '' : s.sessionId"
            >
              <span class="sess-title" :class="{ mono: idAsTitle(s) }" :title="titleTip(s)">{{ titleText(s) }}</span>
              <span class="sess-meta">
                <span v-if="s.sessionKind !== 'conversation'" class="badge off">{{ kindLabel(s.sessionKind) }}</span>
                <span v-if="statsOf(s.sessionId)" class="sess-token" :title="`${num(statsOf(s.sessionId)!.totalTokens)} Token`">{{ compact(statsOf(s.sessionId)!.totalTokens) }} <small>Token</small></span>
                <span v-else-if="!tokensRead(s.sessionId) && tokensBusy" class="row-placeholder" aria-hidden="true"></span>
                <span v-else class="sess-token">—</span>
                <span v-if="whenText(s.updatedAt)" class="sess-time">{{ whenText(s.updatedAt) }}</span>
              </span>
              <AppIcon class="sess-caret" name="chevDown" :size="12" />
            </button>

            <div v-if="sessionOpenId === s.sessionId" class="sess-card">
              <dl class="sess-info" aria-label="会话信息">
                <div class="sess-location">
                  <dt>工作目录</dt>
                  <dd class="sess-cwd" :class="{ mono: !!s.cwd }" :title="s.cwd">{{ s.cwd || '未知' }}</dd>
                </div>
                <div class="sess-identity">
                  <dt>会话 ID</dt>
                  <dd class="mono" :title="s.sessionId">{{ s.sessionId }}</dd>
                </div>
                <div v-if="s.updatedAt">
                  <dt>更新时间</dt>
                  <dd>{{ whenText(s.updatedAt) }}</dd>
                </div>
              </dl>
              <dl v-if="tokenFacts(s.sessionId).length" class="sess-facts" aria-label="会话用量明细">
                <div v-for="[k, v] in tokenFacts(s.sessionId)" :key="k">
                  <dt>{{ k }}</dt>
                  <dd :title="`${num(v)} Token`">{{ compact(v) }}</dd>
                </div>
                <div><dt>请求数</dt><dd>{{ num(statsOf(s.sessionId)!.requestCount) }}</dd></div>
                <div><dt>估算金额（USD）</dt><dd :title="formatUsageCostDetail(statsOf(s.sessionId)!.estimatedCostUsd)">{{ formatUsageCost(statsOf(s.sessionId)!.estimatedCostUsd) }}</dd></div>
              </dl>
              <p v-else-if="!tokensRead(s.sessionId)" class="sess-no-usage" role="status">{{ tokensBusy ? '正在读取这条会话的用量…' : '用量尚未读取，请重试统计。' }}</p>
              <p v-else class="sess-no-usage">这条会话没有 Token 记录</p>
              <div class="sess-acts">
                <button class="action-btn" type="button" @click="copySessionValue(s.sessionId, '会话 ID')"><AppIcon name="copy" :size="13" />复制会话 ID</button>
                <button v-if="s.cwd" class="action-btn" type="button" @click="copySessionValue(s.cwd, '工作目录')"><AppIcon name="copy" :size="13" />复制工作目录</button>
                <button
                  class="action-btn"
                  type="button"
                  :disabled="busyId === s.sessionId"
                  v-if="!webRuntime"
                  @click="openVia(codexApi.openSessionLocation, s.sessionId, '打开位置失败')"
                >
                  <AppIcon name="folder" :size="13" />打开位置
                </button>
                <button
                  class="action-btn"
                  type="button"
                  :disabled="busyId === s.sessionId"
                  @click="webRuntime ? readSessionFile(s) : openVia(codexApi.openSessionRollout, s.sessionId, '打开会话文件失败')"
                >
                  <AppIcon name="file" :size="13" />{{ webRuntime ? '查看会话文件' : '打开会话文件' }}
                </button>
                <button
                  class="action-btn danger trash-btn"
                  type="button"
                  :disabled="busyId === s.sessionId"
                  @click="askTrash(s)"
                >
                  <AppIcon name="trash" :size="13" />移到回收站
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
      <CodexUsageNotes scope="sessions" />
    </div>

    <div v-if="sessionFile" class="dialog-overlay" @click.self="sessionFile = null">
      <section class="dialog session-file-dialog" role="dialog" aria-modal="true" aria-label="会话文件">
        <header class="dialog-header"><h3>{{ sessionFile.title }}</h3><button class="dialog-close" type="button" aria-label="关闭会话文件" @click="sessionFile = null"><AppIcon name="x" :size="16" /></button></header>
        <div class="dialog-body"><pre>{{ sessionFile.content }}</pre></div>
        <footer class="dialog-footer"><button class="btn-secondary" type="button" @click="downloadSessionFile">下载 JSONL</button><button class="btn-primary" type="button" @click="sessionFile = null">关闭</button></footer>
      </section>
    </div>
  </div>
</template>

<style scoped>
.sess-view { font-family: var(--font-ui); letter-spacing: normal; }
.sess-view .empty-title { margin: 0; }
.session-file-dialog { width: 800px; max-height: calc(100dvh - 32px); display: flex; flex-direction: column; }
.session-file-dialog .dialog-body { overflow: auto; }
.session-file-dialog pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--text-xs); }
.page-note { font-size: var(--text-xs); }
/* 总量作为列表摘要，收敛字号和字重，让会话标题保持清晰。 */
.sess-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-content: center;
  align-items: baseline;
  gap: 6px 24px;
  min-height: 72px;
  padding: 12px var(--space-5);
}
.hero-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-height: 22px;
}
.hero-scope { margin: 0 auto 0 0; font-size: var(--text-base); font-weight: 600; }
.hero-scope span { margin-left: 8px; font-size: var(--text-sm); font-weight: 400; color: var(--text-muted); }
.hero-num {
  font-size: var(--text-base);
  font-weight: 500;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}
.hero-unit { font-size: var(--text-xs); color: var(--text-muted); }
.sess-billing { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 0; }
.sess-billing > div { display: flex; align-items: baseline; gap: 8px; }
.sess-billing dt { font-size: var(--text-sm); color: var(--text-muted); }
.sess-billing dd { margin: 0; font-size: var(--text-base); font-weight: 500; font-variant-numeric: tabular-nums; color: var(--text); }
.hero-pending { font-size: var(--text-sm); color: var(--text-muted); }
.hero-placeholder, .row-placeholder { display: inline-block; background: var(--border); border-radius: 4px; animation: skeleton-pulse 1.5s ease-in-out infinite; }
.hero-placeholder { width: 90px; height: 18px; }
.row-placeholder { width: 75px; height: 12px; }
.hero-sub { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 16px; }
.hero-sub .hero-pending { font-size: var(--text-xs); }
.token-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.grp-folder { flex-shrink: 0; color: var(--text-muted); }
.grp-path { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-xs); color: var(--text-muted); }
.sess-token { flex: 0 0 100px; text-align: right; font-size: var(--text-sm); font-variant-numeric: tabular-nums; color: var(--text-secondary); white-space: nowrap; }
.sess-token small { font-size: inherit; color: var(--text-muted); }
.sess-caret { flex-shrink: 0; color: var(--text-muted); }
.sess-meta { display: flex; flex-shrink: 0; align-items: center; gap: 8px; }
.sess-row[aria-expanded='true'] { background: var(--hover); }
.sess-row[aria-expanded='true'] .sess-caret { transform: rotate(180deg); }
@media (prefers-reduced-motion: reduce) { .hero-placeholder, .row-placeholder { animation: none; } }
@media (max-width: 760px) { .sess-token { flex-basis: 76px; } .sess-token small { display: none; } }
.hero-sub {
  grid-column: 1 / -1;
  min-height: 18px;
  margin: 0;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
/* 组头合计行 */
.grp-tok > span { white-space: nowrap; }
.grp-tok b {
  margin-left: 4px;
  font-size: inherit;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}
.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: normal;
}
.grp-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 64px;
  padding: 10px 14px;
  border: none;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.grp-info {
  flex: 1;
  min-width: 0;
}
.grp-l1 {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}
.grp-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-base);
  font-weight: 600;
  line-height: 1.5;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grp-meta {
  flex-shrink: 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}
.grp-tok {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  margin-top: 3px;
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--text-muted);
}
.grp-caret {
  flex-shrink: 0;
  color: var(--text-muted);
  transition: transform var(--transition);
}
.grp-head[aria-expanded='true'] .grp-caret { transform: rotate(180deg); }

/* 沿用面板内细线分行的列表：项目为上层，会话只轻度缩进。 */
.grp-body { border-top: 1px solid var(--border); }
.sess + .sess { border-top: 1px solid var(--border); }
.sess-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 48px;
  padding: 8px 14px 8px 44px;
  border: none;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.sess-row:hover { background: var(--hover); }
.sess-title {
  flex: 1;
  min-width: 0;
  font-size: var(--text-base);
  font-weight: 400;
  line-height: 1.5;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sess-title.mono { font-size: var(--text-sm); overflow: visible; white-space: normal; overflow-wrap: anywhere; }
.sess-time { flex-shrink: 0; font-size: var(--text-xs); font-variant-numeric: tabular-nums; color: var(--text-muted); white-space: nowrap; }
.sess-card {
  padding: 12px 14px 12px 26px;
  background: var(--sunken);
  border-top: 1px solid var(--border);
}
.sess-info { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 24px; margin: 0; }
.sess-info > div { display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: baseline; gap: 8px; min-width: 0; }
.sess-info dt { font-size: var(--text-xs); line-height: 1.6; color: var(--text-muted); }
.sess-info dd {
  min-width: 0;
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  overflow-wrap: anywhere;
  line-height: 1.5;
}
.sess-info > .sess-location, .sess-info > .sess-identity { grid-column: 1 / -1; }
.sess-info dd { font-variant-numeric: tabular-nums; }
.sess-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px 28px;
  margin: 10px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.sess-facts > div { display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: baseline; gap: 8px; min-width: 0; }
.sess-facts dt { font-size: var(--text-xs); line-height: 1.5; color: var(--text-muted); }
.sess-facts dd {
  min-width: 0;
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.sess-no-usage { margin: 12px 0 0; font-size: var(--text-xs); color: var(--text-muted); }
/* 详情段的动作行：一颗颗走全局 .action-btn 的 28px 档，这里只排行程 */
.sess-acts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: 10px;
}
@media (max-width: 850px) {
  .sess-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 600px) {
  .sess-hero { grid-template-columns: minmax(0, 1fr); }
  .hero-line { flex-wrap: wrap; }
  .hero-scope { flex-basis: 100%; }
  .sess-billing { gap: 8px 16px; }
  .sess-row { display: grid; grid-template-columns: minmax(0, 1fr) 16px; gap: 6px 12px; padding: 12px 16px 12px 20px; }
  .sess-title { grid-column: 1; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .sess-title.mono { display: block; -webkit-line-clamp: unset; }
  .sess-meta { grid-column: 1; flex-wrap: wrap; min-width: 0; gap: 6px 12px; }
  .sess-token { flex-basis: auto; text-align: left; }
  .sess-token small { display: inline; }
  .sess-caret { grid-column: 2; grid-row: 1 / 3; }
  .sess-info, .sess-facts { grid-template-columns: minmax(0, 1fr); }
  .sess-card { padding-left: 20px; }
  .sess-acts .action-btn { min-height: 44px; }
}
</style>
