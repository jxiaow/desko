<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch, watchEffect } from 'vue'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import qrcode from 'qrcode-generator'
import { fileshareApi } from '../../services/api/fileshare'
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
import { useWorkspaceLayout, workspaceToolbarTarget } from '../layout/workspaceLayout'
import { isWebRuntime } from '../../services/runtime'
import { uploadSharedFile } from '../../services/transport'
import { writeClipboardText } from '../../utils/clipboard'

const toastStore = useToastStore()
const pageActive = usePageActive()
const workspaceLayout = useWorkspaceLayout()
const webRuntime = isWebRuntime()
const fileInput = ref<HTMLInputElement | null>(null)
let active = true
let poll: ReturnType<typeof setInterval> | undefined

const receivedList = ref<HTMLElement | null>(null)
const targetPathValue = ref('')
const dragActive = ref(false)
const dropping = ref(false)
const serviceAction = ref<'start' | 'stop' | null>(null)
const received = ref<{ name: string; url: string }[]>([])
watch(() => received.value.length, async () => {
  await nextTick()
  const list = receivedList.value
  if (list) list.scrollTop = list.scrollHeight
})

const running = fsRunning
const status = fsStatus
const dirs = computed(() => fsConfig.value?.shareDirs ?? [])
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
const targetPath = computed(() => targetPathValue.value || '在设置中添加共享目录')
const dirOptions = computed(() =>
  dirs.value.length
    ? dirs.value.map((d, i) => ({ value: i, label: baseName(d) }))
    : [{ value: 0, label: '请先在设置中添加共享目录' }]
)
const linkBase = computed(() => status.value?.lanUrl ?? status.value?.localUrl ?? '')
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

