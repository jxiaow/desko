<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getCurrentWebview } from '@tauri-apps/api/webview'
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
  fsSaveConfig,
  requestOpenSettingsTab,
} from '../../services/fileshareSettings'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../shared/AppIcon.vue'

const toastStore = useToastStore()

const dirAdd = ref('')
const targetIdx = ref(0)
const dragActive = ref(false)
const dropping = ref(false)
const received = ref<{ name: string; url: string }[]>([])

const running = fsRunning
const status = fsStatus
const dirs = computed(() => fsConfig.value?.shareDirs ?? [])
/** 局域网开放且没口令：任何人都能读写共享目录，要提醒一句 */
const openWarn = computed(() => running.value && !fsLocalOnly.value && !fsHasPassword.value)
/** 目录可能被别的入口删到少于当前选项，取不到就退回最后一个 */
const target = computed(() => Math.min(targetIdx.value, Math.max(dirs.value.length - 1, 0)))
const targetName = computed(() => baseName(dirs.value[target.value] ?? ''))
const linkBase = computed(() => status.value?.lanUrl ?? status.value?.localUrl ?? '')
/** 横幅说的是"谁能访问"，页条胶囊说的是"在不在听"，两句不重复 */
const exposure = computed(() => {
  if (!running.value) return '服务未启动'
  return fsLocalOnly.value ? '仅本机可访问' : '同网段设备可访问'
})
/** 仅本机态下局域网地址等于本机地址，横幅那行直接显示本机地址 */
const bannerUrl = computed(() => {
  const s = status.value
  if (!s) return ''
  return fsLocalOnly.value ? s.localUrl : s.lanUrl
})

