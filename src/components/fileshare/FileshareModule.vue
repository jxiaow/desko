<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch, watchEffect } from 'vue'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import qrcode from 'qrcode-generator'
import { fileshareApi } from '../../services/api/fileshare'
import type { MessageEntry } from '../../services/api/fileshare'
import { errText } from '../../services/api/backup'
import {
  fsStatus,
  fsConfig,
  fsLoaded,
  fsBusy,
  fsRunning,
  fsPortDrifted,
  fsHasPassword,
  fsLocalOnly,
  fsRefresh,
  requestOpenSettingsTab,
} from '../../services/fileshareSettings'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../shared/AppIcon.vue'
import OptionSelect from '../shared/OptionSelect.vue'
import { usePageHeadStore } from '../../stores/pageHead'
import { usePageActive } from '../../composables/usePageActive'
import { isWebRuntime } from '../../services/runtime'
import { uploadSharedFile } from '../../services/transport'
import { writeClipboardText } from '../../utils/clipboard'

const toastStore = useToastStore()
const pageActive = usePageActive()
const webRuntime = isWebRuntime()
const fileInput = ref<HTMLInputElement | null>(null)
let active = true
let poll: ReturnType<typeof setInterval> | undefined

const targetPathValue = ref('')
const dragActive = ref(false)
const dropping = ref(false)
const serviceAction = ref<'start' | 'stop' | null>(null)

/* ── 消息流：文字和文件是同一层的东西，都排在一条时间线上 ──────
   取消「文件 / 文字」两档：发什么不用先判断自己属于哪一类。 */
const messages = ref<MessageEntry[]>([])
const historyDirection = ref<'all' | 'received' | 'sent'>('all')
const historyDirections = [
  { value: 'all', label: '全部' },
  { value: 'received', label: '收到' },
  { value: 'sent', label: '发出' },
] as const
const historyQuery = ref('')
const historySearchOpen = ref(false)
const historySearchInput = ref<HTMLInputElement | null>(null)
const historySearchButton = ref<HTMLButtonElement | null>(null)

async function toggleHistorySearch() {
  historySearchOpen.value = !historySearchOpen.value
  if (!historySearchOpen.value) historyQuery.value = ''
  await nextTick()
  if (historySearchOpen.value) historySearchInput.value?.focus()
  else historySearchButton.value?.focus()
}

const draft = ref('')
const pushing = ref(false)
/** 长文本折叠：默认只摊一部分，点开看全文 */
const expanded = ref(new Set<string>())
function isLong(text: string) {
  return text.length > 160 || text.split('\n').length > 3
}
function toggleExpand(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}
/** 记录行的类型列显示扩展名，没有就用「文件」。 */
function extOf(name: string) {
  const m = /\.([A-Za-z0-9]{1,4})$/.exec(name)
  return m ? m[1].toUpperCase() : '文件'
}
/** 已经报过到（或已经看过）的条目：轮询靠它分辨"新来的"和"上次就有的" */
let knownIds = new Set<string>()
let messageRequest = 0
const textPolled = ref(false)
const historyUnavailable = ref(false)
const textBytes = computed(() => new TextEncoder().encode(draft.value).length)
const draftTooLong = computed(() => textBytes.value > 64 * 1024)
const draftHint = computed(() => {
  if (!draft.value.trim()) return '最多 64 KB'
  return `${draft.value.split('\n').length} 行 · ${formatBytes(textBytes.value)} / 64 KB`
})
/** 流是两端共读一份：说"我"的是谁，取决于此刻坐在哪一端 */
const selfDir = webRuntime ? 'web' : 'app'
const normalizedHistoryQuery = computed(() => historyQuery.value.trim().toLowerCase())
const visibleMessages = computed(() => messages.value.filter(message => {
  const sent = message.dir === selfDir
  if (historyDirection.value === 'received' && sent) return false
  if (historyDirection.value === 'sent' && !sent) return false
  const content = message.kind === 'file' ? message.name : message.text
  return !normalizedHistoryQuery.value || content.toLowerCase().includes(normalizedHistoryQuery.value)
}))
watch([historyDirection, normalizedHistoryQuery], () => void showLatest())

const peerLabel = webRuntime ? '电脑' : '网页'
const emptyHint = computed(() => fsLocalOnly.value
  ? '在本机浏览器打开连接地址，或直接发送文字和文件。'
  : '其他设备发来的文字和文件会显示在这里。')

/** 浏览器里只拿得到下载链接：在这个端上做"定位"，弹的是别人电脑上的资源管理器 */
function downloadHref(m: MessageEntry) {
  return `/api/share-download/${encodeURIComponent(m.id)}`
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  return `${(n / 1024).toFixed(1)} KB`
}

