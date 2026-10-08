<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import jsQR from 'jsqr'
import { mfaApi, type MfaCode } from '../../services/api/mfa'
import { errText } from '../../services/api/backup'
import { readMfaFeature } from '../../services/mfaFeature'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'

const toastStore = useToastStore()
const confirmStore = useConfirmStore()
const router = useRouter()

/* 发行方首字母块：与收藏/文件行的身份档同一配方（词首两枚，中文取前两字），
   档面尺寸/圆角/底色走 global.css 的 .grid-slot，色彩不再按发行方哈希分浓淡 */
const initials = (name: string) => {
  const words = name.trim().split(/[\s._\-/@]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return name.trim().slice(0, 2).toUpperCase()
}

const codes = ref<MfaCode[]>([])
const loading = ref(true)
let timer: number | undefined
let refreshing = false

/** 刚复制成功的卡片 id：验证码区短暂翻成「已复制」再转回 */
const copiedId = ref<string | null>(null)
let copiedTimer: number | undefined
/** 本次刷新里码值变了的卡：换码闪光（只在数字真换新时走，不是入场动画） */
const flashedIds = ref<Set<string>>(new Set())
let flashTimer: number | undefined

async function refresh() {
  if (refreshing) return
  refreshing = true
  // 首载（loading 仍为 true）不闪光：那批「变化」只是卡片第一次出现
  const prev = new Map(codes.value.map((c) => [c.id, c.code]))
  const firstLoad = loading.value
  try {
    codes.value = await mfaApi.codes()
    if (!firstLoad) {
      const changed = new Set(
        codes.value.filter((c) => prev.get(c.id) !== c.code).map((c) => c.id),
      )
      if (changed.size) {
        flashedIds.value = changed
        if (flashTimer) window.clearTimeout(flashTimer)
        flashTimer = window.setTimeout(() => { flashedIds.value = new Set() }, 600)
      }
    }
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    refreshing = false
    loading.value = false
  }
}

/* 本地每秒只减倒计时，减到 0 才向后端要一批新码：
   锁屏时视图整体卸载，定时器跟着清掉，不用管挂起唤醒的时钟漂移 */
function tick() {
  let expired = false
  for (const c of codes.value) {
    c.remaining -= 1
    if (c.remaining <= 0) expired = true
  }
  if (expired) refresh()
}

onMounted(async () => {
  // 直敲 URL 或锁前停在本页都可能绕开侧栏入口，页面自己再拦一道
  if (!(await readMfaFeature())) {
    await router.replace('/entries')
    return
  }
  refresh()
  timer = window.setInterval(tick, 1000)
})

onUnmounted(() => {
  if (timer !== undefined) window.clearInterval(timer)
  if (copiedTimer) window.clearTimeout(copiedTimer)
  if (flashTimer) window.clearTimeout(flashTimer)
})

/* 6 位按 3+3、8 位按 4+4 分组，读和抄都不容易错 */
const grouped = (c: MfaCode) => {
  const half = c.digits === 8 ? 4 : 3
  return c.digits > half ? `${c.code.slice(0, half)} ${c.code.slice(half)}` : c.code
}

const pct = (c: MfaCode) =>
  `${(Math.max(c.remaining, 0) / Math.max(c.period, 1)) * 100}%`

const copyCode = async (c: MfaCode) => {
  try {
    await navigator.clipboard.writeText(c.code)
    toastStore.showToast('验证码已复制')
    copiedId.value = c.id
    if (copiedTimer) window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => { copiedId.value = null }, 1200)
  } catch {
    toastStore.showToast('复制失败', 'error')
  }
}

const confirmDelete = (c: MfaCode) => {
  confirmStore.showConfirm('确认删除', `确定删除「${c.issuer || c.label}」的验证码？密钥将一并丢失。`, async () => {
    try {
      await mfaApi.remove(c.id)
      await refresh()
      toastStore.showToast('已删除')
    } catch (e) {
      toastStore.showToast(errText(e), 'error')
    }
  })
}