function baseName(p: string) {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

/** 提取链接与网页端列表同一格式：/download?share=N&name=<编码名> */
function extractUrl(name: string) {
  return `${linkBase.value}/download?share=${target.value}&name=${encodeURIComponent(name)}`
}

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

async function importPaths(paths: string[]) {
  if (!running.value) {
    toastStore.showToast('先启动服务，拖入才会落到共享目录', 'error')
    return
  }
  dropping.value = true
  try {
    const r = await fileshareApi.importFiles(target.value, paths)
    r.stored.forEach((f) => received.value.push({ name: f.name, url: extractUrl(f.name) }))
    if (r.failed.length) {
      const why = r.failed[0]
      toastStore.showToast(
        r.stored.length ? `已接收 ${r.stored.length} 个，${r.failed.length} 个未落盘：${why}` : why,
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

onMounted(async () => {
  fsRefresh()
  // 外部文件只能由原生层给路径：HTML5 的 dataTransfer 在这拿不到真实路径
  unlistenDrag = await getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload
    if (p.type === 'drop') {
      dragActive.value = false
      void importPaths(p.paths)
    } else {
      dragActive.value = p.type !== 'leave'
    }
  })
})

onUnmounted(() => unlistenDrag?.())
</script>

<template>
  <div class="content-inner">
    <!-- 加载态与其余四页同一语言：骨架行走 global 的 .rowlist + .skeleton-row，不写"加载中…"句子 -->
    <div v-if="!fsLoaded" class="rowlist" aria-hidden="true">
      <div class="skeleton-row" v-for="n in 2" :key="n">
        <span class="skeleton-block"></span>
        <span class="skeleton-line w40"></span>
      </div>
    </div>

    <template v-else>
      <!-- 顶栏：状态胶囊 ｜ 启停大按钮（标题退役，五页统一无页标题） -->
      <div class="page-bar">
        <span class="chip" :class="{ live: running }">
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

      <!-- 分组一：状态横幅（上半）+ 访问地址行（下半），一张卡说完地址这件事 -->
      <section class="clean-group-card">
        <div class="fs-banner">
          <span class="banner-ico grid-slot" :class="{ on: running }" aria-hidden="true">
            <AppIcon name="navLan" :size="18" />
          </span>
          <div class="banner-main">
            <div class="banner-title">{{ exposure }}</div>
            <div v-if="running" class="banner-line">
              <span
                class="banner-url"
                role="button"
                tabindex="0"
                title="点击复制访问地址"
                @click="copyUrl(bannerUrl)"
                @keyup.enter="copyUrl(bannerUrl)"
              >
                {{ bannerUrl }}
              </span>
              <button class="ib help" type="button" title="同网段设备打不开时，先在 Windows 防火墙放行本应用的专用网络">?</button>
            </div>
          </div>
          <button class="btn-secondary manage-btn" type="button" @click="requestOpenSettingsTab('fileshare')">
            <AppIcon name="gear" :size="13" />
            管理共享
          </button>
        </div>
        <div
          v-if="running && !fsLocalOnly"
          class="group-row url-row local"
          role="button"
          tabindex="0"
          title="点击复制本机地址"
          @click="copyUrl(status!.localUrl)"
          @keyup.enter="copyUrl(status!.localUrl)"
        >
          <span class="chip">本机</span>
          <code>{{ status!.localUrl }}</code>
          <button class="ib" type="button" title="复制本机地址" @click.stop="copyUrl(status!.localUrl)">
            <AppIcon name="copy" :size="14" />
          </button>
        </div>
        <!-- 停止态由横幅标题说话；这里只留全页唯一的警告位，一次说最要紧的一件事 -->
        <p v-if="running && openWarn" class="group-note chip-warn">
          <AppIcon name="lock" :size="12" />
          未设访问口令，同网段任何人都能浏览、上传这些目录。
          <button class="link-btn" type="button" @click="requestOpenSettingsTab('fileshare')">去设置</button>
        </p>
        <p v-else-if="running && fsPortDrifted" class="group-note chip-warn">
          端口 {{ status!.boundPort }} · 配置 {{ status!.configuredPort }} 被占
        </p>
      </section>

      <!-- 分组二：拖拽直投。虚线皮是这张卡自己的边框，不再往白卡里塞第二层盒；
           停止态收成一行提示，不为一个用不了的动作留半屏空白 -->
      <section class="drop-card" :class="{ active: dragActive && running, off: !running }">
        <div class="well-body">
          <AppIcon class="well-ico" :name="dropping ? 'clock' : 'upload'" :size="running ? 28 : 20" />
          <div class="well-text">
            <div class="well-title">{{ running ? (dropping ? '正在落盘…' : '把文件拖到这里') : '拖拽直投' }}</div>
            <div class="well-sub" v-if="running">
              落到 {{ targetName }} · 同名自动加 (1) · 单文件 4 GiB 内
            </div>
            <div class="well-sub" v-else>启动服务后，从资源管理器把文件拖进来即可生成提取链接</div>
          </div>
        </div>
        <div v-if="running && dirs.length > 1" class="dz-dirs">
          <span class="dz-dirs-label">投到</span>
          <button
            v-for="(d, i) in dirs"
            :key="d"
            class="chip"
            :class="{ on: i === target }"
            type="button"
            :title="d"
            @click="targetIdx = i"
          >
            {{ baseName(d) }}
          </button>
        </div>
        <div v-if="received.length" class="recv-list">
          <div
            v-for="f in received"
            :key="f.url"
            class="group-row url-row recv"
            role="button"
            tabindex="0"
            :title="`点击复制 ${f.name} 的提取链接`"
            @click="copyUrl(f.url)"
            @keyup.enter="copyUrl(f.url)"
          >
            <span class="chip">已投</span>
            <code>{{ f.url }}</code>
            <button class="ib" type="button" title="复制提取链接" @click.stop="copyUrl(f.url)">
              <AppIcon name="copy" :size="14" />
            </button>
          </div>
        </div>
      </section>

      <!-- 拖入中：整窗一圈虚线 + 极淡主色底。原生 onDragDropEvent 是窗口级的，
           松手在哪儿都落盘，提示就不该只画在那张卡上——只画卡上等于骗人说只有这块能丢 -->
      <Teleport to="body">
        <div v-if="dragActive && running" class="fs-drop-hint" aria-hidden="true">
          <b>松手即投进 {{ targetName }}</b>
        </div>
      </Teleport>

      <!-- 分组三：共享目录 -->
      <section class="clean-group-card">
        <div class="group-head">共享目录</div>
        <div v-for="(d, i) in dirs" :key="d" class="group-row dir-row">
          <span class="dir-ico grid-slot grid-slot--folder" aria-hidden="true"><AppIcon name="folder" :size="18" /></span>
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
.content-inner { --font-mono: Consolas, 'Cascadia Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace; }

.mono { font-family: var(--font-mono); }

/* ── 顶栏：.page-bar 骨架在 global.css（磨砂吸顶），本页只留启停钮的皮；状态胶囊走 global .chip ── */
.toggle-btn { margin-left: auto }

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
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
}
.group-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 16px;
}
.group-row + .group-row { border-top: 1px solid var(--border); }
/* 行轨与收藏/文件页同档 60px；提示行（note）不受力，仍按内容收口 */
.url-row, .dir-row, .dir-add-row { height: 60px; }
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
  font-family: inherit;
  font-size: inherit;
  font-weight: 600;
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.link-btn:hover { text-decoration-thickness: 2px }

/* ── 状态横幅：40px 图标槽 + 状态标题 + 等宽地址；它替代原「访问地址」卡的表头 ── */
.fs-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  min-height: 64px;
  border-bottom: 1px solid var(--border);
}
/* 尺寸/圆角/中性底走 global.css .grid-slot（与收藏、文件、验证码的身份档同轴），这里只给状态色 */
.banner-ico.on { background: var(--accent-soft); color: var(--accent); }
.banner-main { flex: 1; min-width: 0; }
.banner-title { font-size: var(--text-sm); font-weight: 600; color: var(--text); }
.banner-line { display: inline-flex; align-items: center; gap: 6px; margin-top: 4px; max-width: 100%; }
/* 访问地址是"读一条 URL"，与收藏页行内的 URL 同档 13px 等宽，不再单列一档 17px */
.banner-url {
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.banner-url:hover { color: var(--text-brand); }
.manage-btn {
  flex-shrink: 0;
  /* 与页条主钮同档 30px，别把横幅撑高 */
  height: 30px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-ib);
  font-size: var(--text-sm);
}

/* 访问地址行：整行可点复制 */
.url-row { cursor: pointer; }
.url-row:hover { background: var(--fill); }
.url-row code {
  flex: 1;
  min-width: 0;
  padding: 0;
  background: none;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text);
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-gutter: stable;
}
.ib.help { font-size: var(--text-sm); font-weight: 700; }

