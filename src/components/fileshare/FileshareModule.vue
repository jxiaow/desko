<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { fileshareApi, type FileShareStatus, type FileShareConfig } from '../../services/api/fileshare'
import { errText } from '../../services/api/backup'
import { readFileshareFeature } from '../../services/fileshareFeature'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../shared/AppIcon.vue'

const toastStore = useToastStore()
const router = useRouter()

const status = ref<FileShareStatus | null>(null)
const config = ref<FileShareConfig | null>(null)
const portInput = ref(8000)
const localOnly = ref(false)
const dirAdd = ref('')
const passwordInput = ref('')
const showPwInput = ref(false)
const busy = ref(false)
const loaded = ref(false)

const running = computed(() => status.value?.running ?? false)
const portDrifted = computed(
  () => running.value && status.value && status.value.boundPort !== status.value.configuredPort
)
const hasPassword = computed(() => config.value?.hasPassword ?? false)
/** 局域网开放且没口令：任何人都能读写共享目录，要提醒一句 */
const openWarn = computed(() => !localOnly.value && !hasPassword.value)

async function refresh() {
  try {
    const [st, cfg] = await Promise.all([fileshareApi.status(), fileshareApi.getConfig()])
    status.value = st
    config.value = cfg
    portInput.value = cfg.port
    localOnly.value = cfg.localOnly
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    loaded.value = true
  }
}

async function toggle() {
  if (busy.value) return
  busy.value = true
  try {
    if (running.value) {
      await fileshareApi.stop()
      status.value = await fileshareApi.status()
      toastStore.showToast('已停止监听')
    } else {
      status.value = await fileshareApi.start()
      toastStore.showToast('服务已启动')
    }
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    busy.value = false
  }
}

/** 一次改动一次落盘：目录/端口/仅本机都走这条即时保存，失败回读还原显示 */
async function persist(nextDirs: string[], nextPort: number, nextLocal: boolean, okToast: string): Promise<boolean> {
  if (busy.value) return false
  busy.value = true
  try {
    status.value = await fileshareApi.saveConfig(nextPort, nextDirs, nextLocal)
    toastStore.showToast(okToast)
    return true
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
    return false
  } finally {
    await refresh()
    busy.value = false
  }
}

const dirs = computed(() => config.value?.shareDirs ?? [])

async function addDir() {
  const p = dirAdd.value.trim()
  if (!p) {
    toastStore.showToast('请输入目录路径', 'error')
    return
  }
  if (dirs.value.some((d) => d.toLowerCase() === p.toLowerCase())) {
    toastStore.showToast('该目录已在列表里', 'error')
    return
  }
  const ok = await persist([...dirs.value, p], portInput.value, localOnly.value, '共享目录已更新')
  if (ok) dirAdd.value = ''
}

async function removeDir(i: number) {
  if (dirs.value.length <= 1) {
    toastStore.showToast('至少保留一个共享目录', 'error')
    return
  }
  await persist(dirs.value.filter((_, k) => k !== i), portInput.value, localOnly.value, '共享目录已更新')
}

async function applyPort() {
  const port = Math.max(1, Math.min(65535, portInput.value || config.value?.port || 8000))
  portInput.value = port
  if (port === config.value?.port) return
  await persist(dirs.value, port, localOnly.value, '端口已更新')
}

async function applyLocalOnly() {
  const want = localOnly.value
  const ok = await persist(dirs.value, portInput.value, want, want ? '已切到仅本机访问' : '已对局域网开放')
  if (!ok) localOnly.value = !want
}

async function applyPassword() {
  if (busy.value) return
  busy.value = true
  try {
    await fileshareApi.setPassword(passwordInput.value)
    toastStore.showToast('访问口令已更新')
    passwordInput.value = ''
    showPwInput.value = false
    await refresh()
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    busy.value = false
  }
}

async function clearPassword() {
  if (busy.value) return
  busy.value = true
  try {
    await fileshareApi.setPassword('')
    toastStore.showToast('已清除访问口令')
    await refresh()
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    busy.value = false
  }
}

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    toastStore.showToast('地址已复制')
  } catch {
    toastStore.showToast('复制失败', 'error')
  }
}

onMounted(async () => {
  // 直敲 URL 也要拦：开关没开就没有这个页面
  if (!(await readFileshareFeature())) {
    await router.replace('/entries')
    return
  }
  refresh()
})
</script>

