<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { useCodexDialog } from '../../composables/useCodexDialog'
import { userText } from '../../utils/codexTurnReducer'
import { reasoningLabel } from '../../utils/codexReasoning'
import type { DialogEnvironment } from '../../services/api/codexDialog'
import { isWebRuntime } from '../../services/runtime'
import { usePageActive } from '../../composables/usePageActive'
import { useWorkspaceLayout, workspaceDirectoryKey, workspaceDirectoryTarget, workspaceToolbarTarget } from '../layout/workspaceLayout'
import CreateAction from '../shared/CreateAction.vue'
import PopoverMenu from '../shared/PopoverMenu.vue'
import AppIcon from '../shared/AppIcon.vue'
import CodexDialogMarkdown from './CodexDialogMarkdown.vue'
import CodexDialogApproval from './CodexDialogApproval.vue'
import CodexDialogConnection from './CodexDialogConnection.vue'
import CodexDialogActivity from './CodexDialogActivity.vue'
import CodexDialogComposer from './CodexDialogComposer.vue'

const { connection, directories, environment, environments, environmentsLoading, refreshEnvironments, cwd, workspace, models, account, threads, selected, turns, requests, draft, error, loading, historyLoading, refreshHistory,
  sending, stopping, model, effort, currentModel, busy, anyBusy, selectedThread, draftThreads, savedDrafts, draftId, openDraft, saveDraft, connect, selectThread, newConversation, send, stop, respond, refreshWorkspace, importIndex } = useCodexDialog()