/** 读一次消息。对面新到的条目报一声，其余静默 —— 3 秒一次，不能每次都弹提示 */
async function loadMessages(): Promise<void> {
  const request = ++messageRequest
  let list: MessageEntry[]
  try {
    list = await fileshareApi.messages()
  } catch {
    if (active && request === messageRequest) historyUnavailable.value = true
    return
  }
  if (!active || request !== messageRequest) return
  historyUnavailable.value = false
  const el = streamEl.value
  const follow = !textPolled.value || !el || el.scrollTop < 48
  const fresh = list.filter(m => m.dir !== selfDir && !knownIds.has(m.id))
  knownIds = new Set(list.map(m => m.id))
  messages.value = list
  if (follow) void showLatest()
  if (textPolled.value && fresh.length) {
    const onlyText = fresh.every(m => m.kind === 'text')
    if (onlyText) {
      toastStore.showToast(fresh.length === 1 ? `${peerLabel}发来一条消息` : `${peerLabel}发来 ${fresh.length} 条消息`)
    } else {
      toastStore.showToast(fresh.length === 1 ? `${peerLabel}发来 ${fresh[0].name || '一个文件'}` : `${peerLabel}发来 ${fresh.length} 项`)
    }
  }
  textPolled.value = true
}

async function pushText() {
  const content = draft.value
  if (pushing.value || !content.trim() || draftTooLong.value) return
  pushing.value = true
  try {
    const entry = await fileshareApi.pushText(content)
    messageRequest++
    messages.value = [entry, ...messages.value.filter(m => m.id !== entry.id)].slice(0, 200)
    knownIds.add(entry.id)
    if (draft.value === content) draft.value = ''
    void showLatest()
    toastStore.showToast(running.value ? `已发到${peerLabel}` : `已存下 · 启动服务后${peerLabel}可见`)
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    pushing.value = false
  }
}

async function copyText(entry: MessageEntry) {
  try {
    await writeClipboardText(entry.text)
    toastStore.showToast('已复制')
  } catch {
    toastStore.showToast('复制失败', 'error')
  }
}

async function removeMessage(entry: MessageEntry) {
  try {
    await fileshareApi.deleteMessage(entry.id)
    messageRequest++
    messages.value = messages.value.filter(m => m.id !== entry.id)
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
    await loadMessages()
  }
}