/* 已投文件行：链接本身就在等宽里，名字不必再单列 */
.recv-list { border-top: 1px solid var(--border); }
.recv code { font-size: var(--text-sm); color: var(--text-url); }

/* ── 拖拽直投卡：虚线是"可以丢东西进来"的唯一暗示，它自己就是那层卡皮，
   不再嵌进白卡里当第二层；行式排版，停止态收成一行。非可滚动容器，不受 scrollbar-gutter 约束 ── */
.drop-card {
  border: 1.5px dashed var(--border-hover);
  border-radius: var(--radius-card);
  background: var(--panel-bg);
  box-shadow: var(--shadow-card);
  margin-bottom: var(--space-4);
  transition: border-color var(--transition), background var(--transition);
}
.well-body {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 60px;
  padding: 10px 16px;
}
/* 能投的时候这块得像个井：居中三段（图标／题字／副字）、104px 高。
   行式那 60px 太扁，看着只是张说明卡，不像能丢东西的地方。停止态不跟着长 */
.drop-card:not(.off) .well-body {
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  min-height: 104px;
  padding: 18px 16px;
  text-align: center;
}
.drop-card:not(.off) .well-title { font-size: var(--text-md); letter-spacing: -0.01em }
.drop-card:not(.off) .well-sub { margin-top: 0 }
.well-ico { color: var(--text-muted); flex-shrink: 0 }
.well-text { min-width: 0 }
.well-title { font-size: var(--text-sm); font-weight: 600; color: var(--text) }
.well-sub { font-size: var(--text-xs); color: var(--text-muted); margin-top: 2px }
.drop-card:hover,
.drop-card.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.drop-card.active .well-ico,
.drop-card.active .well-title { color: var(--accent); }
.drop-card.off { background: var(--panel-bg); border-color: var(--border) }
.drop-card.off .well-ico,
.drop-card.off .well-title { color: var(--text-muted) }

/* 拖入中的整页落点提示：pointer-events 不吃事件，只是把「哪儿都能丢」说清楚。
   压在弹窗之上（原生拖拽期间弹窗还开着也得看得见），tooltip 之下 */
.fs-drop-hint {
  position: fixed;
  inset: 8px;
  z-index: 9000;
  pointer-events: none;
  border: 2px dashed var(--accent);
  border-radius: var(--radius-card);
  /* 只敢薄薄一层：这层纱压在整窗的字上，浅色主题曾用 --accent-soft 62%，
     量下来页面正文对比被洗到 2.3:1；6% 主色既留着"整窗亮起"的感觉又不吃字 */
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}
.fs-drop-hint b {
  position: absolute;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%);
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--accent);
  white-space: nowrap;
  background: var(--panel-bg);
  border: 1px solid var(--accent-light);
  border-radius: var(--radius-pill);
  padding: 6px 14px;
  box-shadow: var(--shadow-sm);
}

/* 多目录才有得选；单目录时这行不出现，避免为一个选项做控件 */
.dz-dirs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 0 16px var(--space-3);
  border-top: 1px solid var(--border);
  min-height: 44px;
  padding-top: 8px;
}
.dz-dirs-label { font-size: var(--text-xs); color: var(--text-muted); margin-right: 2px; }
.dz-dirs .chip { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }

/* 共享目录行的档面：与文件页快捷方式同一张目录档（global.css .grid-slot--folder，34px） */
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
/* 输入 + 按钮成一组，落全站字段档 32px / --radius-sm，与弹窗里的字段同一档 */
.dir-add { flex: 1; min-width: 0; height: 32px; font-family: var(--font-mono); font-size: var(--text-sm); }
.add-btn {
  flex-shrink: 0;
  height: 32px;
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
