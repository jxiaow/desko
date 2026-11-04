<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { CodexSessionRecord, CodexSessionTokenStats } from '../../services/api/codex'
import { codexApi } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import {
  loadSessionTokens,
  loadSessions,
  moveSessionToTrash,
  moveSessionsToTrash,
  sessionDirectoryFilter,
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
import OptionSelect from '../shared/OptionSelect.vue'
import PopoverMenu from '../shared/PopoverMenu.vue'
import CodexSessionDetail from './CodexSessionDetail.vue'
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

/** 返回页面保留目录筛选与选中会话；刷新不改变列表布局。 */
let locationReady = false
let locationHandled = false
async function locateRequestedSession() {
  const id = props.locateSessionId
  if (!active || !locationReady || locationHandled || !id || sessionsBusy.value || sessionsError.value) return
  locationHandled = true
  const target = sessions.value.find(session => session.sessionId === id)
  if (target) {
    sessionDirectoryFilter.value = null
    await nextTick()
    if (!active) return
    sessionOpenId.value = id
    await nextTick()
    if (!active) return
    const row = Array.from(document.querySelectorAll<HTMLButtonElement>('.sess-row')).find(row => row.dataset.sid === id)
    row?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: 'nearest' })
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
  for (const g of scopedGroups.value) {
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

const directoryMenuAnchor = ref<HTMLElement | null>(null)
const directoryOptions = computed(() => {
  const options = [{ value: '*', label: '全部目录' }, ...groups.value.map(g => ({
    value: g.key, label: `${g.name} — ${g.cwd || '未知目录'}`,
  }))]
  const chosen = sessionDirectoryFilter.value
  if (chosen !== null && !options.some(option => option.value === chosen)) {
    options.push({ value: chosen, label: chosen === '∅' ? '未知目录' : chosen })
  }
  return options
})
const scopedGroups = computed(() => sessionDirectoryFilter.value === null
  ? groups.value : groups.value.filter(group => group.key === sessionDirectoryFilter.value))
const visibleSessions = computed(() => scopedGroups.value.flatMap(group => group.items)
  .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)))
