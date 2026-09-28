<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { fileshareApi } from '../../services/api/fileshare'
import { errText } from '../../services/api/backup'
import { readFileshareFeature } from '../../services/fileshareFeature'
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
  fsSaveConfig,
  requestOpenSettingsTab,
} from '../../services/fileshareSettings'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../shared/AppIcon.vue'

const toastStore = useToastStore()
const router = useRouter()

const dirAdd = ref('')

const running = fsRunning
const status = fsStatus
const dirs = computed(() => fsConfig.value?.shareDirs ?? [])
/** 局域网开放且没口令：任何人都能读写共享目录，要提醒一句 */
const openWarn = computed(() => running.value && !fsLocalOnly.value && !fsHasPassword.value)

const summary = computed(() => {
  const cfg = fsConfig.value
  if (!cfg) return ''
  return `端口 ${cfg.port} · ${cfg.localOnly ? '仅本机访问' : '对局域网开放'} · 口令${cfg.hasPassword ? '已设' : '未设'}`
})

async function toggle() {
  if (fsBusy.value) return
  fsBusy.value = true
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
  }
}

async function saveDirs(next: string[], okToast: string): Promise<boolean> {
  const cfg = fsConfig.value
  if (!cfg) return false
  try {
    await fsSaveConfig(next, cfg.port, cfg.localOnly)
    toastStore.showToast(okToast)
    return true
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
    return false
  }
}

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
  if (await saveDirs([...dirs.value, p], '共享目录已更新')) dirAdd.value = ''
}

async function removeDir(i: number) {
  if (dirs.value.length <= 1) {
    toastStore.showToast('至少保留一个共享目录', 'error')
    return
  }
  await saveDirs(dirs.value.filter((_, k) => k !== i), '共享目录已更新')
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
  fsRefresh()
})
</script>

<template>
  <div class="content-inner">
    <div v-if="!fsLoaded" class="empty-state"><div class="empty-title">加载中…</div></div>

    <template v-else>
      <!-- 顶栏：状态胶囊 ｜ 启停大按钮（标题退役，五页统一无页标题） -->
      <div class="page-bar">
        <span class="bar-count live-pill" :class="{ on: running }">
          <span class="dot" aria-hidden="true"></span>
          {{ running ? '监听中' : '已停止' }}
        </span>
        <button
          class="btn-primary toggle-btn"
          :class="{ 'ghost-danger': running }"
          :disabled="fsBusy"
          @click="toggle"
        >
          <AppIcon :name="running ? 'x' : 'upload'" :size="13" />
          {{ running ? '停止服务' : '启动服务' }}
        </button>
      </div>

      <!-- 配置摘要：点击直达设置弹窗的服务设置；整句中文走 UI 字体，不套 mono -->
      <button class="cfg-summary" type="button" title="前往设置修改" @click="requestOpenSettingsTab('fileshare')">
        <AppIcon name="edit" :size="12" />
        <span>{{ summary }}</span>
      </button>

      <!-- 分组一：访问地址 -->
      <section class="clean-group-card">
        <div class="group-head">访问地址</div>
        <div
          v-if="running && !fsLocalOnly"
          class="group-row url-row lan"
          role="button"
          tabindex="0"
          title="点击复制局域网地址"
          @click="copyUrl(status!.lanUrl)"
          @keyup.enter="copyUrl(status!.lanUrl)"
        >
          <span class="ep-label">局域网</span>
          <code class="lan-url">{{ status!.lanUrl }}</code>
          <button class="icon-btn help" type="button" title="同网段设备打不开时，先在 Windows 防火墙放行本应用的专用网络" @click.stop>?</button>
          <button class="icon-btn" type="button" title="复制局域网地址" @click.stop="copyUrl(status!.lanUrl)">
            <AppIcon name="copy" :size="14" />
          </button>
        </div>
        <div
          v-if="running"
          class="group-row url-row local"
          role="button"
          tabindex="0"
          title="点击复制本机地址"
          @click="copyUrl(status!.localUrl)"
          @keyup.enter="copyUrl(status!.localUrl)"
        >
          <span class="ep-label">本机</span>
          <code>{{ status!.localUrl }}</code>
          <button class="icon-btn" type="button" title="复制本机地址" @click.stop="copyUrl(status!.localUrl)">
            <AppIcon name="copy" :size="14" />
          </button>
        </div>
        <p v-if="!running" class="group-row dim">服务停止中，启动后在这里显示访问地址。</p>
        <!-- 全页唯一的警告位：一次只说最要紧的一件事 -->
        <p v-else-if="openWarn" class="group-note chip-warn">
          <AppIcon name="lock" :size="12" />
          未设访问口令，同网段任何人都能浏览、上传这些目录。
          <button class="link-btn" type="button" @click="requestOpenSettingsTab('fileshare')">去设置</button>
        </p>
        <p v-else-if="fsPortDrifted" class="group-note chip-warn">
          端口 {{ status!.boundPort }} · 配置 {{ status!.configuredPort }} 被占
        </p>
      </section>

      <!-- 分组二：共享目录 -->
      <section class="clean-group-card">
        <div class="group-head">共享目录</div>
        <div v-for="(d, i) in dirs" :key="d" class="group-row dir-row">
          <span class="dir-ico folder" aria-hidden="true"><AppIcon name="folder" :size="15" /></span>
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
          <button class="btn-secondary add-btn" :disabled="fsBusy || !dirAdd.trim()" @click="addDir">
            <AppIcon name="plus" :size="13" />
            添加
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
/* Cascadia Code 的斜杠零和写意字形在 12px 小字下发斜扎眼，本页等宽一律 Consolas 优先 */
.content-inner { --font-mono: Consolas, 'Cascadia Mono', monospace; }