async function chooseFiles() {
  if (!running.value || dropping.value || !dirs.value.length) return
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
  if (dropping.value) return
  if (!running.value) {
    toastStore.showToast('请先启动服务再投递文件', 'error')
    return
  }
  const index = target.value
  const base = linkBase.value
  dropping.value = true
  try {
    const r = await fileshareApi.importFiles(index, paths)
    r.stored.forEach((f) => received.value.push({ name: f.name, url: `${base}/download?share=${index}&name=${encodeURIComponent(f.name)}` }))
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
  if (!running.value || dropping.value) return
  const index = target.value
  const base = linkBase.value
  dropping.value = true
  let count = 0
  try {
    for (const file of files) {
      if (!active) break
      const stored = await uploadSharedFile(file, index)
      if (!active) return
      received.value.push({ name: stored.name, url: `${base}/download?share=${index}&name=${encodeURIComponent(stored.name)}` })
      count++
    }
    if (active) toastStore.showToast(`已接收 ${count} 个文件`)
  } catch (e) { if (active) toastStore.showToast(`已接收 ${count} 个文件；${errText(e)}`, 'error') }
  finally { dropping.value = false }
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
  void fsRefresh()
  if (webRuntime) {
    poll = setInterval(() => { if (pageActive.value && !fsBusy.value && !dropping.value) void fsRefresh() }, 3000)
    return
  }
  // 外部文件只能由原生层给路径：HTML5 的 dataTransfer 在这拿不到真实路径
  const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
    if (!pageActive.value) return
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

onUnmounted(() => { active = false; clearInterval(poll); unlistenDrag?.() })

watch(pageActive, visible => {
  dragActive.value = false
  if (visible) void fsRefresh()
})
const pageHead = usePageHeadStore()
watchEffect(() => { if (pageActive.value) pageHead.setHead('局域网传输') })
</script>

<template>
  <div class="content-inner lan-page">
    <Teleport :to="workspaceToolbarTarget" :disabled="!workspaceLayout || !pageActive" defer>
      <div class="page-bar service-page-bar" data-workspace-heading="inline">
        <span class="chip" :class="{ live: running }"><span class="dot" aria-hidden="true"></span>{{ !fsLoaded ? '读取中' : running ? '监听中' : '已停止' }}</span>
        <div class="page-actions">
          <button v-if="fsLoaded && fsConfig && status" class="bar-btn service-toggle" :class="running ? 'btn-primary ghost-danger' : 'btn-primary'" type="button" :disabled="fsBusy || dropping" @click="toggle"><AppIcon v-if="running" name="x" :size="13" />{{ serviceAction === 'stop' ? '正在停止…' : serviceAction === 'start' ? '正在启动…' : running ? '停止服务' : '启动服务' }}</button>
          <button class="btn-secondary bar-btn manage-btn" type="button" aria-label="管理共享" title="管理共享" @click="requestOpenSettingsTab('fileshare')"><AppIcon name="gear" :size="16" /></button>
        </div>
      </div>
    </Teleport>

    <div v-if="!fsLoaded" class="lan-loading-state" role="status" aria-label="正在读取共享配置">
      <div class="rcard loading-connection" aria-hidden="true"><div class="loading-line"></div><div class="loading-line"></div><div class="loading-line"></div></div>
      <div class="loading-heading" aria-hidden="true"></div><div class="rcard loading-send" aria-hidden="true"><div class="loading-line"></div><div class="loading-well"></div></div>
    </div>
    <section v-else-if="!fsConfig || !status" class="lan-load-error" aria-labelledby="lan-error-title">
      <AppIcon name="alert" :size="24" /><h2 id="lan-error-title">无法读取共享配置</h2><p>请重试以获取服务状态和共享文件夹。</p><button class="action-btn" type="button" @click="fsRefresh()">重新加载</button>
    </section>

    <div v-else class="lan-content">
      <section class="connection-panel rcard" aria-labelledby="lan-connect-title">
        <div class="connection-body">
          <AppIcon class="connection-icon" name="navLan" :size="20" />
          <div class="connection-info">
            <h2 id="lan-connect-title">连接设备</h2>
            <div v-if="running" class="fs-banner">
              <p class="banner-title">{{ exposure }}</p>
              <div class="address-box"><span class="banner-url" :title="bannerUrl">{{ bannerUrl }}</span><button class="ib copy-address" type="button" aria-label="复制访问地址" title="复制访问地址" @click="copyUrl(bannerUrl)"><AppIcon name="copy" :size="14" /></button></div>
              <div class="connection-meta">
                <button v-if="!fsLocalOnly" class="local-address" type="button" :title="status.localUrl" @click="copyUrl(status.localUrl)"><span>本机</span><span>{{ status.localUrl }}</span><AppIcon name="copy" :size="12" /></button>
                <p v-if="openWarn" class="connection-notice group-note chip-warn"><AppIcon name="lock" :size="12" /><span>未设访问口令，设备可读写。<button class="lan-text-button" type="button" @click="requestOpenSettingsTab('fileshare')">去设置</button></span></p>
                <p v-else-if="fsPortDrifted" class="connection-notice group-note chip-warn">端口 {{ status.boundPort }} · 配置 {{ status.configuredPort }} 被占</p>
                <p v-else class="connection-notice"><AppIcon name="lock" :size="12" /><span>{{ fsHasPassword ? '访问时需验证口令' : '仅本机可访问' }}</span></p>
              </div>
              <p v-if="fsLocalOnly" class="local-explanation">其他设备暂时无法连接。<button class="lan-text-button" type="button" @click="requestOpenSettingsTab('fileshare')">更改访问范围</button></p>
            </div>
            <div v-else class="fs-idle">
              <h3 class="fs-idle-title">服务未启动</h3><p class="fs-idle-desc">{{ fsLocalOnly ? '通过本机浏览器上传和下载文件' : '同网段设备可通过浏览器上传和下载文件' }}</p>
              <dl class="fs-idle-config"><div><dt>访问范围</dt><dd>{{ fsLocalOnly ? '仅本机' : '同网段设备' }}</dd></div><div><dt>端口</dt><dd>{{ fsConfig.port }}</dd></div><div><dt>访问口令</dt><dd>{{ fsHasPassword ? '已设置' : '未设置' }}</dd></div></dl>
            </div>
          </div>
          <div v-if="running" class="connection-code"><template v-if="qrImage"><img class="connection-qr" :src="qrImage" :data-url="bannerUrl" alt="扫描二维码，在浏览器中打开共享文件" /><span>手机扫码打开</span></template><div v-else class="connection-local"><AppIcon name="lock" :size="24" /><span>仅本机</span></div></div>
        </div>
      </section>

      <section class="send-panel" aria-labelledby="lan-send-title">
        <header class="panel-heading"><h2 id="lan-send-title">投递文件</h2></header>
        <div class="rcard upload-card">
          <div class="target-field"><span id="lan-target-label" class="target-label">投递到</span><OptionSelect id="lan-target" class="target-select" :model-value="target" :options="dirOptions" :disabled="fsBusy || dropping || !dirs.length" :title="targetPath" :menu-width="320" aria-labelledby="lan-target-label" @update:model-value="targetPathValue = dirs[Number($event)] ?? ''" /><span class="target-path" :title="targetPath">{{ targetPath }}</span><span class="file-limit">单文件 4 GiB 内</span></div>
          <section v-if="running" class="drop-card" :class="{ active: dragActive, busy: dropping }" aria-label="投递文件区域" :aria-busy="dropping"
            @dragover="webRuntime && $event.preventDefault()" @dragenter="webRuntime && (dragActive = true)" @dragleave="webRuntime && !($event.currentTarget as HTMLElement).contains($event.relatedTarget as Node) && (dragActive = false)" @drop="dropBrowserFiles">
            <input v-if="webRuntime" ref="fileInput" type="file" multiple hidden aria-label="上传到共享目录" @change="chooseBrowserFiles" />
            <div class="well-body"><AppIcon class="well-icon" :name="dropping ? 'clock' : 'upload'" :size="28" /><p class="well-title">{{ dropping ? '正在保存文件…' : webRuntime ? '选择文件或拖入上传' : '将文件拖放到这里' }}</p><p class="well-sub">{{ dropping ? '保存后可复制提取链接' : '支持同时投递多个文件，同名文件自动重命名' }}</p><button class="action-btn primary" type="button" :disabled="fsBusy || dropping || !dirs.length" @click="chooseFiles"><AppIcon name="plus" :size="14" />{{ dropping ? '正在投递…' : '选择文件' }}</button></div>
          </section>
          <div v-else class="send-paused"><AppIcon name="upload" :size="28" /><p>启动服务后，即可投递文件</p><span>文件将保存到所选共享文件夹。</span></div>
          <section class="session-files" aria-label="本次投递"><header class="session-heading"><h3>本次投递</h3><span v-if="received.length" class="panel-meta" role="status">{{ received.length }} 个文件</span></header><div class="session-content"><div v-if="received.length" ref="receivedList" class="recv-list" aria-label="已投递文件"><button v-for="(f, i) in received" :key="`${f.url}-${i}`" class="recv" type="button" :aria-label="`复制 ${f.name} 的提取链接`" :title="`${f.name} · 点击复制提取链接`" @click="copyUrl(f.url)"><span class="received-name">{{ f.name }}</span></button></div><p v-else class="session-empty" role="status">暂无投递记录</p></div></section>
        </div>
      </section>

    </div>
    <Teleport to="body" :disabled="!pageActive"><div v-if="dragActive && running && !dropping && dirs.length" class="fs-drop-hint" aria-hidden="true"><b>松手即投进 {{ targetName }}</b></div></Teleport>
  </div>
</template>

<style scoped>
.lan-page { font-size: var(--text-sm); font-variant-numeric: tabular-nums; }
.lan-page :is(h2, h3, p) { margin: 0; }
.lan-page h2 { font-size: var(--text-sm); font-weight: 500; line-height: 20px; }
/* 页级组标题与直连页同档：13/600 卡外，计数紧随 */
.lan-page .panel-heading h2 { font-weight: 600; color: var(--text-secondary); }
.lan-page h3 { font-size: var(--text-xs); font-weight: 400; line-height: 18px; }
.lan-page .rcard { margin-bottom: 0; }
.manage-btn { width: 32px; padding-inline: 0; }
.service-toggle { min-width: 76px; }
/* 停止与「停止隧道」同形：淡红底 + 红字 + ×，不再是一行裸文字 */
.service-toggle.ghost-danger:not(:disabled) {
  background: var(--danger-soft);
  color: var(--danger);
  box-shadow: none;
}
.service-toggle.ghost-danger:hover:not(:disabled) {
  background: var(--danger-soft);
  color: var(--danger-hover);
}
.lan-text-button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 30px; padding: 0; background: transparent; border: 0; border-radius: var(--radius-sm); color: var(--text-secondary); cursor: pointer; font: inherit; font-size: var(--text-xs); white-space: nowrap; }
.lan-text-button:hover:not(:disabled) { color: var(--text); }
.lan-page button:disabled { cursor: not-allowed; }
.lan-page .action-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; border-radius: var(--radius-ib); font-size: var(--text-xs); }
.lan-content { display: flex; flex-direction: column; gap: 22px; }
.connection-body { display: flex; align-items: flex-start; gap: 16px; padding: 18px 20px; }
.connection-icon { flex: none; margin-top: 1px; color: var(--text-muted); }
.connection-info { flex: 1; min-width: 0; }
.banner-title { margin-top: 4px !important; color: var(--text-muted); font-size: var(--text-xs); line-height: 20px; }
.address-box { display: flex; align-items: center; gap: 7px; margin-top: 7px; min-width: 0; }
.banner-url { min-width: 0; overflow-wrap: anywhere; font-size: var(--text-sm); line-height: 26px; color: var(--text); }
.copy-address { width: 26px; height: 26px; flex: none; }
.connection-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 20px; margin-top: 5px; color: var(--text-muted); font-size: var(--text-xs); line-height: 20px; }
.local-address { display: inline-flex; align-items: center; gap: 6px; min-width: 0; min-height: 20px; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; }
.local-address span:last-of-type { overflow-wrap: anywhere; }
.local-address > svg { flex: none; }
.local-address:hover { color: var(--text); }
.connection-notice { display: flex; align-items: center; gap: 6px; }
.connection-notice > svg { flex: none; }
.connection-notice.chip-warn { color: color-mix(in srgb, var(--warning) 72%, var(--text)); }
.connection-notice .lan-text-button { display: inline; min-height: 0; margin-left: 4px; font-weight: 500; color: inherit; }
.local-explanation { margin-top: 5px !important; color: var(--text-muted); font-size: var(--text-xs); line-height: 20px; }
.local-explanation .lan-text-button { margin-left: 4px; }
.connection-code { display: flex; flex: none; flex-direction: column; align-items: center; gap: 4px; color: var(--text-muted); font-size: 11px; line-height: 20px; }
.connection-qr { display: block; width: 80px; height: 80px; border-radius: var(--radius-sm); background: #fff; }
.connection-local { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 8px; width: 80px; height: 80px; color: var(--text-muted); border-radius: var(--radius-sm); background: var(--bg-canvas-input); }
.fs-idle { margin-top: 8px; }
.fs-idle-title { font-weight: 500 !important; color: var(--text-secondary); }
.fs-idle-desc { margin-top: 4px !important; color: var(--text-muted); font-size: var(--text-xs); line-height: 20px; }
.fs-idle-config { display: flex; flex-wrap: wrap; gap: 6px 24px; margin: 10px 0 0; padding: 0; font-size: var(--text-xs); line-height: 20px; }
.fs-idle-config > div { display: flex; gap: 8px; }
.fs-idle-config dt { color: var(--text-muted); }
.fs-idle-config dd { margin: 0; color: var(--text-secondary); }
.panel-heading { display: flex; align-items: center; gap: 8px; min-height: 32px; margin-bottom: 8px; }
.panel-meta { color: var(--text-muted); font-size: var(--text-xs); font-weight: 400; line-height: 18px; }
.target-field { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 10px 20px; border-bottom: 1px solid var(--border-subtle); }
.target-label { flex: none; color: var(--text-muted); font-size: var(--text-xs); }
.target-field .select { flex: none; width: 196px; min-width: 0; height: 30px; padding: 0 10px; border: 0; border-radius: var(--radius-ib); background: var(--bg-canvas-input); color: var(--text); font-size: var(--text-xs); }
.target-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); font-size: var(--text-xs); }
.file-limit { flex: none; margin-left: auto; color: var(--text-faint); font-size: 11px; white-space: nowrap; }
.drop-card { border: 0; background: transparent; transition: background-color var(--transition-fast); }
.upload-card:has(.drop-card.active) { outline: 2px solid var(--accent-ring); outline-offset: -2px; }
.drop-card.active { background: var(--accent-soft); box-shadow: inset 0 0 0 2px var(--accent-ring); }
.well-body { display: flex; align-items: center; justify-content: center; flex-direction: column; min-height: 168px; padding: 12px 20px; text-align: center; }
.well-icon { margin-bottom: 8px; color: var(--text-muted); }
.well-title { font-size: var(--text-base); line-height: 22px; font-weight: 500; color: var(--text); }
.well-sub { margin-top: 5px !important; color: var(--text-muted); font-size: var(--text-xs); line-height: 19px; }
.well-body .action-btn { margin-top: 10px; padding-inline: 14px; font-size: var(--text-sm); }
.send-paused { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px; min-height: 168px; padding: 12px 20px; text-align: center; color: var(--text-muted); }
.send-paused p { color: var(--text-secondary); font-size: var(--text-sm); }
.send-paused span { font-size: var(--text-xs); }
.session-files { display: grid; grid-template-columns: 76px minmax(0, 1fr); align-items: start; gap: 16px; margin: 0 20px; padding: 14px 0 16px; border-top: 1px solid var(--border-subtle); }
.session-heading { display: flex; align-items: flex-start; flex-direction: column; gap: 4px; padding-top: 2px; color: var(--text-secondary); }
.session-heading .panel-meta { font-size: 11px; line-height: 16px; }
.session-content { min-width: 0; padding-top: 1px; }
.recv-list { display: flex; flex-wrap: wrap; align-content: flex-start; gap: 6px; max-height: 102px; overflow-x: hidden; overflow-y: auto; scrollbar-gutter: stable; }
.recv { display: block; flex: 0 1 auto; max-width: min(100%, 280px); min-width: 0; height: 30px; padding: 0 9px; border: 0; border-radius: var(--radius-sm); background: var(--bg-canvas-input); color: var(--text-secondary); cursor: pointer; font: var(--text-xs)/30px var(--font-ui); text-align: left; transition: background-color var(--transition-fast), color var(--transition-fast); }
.received-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recv:hover { background: var(--accent-soft); color: var(--text-brand); }
.recv:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--accent-ring); color: var(--text-brand); }
.session-empty { padding: 2px 0; color: var(--text-muted); font-size: var(--text-xs); line-height: 30px; }
.lan-load-error { display: flex; align-items: flex-start; flex-direction: column; gap: 10px; padding: 48px 20px; color: var(--text-muted); }
.lan-load-error h2 { color: var(--text); }
.lan-load-error p { font-size: var(--text-xs); }
.lan-load-error .action-btn { margin-top: 4px; }
.loading-connection { min-height: 140px; padding: 22px 20px; }
.loading-line, .loading-heading, .loading-well { border-radius: var(--radius-sm); background: var(--fill); }
.loading-line { width: min(50%, 240px); height: 12px; margin-block: 6px 14px; }
.loading-heading { width: 86px; height: 14px; margin-block: 24px 12px; }
.loading-send { padding: 16px 20px; }
.loading-well { height: 168px; margin-top: 20px; }
.fs-drop-hint { position: fixed; z-index: 800; inset: 8px; display: grid; place-items: center; border: 2px dashed var(--accent); border-radius: 12px; background: color-mix(in srgb, var(--bg-surface) 88%, transparent); pointer-events: none; }
.fs-drop-hint b { padding: 16px 24px; border-radius: var(--radius-ib); background: var(--bg-surface); color: var(--text); font-size: var(--text-lg); font-weight: 500; }
@media (max-width: 900px) {
  .lan-content { gap: 18px; }
  .connection-body { padding: 16px; }
  .connection-meta { gap: 4px 12px; }
  .target-field { padding-inline: 16px; }
  .target-field .select { width: 170px; }
  .file-limit { display: none; }
  .well-body, .send-paused { min-height: 168px; padding-block: 12px; }
  .session-files { gap: 12px; margin-inline: 16px; }
}
@media (max-width: 600px) {
  .connection-body { gap: 10px; padding: 14px; }
  .connection-icon { display: none; }
  .connection-code { font-size: 10px; }
  .connection-qr, .connection-local { width: 64px; height: 64px; }
  .connection-meta { font-size: 11px; }
  .local-address { min-height: 36px; }
  .target-field { flex-wrap: wrap; gap: 5px; padding: 12px 14px; }
  .target-label { font-size: 11px; }
  .target-field .select { flex: 1; width: auto; min-height: 44px; font-size: var(--text-sm); }
  .target-path { flex-basis: 100%; padding-left: 46px; font-size: 11px; }
  .well-body, .send-paused { min-height: 176px; padding: 12px 14px; }
  .well-title { font-size: var(--text-sm); }
  .well-sub { font-size: 11px; max-width: 20em; }
  .well-body .action-btn { min-height: 44px; margin-top: 12px; }
  .session-files { display: block; margin-inline: 14px; padding-top: 12px; }
  .session-heading { flex-direction: row; align-items: center; gap: 8px; padding: 0; margin-bottom: 8px; }
  .recv-list { max-height: 144px; }
  .recv { max-width: 100%; height: 44px; line-height: 44px; }
}
@media (prefers-reduced-motion: reduce) { .lan-page :is(button, input, select, .drop-card) { transition: none; } }
</style>