<template>
  <div class="content-inner">
    <div v-if="!loaded" class="empty-state"><div class="empty-title">加载中…</div></div>

    <template v-else>
      <!-- 顶栏：标题 + 状态胶囊 ｜ 停止服务 -->
      <div class="page-bar">
        <h1 class="page-title">局域网传输</h1>
        <span class="bar-count live-pill" :class="{ on: running }">
          <span class="dot" aria-hidden="true"></span>
          {{ running ? '监听中' : '已停止' }}
          <template v-if="running && !portDrifted">· <span class="mono">端口 {{ status!.configuredPort }}</span></template>
        </span>
        <span v-if="running && portDrifted" class="chip-warn mono">端口 {{ status!.boundPort }} · 配置 {{ status!.configuredPort }} 被占</span>
        <span v-if="localOnly" class="chip-meta">仅本机</span>
        <button
          class="btn-primary toggle-btn"
          :class="{ 'ghost-danger': running }"
          :disabled="busy"
          @click="toggle"
        >
          <AppIcon :name="running ? 'x' : 'upload'" :size="13" />
          {{ running ? '停止服务' : '启动服务' }}
        </button>
      </div>

      <!-- 分组一：访问地址 -->
      <section class="clean-group-card">
        <div class="group-head">访问地址</div>
        <div v-if="running && !localOnly" class="group-row url-row lan">
          <span class="ep-label">局域网</span>
          <code>{{ status!.lanUrl }}</code>
          <button class="btn-secondary copy-btn" type="button" title="复制局域网地址" @click="copyUrl(status!.lanUrl)">
            <AppIcon name="copy" :size="13" />
            复制网址
          </button>
        </div>
        <div v-if="running" class="group-row url-row local">
          <span class="ep-label">本机</span>
          <code>{{ status!.localUrl }}</code>
          <button class="btn-secondary copy-btn" type="button" title="复制本机地址" @click="copyUrl(status!.localUrl)">
            <AppIcon name="copy" :size="13" />
            复制网址
          </button>
        </div>
        <p v-if="running && !localOnly" class="group-note">局域网打不开时，先在 Windows 防火墙里放行本应用的专用网络。</p>
        <p v-if="openWarn" class="group-note">
          <AppIcon name="lock" :size="12" />
          未设访问口令，同网段任何人都能浏览、上传这些目录。
        </p>
      </section>

      <!-- 分组二：共享目录 -->
      <section class="clean-group-card">
        <div class="group-head">共享目录</div>
        <div v-for="(d, i) in dirs" :key="d" class="group-row dir-row">
          <span class="ft-ico folder" aria-hidden="true"><AppIcon name="folder" :size="15" /></span>
          <span class="dir-path" :title="d">{{ d }}</span>
          <button class="ib danger dir-del" type="button" title="移除该目录" @click="removeDir(i)">
            <AppIcon name="trash" :size="14" />
          </button>
        </div>
        <div class="group-row dir-add-row">
          <input
            v-model="dirAdd"
            class="input dir-add"
            placeholder="添加共享目录，如 D:\share\docs"
            spellcheck="false"
            @keyup.enter="addDir"
          />
          <button class="btn-secondary add-btn" :disabled="busy || !dirAdd.trim()" @click="addDir">
            <AppIcon name="plus" :size="13" />
            添加
          </button>
        </div>
      </section>

      <!-- 分组三：服务设置 -->
      <section class="clean-group-card setting-card">
        <div class="group-head">服务设置</div>
        <div class="group-row setting-item">
          <div class="setting-info">
            <span class="setting-name">端口</span>
            <span class="setting-desc">被占用时自动向后漂移，实际端口见顶部</span>
          </div>
          <input
            v-model.number="portInput"
            class="input port-input"
            type="number"
            min="1"
            max="65535"
            @change="applyPort"
            @keyup.enter="applyPort"
          />
        </div>
        <div class="group-row setting-item">
          <div class="setting-info">
            <span class="setting-name">仅本机访问</span>
            <span class="setting-desc">只监听 127.0.0.1，其他设备无法连接</span>
          </div>
          <label class="switch">
            <input type="checkbox" v-model="localOnly" @change="applyLocalOnly" />
            <span class="switch-slider"></span>
          </label>
        </div>
        <div class="group-row setting-item" :class="{ stacked: showPwInput }">
          <div class="setting-info">
            <span class="setting-name">访问口令</span>
            <span class="setting-desc">启用后网页端所有页面都要先输口令</span>
          </div>
          <div class="pw-ctl">
            <span class="tag" :class="{ on: hasPassword }">{{ hasPassword ? '已启用' : '未启用' }}</span>
            <button v-if="!showPwInput" class="btn-secondary" @click="showPwInput = true">
              {{ hasPassword ? '修改口令' : '设置口令' }}
            </button>
            <button v-if="hasPassword" class="btn-secondary" :disabled="busy" @click="clearPassword">清除口令</button>
          </div>
          <div v-if="showPwInput" class="pw-row">
            <input
              v-model="passwordInput"
              class="input pw-input"
              type="password"
              placeholder="新口令"
              autocomplete="new-password"
              @keyup.enter="applyPassword"
            />
            <button class="btn-primary" :disabled="busy || !passwordInput" @click="applyPassword">设置</button>
            <button class="btn-secondary" @click="showPwInput = false; passwordInput = ''">取消</button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