/** 收到的文件：在资源管理器里定位。文件可能已被挪走，那就如实说一句 */
async function revealFile(entry: MessageEntry) {
  try {
    await fileshareApi.revealFile(messageShare(entry), entry.name)
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
}

/** 打开时从最新的一条开始 */
const streamEl = ref<HTMLElement | null>(null)
async function showLatest() {
  await nextTick()
  const el = streamEl.value
  if (el) el.scrollTop = 0
}

const running = fsRunning
const status = fsStatus
const dirs = computed(() => fsConfig.value?.shareDirs ?? [])
function messageShare(entry: MessageEntry) {
  return entry.dirHint ? dirs.value.indexOf(entry.dirHint) : (dirs.value[entry.share] ? entry.share : -1)
}
const canAttach = computed(() => running.value && !fsBusy.value && !dropping.value && !!dirs.value.length)
const transferStatus = ref('')
/** 局域网开放且没口令：任何人都能读写共享目录，要提醒一句 */
const openWarn = computed(() => running.value && !fsLocalOnly.value && !fsHasPassword.value)
/** 按路径记住投递目标：设置里删掉别的目录时，选中项不会跟着下标漂移 */
const target = computed(() => {
  const index = dirs.value.indexOf(targetPathValue.value)
  return index >= 0 ? index : 0
})
watch(dirs, (list) => {
  if (!list.includes(targetPathValue.value)) targetPathValue.value = list[0] ?? ''
}, { immediate: true })
const targetName = computed(() => baseName(targetPathValue.value))
const dirOptions = computed(() => dirs.value.map((dir, index) => ({ value: index, label: baseName(dir) })))
/** 连接卡说明访问范围，页条只说明服务是否监听。 */
const exposure = computed(() => {
  return fsLocalOnly.value ? '仅本机可访问' : '同网段设备可访问'
})
/** 仅本机模式使用本机地址，不生成其他设备无法访问的二维码。 */
const bannerUrl = computed(() => {
  const s = status.value
  if (!s) return ''
  return fsLocalOnly.value ? s.localUrl : s.lanUrl
})
const qrImage = computed(() => {
  if (!running.value || fsLocalOnly.value || !bannerUrl.value) return ''
  const qr = qrcode(0, 'M')
  qr.addData(bannerUrl.value)
  qr.make()
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true }))}`
})

/* 二维码收成卡头一颗按钮：常驻会占掉一整列（上一版左栏 300px 的空白就是它撑出来的）。
   Esc 与点空白处都收起来，跟菜单一个手感。 */
const qrOpen = ref(false)
function onQrKey(ev: KeyboardEvent) {
  if (ev.key === 'Escape') qrOpen.value = false
}
watch(qrOpen, (open) => {
  if (open) window.addEventListener('keydown', onQrKey)
  else window.removeEventListener('keydown', onQrKey)
})
// 服务停了 / 切到仅本机：浮层里的地址已失效，顺手收起
watch(qrImage, (img) => { if (!img) qrOpen.value = false })

async function chooseFiles() {
  if (!canAttach.value) return
  if (webRuntime) { fileInput.value?.click(); return }
  try {
    const paths = await dialogOpen({ multiple: true, directory: false, title: '选择要传输的文件' })
    if (paths) await importPaths(Array.isArray(paths) ? paths : [paths])
  } catch (e) { toastStore.showToast(errText(e), 'error') }
}

function baseName(p: string) {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

async function toggle() {
  if (fsBusy.value) return
  fsBusy.value = true
  serviceAction.value = running.value ? 'stop' : 'start'
  try {
    if (running.value) {
      await fileshareApi.stop()
      toastStore.showToast('已停止监听')
    } else {
      await fileshareApi.start()
      toastStore.showToast('服务已启动')
    }
    await fsRefresh()
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    fsBusy.value = false
    serviceAction.value = null
  }
}

async function copyUrl(url: string) {
  try {
    await writeClipboardText(url)
    toastStore.showToast('地址已复制')
  } catch {
    toastStore.showToast('复制失败', 'error')
  }
}

async function importPaths(paths: string[]) {
  if (dropping.value || fsBusy.value || !paths.length) return
  if (!running.value) {
    toastStore.showToast('请先启动服务再投递文件', 'error')
    return
  }
  if (!dirs.value.length) return
  const index = target.value
  dropping.value = true
  transferStatus.value = `正在保存 ${paths.length} 个文件…`
  try {
    const r = await fileshareApi.importFiles(index, paths)
    if (r.stored.length) {
      void loadMessages().then(showLatest)
    }
    if (r.failed.length) {
      const why = r.failed[0]
      toastStore.showToast(
        r.stored.length ? `已接收 ${r.stored.length} 个，${r.failed.length} 个保存失败：${why}` : why,
        'error'
      )
    } else {
      toastStore.showToast(`已接收 ${r.stored.length} 个文件`)
    }
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    dropping.value = false
  }
}

let unlistenDrag: (() => void) | undefined

async function importBrowserFiles(files: File[]) {
  if (!canAttach.value || !files.length) return
  const targetPath = targetPathValue.value
  dropping.value = true
  let count = 0
  const failed: string[] = []
  try {
    for (const [position, file] of files.entries()) {
      if (!active) return
      const index = dirs.value.indexOf(targetPath)
      if (index < 0) {
        failed.push(...files.slice(position).map(item => `${item.name}：共享目录已移除`))
        break
      }
      transferStatus.value = `正在上传 ${position + 1}/${files.length} · ${file.name}`
      try {
        await uploadSharedFile(file, index)
        count++
      } catch (e) {
        failed.push(`${file.name}：${errText(e)}`)
      }
    }
    if (!active) return
    if (count) {
      void loadMessages().then(showLatest)
    }
    const summary = `已接收 ${count} 个文件`
    if (failed.length) toastStore.showToast(`${summary}，${failed.length} 个失败 · ${failed[0]}`, 'error')
    else toastStore.showToast(summary)
  } finally {
    dropping.value = false
  }
}
function chooseBrowserFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  void importBrowserFiles(files)
}
function dropBrowserFiles(event: DragEvent) {
  if (!webRuntime) return
  event.preventDefault()
  dragActive.value = false
  void importBrowserFiles(Array.from(event.dataTransfer?.files ?? []))
}

onMounted(async () => {
  await fsRefresh()
  if (!active) return
  void loadMessages()
  // 文字只有一条路进来（网页那边发），桌面上没有别的东西会改它：靠这一次轮询报到
  poll = setInterval(() => {
    if (!pageActive.value || fsBusy.value || dropping.value || pushing.value) return
    void loadMessages()
    if (webRuntime) void fsRefresh(true)
  }, 3000)
  if (webRuntime) return
  // 外部文件只能由原生层给路径：HTML5 的 dataTransfer 在这拿不到真实路径
  const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
    if (!active || !pageActive.value) return
    const p = event.payload
    if (p.type === 'drop') {
      dragActive.value = false
      void importPaths(p.paths)
    } else {
      dragActive.value = p.type !== 'leave'
    }
  })
  if (active) unlistenDrag = unlisten
  else unlisten()
})

onUnmounted(() => { active = false; clearInterval(poll); unlistenDrag?.(); window.removeEventListener('keydown', onQrKey) })

watch(pageActive, visible => {
  dragActive.value = false
  if (visible) { void fsRefresh(); void loadMessages().then(showLatest) }
})
const pageHead = usePageHeadStore()
watchEffect(() => { if (pageActive.value) pageHead.setHead('局域网传输') })
</script>

<template>
  <div class="content-inner lan-page">
    <div v-if="!fsLoaded" class="lan-loading-state" role="status" aria-label="正在读取共享配置">
      <div class="loading-chat" aria-hidden="true">
        <div class="loading-head"><span></span><span></span><span></span></div>
        <div class="loading-composer"></div>
        <div class="loading-stream"><span></span><span></span><span></span></div>
      </div>
    </div>
    <section v-else-if="!fsConfig || !status" class="lan-load-error" aria-labelledby="lan-error-title">
      <AppIcon name="alert" :size="24" /><h2 id="lan-error-title">无法读取共享配置</h2><p>请重试以获取服务状态和共享文件夹。</p><button class="transfer-button" type="button" @click="fsRefresh()">重新加载</button>
    </section>

    <div v-else class="lan-content">
      <section class="transfer-workspace" :class="{ active: dragActive && canAttach }" aria-label="局域网传输"
        @dragover="webRuntime && $event.preventDefault()"
        @dragenter="webRuntime && $event.dataTransfer?.types.includes('Files') && (dragActive = true)"
        @dragleave="webRuntime && !($event.currentTarget as HTMLElement).contains($event.relatedTarget as Node) && (dragActive = false)"
        @drop="dropBrowserFiles">
        <div class="transfer-controls">
          <section class="connection-panel" aria-labelledby="lan-chat-title">
            <header class="chat-head" :class="{ 'qr-open': qrOpen }">
              <h2 id="lan-chat-title">设备连接</h2>
              <span class="chip" :class="{ live: running }" role="status"><span class="status-dot" aria-hidden="true"></span>{{ running ? '监听中' : '已停止' }}</span>
              <button v-if="running && bannerUrl" class="head-addr" type="button" :title="`复制 ${bannerUrl}`" @click="copyUrl(bannerUrl)">
                <span class="banner-url">{{ bannerUrl }}</span><AppIcon name="copy" :size="14" />
              </button>
              <p v-else-if="running" class="connection-detail">当前没有可用的访问地址</p>
              <div class="head-actions">
                <button v-if="running" class="bar-btn qr-btn" type="button" :aria-expanded="qrOpen" :disabled="!qrImage" :title="qrImage ? '扫码在网页端打开' : '没有可扫码的地址'" @click="qrOpen = !qrOpen">二维码</button>
                <button class="bar-btn service-toggle" :class="{ 'btn-primary': !running }" type="button" :disabled="fsBusy || dropping" @click="toggle">{{ serviceAction === 'stop' ? '正在停止…' : serviceAction === 'start' ? '正在启动…' : running ? '停止服务' : '启动服务' }}</button>
              </div>
              <button class="bar-btn manage-btn" type="button" aria-label="共享设置" title="共享设置" @click="requestOpenSettingsTab('fileshare')"><AppIcon name="gear" :size="16" /></button>
              <div v-if="qrOpen" class="qr-pop" role="dialog" aria-label="扫码在网页端打开">
                <img v-if="qrImage" class="connection-qr" :src="qrImage" :data-url="bannerUrl" alt="扫描二维码，在浏览器中打开共享文件" />
                <p class="banner-title">{{ exposure }}</p>
                <button class="qr-url" type="button" title="复制访问地址" @click="copyUrl(bannerUrl)"><span>{{ bannerUrl }}</span><AppIcon name="copy" :size="12" /></button>
                <button v-if="!fsLocalOnly" class="local-address" type="button" :title="status.localUrl" @click="copyUrl(status.localUrl)"><span>本机</span><span>{{ status.localUrl }}</span></button>
                <p class="qr-hint">{{ fsLocalOnly ? '仅本机能打开，其他设备连不上' : '手机或平板扫码，同一网络下直接打开' }}</p>
              </div>
            </header>
            <p v-if="running && (fsLocalOnly || openWarn || fsPortDrifted)" class="chat-warn">
              <AppIcon name="lock" :size="12" />
              <span v-if="fsLocalOnly">仅本机可访问，其他设备连不上。<button class="lan-text-button" type="button" @click="requestOpenSettingsTab('fileshare')">更改访问范围</button></span>
              <span v-else-if="openWarn">未设访问口令，同网段的设备都能读写这些目录。<button class="lan-text-button" type="button" @click="requestOpenSettingsTab('fileshare')">去设置</button></span>
              <span v-if="fsPortDrifted">端口 {{ status.configuredPort }} 被占用，实际监听在 {{ status.boundPort }}</span>
            </p>
          </section>

          <section class="send-panel" aria-labelledby="lan-send-title">
            <h2 id="lan-send-title">发送内容</h2>
            <form class="transfer-composer" @submit.prevent="pushText">
              <textarea
                id="lan-message"
                v-model="draft"
                class="transfer-text-input"
                rows="2"
                aria-label="要发送的文字"
                aria-describedby="lan-text-hint"
                spellcheck="false"
                :placeholder="running ? '输入或粘贴要发送的文字…' : '输入文字，启动服务前可先暂存…'"
                @keydown.ctrl.enter.prevent="pushText"
                @keydown.meta.enter.prevent="pushText"
              ></textarea>
              <div class="transfer-composer-bar">
                <div class="file-tools">
                  <template v-if="dirs.length">
                    <input v-if="webRuntime" ref="fileInput" type="file" multiple hidden aria-label="选择要发的文件" @change="chooseBrowserFiles" />
                    <button class="transfer-button send-file" type="button" :disabled="!canAttach" @click="chooseFiles">
                      <AppIcon :name="dropping ? 'clock' : 'file'" :size="16" />{{ dropping ? '保存中…' : '发送文件' }}
                    </button>
                    <span class="chat-dir" :title="targetPathValue">
                      <span class="chat-dir-label">存到</span>
                      <OptionSelect id="lan-target" class="chat-dir-select" :model-value="target" :options="dirOptions" :disabled="fsBusy || dropping" :title="targetPathValue" :menu-width="320" aria-label="文件保存到哪个共享目录" @update:model-value="targetPathValue = dirs[Number($event)] ?? ''" />
                    </span>
                  </template>
                  <button v-else class="transfer-button" type="button" @click="requestOpenSettingsTab('fileshare')">
                    <AppIcon name="folder" :size="16" />添加共享目录
                  </button>
                </div>
                <span id="lan-text-hint" class="text-hint" role="status" :class="{ err: draftTooLong }">{{ draftTooLong ? '超过 64 KB，删减一些再发' : draftHint }}</span>
                <button class="transfer-button transfer-primary composer-send" type="submit" :disabled="pushing || !draft.trim() || draftTooLong" title="Ctrl 或 ⌘ + Enter">{{ pushing ? '发送中…' : running ? '发送' : '暂存' }}</button>
              </div>
            </form>
            <p v-if="dropping" class="file-status" role="status">{{ transferStatus }}</p>
          </section>
        </div>

        <div v-if="qrOpen" class="qr-scrim" @click="qrOpen = false"></div>

        <section class="activity-panel" aria-labelledby="lan-history-title">
          <header class="activity-head">
            <h2 id="lan-history-title">传输记录</h2>
            <span v-if="messages.length" class="panel-meta" role="status">{{ visibleMessages.length }} 条</span>
            <div class="history-tools">
              <div class="history-filters" role="group" aria-label="筛选传输方向">
                <button v-for="direction in historyDirections" :key="direction.value" type="button"
                  :aria-pressed="historyDirection === direction.value"
                  @click="historyDirection = direction.value">{{ direction.label }}</button>
              </div>
              <button ref="historySearchButton" class="history-search-toggle" type="button" aria-label="搜索传输记录"
                title="搜索传输记录" :aria-expanded="historySearchOpen" aria-controls="lan-history-search"
                @click="toggleHistorySearch"><AppIcon name="search" :size="16" /></button>
            </div>
          </header>
          <div v-show="historySearchOpen" id="lan-history-search" class="history-search">
            <AppIcon name="search" :size="16" />
            <input ref="historySearchInput" v-model="historyQuery" type="search"
              aria-label="按文件名或文字内容搜索" placeholder="按文件名或文字内容搜索"
              @keydown.esc.stop.prevent="toggleHistorySearch" />
          </div>
          <div ref="streamEl" class="stream" aria-label="传输记录" aria-live="polite">
            <div v-if="historyUnavailable" class="stream-empty history-error">
              <strong>暂时无法读取传输记录</strong>
              <button type="button" class="lan-text-button" @click="loadMessages">重试</button>
            </div>
            <p v-else-if="!textPolled" class="stream-empty" role="status">正在读取传输记录…</p>
            <p v-else-if="!messages.length" class="stream-empty">
              <strong>{{ running ? '等候接收' : '暂无传输记录' }}</strong>
              {{ running ? emptyHint : '发送或接收的内容会显示在这里。' }}
            </p>
            <p v-else-if="!visibleMessages.length" class="stream-empty">
              <strong>{{ normalizedHistoryQuery ? '没有匹配的记录' : historyDirection === 'sent' ? '还没有发出的记录' : '还没有收到的记录' }}</strong>
              {{ normalizedHistoryQuery ? '试试其他关键词，或切换传输方向。' : '可以切换到「全部」查看其他记录。' }}
            </p>
            <article v-for="m in visibleMessages" :key="m.id" class="msg"
              :data-dir="m.dir === selfDir ? 'me' : 'peer'" :data-kind="m.kind">
              <span class="mic">{{ m.kind === 'file' ? extOf(m.name) : '文字' }}</span>
              <div class="payload">
                <div v-if="m.kind === 'file'" class="mfile">
                  <span class="mname" :title="m.name">{{ m.name }}</span>
                  <span class="msize">{{ m.sizeText }}</span>
                </div>
                <template v-else>
                  <p class="mtext" :class="{ clamp: !expanded.has(m.id) && isLong(m.text) }">{{ m.text }}</p>
                  <button v-if="isLong(m.text)" class="mmore" type="button" :aria-expanded="expanded.has(m.id)" @click="toggleExpand(m.id)">{{ expanded.has(m.id) ? '收起' : '展开全文' }}</button>
                </template>
                <div class="mmeta"><span>{{ m.dir === selfDir ? '我发出' : `${peerLabel}发来` }}</span><span>{{ m.time }}</span></div>
              </div>
              <div class="message-actions">
                <button v-if="m.kind === 'text'" class="mget" type="button" @click="copyText(m)">复制</button>
                <span v-else-if="messageShare(m) < 0" class="msize">目录已移除</span>
                <a v-else-if="webRuntime" class="mget" :href="downloadHref(m)" :download="m.name">下载</a>
                <button v-else class="mget" type="button" @click="revealFile(m)">定位</button>
                <button class="mact" type="button" :title="m.kind === 'file' ? '只删这条记录，共享目录里的文件还在' : '删掉这条'" @click="removeMessage(m)">删除</button>
              </div>
            </article>
          </div>
        </section>
      </section>
    </div>
    <Teleport to="body" :disabled="!pageActive"><div v-if="dragActive && running && !dropping && dirs.length" class="fs-drop-hint" aria-hidden="true"><b>松手即投进 {{ targetName }}</b></div></Teleport>
  </div>
</template>

<style scoped>
.lan-page {
  display: flex;
  flex-direction: column;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  container-type: inline-size;
}
.lan-page :is(h1, h2, p) { margin: 0; }
.lan-page h2 { font-size: var(--text-sm); font-weight: 600; line-height: 22px; }
.lan-page button:disabled { cursor: not-allowed; }
.lan-page :is(button, a):focus-visible { outline: 2px solid var(--text-brand); outline-offset: 2px; }
.lan-page .transfer-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-ib);
  background: var(--bg-surface);
  color: var(--text);
  font: 500 var(--text-sm) var(--font-ui);
  cursor: pointer;
}
.lan-page .transfer-button:hover:enabled { background: var(--hover-chrome); }
.lan-page .transfer-button:disabled { background: var(--fill); color: var(--text-secondary); cursor: not-allowed; }
.lan-page .transfer-primary:enabled { border-color: transparent; background: var(--text); color: var(--bg-surface); }
.lan-page .transfer-primary:hover:enabled { background: var(--text-secondary); }
.lan-content { flex: 1 1 auto; min-height: 0; display: flex; }

/* 顶部工具区按内容定高，记录区占用剩余空间。 */
.transfer-workspace {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 340px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(160px, 1fr);
}
.transfer-controls { min-width: 0; }
.connection-panel { padding-bottom: 10px; border-bottom: 1px solid var(--border-card); }
.send-panel { padding-block: 12px; }
.chat-head {
  position: relative;
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
}
.chat-head .chip {
  justify-self: start;
  padding: 0;
  gap: 5px;
  background: transparent;
  color: var(--text-secondary);
}
.chat-head .chip.live { color: var(--success); }
.status-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.chat-head.qr-open { z-index: 21; }
.qr-btn[aria-expanded="true"] { background: var(--hover-chrome); color: var(--text); }
.manage-btn { grid-column: 5; grid-row: 1; justify-self: end; width: 32px; padding-inline: 0; }
.head-addr, .connection-detail { grid-column: 3; }
.head-actions { grid-column: 4; }
.head-actions { display: flex; gap: 6px; }
.head-actions .bar-btn { min-height: 32px; }
.service-toggle:not(.btn-primary):hover:not(:disabled) { color: var(--danger); background: var(--danger-soft); }
.head-addr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  min-height: 32px;
  width: fit-content;
  max-width: 100%;
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-ib);
  background: transparent;
  color: var(--text-brand);
  font: inherit;
  cursor: pointer;
}
.head-addr:hover { background: var(--hover-chrome); }
.banner-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.head-addr svg { flex: none; }
.connection-detail, .chat-warn { color: var(--text-secondary); font-size: var(--text-xs); }
.chat-warn { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 6px; padding-top: 10px; color: color-mix(in srgb, var(--warning) 68%, var(--text)); }
.chat-warn > svg { flex: none; align-self: center; }
.lan-text-button { padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.chat-warn .lan-text-button { margin-left: 4px; }

.qr-scrim { position: absolute; inset: 0; z-index: 20; }
.qr-pop {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 30;
  display: flex; flex-direction: column; align-items: center; gap: 9px;
  width: min(236px, 100%); padding: 16px 16px 14px;
  border: 1px solid var(--border-card); border-radius: 10px;
  background: var(--bg-surface); box-shadow: var(--shadow-card-rest); /* taste-skill-ignore: QR popover */
}
.connection-qr { display: block; width: 172px; height: 172px; border-radius: var(--radius-sm); background: #fff; }
.banner-title { color: var(--text-muted); font-size: var(--text-xs); line-height: 18px; }
.qr-url { display: flex; align-items: center; gap: 6px; max-width: 100%; padding: 4px 9px; border: 0; border-radius: var(--radius-sm); background: var(--fill); color: var(--text); font: inherit; font-size: var(--text-xs); cursor: pointer; }
.qr-url span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qr-url svg { flex: none; }
.qr-url:hover { background: var(--hover-chrome); }
.local-address { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-height: 24px; padding: 0; border: 0; background: transparent; color: var(--text-muted); font: inherit; font-size: 11px; cursor: pointer; }
.local-address span:last-of-type { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.local-address:hover { color: var(--text); }
.qr-hint { color: var(--text-muted); font-size: 11px; line-height: 16px; text-align: center; }

.file-tools { display: flex; align-items: center; gap: 8px; min-width: 0; }
.chat-dir { display: flex; flex: 1; align-items: center; gap: 6px; min-width: 0; color: var(--text-secondary); font-size: var(--text-xs); }
.chat-dir-label { flex: none; }
.chat-dir :deep(.select) { flex: 1; min-width: 0; max-width: 200px; min-height: 32px; border-color: transparent; background: transparent; font-size: var(--text-sm); }
.chat-dir :deep(.select:hover:enabled) { background: var(--hover-chrome); }
.send-file { flex: none; white-space: nowrap; }
.file-status { padding-top: 6px; color: var(--text-secondary); font-size: var(--text-xs); overflow-wrap: anywhere; }
.activity-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-top: 1px solid var(--border-card); }
.activity-head { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 42px; padding-block: 8px; }
.history-tools { display: flex; align-items: center; gap: 6px; margin-inline-start: auto; }
.history-filters { display: inline-flex; gap: 2px; padding: 2px; border-radius: var(--radius-sm); background: var(--fill); }
.history-filters button, .history-search-toggle {
  display: inline-grid;
  place-items: center;
  min-height: 28px;
  padding: 0 9px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.history-filters button[aria-pressed="true"], .history-search-toggle[aria-expanded="true"] { background: var(--bg-surface); color: var(--text); }
.history-filters button[aria-pressed="true"] { font-weight: 600; }
.history-filters button:hover, .history-search-toggle:hover { color: var(--text); }
.history-search-toggle { width: 32px; padding: 0; }
.history-search {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  padding-inline: 10px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
}
.history-search:focus-within { border-color: var(--accent); }
.history-search input { flex: 1; min-width: 0; min-height: 34px; border: 0; outline: none; background: transparent; color: var(--text); font: inherit; }
.stream { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding-bottom: 10px; scrollbar-gutter: stable; }
.stream-empty { padding-block: 16px; color: var(--text-secondary); font-size: var(--text-xs); line-height: 1.7; }
.stream-empty strong { display: block; color: var(--text); font-size: var(--text-sm); font-weight: 600; }
.history-error .lan-text-button { min-height: 32px; }
.msg { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: start; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-subtle); }
.payload { min-width: 0; }
.mmeta { display: flex; flex-wrap: wrap; gap: 4px 8px; margin-top: 3px; color: var(--text-secondary); font-size: var(--text-xs); }
.msg[data-dir="peer"] .mmeta > span:first-child { color: var(--text-brand); }
.message-actions { display: flex; align-items: center; gap: 4px; }
.mact, .mget { display: inline-flex; align-items: center; min-height: 30px; padding: 0 6px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text-secondary); font: inherit; text-decoration: none; cursor: pointer; }
.mget { padding-inline: 9px; background: var(--fill); color: var(--text); }
.mact:hover, .mget:hover { background: var(--hover-chrome); color: var(--text); }
.mtext { color: var(--text); font: var(--text-sm)/1.6 var(--font-ui); white-space: pre-wrap; overflow-wrap: anywhere; }
.mtext.clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.mmore { margin-top: 4px; padding: 0; border: 0; background: none; color: var(--text-brand); font: inherit; font-size: var(--text-xs); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.mfile { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 8px; }
.mic { display: grid; place-items: center; min-height: 32px; border-radius: var(--radius-sm); background: var(--fill); color: var(--text-secondary); font: 600 11px/19px var(--font-ui); }
.msg[data-dir="peer"] .mic { background: var(--accent-soft); color: var(--text-brand); }
.mname { min-width: 0; color: var(--text); font-size: var(--text-sm); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msize { color: var(--text-secondary); font-size: var(--text-xs); white-space: nowrap; }

.lan-page .transfer-composer {
  display: grid;
  min-width: 0;
  margin: 8px 0 0;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-ib);
  background: var(--bg-surface);
}
.lan-page .transfer-composer:focus-within {
  border-color: var(--accent);
}
.lan-page .transfer-text-input {
  width: 100%;
  min-height: 56px;
  max-height: 140px;
  padding: 8px 12px;
  border: 0;
  border-radius: var(--radius-ib) var(--radius-ib) 0 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font: var(--text-sm)/1.55 var(--font-ui);
  resize: vertical;
}
.transfer-text-input::placeholder { color: var(--text-muted); }
.transfer-composer-bar {
  display: grid;
  grid-template-columns: minmax(0, 300px) minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-top: 1px solid var(--border-subtle);
}
.lan-page .composer-send { min-width: 62px; }
.text-hint { justify-self: end; color: var(--text-secondary); font-size: var(--text-xs); overflow-wrap: anywhere; }
.text-hint.err { color: var(--danger); }
.panel-meta { color: var(--text-muted); font-size: var(--text-xs); font-weight: 400; line-height: 18px; }
.lan-load-error { display: flex; align-items: flex-start; flex-direction: column; gap: 10px; padding: 48px 20px; color: var(--text-muted); }
.lan-load-error h2 { color: var(--text); }
.lan-load-error p { font-size: var(--text-xs); }
.lan-load-error .transfer-button { margin-top: 4px; }
/* 骨架屏沿用连接栏、输入区和记录列表的阅读顺序。 */
.lan-loading-state { flex: 1 1 auto; min-height: 0; display: flex; }
.loading-chat { flex: 1 1 auto; min-height: 340px; display: flex; flex-direction: column; }
.loading-head { flex: none; display: flex; align-items: center; gap: 10px; height: 45px; border-bottom: 1px solid var(--border-card); }
.loading-head span { display: block; height: 12px; border-radius: var(--radius-sm); background: var(--fill); }
.loading-head span:nth-child(1) { width: 44px; height: 14px; }
.loading-head span:nth-child(2) { width: 62px; }
.loading-head span:nth-child(3) { width: 132px; }
.loading-stream { flex: 1 1 auto; display: flex; flex-direction: column; gap: 36px; padding-block: 22px; border-top: 1px solid var(--border-card); }
.loading-stream span { display: block; height: 12px; border-radius: var(--radius-sm); background: var(--fill); }
.loading-stream span:nth-child(1) { width: 62%; }
.loading-stream span:nth-child(2) { width: 48%; }
.loading-stream span:nth-child(3) { width: 70%; }
.loading-composer { flex: none; height: 92px; margin-block: 16px; border-radius: var(--radius-ib); background: var(--fill); }
.fs-drop-hint { position: fixed; z-index: 800; inset: 8px; display: grid; place-items: center; border: 2px dashed var(--accent); border-radius: 12px; background: color-mix(in srgb, var(--bg-surface) 88%, transparent); pointer-events: none; }
.fs-drop-hint b { padding: 16px 24px; border-radius: var(--radius-ib); background: var(--bg-surface); color: var(--text); font-size: var(--text-lg); font-weight: 500; }

@container (max-width: 620px) {
  .chat-head { grid-template-columns: auto auto minmax(0, 1fr) auto; }
  .manage-btn { grid-column: 4; }
  .head-addr, .connection-detail { grid-column: 1 / 4; width: 100%; }
  .head-actions { grid-column: 4; }
}
@container (max-width: 480px) {
  .chat-head { grid-template-columns: auto minmax(0, 1fr) auto; }
  .manage-btn { grid-column: 3; }
  .head-addr, .head-actions, .connection-detail { grid-column: 1 / -1; }
  .chat-head { gap: 6px 8px; }
  .transfer-composer-bar { grid-template-columns: minmax(0, 1fr) auto; }
  .file-tools { grid-column: 1 / -1; }
  .text-hint { justify-self: start; padding-left: 4px; }
  .transfer-composer-bar .transfer-button, .head-actions .bar-btn { min-height: 38px; }
  .msg { grid-template-columns: 36px minmax(0, 1fr); gap: 4px 8px; }
  .mic { grid-row: span 2; }
  .message-actions { grid-column: 2; }
  .mact, .mget { min-height: 36px; }
  .lan-page .transfer-text-input { font-size: var(--text-base); }
}
@media (prefers-reduced-motion: reduce) { .lan-page :is(button, input, select) { transition: none; } }
</style>