const workspaceLayout = useWorkspaceLayout()
const pageActive = usePageActive()
const directory = inject(workspaceDirectoryKey)
const web = isWebRuntime()
const panel = ref<'project' | 'history' | null>(null)
const panelAnchor = ref<HTMLElement | null>(null)
const panelWidth = ref(420)
const historyQuery = ref('')
const projectQuery = ref('')
const addingProject = ref(false)
const searchInput = ref<HTMLInputElement>()
const projectSearch = ref<HTMLInputElement>()
const environmentLabel = computed(() => environment.value.kind === 'wsl' ? `WSL · ${environment.value.distro}` : environments.value.nativeLabel)
const filteredThreads = computed(() => threads.value.filter(t => t.title.toLowerCase().includes(historyQuery.value.trim().toLowerCase())))
const filteredDrafts = computed(() => draftThreads.value.filter(t => t.text.toLowerCase().includes(historyQuery.value.trim().toLowerCase())))
const filteredDirectories = computed(() => directories.value.filter(d => d.cwd.toLowerCase().includes(projectQuery.value.trim().toLowerCase())))
const scroll = ref<HTMLElement>()
const composer = ref<InstanceType<typeof CodexDialogComposer>>()
const follow = ref(true)
const selectedFile = ref('')
const copied = ref('')
const fileChanges = computed(() => turns.value.flatMap(t => t.items).filter(i => i.type === 'fileChange').flatMap(i => i.changes || []))
const files = computed(() => {
  const changes = new Map(fileChanges.value.map(change => [change.path, change]))
  return (workspace.value?.files || []).map(file => ({ ...file, diff: changes.get(file.path)?.diff || '' }))
})
const currentFile = computed(() => {
  const file = files.value.find(f => f.path === selectedFile.value)
  if (file) return file
  const change = [...fileChanges.value].reverse().find(f => f.path === selectedFile.value)
  return change ? { ...change, status: '', originalPath: undefined } : undefined
})
const diffLines = computed(() => currentFile.value?.diff?.split('\n') || [])
const lastTurn = computed(() => turns.value[turns.value.length - 1])
const taskStatus = computed(() => requests.value.length ? '等待你确认' : sending.value ? '正在发送…' : busy.value ? '正在回复…' : lastTurn.value?.status === 'interrupted' ? '回复已停止' : lastTurn.value?.error || lastTurn.value?.status === 'failed' ? '回复失败' : '')
const locked = computed(() => anyBusy.value || requests.value.length > 0 || connection.value === 'connecting')
function closePanel(focus = false) { panel.value = null; if (focus) panelAnchor.value?.focus() }
async function togglePanel(kind: 'project' | 'history', event: MouseEvent) {
  if (panel.value === kind) { closePanel(); return }
  saveDraft(); panel.value = kind; panelAnchor.value = event.currentTarget as HTMLElement
  panelWidth.value = Math.min(420, innerWidth - 24)
  historyQuery.value = ''; projectQuery.value = ''; addingProject.value = false
  await nextTick(); (kind === 'history' ? searchInput : projectSearch).value?.focus()
}
async function connectEnvironment(path: string, target: DialogEnvironment) {
  await connect(path, false, target)
  if (connection.value === 'ready') { closePanel(); follow.value = true }
}
async function chooseIndex() {
  try {
    const path = await open({ multiple: false, title: '导入 codex-web-ui 的 .local/threads.json', filters: [{ name: '会话索引', extensions: ['json'] }] })
    if (typeof path === 'string') await importIndex(path)
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
}
function sourceLabel(source?: string) { return source === 'cli' || source === 'exec' ? 'CLI' : source ? 'Codex' : 'Desko' }
function dateLabel(time: number) { return new Date(time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
function directoryName(path: string) { return path.replace(/[\\/]+$/, '').split(/[\\/]/).slice(-1)[0] || path }
function directoryEnvironment(target: DialogEnvironment) { return target.kind === 'wsl' ? `WSL · ${target.distro}` : environments.value.nativeLabel }
function modelLabel(id: string) { return models.value.find(m => (m.model || m.id) === id)?.displayName || id }
function hasDraft(id: string) { return savedDrafts.value.some(d => d.threadId === id && d.text.trim()) }
function startConversation() { if (locked.value) return; newConversation(); follow.value = true; closePanel(); composer.value?.focus() }
async function openThread(id: string) { closePanel(); follow.value = true; await selectThread(id); composer.value?.focus() }
function selectDraft(id: string) { openDraft(id); closePanel(); follow.value = true; composer.value?.focus() }
function showChanges() { closePanel(); if (!directory?.visible.value) directory?.toggle() }
function openWebSettings() { closePanel(); window.dispatchEvent(new CustomEvent('desko:open-settings-tab', { detail: 'web' })) }
function openFile(path: string) { selectedFile.value = path; showChanges() }
function fillDraft(text: string) { draft.value = draft.value ? `${draft.value}\n\n${text}` : text; composer.value?.focus() }
async function copyMessage(id: string, text: string) {
  try { await navigator.clipboard.writeText(text); copied.value = id }
  catch { error.value = '复制失败，请选中文本后复制。' }
}
function onScroll() { if (scroll.value) follow.value = scroll.value.scrollHeight - scroll.value.scrollTop - scroll.value.clientHeight < 60 }
function latest() { follow.value = true; scroll.value?.scrollTo({ top: scroll.value.scrollHeight }) }
function submit() { follow.value = true; void send() }
function followMessages() { if (follow.value && scroll.value) scroll.value.scrollTop = scroll.value.scrollHeight }
watch([turns, loading], async () => { await nextTick(); followMessages() }, { deep: true })
watch(selected, () => { selectedFile.value = ''; copied.value = ''; follow.value = true })
watch(() => workspace.value?.path, () => { selectedFile.value = ''; historyQuery.value = ''; follow.value = true })
let observer: ResizeObserver | undefined
watch(scroll, element => { observer?.disconnect(); if (element) observer?.observe(element) })
onMounted(() => { observer = new ResizeObserver(followMessages); if (scroll.value) observer.observe(scroll.value) })
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <section class="codex-dialog" aria-label="Codex 项目对话">
    <Teleport :to="workspaceToolbarTarget" :disabled="!workspaceLayout || !pageActive" defer>
      <div class="page-bar dialog-page-controls"><div class="page-actions">
        <button class="btn-secondary bar-btn" aria-label="历史对话" aria-haspopup="dialog" :disabled="!workspace || locked" :aria-expanded="panel === 'history'" @click="togglePanel('history', $event)"><AppIcon name="clock" :size="14" /><span>历史</span></button>
        <CreateAction class="bar-btn" label="新对话" :disabled="connection !== 'ready' || locked" @click="startConversation" />
      </div></div>
    </Teleport>
    <div class="dialog-context">
      <span class="scope-label">项目</span>
      <button class="select project-trigger" aria-label="选择项目" aria-haspopup="dialog" :disabled="locked" :aria-expanded="panel === 'project'" :title="workspace ? `${workspace.name} · ${environmentLabel}` : '选择项目'" @click="togglePanel('project', $event)"><AppIcon name="folder" :size="16" /><span>{{ workspace?.name || '选择项目' }}</span><small>{{ workspace ? environmentLabel : '' }}</small><AppIcon name="chevDown" :size="11" /></button>
      <p v-if="workspace" class="project-path" :title="workspace.path">{{ workspace.path }}</p>
      <span class="connection-state" role="status">{{ connection === 'ready' ? '已连接' : connection === 'connecting' ? '正在连接…' : '' }}</span>
    </div>
    <div v-if="error || connection === 'disconnected'" class="dialog-error" role="alert"><AppIcon name="alert" :size="16" /><span>{{ error || '连接已断开，草稿已保留。' }}</span><button v-if="cwd" class="text-action" aria-label="重新连接" :disabled="locked" @click="connect(cwd, true)">重新连接</button><button v-if="error" class="ib" aria-label="关闭提示" @click="error = ''"><AppIcon name="x" :size="14" /></button></div>
    <div v-if="!workspace" class="dialog-start"><h1>在项目里开始对话</h1><p>选择项目后，描述问题或告诉 Codex 你想完成什么。</p><CodexDialogConnection :environment="environment" :cwd="cwd" :environments="environments" :directories="directories" :disabled="connection === 'connecting'" :refreshing="environmentsLoading" @connect="connectEnvironment" @refresh="refreshEnvironments" @error="error = $event" /></div>
    <template v-else>
      <div ref="scroll" class="dialog-conversation" tabindex="0" aria-label="对话消息" @scroll="onScroll"><div class="conversation-inner">
        <p v-if="loading" class="dialog-loading" role="status">正在恢复对话…</p>
        <div v-else-if="!turns.length" class="dialog-welcome"><h1>在项目里开始对话</h1><p>描述问题，或告诉 Codex 你想完成什么。</p><div class="empty-suggestions"><button class="text-action" @click="fillDraft('帮我了解这个项目的结构和主要入口。')">了解项目</button><button class="text-action" @click="fillDraft('检查当前改动，找出有证据的问题，先不要修改文件。')">检查改动</button></div></div>
        <template v-else>
          <h1 class="thread-title">{{ selectedThread?.title || '新对话' }}</h1>
          <article v-for="turn in turns" :key="turn.id" class="dialog-turn" :aria-busy="turn.status === 'inProgress'">
            <template v-for="item in turn.items" :key="item.id">
              <div v-if="item.type === 'userMessage'" class="dialog-user-wrap"><div class="dialog-user" tabindex="0" title="双击放回输入框编辑" @dblclick="fillDraft(userText(item))">{{ userText(item) }}</div></div>
              <div v-else-if="item.type === 'agentMessage'" class="rcard dialog-response"><div class="response-heading"><AppIcon name="navCodex" :size="17" /><strong>Codex</strong><span v-if="turn.model" class="response-parameters" :title="`本条回复：${modelLabel(turn.model)}${turn.effort ? ` · ${reasoningLabel(turn.effort)}` : ''}`">{{ modelLabel(turn.model) }}<template v-if="turn.effort"> · {{ reasoningLabel(turn.effort) }}</template></span><button v-if="!['inProgress', 'pending'].includes(turn.status) && item.text" class="ib copy-message" :aria-label="copied === `${turn.id}:${item.id}` ? '已复制回复' : '复制回复'" @click="copyMessage(`${turn.id}:${item.id}`, item.text)"><AppIcon :name="copied === `${turn.id}:${item.id}` ? 'check' : 'copy'" :size="14" /></button></div><CodexDialogMarkdown :text="item.text || ''" /></div>
              <CodexDialogActivity v-else-if="item.type !== 'reasoning' || item.text || item.summary?.length" :item="item" @inspect="openFile" />
            </template>
            <p v-if="turn.error" class="turn-error" role="alert">{{ turn.error.message }}</p>
            <p v-if="turn.status === 'interrupted'" class="dialog-muted">任务已停止</p>
            <p v-if="['inProgress', 'pending'].includes(turn.status) && !turn.items.some(i => i.type !== 'userMessage')" class="dialog-muted" role="status">Codex 正在处理…</p>
          </article>
        </template>
      </div></div>
      <div class="dialog-bottom">
        <button v-if="!follow" class="text-action latest-message" @click="latest"><AppIcon name="chevDown" :size="14" />回到最新消息</button>
        <div v-if="requests.length" class="approval-tray" aria-label="等待处理"><CodexDialogApproval v-for="request in requests" :key="`${typeof request.id}:${request.id}`" :request="request" :respond="respond" :disabled="connection !== 'ready'" /></div>
        <CodexDialogComposer ref="composer" v-model="draft" v-model:model-id="model" v-model:effort="effort" :models="models" :current-model="currentModel" :status="taskStatus" :ready="connection === 'ready'" :loading="loading" :sending="sending" :busy="busy" :stopping="stopping" :approval="!!requests.length" @send="submit" @stop="stop" />
      </div>
    </template>
    <PopoverMenu v-if="panel && panelAnchor" :anchor="panelAnchor" :width="panelWidth" :align="panel === 'history' ? 'end' : 'start'" panel-class="codex-dialog-popover" role="dialog" :aria-label="panel === 'history' ? '当前项目历史' : '选择项目'" nested-menus @close="closePanel(true)">
      <template v-if="panel === 'history'">
        <div class="panel-heading"><h2>历史对话 <small>{{ workspace?.name }}</small></h2><button class="ib" aria-label="关闭历史对话" @click="closePanel(true)"><AppIcon name="x" :size="14" /></button></div>
        <label class="panel-search"><AppIcon name="search" :size="14" /><input ref="searchInput" v-model="historyQuery" aria-label="搜索历史对话" placeholder="搜索当前项目的对话…" /></label>
        <div class="history-options">
          <button v-for="entry in filteredDrafts" :key="entry.id" class="dialog-thread" :aria-current="!selected && draftId === entry.id ? 'true' : undefined" @click="selectDraft(entry.id)"><strong>{{ entry.text.slice(0, 42) }}<small class="draft-label">草稿</small></strong><span><small>Desko</small><time>{{ dateLabel(entry.updatedAt) }}</time></span></button>
          <button v-for="thread in filteredThreads" :key="thread.id" class="dialog-thread" :aria-current="selected === thread.id ? 'true' : undefined" :disabled="connection !== 'ready'" @click="openThread(thread.id)"><strong>{{ thread.title }}<small v-if="hasDraft(thread.id)" class="draft-label">草稿</small></strong><span><small>{{ sourceLabel(thread.source) }}</small><time>{{ dateLabel(thread.updatedAt) }}</time></span></button>
          <p v-if="!filteredThreads.length && !filteredDrafts.length" class="dialog-muted">{{ historyQuery ? '没有匹配的对话' : '这个项目还没有对话' }}</p>
        </div>
        <div class="history-foot"><span>包含当前项目的 CLI / Codex 记录</span><button class="ib" aria-label="同步 CLI 和 Codex 历史" :disabled="historyLoading || connection !== 'ready'" @click="refreshHistory"><AppIcon name="refresh" :size="14" /></button></div>
        <button v-if="!web" class="pop-item" :disabled="connection !== 'ready'" @click="chooseIndex"><AppIcon name="download" :size="14" />导入 Web UI 对话</button>
      </template>
      <template v-else>
        <div class="panel-heading"><h2>选择项目</h2><button class="ib" aria-label="关闭项目选择" @click="closePanel(true)"><AppIcon name="x" :size="14" /></button></div>
        <label class="panel-search"><AppIcon name="search" :size="14" /><input ref="projectSearch" v-model="projectQuery" aria-label="搜索项目" placeholder="搜索最近项目…" /></label>
        <div class="project-options"><button v-for="entry in filteredDirectories" :key="JSON.stringify(entry)" class="project-option pop-item" :disabled="locked" @click="connectEnvironment(entry.cwd, entry.environment)"><AppIcon name="folder" :size="16" /><span><strong>{{ directoryName(entry.cwd) }}<small>{{ directoryEnvironment(entry.environment) }}</small></strong><span :title="entry.cwd">{{ entry.cwd }}</span></span></button></div>
        <button class="pop-item" :disabled="locked" @click="addingProject = !addingProject"><AppIcon name="plus" :size="14" />添加项目 / 运行环境</button>
        <div v-if="addingProject" class="project-connection"><CodexDialogConnection compact :environment="environment" :cwd="cwd" :environments="environments" :directories="[]" :disabled="locked" :refreshing="environmentsLoading" @connect="connectEnvironment" @refresh="refreshEnvironments" @error="error = $event" /></div>
        <button v-if="workspace" class="pop-item" @click="showChanges"><AppIcon name="code" :size="14" />查看项目改动 <small>{{ files.length }}</small></button>
        <button v-if="cwd" class="pop-item" :disabled="locked" @click="connect(cwd, true).then(() => closePanel())"><AppIcon name="refresh" :size="14" />重新连接</button>
        <button v-if="!web" class="pop-item" @click="openWebSettings"><AppIcon name="external" :size="14" />设置 Web 访问</button>
        <p v-if="workspace" class="dialog-muted account-note">{{ account?.type === 'chatgpt' ? 'ChatGPT 登录' : account?.type ? 'Codex 已登录' : 'CLI 尚未登录' }}{{ account?.plan ? ` · ${account.plan}` : '' }}</p>
      </template>
    </PopoverMenu>
    <Teleport v-if="workspaceLayout && pageActive" :to="workspaceDirectoryTarget" defer>
      <div class="codex-directory">
        <p v-if="!workspace" class="dialog-muted">连接工作目录后查看改动。</p>
      <section v-else class="dialog-inspector" aria-label="工作区改动">
        <div class="inspector-title" data-workspace-directory-keep-open><span>{{ files.length }} 个改动文件</span><button class="dialog-icon" aria-label="刷新工作区改动" @click="refreshWorkspace"><AppIcon name="refresh" :size="15" /></button></div>
        <p v-if="workspace.error" class="dialog-muted">{{ workspace.error }}</p><div v-else-if="!files.length" class="inspector-empty"><AppIcon name="checkall" :size="24" /><strong>工作区没有改动</strong></div>
        <div class="git-files" data-workspace-directory-keep-open><button v-for="file in files" :key="file.path" class="git-file" :class="{ selected: selectedFile === file.path }" :aria-pressed="selectedFile === file.path" @click="selectedFile = selectedFile === file.path ? '' : file.path"><code>{{ file.status }}</code><span :title="file.originalPath ? `${file.originalPath} → ${file.path}` : file.path">{{ file.path }}</span><AppIcon name="chevRight" :size="12" /></button></div>
        <div v-if="currentFile" class="file-detail"><div class="file-detail-heading"><AppIcon name="file" :size="15" /><strong>{{ currentFile.path }}</strong></div><p v-if="currentFile.originalPath" class="dialog-muted">原路径：{{ currentFile.originalPath }}</p><div v-if="currentFile.diff" class="file-diff" aria-label="文件修改内容"><pre v-for="(line, index) in diffLines" :key="index" :class="{ added: line.startsWith('+') && !line.startsWith('+++'), removed: line.startsWith('-') && !line.startsWith('---') }">{{ line || ' ' }}</pre></div><p v-else class="dialog-muted">{{ fileChanges.some(c => c.path === currentFile?.path) ? '本次执行未返回文件差异。' : '当前对话没有此文件的修改记录。' }}</p><button class="dialog-button file-context-action" @click="fillDraft(`请审查文件 \`${currentFile!.path}\` 的当前改动，说明问题和验证建议。`)"><AppIcon name="code" :size="15" />让 Codex 审查此文件</button></div>
        <p class="inspector-note">差异展示当前对话对该文件的最后一次修改。</p>
      </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.codex-dialog { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; color: var(--text); font-family: var(--font-ui); container: codex-conversation / inline-size; }
.dialog-context { display: flex; flex: none; align-items: center; gap: 12px; padding: 16px calc(var(--workspace-content-padding) + var(--scrollbar-track)) 16px var(--workspace-content-padding); }
.scope-label, .project-path { color: var(--text-muted); font-size: var(--text-xs); }
.scope-label { flex: none; }
.project-trigger { display: inline-flex; flex: none; align-items: center; gap: 8px; width: 260px; height: 32px; padding-inline: 10px; border: 0; background: var(--bg-surface); font-size: var(--text-sm); }
.project-trigger > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-trigger small { margin-left: auto; color: var(--text-muted); font-size: var(--text-xs); white-space: nowrap; }
.project-trigger svg { flex: none; color: var(--text-muted); }
.project-path { min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.connection-state { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.dialog-error { display: flex; flex: none; align-items: center; gap: 10px; margin: 0 calc(var(--workspace-content-padding) + var(--scrollbar-track)) 12px var(--workspace-content-padding); padding: 8px 12px; border-radius: 8px; background: var(--bg-surface); font-size: var(--text-sm); }
.dialog-error > span { flex: 1; overflow-wrap: anywhere; }
.dialog-error > svg, .turn-error { color: var(--danger); }
.dialog-start { margin: 40px var(--workspace-content-padding); overflow: auto; }
.dialog-start h1, .dialog-welcome h1 { font-size: var(--text-xl); line-height: 28px; font-weight: 500; margin: 0 0 8px; }
.dialog-start > p, .dialog-welcome > p { color: var(--text-secondary); font-size: var(--text-base); margin: 0 0 20px; }
.dialog-conversation { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.conversation-inner { margin: 0 var(--workspace-content-padding); padding-bottom: 24px; }
.thread-title { margin: 0 0 12px; font-size: var(--text-base); font-weight: 500; line-height: 24px; }
.dialog-welcome { padding-top: 56px; }
.empty-suggestions { display: flex; gap: 8px; }
.dialog-turn { display: flex; flex-direction: column; gap: 16px; margin-bottom: 16px; }
.dialog-user-wrap { display: flex; justify-content: flex-end; }
.dialog-user { max-width: 83%; padding: 12px 16px; border-radius: 12px; background: var(--bg-surface); font-size: var(--text-base); line-height: 25px; white-space: pre-wrap; overflow-wrap: anywhere; }
.dialog-response { min-width: 0; margin: 0; padding: 16px 20px 14px; border-radius: 12px; background: var(--bg-surface); }
.response-heading { display: flex; align-items: center; gap: 8px; min-height: 28px; margin-bottom: 8px; font-size: var(--text-sm); }
.response-heading > svg { flex: none; color: var(--text-muted); }
.response-heading strong { font-weight: 500; }
.response-parameters { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); color: var(--text-muted); }
.copy-message { flex: none; width: 28px; height: 28px; margin-left: auto; }
.dialog-bottom { flex: none; position: relative; padding: 0 calc(var(--workspace-content-padding) + var(--scrollbar-track)) 20px var(--workspace-content-padding); }
.text-action, .dialog-button, .dialog-icon { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 0 9px; border: 0; border-radius: var(--radius-ib); background: transparent; color: var(--text-secondary); font: inherit; font-size: var(--text-xs); cursor: pointer; }
.text-action:hover, .dialog-button:hover, .dialog-icon:hover { background: var(--hover); color: var(--text); }
.dialog-icon { width: 32px; padding: 0; }
.latest-message { position: absolute; z-index: 2; right: calc(var(--workspace-content-padding) + var(--scrollbar-track)); bottom: calc(100% + 8px); background: var(--bg-surface); box-shadow: var(--shadow-pop); }
.approval-tray { max-height: min(40dvh, 360px); overflow: auto; margin-bottom: 12px; scrollbar-gutter: stable; }
.dialog-muted, .dialog-loading { font-size: var(--text-xs); line-height: 1.8; color: var(--text-muted); }
.turn-error { font-size: var(--text-sm); }
:global(.codex-dialog-popover) { max-width: calc(100vw - 24px); max-height: calc(100dvh - 24px); overflow-y: auto; }
.panel-heading { display: flex; align-items: center; justify-content: space-between; margin: 4px 8px 8px; }
.panel-heading h2 { margin: 0; font-size: var(--text-sm); font-weight: 500; }
.panel-heading small { margin-left: 8px; color: var(--text-muted); font-size: var(--text-xs); font-weight: 400; }
.panel-search { display: flex; align-items: center; gap: 8px; min-height: 36px; margin: 0 8px 8px; padding: 0 10px; background: var(--bg-canvas-input); border-radius: 8px; color: var(--text-muted); }
.panel-search input { width: 100%; min-width: 0; padding: 0; border: 0; background: transparent; color: var(--text); font: inherit; font-size: var(--text-xs); outline: none; }
.panel-search:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.panel-search input:focus-visible { box-shadow: none; }
.history-options, .project-options { max-height: min(360px, 48dvh); overflow-y: auto; padding: 0 4px; }
.dialog-thread { display: block; width: 100%; padding: 8px 12px; border: 0; border-radius: 8px; background: transparent; color: var(--text); text-align: left; cursor: pointer; font: inherit; }
.dialog-thread:hover, .project-option:hover { background: var(--hover); }
.dialog-thread[aria-current='true'] { background: var(--accent-soft); color: var(--text-brand); }
.dialog-thread > strong { display: flex; align-items: center; gap: 8px; font-size: var(--text-sm); line-height: 22px; font-weight: 400; overflow-wrap: anywhere; }
.dialog-thread > span, .project-option strong { display: flex; justify-content: space-between; gap: 8px; margin-top: 3px; color: var(--text-muted); font-size: var(--text-xs); line-height: 18px; }
.dialog-thread small { font-size: var(--text-xs); }
.draft-label { margin-left: auto; color: var(--text-brand); white-space: nowrap; }
.history-foot { display: flex; align-items: center; justify-content: space-between; margin: 4px 12px; font-size: var(--text-xs); color: var(--text-muted); }
.project-option { align-items: flex-start; gap: 8px; }
.project-option > span { flex: 1; min-width: 0; }
.project-option strong { margin: 0; color: var(--text); font-weight: 400; }
.project-option small { color: var(--text-muted); font-size: var(--text-xs); }
.project-option span > span { display: block; margin-top: 4px; color: var(--text-muted); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; }
.project-connection { padding: 8px 12px; }
.project-connection :deep(.compact) { display: flex; }
.account-note { padding: 0 12px; }
.dialog-inspector { flex: 1; min-width: 0; }
.inspector-title { display: flex; align-items: center; justify-content: space-between; font-size: var(--text-xs); color: var(--text-secondary); margin-bottom: 8px; }
.git-file { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px; border: 0; background: transparent; border-radius: var(--radius-ib); color: var(--text); text-align: left; font: inherit; font-size: var(--text-xs); cursor: pointer; }
.git-file:hover { background: var(--bg-inspector-hover); }
.git-file.selected { background: var(--bg-inspector-active); }
.git-file code { min-width: 18px; font: 12px var(--font-mono); color: var(--text-secondary); }
.git-file span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.git-file > svg { flex: none; color: var(--text-secondary); }
.file-detail { margin-top: 16px; padding: 12px 0; }
.file-detail-heading { display: flex; align-items: flex-start; gap: 8px; font-size: var(--text-xs); margin-bottom: 12px; }
.file-detail-heading > svg { flex: none; }
.file-detail-heading strong { overflow-wrap: anywhere; font-weight: 500; }
.file-diff { overflow: auto; max-height: 45dvh; padding-block: 8px; }
.file-diff pre { margin: 0; min-height: 20px; padding-inline: 6px; font: 12px/1.8 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.file-diff .added { color: var(--success, var(--accent)); background: color-mix(in srgb, var(--success, var(--accent)) 8%, transparent); }
.file-diff .removed { color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, transparent); }
.file-context-action { margin-top: 12px; width: 100%; background: var(--bg-inspector-hover); }
.inspector-note { font-size: var(--text-xs); color: var(--text-secondary); line-height: 1.8; margin: 16px 0; }
.inspector-empty { padding: 20px 0; color: var(--text-secondary); font-size: var(--text-xs); }
.inspector-empty strong { display: block; margin-top: 12px; color: var(--text); font-weight: 500; }

@media (max-width: 900px) { .project-trigger { width: 236px; } }
@media (max-width: 600px) {
  .dialog-context { flex-wrap: wrap; gap: 8px; padding-top: 12px; padding-bottom: 12px; }
  .project-trigger { flex: 1; min-width: 0; width: auto; min-height: 44px; }
  .project-trigger small { max-width: 110px; overflow: hidden; text-overflow: ellipsis; }
  .project-path { flex-basis: 100%; padding-left: 32px; }
  .dialog-page-controls .bar-btn { min-width: 44px; min-height: 44px; padding-inline: 8px; }
  .dialog-page-controls :deep(.create-action span), .dialog-page-controls .bar-btn > span { display: none; }
  .dialog-response { padding: 12px 14px; }
  .response-heading { margin-bottom: 4px; }
  .copy-message, .text-action, .panel-heading .ib, .history-foot .ib { min-width: 44px; min-height: 44px; }
  .panel-search { min-height: 44px; }
  .dialog-thread { padding-block: 12px; }
  .dialog-user { max-width: 94%; }
  .dialog-turn { gap: 12px; }
  .dialog-bottom { padding-bottom: max(12px, env(safe-area-inset-bottom)); }
  .thread-title { font-size: var(--text-sm); }
}
@media (max-height: 650px) {
  .dialog-context { padding-top: 8px; padding-bottom: 8px; }
  .conversation-inner { padding-bottom: 16px; }
  .thread-title { margin-bottom: 8px; }
  .dialog-turn { gap: 12px; margin-bottom: 12px; }
  .dialog-response { padding-block: 12px; }
  .dialog-bottom { padding-bottom: max(10px, env(safe-area-inset-bottom)); }
  .dialog-welcome { padding-top: 24px; }
  .approval-tray { max-height: 28dvh; }
}
</style>