/* Cascadia Code 的斜杠零和写意字形在 12px 小字下发斜扎眼，本页等宽一律 Consolas 优先 */
.content-inner { --font-mono: Consolas, 'Segoe UI Mono', 'Cascadia Mono', monospace; }

.content-inner { flex: 1; overflow-y: auto; scrollbar-gutter: stable; padding: 0 var(--space-5) 96px; }

.mono { font-family: var(--font-mono); }

/* ── 顶栏 ─────────────────────────────────────────────── */
.page-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: calc(var(--space-5) + var(--space-1)) 0 var(--space-3);
}
.page-title { font-size: 15px; font-weight: 600; color: var(--text); margin-right: var(--space-2); }
.toggle-btn { margin-left: auto; }

.live-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 11px;
  border-radius: 99px;
  background: var(--fill);
  color: var(--text-secondary);
  /* 全局 .bar-count 带 margin-right:auto，会把后面的元素顶散 */
  margin-right: 0;
}
.live-pill .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
}
.live-pill.on { background: var(--success-soft); color: var(--success); }
.live-pill.on .dot {
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft), 0 0 8px var(--success);
}
.live-pill .mono { font-size: 11.5px; font-weight: 500; }

.chip-meta, .chip-warn {
  font-size: 11.5px;
  font-weight: 500;
  padding: 3px 9px;
  border-radius: 99px;
  background: var(--fill);
  color: var(--text-secondary);
}
.chip-warn { background: var(--warning-soft); color: var(--warning); }

/* 浅红幽灵态停止按钮：压在 .btn-primary 全局样式之上 */
.toggle-btn.ghost-danger {
  background: var(--danger-soft);
  color: var(--danger);
  border: 1px solid var(--danger-border);
  box-shadow: none;
}
.toggle-btn.ghost-danger:hover {
  background: var(--danger-soft);
  border-color: var(--danger);
  color: var(--danger-hover);
}

/* ── 分组卡：一层框，行用细线分隔，不做卡中卡 ──────────── */
.clean-group-card {
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  margin-bottom: var(--space-4);
}
.group-head {
  padding: 10px 16px 9px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}
.group-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 16px;
}
.group-row + .group-row { border-top: 1px solid var(--border); }
.group-note {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-muted);
  padding: 8px 16px;
  border-top: 1px solid var(--border);
}
.group-note svg { flex-shrink: 0; }

/* 访问地址行：胶囊标签 + 等宽纯文字 + 复制钮 */
.ep-label {
  flex-shrink: 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--fill);
  padding: 2px 9px;
  border-radius: 99px;
}
.url-row code {
  flex: 1;
  min-width: 0;
  padding: 0;
  background: none;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text);
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-gutter: stable;
}
.copy-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  padding: 4px 10px;
}

/* 共享目录行 */
.ft-ico {
  width: 26px;
  height: 26px;
  border-radius: var(--radius);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ft-ico.folder { background: var(--warning-soft); color: var(--warning); }
.dir-path {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--text-url);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dir-del { opacity: 0; transition: opacity var(--transition); flex-shrink: 0; }
.dir-row:hover .dir-del, .dir-row:focus-within .dir-del { opacity: 1; }
html.hover-suppressed .dir-row:hover .dir-del { opacity: 0; }
.dir-del.danger:hover {
  background: var(--danger-soft);
  color: var(--danger);
  box-shadow: inset 0 0 0 1px var(--danger-border);
}

.dir-add-row { gap: var(--space-2); }
.dir-add { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 12.5px; }
.add-btn { flex-shrink: 0; }

/* 服务设置行 */
.setting-item { gap: var(--space-4); }
.setting-item.stacked { flex-wrap: wrap; }
.setting-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.setting-name { font-size: 13px; font-weight: 500; color: var(--text); }
.setting-desc { font-size: 11.5px; color: var(--text-muted); }

.input {
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  padding: 6px 10px;
  font-size: 13px;
  font-family: inherit;
  transition: border-color var(--transition), box-shadow var(--transition);
}
.input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-ring); }
.port-input {
  width: 90px;
  flex-shrink: 0;
  font-family: var(--font-mono);
  text-align: center;
}

.pw-ctl { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
.tag {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 8px;
  border-radius: 99px;
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.tag.on { border-color: var(--success); color: var(--success); }
.pw-row { display: flex; align-items: center; gap: var(--space-2); width: 100%; padding-bottom: var(--space-1); }
.pw-input { flex: 1; min-width: 160px; }
</style>