/* ---------- 添加弹窗 ---------- */

const showAddDialog = ref(false)
const addTab = ref<'uri' | 'manual'>('uri')
const uriInput = ref('')
const manualForm = ref({ issuer: '', label: '', secret: '' })
const busy = ref(false)

const openAdd = () => {
  addTab.value = 'uri'
  uriInput.value = ''
  manualForm.value = { issuer: '', label: '', secret: '' }
  showAddDialog.value = true
}

const closeAdd = () => {
  showAddDialog.value = false
}

useEscapeClose(closeAdd, () => showAddDialog.value)

const submitAdd = async () => {
  if (busy.value) return
  busy.value = true
  try {
    if (addTab.value === 'uri') {
      await mfaApi.addUri(uriInput.value.trim())
    } else {
      await mfaApi.addManual(
        manualForm.value.label.trim(),
        manualForm.value.secret,
        manualForm.value.issuer.trim() || undefined,
      )
    }
    closeAdd()
    await refresh()
    toastStore.showToast('已添加')
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    busy.value = false
  }
}

/* ---------- 二维码识别（前端 jsQR，后端只帮忙读文件） ---------- */

const imageDataFromBlob = async (blob: Blob): Promise<ImageData> => {
  const bmp = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(bmp, 0, 0)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

const base64ToBlob = (b64: string): Blob => {
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
  return new Blob([bytes])
}

const applyScan = (data: string | null) => {
  if (data && data.startsWith('otpauth://')) {
    addTab.value = 'uri'
    uriInput.value = data
    toastStore.showToast('二维码已识别，确认后添加')
  } else {
    toastStore.showToast('图片里没有识别到验证码二维码', 'error')
  }
}

const scanFromImageFile = async () => {
  try {
    const selected = await dialogOpen({
      multiple: false,
      directory: false,
      filters: [{ name: '二维码图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
    })
    if (!selected || typeof selected !== 'string') return
    const b64 = await mfaApi.readImage(selected)
    applyScan(jsQRFrom(await imageDataFromBlob(base64ToBlob(b64))))
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
}

const jsQRFrom = (img: ImageData): string | null =>
  jsQR(img.data, img.width, img.height)?.data ?? null

/* 截图直接 Ctrl+V 贴进弹窗也能识别，省一次存盘再选文件 */
const onPaste = async (e: ClipboardEvent) => {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (!file) continue
      e.preventDefault()
      try {
        applyScan(jsQRFrom(await imageDataFromBlob(file)))
      } catch {
        toastStore.showToast('图片解析失败', 'error')
      }
      return
    }
  }
  const text = e.clipboardData?.getData('text') ?? ''
  if (text.trim().startsWith('otpauth://') && addTab.value === 'uri') {
    e.preventDefault()
    uriInput.value = text.trim()
  }
}
</script>

<template>
  <div class="content-inner" @paste="onPaste">
    <div class="page-bar">
      <span class="bar-count">{{ codes.length }} 个账号</span>
      <button class="btn-primary" @click="openAdd">
        <AppIcon name="plus" :size="14" />
        新增
      </button>
    </div>

    <div v-if="loading" class="mfa-grid">
      <div class="mfa-card skeleton" v-for="n in 3" :key="n">
        <span class="skeleton-line w40"></span>
        <span class="skeleton-line w70 tall"></span>
      </div>
    </div>

    <div v-else-if="codes.length > 0" class="mfa-grid">
      <div
        v-for="c in codes"
        :key="c.id"
        class="mfa-card"
        :class="{ expiring: c.remaining <= 5, flash: flashedIds.has(c.id) }"
        role="button"
        tabindex="0"
        :aria-label="`复制 ${c.issuer || c.label} 的验证码`"
        title="点击复制验证码"
        @click="copyCode(c)"
        @keydown.enter.prevent="copyCode(c)"
        @keydown.space.prevent="copyCode(c)"
      >
        <div class="card-top">
          <span class="mfa-tile grid-slot" aria-hidden="true">{{ initials(c.issuer || c.label) }}</span>
          <span class="card-issuer" :title="c.issuer || c.label">{{ c.issuer || c.label }}</span>
          <button class="ib danger" type="button" title="删除" @click.stop="confirmDelete(c)">
            <AppIcon name="trash" :size="14" />
          </button>
        </div>
        <div v-if="c.issuer && c.label" class="card-label" :title="c.label">{{ c.label }}</div>
        <div class="card-code-row">
          <div class="card-code" :class="{ copied: copiedId === c.id }" aria-live="polite">{{ copiedId === c.id ? '已复制' : grouped(c) }}</div>
          <span class="timer-text">{{ Math.max(c.remaining, 0) }}s</span>
        </div>
        <div class="card-bottom"><div class="card-bottom-fill" :style="{ width: pct(c) }"></div></div>
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon"><AppIcon name="lock" :size="24" /></div>
      <div class="empty-title">暂无验证码</div>
      <div class="empty-desc">点击「新增」，粘贴 otpauth 链接或识别二维码</div>
    </div>

    <!-- Add Dialog -->
    <Transition name="dialog">
      <div v-if="showAddDialog" class="dialog-overlay">
        <div class="dialog" role="dialog" aria-modal="true" aria-label="添加验证码" @paste="onPaste">
          <div class="dialog-header">
            <div class="dialog-header-left">
              <h3>添加验证码</h3>
            </div>
            <button class="dialog-close" @click="closeAdd" title="关闭">
              <AppIcon name="x" :size="18" />
            </button>
          </div>
          <div class="dialog-body">
            <div class="add-tabs">
              <button class="add-tab" :class="{ active: addTab === 'uri' }" @click="addTab = 'uri'">otpauth 链接</button>
              <button class="add-tab" :class="{ active: addTab === 'manual' }" @click="addTab = 'manual'">手动密钥</button>
            </div>

            <template v-if="addTab === 'uri'">
              <div class="form-group">
                <label>链接</label>
                <textarea
                  v-model="uriInput"
                  class="uri-box"
                  rows="3"
                  placeholder="otpauth://totp/…"
                  spellcheck="false"
                ></textarea>
              </div>
              <div class="qr-row">
                <span class="qr-hint">有二维码图片？</span>
                <button class="btn-secondary" @click="scanFromImageFile">
                  <AppIcon name="image" :size="14" />
                  识别图片
                </button>
                <span class="qr-hint">或直接 Ctrl+V 粘贴截图</span>
              </div>
            </template>

            <template v-else>
              <div class="form-group">
                <label>服务名（可选）</label>
                <input v-model="manualForm.issuer" placeholder="如 GitHub" />
              </div>
              <div class="form-group">
                <label>账号</label>
                <input v-model="manualForm.label" placeholder="如 alice@example.com" />
              </div>
              <div class="form-group">
                <label>密钥（Base32）</label>
                <input v-model="manualForm.secret" placeholder="如 JBSWY3DPEHPK3PXP" spellcheck="false" />
              </div>
            </template>
          </div>
          <div class="dialog-footer">
            <button class="btn-secondary" @click="closeAdd">取消</button>
            <button class="btn-primary" :disabled="busy" @click="submitAdd">添加</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* .content-inner / .page-bar / 主按钮走 global.css 的页面骨架；本页计数顶左、动作钮顶右 */
.page-bar .btn-primary { margin-left: auto; }

.mfa-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-4);
  padding-top: var(--space-2);
}

