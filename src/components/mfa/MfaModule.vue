<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import jsQR from 'jsqr'
import { mfaApi, type MfaCode } from '../../services/api/mfa'
import { avatarLetter } from '../../utils/avatar'
import { errText } from '../../services/api/backup'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'
import { useEscapeClose } from '../../composables/useEscapeClose'
import { usePageActive } from '../../composables/usePageActive'
import { useWorkspaceLayout, workspaceToolbarTarget } from '../layout/workspaceLayout'
import AppIcon from '../shared/AppIcon.vue'
import CreateAction from '../shared/CreateAction.vue'
import { usePageHeadStore } from '../../stores/pageHead'
import { isWebRuntime } from '../../services/runtime'
import { writeClipboardText } from '../../utils/clipboard'

const toastStore = useToastStore()
const pageActive = usePageActive()
const workspaceLayout = useWorkspaceLayout()
const confirmStore = useConfirmStore()
const webRuntime = isWebRuntime()

/* 档面取发行方首字，与收藏/文件身份档同一配方（utils/avatar），24px 档只放得下一枚 */

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
  if (!pageActive.value) return
  let expired = false
  for (const c of codes.value) {
    c.remaining -= 1
    if (c.remaining <= 0) expired = true
  }
  if (expired) refresh()
}

onMounted(async () => {
  refresh()
  timer = window.setInterval(tick, 1000)
})

watch(pageActive, visible => { if (visible) void refresh() })

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

/* 圆环倒计时：r=14 → 周长≈88，剩余越多描边越满（stroke-dashoffset 从 0 满环到 88 空环） */
const RING = 88
const ringOffset = (c: MfaCode) => RING * (1 - Math.max(c.remaining, 0) / Math.max(c.period, 1))

const copyCode = async (c: MfaCode) => {
  try {
    await writeClipboardText(c.code)
    toastStore.showToast('验证码已复制')
    copiedId.value = c.id
    if (copiedTimer) window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => { copiedId.value = null }, 1200)
  } catch {
    toastStore.showToast('复制失败', 'error')
  }
}

const confirmDelete = (c: MfaCode) => {
  confirmStore.showConfirm('删除验证码', `「${c.issuer || c.label}」的密钥将一并丢失，站点侧需重新绑定。`, async () => {
    try {
      await mfaApi.remove(c.id)
      await refresh()
      toastStore.showToast('已删除')
    } catch (e) {
      toastStore.showToast(errText(e), 'error')
    }
  }, '删除')
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
const imageInput = ref<HTMLInputElement | null>(null)

const imageDataFromBlob = async (blob: Blob): Promise<ImageData> => {
  const bmp = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('无法创建画布')
    ctx.drawImage(bmp, 0, 0)
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  } finally {
    bmp.close()
  }
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
  if (webRuntime) {
    imageInput.value?.click()
    return
  }
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

const onWebImageSelected = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 15 * 1024 * 1024) {
    toastStore.showToast('二维码图片不能超过 15 MB', 'error')
    return
  }
  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error)
      reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '')
      reader.readAsDataURL(file)
    })
    applyScan(jsQRFrom(await imageDataFromBlob(base64ToBlob(base64))))
  } catch {
    toastStore.showToast('图片解析失败', 'error')
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

const pageHead = usePageHeadStore()
watchEffect(() => {
  if (pageActive.value) pageHead.setHead('验证码', codes.value.length ? `${codes.value.length} 个账号` : '')
})
</script>

<template>
  <div class="content-inner" @paste="onPaste">
    <Teleport :to="workspaceToolbarTarget" :disabled="!workspaceLayout || !pageActive" defer>
    <div class="page-bar">
      <div class="page-actions">
        <CreateAction label="新增验证码" @click="openAdd" />
      </div>
    </div>
    </Teleport>

    <div v-if="loading" class="card-grid">
      <div class="mfa-card skeleton" v-for="n in 3" :key="n">
        <div class="card-top">
          <span class="skeleton-slot"></span>
          <span class="skeleton-line w40"></span>
        </div>
        <span class="skeleton-line w70 tall"></span>
      </div>
    </div>

    <div v-else-if="codes.length > 0" class="card-grid">
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
        <!-- 身份行：24px 档 + 发行方 + 账号（同行淡字）+ 右缘删除（hover 显形） -->
        <div class="card-top">
          <span class="mfa-tile grid-slot" aria-hidden="true">{{ avatarLetter(c.issuer || c.label) }}</span>
          <span class="card-issuer" :title="c.issuer || c.label">{{ c.issuer || c.label }}</span>
          <span v-if="c.issuer && c.label" class="card-label" :title="c.label">{{ c.label }}</span>
          <button class="ib danger card-del" type="button" title="删除" @click.stop="confirmDelete(c)">
            <AppIcon name="trash" :size="14" />
          </button>
        </div>
        <!-- 码行：24px 等宽六位/八位码 + 右下圆环倒计时（环心读秒） -->
        <div class="card-code-row">
          <div class="card-code" :class="{ copied: copiedId === c.id }" aria-live="polite">{{ copiedId === c.id ? '已复制' : grouped(c) }}</div>
          <AppIcon class="card-copy" name="copy" :size="15" />
          <span class="ring" aria-hidden="true">
            <svg width="32" height="32">
              <circle cx="16" cy="16" r="14" fill="none" stroke="var(--fill)" stroke-width="2.5" />
              <circle
                class="ring-fg"
                cx="16"
                cy="16"
                r="14"
                fill="none"
                stroke-width="2.5"
                stroke-linecap="round"
                :stroke-dasharray="RING"
                :stroke-dashoffset="ringOffset(c)"
              />
            </svg>
            <b class="timer-text">{{ Math.max(c.remaining, 0) }}s</b>
          </span>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon"><AppIcon name="navMfa" :size="24" /></div>
      <div class="empty-title">暂无验证码</div>
      <div class="empty-desc">点击右上角「新增验证码」，粘贴 otpauth 链接或识别二维码</div>
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
              <AppIcon name="x" :size="16" />
            </button>
          </div>
          <div class="dialog-body">
            <div class="seg" role="tablist">
              <button class="seg-btn" :class="{ on: addTab === 'uri' }" type="button" role="tab" @click="addTab = 'uri'">otpauth 链接</button>
              <button class="seg-btn" :class="{ on: addTab === 'manual' }" type="button" role="tab" @click="addTab = 'manual'">手动密钥</button>
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
                <input v-if="webRuntime" ref="imageInput" type="file" accept=".png,.jpg,.jpeg,.webp,.bmp,image/png,image/jpeg,image/webp,image/bmp" class="qr-file-input" aria-label="选择二维码图片" @change="onWebImageSelected" />
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
.card-copy { color: var(--text-muted); flex-shrink: 0; }
.mfa-card:is(:hover, :focus-visible) .card-copy { color: var(--accent); }
.qr-file-input { display: none; }
/* .content-inner / .page-bar / 主按钮走 global.css 的页面骨架；本页计数顶左、动作钮顶右 */

/* 96px 双行令牌卡（mock .otp）：身份行 + 码行（右下圆环倒计时），网格壳走全局 .card-grid */
.mfa-card {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
  min-height: 96px;
  overflow: hidden;
  border: 1px solid var(--border-card);
  border-radius: 12px;
  background: var(--bg-surface);
  box-shadow: var(--shadow-card-rest);
  padding: 13px 15px;
  cursor: pointer;
  transition: transform var(--transition), border-color var(--transition),
    box-shadow var(--transition), background-color var(--transition);
}
/* 与收藏/文件卡片使用相同的悬停反馈。 */
.mfa-card:hover {
  transform: translateY(-1px);
  border-color: var(--border-card-hover);
  box-shadow: var(--shadow-card-hover);
}
[data-base="light"] .mfa-card:hover { background: var(--sunken); }
[data-base="dark"] .mfa-card:hover { background: var(--hover); }
.mfa-card:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring), var(--shadow-pop);
}

