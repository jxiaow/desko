<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { CodexSessionRecord, CodexSessionTokenStats } from '../../services/api/codex'
import { codexApi } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import {
  loadSessionTokens,
  loadSessions,
  moveSessionToTrash,
  sessionGroupsSeeded,
  sessionOpenGroups,
  sessionOpenId,
  sessionQuery,
  sessionSearchMode,
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

/** 展开态住在 store：切去用量再回来不该把翻开的组一起丢掉 */
const searching = computed(() => sessionQuery.value.trim() !== '')

function isOpen(key: string) {
  // 有搜索词时命中即展开：折叠态会把搜索结果藏在水下
  return searching.value || sessionOpenGroups.value.has(key)
}

async function toggleGroup(key: string, ids: string[]) {
  const next = new Set(sessionOpenGroups.value)
  if (next.has(key)) {
    next.delete(key)
    if (sessionOpenId.value && ids.includes(sessionOpenId.value)) sessionOpenId.value = ''
  } else {
    next.add(key)
    // 进档时已按全量预取过；这里只补预取失败或新出现在列表里的 id
    await loadSessionTokens(ids)
  }
  sessionOpenGroups.value = next
}

/** 首屏别只给一排壳：进档把最近活动那一组摊开，播过一次就不再跟用户抢折叠权 */
watch(
  groups,
  (list) => {
    if (sessionGroupsSeeded.value || !list.length) return
    sessionGroupsSeeded.value = true
    sessionOpenGroups.value = new Set([list[0].key])
  },
  { immediate: true },
)

const kindLabel = (kind: string) => (kind === 'subagent' ? '子代理' : kind === 'external' ? '外部' : '')

/** 没有标题时显示完整会话 ID，空间不足时由布局自动换行。 */
const idAsTitle = (s: CodexSessionRecord) => {
  const t = s.title.trim()
  return !t || t === s.sessionId
}
const titleText = (s: CodexSessionRecord) => (idAsTitle(s) ? s.sessionId : s.title.trim())
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

/** 行上不给 token 读数：整行的悬停账（完整标题或完整 ID + 五口径）住这里 */
function rowTip(s: CodexSessionRecord): string {
  return [titleTip(s), tokenTip(s.sessionId)].filter(Boolean).join('\n')
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
const heroSub = computed(() => {
  const a = allSum.value
  return `${groups.value.length} 个项目 · ${sessions.value.length} 条会话 · 净输入 ${compact(a.input - a.cached)} · 输出 ${compact(a.output)} · 缓存命中 ${compact(a.cached)}`
})

let debounce: ReturnType<typeof setTimeout> | null = null
watch([sessionQuery, sessionSearchMode], () => {
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

/** 确认框与列表使用同一标题，便于核对要删除的会话。 */
function rowLabel(s: CodexSessionRecord): string {
  return titleText(s)
}

function askTrash(s: CodexSessionRecord) {
  confirmStore.showConfirm(
    '移到回收站',
    `删除「${rowLabel(s)}」？desko 先把会话文件留底进回收站（可还原），再从官方 Codex 目录移除并更新会话索引。Codex 若在运行，需重启后其侧栏才同步。`,
    () => {
      void runOnSession(s.sessionId, async () => {
        try {
          toastStore.showToast(await moveSessionToTrash(s.sessionId))
          if (sessionOpenId.value === s.sessionId) sessionOpenId.value = ''
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
        {{ sessionQuery.trim() ? (sessionSearchMode === 'content' ? '没有正文匹配的会话' : '没有标题匹配的会话') : '官方 Codex 还没有会话记录' }}
      </div>
      <div class="empty-desc">
        {{ sessionQuery.trim() ? '换个关键词，或清空搜索框看全量' : '这一档列的是官方客户端留在本机的会话' }}
      </div>
    </div>

    <div v-else class="rcard-list">
      <div class="rcard sess-hero" :title="sumReady ? sumText : undefined">
        <div class="hero-line">
          <template v-if="sumReady">
            <span class="hero-num">{{ compact(allSum.total) }}</span>
            <span class="hero-unit">累计 Token</span>
          </template>
          <span v-else class="hero-pending">Token 统计中 · 已获取 {{ allSum.known }} / {{ sessions.length }} 条</span>
        </div>
        <p class="hero-sub">{{ sumReady ? heroSub : '' }}</p>
      </div>

      <section v-for="g in groups" :key="g.key" class="rcard sess-group">
        <button
          class="grp-head"
          type="button"
          :aria-expanded="isOpen(g.key)"
          @click="toggleGroup(g.key, g.items.map((s) => s.sessionId))"
        >
          <span class="grp-info">
            <span class="grp-l1">
              <span class="grp-name" :title="[g.name, g.cwd].filter(Boolean).join('\n')">{{ g.name }}</span>
              <span class="grp-meta">{{ g.items.length }} 条 · {{ recentText(g.recent) }}</span>
            </span>
            <span v-if="groupTokText(g)" class="grp-tok" :title="groupTokText(g)">
              <span>累计 <b>{{ compact(g.sum.total) }}</b> Token</span>
              <span>净输入 <b>{{ compact(g.sum.input - g.sum.cached) }}</b></span>
              <span>输出 <b>{{ compact(g.sum.output) }}</b></span>
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
              :title="rowTip(s)"
              @click="sessionOpenId = sessionOpenId === s.sessionId ? '' : s.sessionId"
            >
              <span class="sess-title" :class="{ mono: idAsTitle(s) }">{{ titleText(s) }}</span>
              <span v-if="s.sessionKind !== 'conversation'" class="badge off">{{ kindLabel(s.sessionKind) }}</span>
              <span v-if="whenText(s.updatedAt)" class="sess-time">{{ whenText(s.updatedAt) }}</span>
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
                  <dd>{{ v }}</dd>
                </div>
              </dl>
              <p v-else class="sess-no-usage">这条会话没有 Token 记录</p>
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
.page-note { font-size: var(--text-xs); }
/* 页内第二档的分组卡：一档一枚项目卡，展开才往纸面下挂会话行（细线分行，不做卡中卡） */
.sess-sk {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 52px;
  padding: 0 14px;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

/* 用量 hero：与直连页 hero 同壳同字号，数字是账目不是健康判定，所以吃 --text 不吃 --success */
.sess-hero {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  min-height: 84px;
  padding: var(--space-4) var(--space-5);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
}
.hero-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-height: 40px;
}
.hero-num {
  font-size: 34px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.hero-unit { font-size: var(--text-xs); color: var(--text-muted); }
.hero-pending { font-size: var(--text-sm); color: var(--text-muted); }
.hero-sub {
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
  font-size: var(--text-sm);
  font-weight: 500;
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
  font-size: var(--text-md);
  font-weight: 600;
  line-height: 1.4;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grp-meta {
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.grp-tok {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  margin-top: 3px;
  font-size: var(--text-xs);
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
  min-height: 40px;
  padding: 0 14px 0 26px;
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
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 1.5;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sess-title.mono { overflow: visible; white-space: normal; overflow-wrap: anywhere; }
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
</style>