.mono { font-family: var(--font-mono); }

/* ── 顶栏：.page-bar 骨架在 global.css（44px 磨砂吸顶），本页只留状态胶囊和启停钮的皮 ── */
.toggle-btn { margin-left: auto; }

.live-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: var(--text-sm);
  font-weight: 600;
  padding: 4px 11px;
  border-radius: var(--radius-pill);
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

/* 配置摘要行：低调的入口，不是内容；与吸顶栏拉开一档间距 */
.cfg-summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: var(--space-2) 0 var(--space-3);
  padding: 3px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  font-size: var(--text-sm);
  color: var(--text-muted);
  cursor: pointer;
}
.cfg-summary:hover { color: var(--text-secondary); background: var(--fill); }
.cfg-summary svg { flex-shrink: 0; }

/* ── 分组卡：一层框，行用细线分隔，不做卡中卡；外框与行卡同套发丝分层 ── */
.clean-group-card {
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  margin-bottom: var(--space-4);
}
.group-head {
  padding: 10px 16px 9px;
  font-size: var(--text-xs);
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
.group-row.dim { color: var(--text-muted); font-size: var(--text-base); }
.group-note {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--text-muted);
  padding: 8px 16px;
  border-top: 1px solid var(--border);
}
.group-note svg { flex-shrink: 0; }
.group-note.chip-warn { background: var(--warning-soft); color: var(--warning); border-top: none; }
.group-note.chip-warn:last-child { border-radius: 0 0 var(--radius-lg) var(--radius-lg); }
.link-btn {
  border: none;
  background: none;
  padding: 0;
  font-size: inherit;
  font-weight: 600;
  color: inherit;
  text-decoration: underline;
  cursor: pointer;
}

/* 访问地址行：整行可点复制 */
.url-row { cursor: pointer; }
.url-row:hover { background: var(--fill); }
.ep-label {
  flex-shrink: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--fill);
  padding: 2px 9px;
  border-radius: var(--radius-pill);
}
.url-row code {
  flex: 1;
  min-width: 0;
  padding: 0;
  background: none;
  font-family: var(--font-mono);
  font-size: var(--text-base);
  color: var(--text);
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-gutter: stable;
}
/* 局域网地址是本页的主角 */
.url-row.lan code.lan-url { font-size: var(--text-lg); font-weight: 600; }
.icon-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}
.icon-btn:hover { background: var(--panel-bg); color: var(--text); }
.icon-btn.help { font-size: var(--text-sm); font-weight: 700; }
.url-row .icon-btn + .icon-btn { margin-left: -4px; }

/* 共享目录行（.dir-ico 是本页私有，与文件页 32px 的 .ft-ico 不同档，不再同名） */
.dir-ico {
  width: 26px;
  height: 26px;
  border-radius: var(--radius);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.dir-ico.folder { background: var(--warning-soft); color: var(--warning); }
.dir-path {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
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

.dir-add-row { gap: var(--space-2); align-items: center; }
.dir-add { flex: 1; min-width: 0; height: 34px; font-family: var(--font-mono); font-size: var(--text-sm); }
.add-btn {
  flex-shrink: 0;
  /* 与 .dir-add 同高同圆角；btn-secondary 默认的 36px/8px 圆角比输入框大一圈 */
  height: 34px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}

.input {
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  padding: 6px 10px;
  font-size: var(--text-base);
  font-family: inherit;
  transition: border-color var(--transition), box-shadow var(--transition);
}
.input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
</style>