/* 身份行：24px 档 + 发行方 + 账号淡字同行 + 右缘删除 */
.card-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
/* 档面收进 24px（与浮岛卡同一档），基座 .grid-slot 是 34px */
.mfa-card .grid-slot { width: 24px; height: 24px; border-radius: 6px; font-size: var(--text-2xs) }
.mfa-tile { font-weight: 700; letter-spacing: 0.02em; }
.card-issuer {
  flex: 0 1 auto;
  min-width: 0;
  font-size: var(--text-base);
  font-weight: var(--weight-card-title);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-label {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-del { margin-left: auto; flex: none; opacity: 0; transition: opacity var(--transition); }
.mfa-card:hover .card-del, .mfa-card:focus-within .card-del { opacity: 1; }
html.hover-suppressed .mfa-card:hover .card-del { opacity: 0; }

/* 码行：大号等宽码 + 右下圆环 */
.card-code-row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.card-code {
  font-family: var(--font-mono);
  font-size: var(--text-2xl);
  font-weight: 650;
  letter-spacing: 0.08em;
  color: var(--text);
  border-radius: var(--radius-sm);
}
/* 复制反馈：码区整块翻成「已复制」，1.2s 后转回——回执落在结果本身上 */
.card-code.copied { font-size: var(--text-lg); letter-spacing: 0; color: var(--success); }
/* 换码闪光：只在数字真换新的一瞬走一遍，是变化回执不是入场装饰 */
@keyframes code-flash {
  0% { background: color-mix(in srgb, var(--cat-3) 22%, transparent); }
  100% { background: transparent; }
}
.mfa-card.flash .card-code { animation: code-flash 0.6s ease-out; }

/* 圆环倒计时：32px，环心读秒；描边随剩余收放，临期转警示色 */
.ring { margin-left: auto; position: relative; width: 32px; height: 32px; flex: none; }
.ring svg { transform: rotate(-90deg); display: block; }
.ring-fg { stroke: var(--accent); transition: stroke-dashoffset 1s linear, stroke var(--transition); }
.ring .timer-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  font-weight: 600;
  color: var(--text-muted);
}
.mfa-card.expiring { border-color: color-mix(in srgb, var(--warning) 55%, var(--border)); }
.mfa-card.expiring .card-code { color: var(--warning); }
.mfa-card.expiring .ring-fg { stroke: var(--warning); }
.mfa-card.expiring .timer-text { color: var(--warning); }

/* 加载骨架：呼吸走在容器上（与行卡页一致），条块只出静态色 */
.mfa-card.skeleton {
  cursor: default;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}
.mfa-card.skeleton:hover { transform: none; border-color: var(--border-card); background: var(--bg-surface); box-shadow: var(--shadow-card-rest); }
.skeleton-line { height: 12px; border-radius: 5px; }
.skeleton-line.tall { height: 26px; width: 120px; }

/* 添加弹窗的页签走 global.css 的 .dialog .seg；凹槽+浮白药丸那一套已删 */

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
  background: var(--bg-surface);
}

.qr-row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.qr-hint { font-size: var(--text-xs); color: var(--text-muted); }
</style>
