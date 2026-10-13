<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { CodexSessionRecord, CodexSessionTokenStats } from '../../services/api/codex'
import { codexApi } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import {
  loadSessionTokens,
  loadSessions,
  moveSessionToTrash,
  sessionQuery,
  sessionTokens,
  sessions,
  sessionsBusy,
  sessionsError,
  sessionsLoaded,
} from '../../services/codexState'
import { useConfirmStore } from '../../stores/confirm'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../shared/AppIcon.vue'

const toastStore = useToastStore()
const confirmStore = useConfirmStore()

/** 官方目录一次全扫是重 I/O：进这一档才扫，扫过就留在内存，切回不重取 */
onMounted(() => {
  if (!sessionsLoaded.value) void loadSessions()
})

/** token 合计：known 用来区分「一条都没取到」与「真的没有用量」 */
interface TokenSum {
  input: number
  cached: number
  cacheWrite: number
  output: number
  reasoning: number
  total: number
  known: number
}

const emptySum = (): TokenSum => ({
  input: 0,
  cached: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
  total: 0,
  known: 0,
})

function addSum(acc: TokenSum, t: CodexSessionTokenStats): void {
  acc.input += t.inputTokens
  acc.cached += t.cachedInputTokens
  acc.cacheWrite += t.cacheWriteInputTokens
  acc.output += t.outputTokens
  acc.reasoning += t.reasoningOutputTokens
  acc.total += t.totalTokens
  acc.known += 1
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

const openKeys = ref<Set<string>>(new Set())
const openSessionId = ref('')

async function toggleGroup(key: string, ids: string[]) {
  const next = new Set(openKeys.value)
  if (next.has(key)) {
    next.delete(key)
    if (openSessionId.value && ids.includes(openSessionId.value)) openSessionId.value = ''
  } else {
    next.add(key)
    // 进档时已按全量预取过；这里只补预取失败或新出现在列表里的 id
    await loadSessionTokens(ids)
  }
  openKeys.value = next
}

const kindLabel = (kind: string) => (kind === 'subagent' ? '子代理' : kind === 'external' ? '外部' : '')

/** 后端没标题时把整条 UUID 原样填进 title（真机 64 条里 16 条如此），行上收成短 ID */
const idAsTitle = (s: CodexSessionRecord) => {
  const t = s.title.trim()
  return !t || t === s.sessionId
}
const titleText = (s: CodexSessionRecord) => (idAsTitle(s) ? `${s.sessionId.slice(0, 8)}…` : s.title.trim())
const titleTip = (s: CodexSessionRecord) => (idAsTitle(s) ? s.sessionId : s.title.trim())

function compact(n: number): string {
  const v = n >= 1_000_000 ? n / 1_000_000 : n >= 1_000 ? n / 1_000 : null
  if (v === null) return String(n)
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}${n >= 1_000_000 ? 'M' : 'K'}`
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 上次使用只到分：秒级抖动在这一档没有信息量 */
function whenText(sec: number | null | undefined): string {
  if (!sec) return ''
  const d = new Date(sec * 1000)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function recentText(rsec: number): string {
  if (!rsec) return '时间未知'
  const days = Math.floor((Date.now() / 1000 - rsec) / 86_400)
  if (days < 1) return '今天'
  if (days < 2) return '昨天'
  if (days < 30) return `${days} 天前`
  return `${Math.floor(days / 30)} 个月前`
}

const statsOf = (id: string) => sessionTokens.value[id]

/** 官方把每轮重发的上下文全记进 inputTokens；减掉缓存命中才是这条真正喂进去的新内容 */
const netInput = (t: NonNullable<ReturnType<typeof statsOf>>) => Math.max(t.inputTokens - t.cachedInputTokens, 0)
const num = (v: number) => v.toLocaleString()

/** 取回前留占位灰线：这一格迟早要有数，空着会被读成「没有用量」 */
function tokenText(id: string): string {
  const t = statsOf(id)
  if (!t) return ''
  return `输入 ${compact(netInput(t))} · 输出 ${compact(t.outputTokens)}`
}

/** 行上只给两位，缓存与推理这些进悬停 */
function tokenTip(id: string): string {
  const t = statsOf(id)
  if (!t) return ''
  return `净输入 ${num(netInput(t))} · 缓存命中 ${num(t.cachedInputTokens)} · 输出 ${num(t.outputTokens)}（含推理 ${num(t.reasoningOutputTokens)}）· 官方累计 ${num(t.totalTokens)}`
}

/** 详情段逐位铺开：官方口径与账单口径并排，别再让人拿 1.8M 去对账单 */
function tokenFacts(id: string): Array<[string, string]> {
  const t = statsOf(id)
  if (!t) return []
  return [
    ['净输入', num(netInput(t))],
    ['缓存命中', num(t.cachedInputTokens)],
    ['缓存写入', num(t.cacheWriteInputTokens)],
    ['输出', num(t.outputTokens)],
    ['其中推理', num(t.reasoningOutputTokens)],
    ['官方累计', num(t.totalTokens)],
  ]
}

/** 组头只在整组都有数时给合计，半截数会被读成这一组的真实用量 */
function groupTokText(g: { items: CodexSessionRecord[]; sum: TokenSum }): string {
  if (!g.items.length || g.sum.known < g.items.length) return ''
  return `累计 ${compact(g.sum.total)} tokens（净输入 ${compact(g.sum.input - g.sum.cached)} · 输出 ${compact(g.sum.output)}）`
}

const sumReady = computed(() => sessions.value.length > 0 && allSum.value.known === sessions.value.length)
const sumText = computed(() => {
  const a = allSum.value
  return `累计 ${compact(a.total)} tokens（净输入 ${compact(a.input - a.cached)} · 输出 ${compact(a.output)} · 缓存命中 ${compact(a.cached)}）`
})

let debounce: ReturnType<typeof setTimeout> | null = null
watch(sessionQuery, () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => void loadSessions(), 300)
})
onUnmounted(() => {
  if (debounce) clearTimeout(debounce)
})

/** 删除与开文件都是重 I/O 的官方目录动作：一次只允许一条在飞 */
const busyId = ref('')

async function runOnSession(id: string, fn: () => Promise<void>) {
  if (busyId.value) return
  busyId.value = id
  try {
    await fn()
  } finally {
    busyId.value = ''
  }
}

/** 无标题那条行上是短 ID，确认框里也得是短 ID，别放一串 UUID 进去吓人 */
function rowLabel(s: CodexSessionRecord): string {
  return idAsTitle(s) ? `${s.sessionId.slice(0, 8)}…` : s.title.trim()
}

function askTrash(s: CodexSessionRecord) {
  confirmStore.showConfirm(
    '移到回收站',
    `删除「${rowLabel(s)}」？desko 先把会话文件留底进回收站（可还原），再从官方 Codex 目录移除并更新会话索引。Codex 若在运行，需重启后其侧栏才同步。`,
    () => {
      void runOnSession(s.sessionId, async () => {
        try {
          toastStore.showToast(await moveSessionToTrash(s.sessionId))
          if (openSessionId.value === s.sessionId) openSessionId.value = ''
        } catch (e) {
          toastStore.showToast(errText(e), 'error')
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
      toastStore.showToast(errText(e) || failText, 'error')
    }
  })
}
</script>

<template>
  <div class="sess-view">
    <div v-if="sessionsBusy && !groups.length" class="rcard-list" aria-hidden="true">
      <div class="rcard sess-sk" v-for="n in 2" :key="n">
        <span class="skeleton-block"></span>
        <span class="skeleton-line w40"></span>
      </div>
    </div>

    <div v-else-if="sessionsError" class="rcard empty-state">
      <div class="empty-icon"><AppIcon name="alert" :size="24" /></div>
      <div class="empty-title">读不到官方会话目录</div>
      <div class="empty-desc" :title="sessionsError">{{ sessionsError }}</div>
      <button class="action-btn primary" type="button" @click="loadSessions()">重试</button>
    </div>

    <div v-else-if="!groups.length" class="rcard empty-state">
      <div class="empty-icon"><AppIcon name="navCodex" :size="24" /></div>
      <div class="empty-title">
        {{ sessionQuery.trim() ? '没有标题匹配的会话' : '官方 Codex 还没有会话记录' }}
      </div>
      <div class="empty-desc">
        {{ sessionQuery.trim() ? '换个关键词，或清空搜索框看全量' : '这一档列的是官方客户端留在本机的会话' }}
      </div>
    </div>

    <div v-else class="rcard-list">
      <div class="rcard sess-sum">
        <span v-if="sumReady" class="sum-text" :title="`已取数 ${allSum.known} / ${sessions.length} 条`">{{ sumText }}</span>
        <span v-else class="sum-text faint">token 取数中 · 已有 {{ allSum.known }} / {{ sessions.length }} 条</span>
      </div>

      <section v-for="g in groups" :key="g.key" class="rcard sess-group">
        <button
          class="grp-head"
          type="button"
          :aria-expanded="openKeys.has(g.key)"
          @click="toggleGroup(g.key, g.items.map((s) => s.sessionId))"
        >
          <span class="grp-name" :title="g.cwd">{{ g.name }}</span>
          <span v-if="groupTokText(g)" class="grp-tok mono-ish">{{ groupTokText(g) }}</span>
          <span class="grp-meta">{{ g.items.length }} 条 · {{ recentText(g.recent) }}</span>
          <AppIcon class="grp-caret" name="chevDown" :size="13" />
        </button>

        <div v-if="openKeys.has(g.key)" class="grp-body">
          <div v-for="s in g.items" :key="s.sessionId" class="sess">
            <button
              class="sess-row"
              type="button"
              :aria-expanded="openSessionId === s.sessionId"
              :data-sid="s.sessionId"
              @click="openSessionId = openSessionId === s.sessionId ? '' : s.sessionId"
            >
              <span class="sess-l1">
                <span class="sess-title" :title="titleTip(s)">{{ titleText(s) }}</span>
                <span v-if="s.sessionKind !== 'conversation'" class="badge off">{{ kindLabel(s.sessionKind) }}</span>
              </span>
              <span class="sess-l2">
                <span v-if="whenText(s.updatedAt)">上次使用 {{ whenText(s.updatedAt) }}</span>
                <span v-if="tokenText(s.sessionId)" :title="tokenTip(s.sessionId)">{{ tokenText(s.sessionId) }}</span>
                <span v-else class="tok-ph" aria-hidden="true"></span>
              </span>
            </button>

            <div v-if="openSessionId === s.sessionId" class="sess-card">
              <p class="sess-cwd mono" :title="s.cwd">{{ s.cwd || '工作目录未知' }}</p>
              <div class="sess-facts">
                <span :title="s.sessionId">会话 ID <b class="mono">{{ s.sessionId.slice(0, 12) }}</b></span>
                <span v-if="s.updatedAt">更新 {{ whenText(s.updatedAt) }}</span>
                <span v-for="[k, v] in tokenFacts(s.sessionId)" :key="k">{{ k }} <b class="mono">{{ v }}</b></span>
                <span v-if="!tokenFacts(s.sessionId).length">这条会话没有 token 记录</span>
              </div>
              <div class="sess-acts">
                <button
                  class="action-btn"
                  type="button"
                  :disabled="busyId === s.sessionId"
                  @click="openVia(codexApi.openSessionLocation, s.sessionId, '打开位置失败')"
                >
                  <AppIcon name="folder" :size="13" />打开位置
                </button>
                <button
                  class="action-btn"
                  type="button"
                  :disabled="busyId === s.sessionId"
                  @click="openVia(codexApi.openSessionRollout, s.sessionId, '打开会话文件失败')"
                >
                  <AppIcon name="file" :size="13" />打开会话文件
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
    </div>

    <p v-if="!groups.length && !sessionsError && !sessionsBusy" class="page-note">
      <AppIcon name="info" :size="13" />
      这一档列的是官方 Codex 留在本机的会话；移到回收站会先留底进 desko，再从官方目录移除。
    </p>
  </div>
</template>

<style scoped>
/* 页内第二档的分组卡：一档一枚项目卡，展开才往纸面下挂会话行（细线分行，不做卡中卡） */
.sess-sk {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 52px;
  padding: 0 14px;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

/* 合计量单占一行，坐在分组卡之上：组头那一档只放本组累计 */
.sess-sum {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 0 14px;
}
.sum-text {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}
.sum-text.faint {
  color: var(--text-faint);
}
.grp-tok {
  flex-shrink: 0;
  font-size: var(--text-2xs);
  color: var(--text-muted);
}
.mono-ish {
  font-family: var(--font-mono);
}
.grp-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 52px;
  padding: 0 14px;
  border: none;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.grp-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-md);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grp-meta {
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--text-faint);
}
.grp-caret {
  flex-shrink: 0;
  color: var(--text-faint);
  transition: transform var(--transition);
}
.grp-head[aria-expanded='true'] .grp-caret { transform: rotate(180deg); }

/* 展开体：纸面 + 发丝线断句，凹底只留给单条会话的详情那一段 */
.grp-body { border-top: 1px solid var(--border); }
.sess + .sess { border-top: 1px solid var(--border); }
.sess-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  width: 100%;
  padding: 9px 14px;
  border: none;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.sess-row:hover { background: var(--hover); }
.sess-l1 {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  width: 100%;
}
.sess-title {
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sess-l2 {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  width: 100%;
  font-size: var(--text-2xs);
  color: var(--text-muted);
}
/* token 未取回时的占位灰线：撑住行高，别让它读成「没有用量」 */
.tok-ph {
  display: inline-block;
  width: 58px;
  height: 8px;
  border-radius: 4px;
  background: var(--fill);
}
.sess-card {
  padding: var(--space-3) 14px;
  background: var(--sunken);
  border-top: 1px solid var(--border);
}
.sess-cwd {
  margin: 0 0 var(--space-2);
  font-size: var(--text-2xs);
  color: var(--text-secondary);
  word-break: break-all;
  line-height: 1.5;
}
.sess-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-size: var(--text-2xs);
  color: var(--text-muted);
}
/* 详情段的动作行：一颗颗走全局 .action-btn 的 28px 档，这里只排行程 */
.sess-acts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
</style>