.mfa-card {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--bg-surface);
  box-shadow: var(--shadow-card);
  padding: var(--space-3) var(--space-4);
  cursor: pointer;
  transition: border-color var(--transition), box-shadow var(--transition), background-color var(--transition);
}
/* hover 与收藏/文件行卡、小记便签同一配方：描边显色 + 背景微沉（轻量化轮，抬影退役） */
.mfa-card:hover {
  border-color: var(--border-card-hover);
  background: var(--bg-surface-hover);
}
.mfa-card:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }

.card-top { display: flex; align-items: center; gap: var(--space-3); }
/* 档面尺寸/圆角/中性底色走 global.css .grid-slot（34px 档），这里只留两枚字母的字面处理 */
.mfa-tile { font-weight: 700; letter-spacing: 0.02em; }
.card-issuer {
  flex: 1;
  min-width: 0;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-top .ib { opacity: 0; transition: opacity var(--transition); }
.mfa-card:hover .ib, .mfa-card:focus-within .ib { opacity: 1; }
html.hover-suppressed .mfa-card:hover .ib { opacity: 0; }

.card-label {
  margin-top: 2px;
  /* 与图块右侧的发行方名左缘对齐（34px 档 + 12px 间距） */
  margin-left: calc(34px + var(--space-3));
  font-size: var(--text-xs);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-code-row { display: flex; align-items: baseline; gap: var(--space-2); margin-top: var(--space-2); }
.card-code {
  font-family: var(--font-mono);
  font-size: var(--text-3xl);
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  border-radius: var(--radius-sm);
}
/* 复制反馈：码区整块翻成「已复制」，1.2s 后转回——回执落在结果本身上 */
.card-code.copied { font-size: var(--text-xl); letter-spacing: 0.02em; color: var(--success); }
/* 换码闪光：只在数字真换新的一瞬走一遍，是变化回执不是入场装饰 */
@keyframes code-flash {
  0% { background: color-mix(in srgb, var(--cat-3) 22%, transparent); }
  100% { background: transparent; }
}
.mfa-card.flash .card-code { animation: code-flash 0.6s ease-out; }

/* 通宽底缘进度线：2px 贴卡底沿，读秒收进码行右侧；剩余≤5s 整卡描边转警示色 */
.card-bottom { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--fill); }
.card-bottom-fill { height: 100%; background: var(--accent); transition: width 1s linear; }
.timer-text { margin-left: auto; font-size: var(--text-xs); color: var(--text-muted); font-variant-numeric: tabular-nums; }
.mfa-card.expiring { border-color: color-mix(in srgb, var(--warning) 55%, transparent); }
.mfa-card.expiring .card-code { color: var(--warning); }
.mfa-card.expiring .card-bottom-fill { background: var(--warning); }

/* 加载骨架：呼吸走在容器上（与行卡页一致），条块只出静态色 */
.mfa-card.skeleton {
  cursor: default;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}
.mfa-card.skeleton:hover { border-color: transparent; background: var(--bg-surface); box-shadow: var(--shadow-card); }
.skeleton-line { height: 12px; border-radius: 5px; }
.skeleton-line.tall { height: 26px; }

/* 添加弹窗：分段轨道与快捷方式弹窗 type-seg 同一套浮卡语言（凹槽底 + 浮白选中块） */
.add-tabs {
  display: flex;
  padding: 3px;
  background: var(--sunken);
  border-radius: var(--radius);
  margin-bottom: var(--space-4);
}
.add-tab {
  flex: 1;
  padding: 6px 14px;
  font-size: var(--text-sm);
  font-weight: 500;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-family: inherit;
  transition: all var(--transition);
}
.add-tab.active {
  background: var(--bg-surface);
  color: var(--text);
  font-weight: 600;
  box-shadow: var(--shadow-xs);
}
.add-tab:hover:not(.active) { color: var(--text-secondary); }

.uri-box {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  padding: 6px 11px;
  resize: vertical;
  transition: all var(--transition);
}
.uri-box:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
  background: var(--panel-bg);
}

.qr-row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.qr-row .btn-secondary { height: 32px; } /* 正文动作钮落字段档，别高过底栏主钮 */
.qr-hint { font-size: var(--text-xs); color: var(--text-muted); }
</style>