const selected = computed(() => visibleSessions.value.find(s => s.sessionId === sessionOpenId.value) ?? null)
function setDirectory(value: string | number) {
  sessionDirectoryFilter.value = value === '*' ? null : String(value)
}
watch(sessionDirectoryFilter, () => {
  sessionOpenId.value = ''
  directoryMenuAnchor.value = null
})
function selectSession(session: CodexSessionRecord) {
  if (sessionOpenId.value === session.sessionId) { void closeDetail(); return }
  sessionOpenId.value = session.sessionId
  void loadSessionTokens([session.sessionId])
}
async function closeDetail() {
  const id = sessionOpenId.value
  sessionOpenId.value = ''
  await nextTick()
  if (!active) return
  Array.from(document.querySelectorAll<HTMLButtonElement>('.sess-row')).find(row => row.dataset.sid === id)?.focus({ preventScroll: true })
}
useEscapeClose(() => { void closeDetail() }, () => !!selected.value && !sessionFile.value)
watch(sessions, () => {
  if (sessionOpenId.value && !sessions.value.some(s => s.sessionId === sessionOpenId.value)) sessionOpenId.value = ''
})
function trashCurrentDirectory() {
  directoryMenuAnchor.value = null
  if (sessionDirectoryFilter.value !== null) void askTrashDirectory(sessionDirectoryFilter.value === '∅' ? '' : sessionDirectoryFilter.value)
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

const sumReady = computed(() => allSum.value.known === visibleSessions.value.length)
const sumText = computed(() => {
  const a = allSum.value
  return `累计 ${compact(a.total)} tokens（净输入 ${compact(a.input - a.cached)} · 输出 ${compact(a.output)} · 缓存命中 ${compact(a.cached)}）· ${num(a.requests)} 次请求 · 估算金额 ${formatUsageCost(a.cost)}`
})
const heroSub = computed(() => {
  const a = allSum.value
  return `净输入 ${compact(a.input - a.cached)} · 输出 ${compact(a.output)} · 缓存命中 ${compact(a.cached)}`
})

let debounce: ReturnType<typeof setTimeout> | null = null
// 空关键词的标题/正文模式查询完全相同；只在有效查询发生变化时刷新。
watch(() => {
  const query = sessionQuery.value.trim()
  return query ? JSON.stringify([sessionSearchMode.value, query]) : ''
}, () => {
  sessionOpenId.value = ''
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

async function askTrashDirectory(cwd: string) {
  await runOnSession('directory:' + cwd, async () => {
    try {
      // 搜索只影响展示；目录操作先读取完整列表，并在确认中明确数量和路径。
      const records = await codexApi.listSessions()
      if (!active) return
      const ids = records.filter(s => s.cwd.trim() === cwd.trim()).map(s => s.sessionId)
      if (!ids.length) { toastStore.showToast('此目录没有可移入回收站的会话'); return }
      confirmStore.showConfirm('将目录会话移到回收站',
        `将「${cwd || '未知目录'}」下的 ${ids.length} 条会话移入回收站？包含搜索未显示的会话，可从回收站恢复。不会删除项目文件。`,
        () => { void runOnSession('directory:' + cwd, async () => {
          try {
            const message = await moveSessionsToTrash(ids)
            if (!active) return
            if (ids.includes(sessionOpenId.value)) sessionOpenId.value = ''
            toastStore.showToast(message)
          } catch (e) { if (active) toastStore.showToast(errText(e), 'error') }
        }) })
    } catch (e) { if (active) toastStore.showToast(errText(e), 'error') }
  })
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
    <div v-if="sessionsLoaded && (sessions.length || sessionDirectoryFilter !== null)" class="sess-directory-bar">
      <AppIcon name="folder" :size="16" />
      <OptionSelect class="sess-directory-select" aria-label="目录筛选" :title="directoryOptions.find(option => option.value === (sessionDirectoryFilter ?? '*'))?.label" :model-value="sessionDirectoryFilter ?? '*'" :options="directoryOptions" :menu-width="360" @update:model-value="setDirectory" />
      <button v-if="sessionDirectoryFilter !== null" class="btn-secondary directory-menu-button" type="button" aria-label="目录操作" :disabled="!!busyId" :aria-expanded="!!directoryMenuAnchor" @click="directoryMenuAnchor = directoryMenuAnchor ? null : $event.currentTarget as HTMLElement"><AppIcon name="dots" :size="16" /></button>
      <span class="sess-result-count">{{ visibleSessions.length }} 条会话</span>
    </div>
    <PopoverMenu v-if="directoryMenuAnchor" :anchor="directoryMenuAnchor" :width="240" @close="directoryMenuAnchor = null">
      <button class="pop-item danger directory-trash" type="button" role="menuitem" @click="trashCurrentDirectory"><AppIcon name="trash" :size="14" />将此目录会话移到回收站</button>
    </PopoverMenu>
    <CodexLoadingSkeleton v-if="sessionsBusy && !groups.length" variant="sessions" />

    <div v-else-if="sessionsError && !groups.length" class="empty-state module-empty-state">
      <div class="empty-icon"><AppIcon name="alert" :size="24" /></div>
      <h1 class="empty-title">读不到官方会话目录</h1>
      <div class="empty-desc" :title="sessionsError">{{ sessionsError }}</div>
      <button class="action-btn primary" type="button" @click="loadSessions()">重试</button>
    </div>

    <div v-else-if="!groups.length" class="empty-state module-empty-state">
      <div class="empty-icon"><AppIcon name="navCodex" :size="24" /></div>
      <h1 class="empty-title">
        {{ sessionQuery.trim() ? (sessionSearchMode === 'content' ? '没有正文匹配的会话' : '没有标题匹配的会话') : '官方 Codex 还没有会话记录' }}
      </h1>
      <div class="empty-desc">
        {{ sessionQuery.trim() ? '更换关键词或清空搜索。' : '在 Codex 中开始一次对话，会话记录会自动显示在这里。' }}
      </div>
      <div v-if="sessionQuery.trim()" class="empty-actions"><button class="btn-secondary" type="button" @click="sessionQuery = ''">清空会话搜索</button></div>
      <p v-else class="empty-note">读取本机已有会话，无需手动添加</p>
    </div>

    <div v-else class="rcard-list">
      <p v-if="sessionsError" class="page-note" role="status">刷新失败，显示上次结果：{{ sessionsError }}</p>
      <p v-if="sessionTokensError" class="page-note token-error" role="status">
        用量读取失败，已有读数保留。<button type="button" class="action-btn" :disabled="tokensBusy" @click="loadSessionTokens(sessions.map(s => s.sessionId), true)">重试统计</button>
      </p>
      <div class="rcard sess-hero" :title="sumReady ? sumText : undefined">
        <div class="hero-line">
          <h1 class="hero-scope">会话 <span>{{ scopedGroups.length }} 个目录 · {{ visibleSessions.length }} 条</span></h1>
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

      <div class="sess-browser">
        <div class="sess-list">
          <article v-for="s in visibleSessions" :key="s.sessionId" class="rcard sess-item" :class="{ 'is-selected': sessionOpenId === s.sessionId }">
          <button class="sess-row" type="button"
            :data-sid="s.sessionId" :aria-expanded="sessionOpenId === s.sessionId" :aria-controls="`session-detail-${s.sessionId}`" :aria-label="`${titleTip(s)}，${sessionOpenId === s.sessionId ? '收起详情' : '展开详情'}`" @click="selectSession(s)">
            <span class="sess-main">
              <span class="sess-title" :class="{ mono: idAsTitle(s) }" :title="titleTip(s)">{{ titleText(s) }}</span>
              <span class="sess-meta">
                <span class="sess-path" :title="s.cwd || '未知目录'">{{ s.cwd || '未知目录' }}</span>
                <span v-if="whenText(s.updatedAt)" class="sess-time">{{ whenText(s.updatedAt) }}</span>
                <span v-if="s.sessionKind !== 'conversation'" class="badge off">{{ kindLabel(s.sessionKind) }}</span>
              </span>
            </span>
            <span v-if="statsOf(s.sessionId)" class="sess-token" :title="`${num(statsOf(s.sessionId)!.totalTokens)} Token`">{{ compact(statsOf(s.sessionId)!.totalTokens) }} <small>Token</small></span>
            <span v-else-if="!tokensRead(s.sessionId) && tokensBusy" class="row-placeholder" aria-hidden="true"></span>
            <span v-else class="sess-token">—</span>
            <span class="sess-toggle">{{ sessionOpenId === s.sessionId ? '收起' : '详情' }}<AppIcon name="chevDown" :style="{ transform: sessionOpenId === s.sessionId ? 'rotate(180deg)' : undefined }" :size="13" /></span>
          </button>
        <CodexSessionDetail v-if="sessionOpenId === s.sessionId" :id="`session-detail-${s.sessionId}`" :session="s" :updated-label="whenText(s.updatedAt)"
          :stats="statsOf(s.sessionId)" :facts="tokenFacts(s.sessionId)" :ready="tokensRead(s.sessionId)" :loading="tokensBusy"
          :busy="!!busyId" :web-runtime="webRuntime" @copy="copySessionValue"
          @location="openVia(codexApi.openSessionLocation, s.sessionId, '打开位置失败')"
          @file="webRuntime ? readSessionFile(s) : openVia(codexApi.openSessionRollout, s.sessionId, '打开会话文件失败')"
          @trash="askTrash(s)" />
          </article>
          <div v-if="!visibleSessions.length" class="rcard directory-empty">
            <p>当前目录没有匹配的会话</p>
            <button class="action-btn" type="button" @click="setDirectory('*')">查看全部目录</button>
          </div>
        </div>

      </div>
      <CodexUsageNotes scope="sessions" />
    </div>

    <Teleport to="body"><div v-if="sessionFile" class="dialog-overlay" @click.self="sessionFile = null">
      <section class="dialog session-file-dialog" role="dialog" aria-modal="true" aria-label="会话文件">
        <header class="dialog-header"><h3>{{ sessionFile.title }}</h3><button class="dialog-close" type="button" aria-label="关闭会话文件" @click="sessionFile = null"><AppIcon name="x" :size="16" /></button></header>
        <div class="dialog-body"><pre>{{ sessionFile.content }}</pre></div>
        <footer class="dialog-footer"><button class="btn-secondary" type="button" @click="downloadSessionFile">下载 JSONL</button><button class="btn-primary" type="button" @click="sessionFile = null">关闭</button></footer>
      </section>
    </div></Teleport>
  </div>
</template>

<style scoped>
.sess-view { container: codex-sessions / inline-size; }
.sess-view { font-family: var(--font-ui); letter-spacing: normal; }
.sess-view .empty-title { margin: 0; }
.session-file-dialog { width: 800px; max-height: calc(100dvh - 32px); display: flex; flex-direction: column; }
.session-file-dialog .dialog-body { overflow: auto; }
.session-file-dialog pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--text-xs); }
.page-note { font-size: var(--text-xs); }
/* 总量作为列表摘要，收敛字号和字重，让会话标题保持清晰。 */
.sess-hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-content: center;
  align-items: baseline;
  gap: 6px 24px;
  min-height: 72px;
  padding: 12px var(--space-5);
}
.sess-hero::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--accent);
  pointer-events: none;
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
  font-weight: 600;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
  color: var(--text-brand);
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
@media (prefers-reduced-motion: reduce) { .hero-placeholder, .row-placeholder { animation: none; } }
.hero-sub {
  grid-column: 1 / -1;
  min-height: 18px;
  margin: 0;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.sess-view > .rcard-list { margin-top: 0; padding-top: 0; }
.sess-hero { margin-bottom: 16px; }
.sess-directory-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; min-width: 0; color: var(--text-secondary); }
.sess-directory-bar :deep(.sess-directory-select) { flex: 0 0 auto; width: 320px; max-width: calc(100% - 140px); min-width: 0; }
.sess-directory-bar :deep(.sess-directory-select .opt-value) { min-width: 0; white-space: nowrap; }
.directory-menu-button { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; }
.sess-result-count { margin-left: auto; font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap; }
.sess-browser { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }

.sess-list { min-width: 0; display: grid; gap: 10px; }
.sess-row { border: 0; background: transparent; display: flex; align-items: center; gap: 16px; width: 100%; min-width: 0; min-height: 78px; margin: 0; padding: 16px 20px; text-align: left; color: var(--text); font: inherit; cursor: pointer; }
.sess-item { margin: 0; }
.sess-item.is-selected { border-color: color-mix(in srgb, var(--accent) 38%, var(--border-card)); }
.sess-toggle { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; font-size: var(--text-xs); color: var(--text-muted); }
.sess-main { flex: 1; min-width: 0; display: grid; gap: 7px; }
.sess-title { display: block; min-width: 0; font-size: var(--text-base); line-height: 1.5; font-weight: 500; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sess-title.mono { font-family: var(--font-mono); white-space: normal; overflow-wrap: anywhere; }
.sess-meta { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: var(--text-xs); color: var(--text-muted); }
.sess-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sess-time { flex-shrink: 0; font-variant-numeric: tabular-nums; }
.sess-token { flex-shrink: 0; min-width: 72px; text-align: right; font-size: var(--text-sm); font-variant-numeric: tabular-nums; color: var(--text-secondary); }
.sess-token small { display: block; font-size: var(--text-xs); color: var(--text-muted); margin-top: 4px; }
.directory-empty { padding: 24px; font-size: var(--text-sm); color: var(--text-secondary); text-align: center; }
@media (max-width: 600px) {
  .sess-hero { grid-template-columns: minmax(0, 1fr); }
  .hero-line { flex-wrap: wrap; }
  .hero-scope { flex-basis: 100%; }
  .sess-billing { gap: 8px 16px; }
  .sess-row { padding: 16px; flex-wrap: wrap; gap: 10px; }
  .sess-main { flex-basis: 100%; }
  .sess-title { white-space: normal; overflow-wrap: anywhere; }
  .sess-meta { flex-wrap: wrap; }
  .sess-path { flex-basis: 100%; }
  .sess-token { text-align: left; }
  .sess-token small { display: inline; margin-left: 4px; }
}
</style>
