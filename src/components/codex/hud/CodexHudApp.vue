<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { getCurrentWindow } from '@tauri-apps/api/window'
import CodexHudSprite from './CodexHudSprite.vue'
import {
  HUD_ALERT_MOVES,
  HUD_IDLE_MOVES,
  HUD_MOVE_MS,
  hudAriaLabel,
  type CodexHudEventPayload,
  type CodexHudMove,
  type CodexHudSkin,
  type CodexHudState,
} from '../../../utils/codexHud'

const state = ref<CodexHudState | null>(null)
const expanded = ref(false)
const pinned = ref(false)
const poke = ref(false)
const appWindow = getCurrentWindow()
const ariaLabel = computed(() => {
  if (!state.value) return 'Codex 桌面挂件'
  const base = hudAriaLabel(state.value)
  if (!expanded.value) return `${base}；悬停或点击角色展开`
  if (pinned.value) return `${base}；已钉住，点击角色取消钉住，点击面板打开 Codex`
  return `${base}；移开鼠标收起，点击角色钉住，点击面板打开 Codex`
})

/** 掠过窗口不该弹面板，停一下才算“想看”；这个停留时长就是两者的分界。 */
const HOVER_DWELL_MS = 160
const DRAG_SETTLE_MS = 150
const POKE_MS = 520

/** 走动：绕「用户放置的锚点」小幅散步，锚点才是落盘的位置，走动偏移永不落盘。
    一拍 = 跨步（窗内滑出）→ 跟位（整窗挪同样的量、角色瞬时归位）→ 落地停，屏幕坐标连续。 */
const WALK_LEASH_PX = 48
const WALK_COOLDOWN_MS = 1500
const WALK_MOVE_CLAIM_MS = 250
const WALK_SETTLE_MS = 180
const WALK_GLIDE_EASE = 'cubic-bezier(.22, .61, .36, 1)'
const WALK_TURN_SQUASH = 0.84

/** 招牌动作插在节拍间隙，取代原来的「张望」：每隔 3~5 拍抽一个，按顺序轮转不重样。 */
const MOVE_GAPS = [3, 4, 5]

type HudGait = {
  /** 一步的屏幕位移，CSS px */
  stride: number
  glide: number
  hold: number
  turnMs: number
}

const WALK_GAIT: Record<CodexHudSkin, HudGait> = {
  bunny: { stride: 6, glide: 340, hold: 210, turnMs: 240 },
  penguin: { stride: 4, glide: 420, hold: 260, turnMs: 240 },
  snail: { stride: 3, glide: 620, hold: 340, turnMs: 160 },
}

let unlisten: UnlistenFn[] = []
let revealed = false
let revealing = false
let saveTimer: ReturnType<typeof setTimeout> | undefined
let dwellTimer: ReturnType<typeof setTimeout> | undefined
let dragSettleTimer: ReturnType<typeof setTimeout> | undefined
let pokeTimer: ReturnType<typeof setTimeout> | undefined
let walkTimer: ReturnType<typeof setTimeout> | undefined
let moveTimer: ReturnType<typeof setTimeout> | undefined
let armed = false
let dragging = false
let hovered = false
let pressedPanel = false
let pressX = 0
let pressY = 0
let lastPointerAt = 0
let walkEnabled = true
let anchorX = 0
let anchorY = 0
let walkOffset = 0
let walkDir = 1
let walkScale = 1
let anchored = false
/** 巡游自己触发的 Moved：既不能当成拖动，也不能写进持久化位置。 */
let expectedMove: { x: number; y: number; at: number } | null = null
let walkStrides = 0
/** 距离下一个招牌动作还剩几拍，以及轮到第几个动作 */
let beatsToMove = MOVE_GAPS[0]
let moveTurn = 0
/** 系统级降低动效：招牌动作干脆不放，别让它无声地卡住节拍 */
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** 角色在窗口内的姿态。一条 transform 由一个持有者写完，所以跨步/起伏/转身共用一个对象。 */
const walkPose = ref({ lane: 0, bob: 0, face: 1, ms: 0, ease: 'ease-out' })
const walkLift = ref<'' | 'a' | 'b'>('')
/** 常驻步子那一下：角色自己那一层，与 `walkLift` 同奇偶 */
const walkGait = ref<'' | 'a' | 'b'>('')
const walkGaitMs = ref(0)
/** 时长不进 prop：sprite 按动作名从同一张表里取，JS 收尾与 CSS 同源 */
const moveId = ref<CodexHudMove | ''>('')
/** 上一次推过来的快照是否已经在告警：缩壳只给「刚变成告警」那一次 */
let wasAlert = false

const walkStyle = computed(() => ({
  transform: `translate3d(${walkPose.value.lane}px, ${walkPose.value.bob}px, 0) scaleX(${walkPose.value.face})`,
  transitionDuration: `${walkPose.value.ms}ms`,
  transitionTimingFunction: walkPose.value.ease,
}))

function applyTheme(next: CodexHudState): void {
  const root = document.documentElement
  root.setAttribute('data-layout', 'workspace')
  root.setAttribute('data-theme', next.theme.theme)
  root.setAttribute('data-base', next.theme.base)
  root.setAttribute('data-accent', next.theme.accent)
  root.setAttribute('data-atmosphere', next.theme.atmosphere ? 'on' : 'off')
}

/** 窗口先隐着等首帧：字体与两帧绘制都落定后再 show，避免纸/墨闪一下。 */
async function revealAfterPaint(): Promise<void> {
  if (revealing) return
  revealing = true
  try {
    const fonts = 'fonts' in document
      ? document.fonts.ready
      : Promise.resolve()
    await Promise.race([fonts, new Promise((resolve) => setTimeout(resolve, 600))])
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    revealed = true
    await invoke('desko_hud_reveal')
    await reanchor()
    scheduleWalk()
  } catch {
    /* 主窗口下一次推 snapshot 时会再走一遍 reveal */
  } finally {
    revealing = false
  }
}

async function applyPayload(payload: CodexHudEventPayload): Promise<void> {
  const alert = Boolean(
    payload.state.severe || payload.state.stale || payload.state.placeholderAlert,
  )
  const alertRisen = alert && !wasAlert
  wasAlert = alert
  state.value = payload.state
  applyTheme(payload.state)
  walkEnabled = payload.walk !== false
  scheduleWalk()
  // 重新亮相（解锁/重建）一律从收起态开始：Rust 在 reveal 时也会把窗口缩回收起高度。
  if (payload.reveal) {
    clearDwell()
    pinned.value = false
    hovered = false
    expanded.value = false
    walkOffset = 0
    walkDir = 1
    walkStrides = 0
    beatsToMove = MOVE_GAPS[0]
    moveTurn = 0
    cancelMove()
    walkLift.value = ''
    walkGait.value = ''
    walkGaitMs.value = 0
    setPose({ ms: 0, ease: 'ease-out', lane: 0, bob: 0, face: 1 })
  } else {
    void parkAtAnchor()
  }
  // 告警那一下只在「变化」与「窗已经亮着」时放：首次快照窗还没 show，解锁重亮相也不该再缩一次。
  if (alertRisen && revealed && !reducedMotion) void playMove(HUD_ALERT_MOVES[payload.state.skin])
  await nextTick()
  if (payload.reveal) void revealAfterPaint()
}

function setExpanded(next: boolean): void {
  if (expanded.value === next) return
  expanded.value = next
  void invoke('desko_hud_set_expanded', { expanded: next }).catch(() => {
    expanded.value = !next
  })
}

function clearDwell(): void {
  if (dwellTimer) {
    clearTimeout(dwellTimer)
    dwellTimer = undefined
  }
}

async function reanchor(): Promise<void> {
  try {
    const pos = await appWindow.outerPosition()
    anchorX = pos.x
    anchorY = pos.y
    walkScale = await appWindow.scaleFactor()
    anchored = true
  } catch {
    /* 读不到显示器信息就这一轮不走，下一次推快照还会再试 */
  }
}

function leashPx(): number {
  return Math.max(1, Math.round(WALK_LEASH_PX * walkScale))
}

/** 有人在看它、按着它、拖着它、或者刚碰过它，都不许走。 */
function canWalk(): boolean {
  return walkEnabled
    && state.value !== null
    && !expanded.value
    && !pinned.value
    && !dragging
    && !hovered
    && !armed
    && Date.now() - lastPointerAt > WALK_COOLDOWN_MS
}

/** 招牌动作只在「没人管它」时抽；减少动效则干脆不放，别让它无声地卡住节拍。 */
function canMove(): boolean {
  return !reducedMotion && !expanded.value && !pinned.value && !dragging && !armed && !hovered
}

function gait(): HudGait {
  return WALK_GAIT[state.value?.skin ?? 'bunny']
}

function setPose(next: Partial<typeof walkPose.value>): void {
  walkPose.value = { ...walkPose.value, ...next }
}

function after(ms: number, run: () => void): void {
  clearTimeout(walkTimer)
  walkTimer = setTimeout(run, ms)
}

/** 同一个动作连放两次不会重启动画：先把 class 摘掉、等一帧渲染，再挂回去。 */
async function playMove(id: CodexHudMove): Promise<void> {
  clearTimeout(moveTimer)
  if (moveId.value === id) {
    moveId.value = ''
    await nextTick()
  }
  moveId.value = id
  moveTimer = setTimeout(() => { moveId.value = '' }, HUD_MOVE_MS[id])
}

function cancelMove(): void {
  clearTimeout(moveTimer)
  moveTimer = undefined
  moveId.value = ''
}

/** 空转也要留表：被挡住时按节拍重试，指针一走自然接上。 */
function scheduleWalk(): void {
  if (!walkEnabled) {
    clearTimeout(walkTimer)
    walkTimer = undefined
    return
  }
  const g = gait()
  after(g.glide + g.hold, beginBeat)
}

function beginBeat(): void {
  if (!canWalk()) {
    settleWalk()
    return
  }
  const g = gait()
  const step = Math.max(1, Math.round(g.stride * walkScale))
  if (Math.abs(walkOffset + walkDir * step) > leashPx()) {
    beginTurn(g)
    return
  }
  walkStrides += 1
  const odd = walkStrides % 2 === 1
  setPose({ ms: g.glide, ease: WALK_GLIDE_EASE, lane: walkDir * g.stride })
  walkLift.value = odd ? 'a' : 'b'
  walkGait.value = odd ? 'a' : 'b'
  walkGaitMs.value = g.glide
  after(g.glide, endStride)
}

/** 跟位：窗口和车道在同一个任务里交换，窗口先动、角色瞬时归位，屏幕位置才接得上。 */
function endStride(): void {
  const g = gait()
  const step = Math.round(walkPose.value.lane * walkScale)
  if (step !== 0 && canWalk()) {
    const target = { x: anchorX + walkOffset + step, y: anchorY, at: Date.now() }
    expectedMove = target
    void appWindow.setPosition(new PhysicalPosition(target.x, target.y)).then(() => {
      walkOffset += step
    }).catch(() => {
      expectedMove = null
    })
  }
  setPose({ ms: 0, ease: 'ease-out', lane: 0, bob: 0 })
  walkLift.value = ''
  walkGait.value = ''
  walkGaitMs.value = g.hold
  after(g.hold, afterHold)
}

/** 落地停那一拍：数到点的拍间隙抽一个招牌动作，没数到就继续迈步。 */
function afterHold(): void {
  if (!canWalk()) {
    settleWalk()
    return
  }
  const pick = takeIdleMove()
  if (!pick) {
    beginBeat()
    return
  }
  void playMove(pick)
  after(HUD_MOVE_MS[pick], beginBeat)
}

/** 不掷骰子：按计数器轮转，第几拍放哪一手能数出来，单测才断言得动。 */
function takeIdleMove(): CodexHudMove | '' {
  if (!canMove()) return ''
  beatsToMove -= 1
  if (beatsToMove > 0) return ''
  const pool = HUD_IDLE_MOVES[state.value?.skin ?? 'bunny']
  const pick = pool[moveTurn % pool.length]
  moveTurn += 1
  beatsToMove = MOVE_GAPS[moveTurn % MOVE_GAPS.length]
  return pick
}

/** 兔子/企鹅左右几乎对称，翻面等于没翻——靠挤压那一下让「掉头」看得见。 */
function beginTurn(g: HudGait): void {
  const inMs = Math.max(60, Math.round(g.turnMs * 0.45))
  setPose({ ms: inMs, ease: 'ease-out', face: walkDir * WALK_TURN_SQUASH, bob: 0.5 })
  after(inMs, () => {
    walkDir = -walkDir
    const outMs = Math.max(60, g.turnMs - inMs)
    setPose({ ms: outMs, ease: 'ease-out', face: walkDir, bob: 0 })
    after(outMs, beginBeat)
  })
}

/** 有人在看、在按、在拖：车道收回锚点，窗口停在它当前所在的那一点。 */
function settleWalk(): void {
  clearTimeout(walkTimer)
  walkTimer = undefined
  cancelMove()
  walkLift.value = ''
  walkGait.value = ''
  walkGaitMs.value = WALK_SETTLE_MS
  const p = walkPose.value
  // 拖动每帧都会进来一次，姿态已经归位就别再写一遍
  if (p.lane !== 0 || p.bob !== 0 || p.face !== walkDir) {
    setPose({ ms: WALK_SETTLE_MS, ease: 'ease-out', lane: 0, bob: 0, face: walkDir })
  }
  scheduleWalk()
}

/** 认领巡游自己造成的 Moved；Rust 夹回（撞屏边）时按实际位置收绳并掉头。 */
function claimWalkMove(payload: { x: number; y: number }): boolean {
  const target = expectedMove
  if (!target) return false
  expectedMove = null
  if (Date.now() - target.at > WALK_MOVE_CLAIM_MS) return false
  if (Math.abs(payload.x - target.x) > 1 || Math.abs(payload.y - target.y) > 1) {
    const leash = leashPx()
    walkOffset = Math.max(-leash, Math.min(leash, payload.x - anchorX))
    if (Math.abs(walkOffset) >= leash) walkDir = -walkDir
  }
  return true
}

/** 走动被关掉时别把它丢在巡游半路上：送回用户放置的那一点，落盘位置始终不变。 */
async function parkAtAnchor(): Promise<void> {
  if (walkEnabled || !anchored) return
  clearTimeout(walkTimer)
  walkTimer = undefined
  cancelMove()
  walkLift.value = ''
  walkGait.value = ''
  walkGaitMs.value = WALK_SETTLE_MS
  setPose({ ms: WALK_SETTLE_MS, ease: 'ease-out', lane: 0, bob: 0, face: 1 })
  if (walkOffset === 0) return
  const target = { x: anchorX, y: anchorY, at: Date.now() }
  expectedMove = target
  try {
    await appWindow.setPosition(new PhysicalPosition(target.x, target.y))
    walkOffset = 0
    walkDir = 1
  } catch {
    expectedMove = null
  }
}

/** 点角色 = 钉住/解钉，顺带眨一下：让这一下有回应，但不动面板。 */
async function pokeCharacter(): Promise<void> {
  poke.value = false
  await nextTick()
  poke.value = true
  clearTimeout(pokeTimer)
  pokeTimer = setTimeout(() => { poke.value = false }, POKE_MS)
}

function armHoverReveal(): void {
  if (expanded.value || pinned.value || dragging) return
  clearDwell()
  dwellTimer = setTimeout(() => {
    dwellTimer = undefined
    if (hovered && !pinned.value && !dragging) setExpanded(true)
  }, HOVER_DWELL_MS)
}

/** 角色只占窗口上半，指针进角色才算“要看”；4px 透明边上掠过不该弹。 */
function onSpritePointerEnter(): void {
  hovered = true
  lastPointerAt = Date.now()
  settleWalk()
  armHoverReveal()
}

function onRootPointerLeave(): void {
  armed = false
  hovered = false
  lastPointerAt = Date.now()
  clearDwell()
  if (!pinned.value) setExpanded(false)
}

/** 拖动由 onMoved 判定：startDragging 之后页面收得到移动窗口事件，未必收得到 pointerup。 */
function markDragging(): void {
  lastPointerAt = Date.now()
  settleWalk()
  if (!dragging) {
    dragging = true
    clearDwell()
    if (!pinned.value) setExpanded(false)
  }
  clearTimeout(dragSettleTimer)
  dragSettleTimer = setTimeout(() => {
    dragSettleTimer = undefined
    dragging = false
    if (hovered) armHoverReveal()
  }, DRAG_SETTLE_MS)
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  armed = true
  lastPointerAt = Date.now()
  settleWalk()
  // 手已经搭上来了，之后任何移动都算用户意图，不再认巡游的账
  expectedMove = null
  pressedPanel = !!(event.target as Element | null)?.closest?.('.tag')
  pressX = event.clientX
  pressY = event.clientY
}

function onPointerMove(event: PointerEvent): void {
  if (!armed || dragging) return
  if (Math.hypot(event.clientX - pressX, event.clientY - pressY) <= 4) return
  armed = false
  markDragging()
  void appWindow.startDragging().catch(() => {})
}

function onPointerUp(event: PointerEvent): void {
  if (!armed) return
  armed = false
  if (event.button === 0 && !dragging) {
    if (pressedPanel) {
      pinned.value = false
      setExpanded(false)
      void invoke('desko_hud_open_codex').catch(() => {})
    } else {
      pinned.value = !pinned.value
      setExpanded(pinned.value || hovered)
      void pokeCharacter()
    }
  }
  pressedPanel = false
}

function onPointerCancel(): void {
  armed = false
}

onMounted(async () => {
  unlisten = [
    await listen<CodexHudEventPayload>('codex-hud:state', (event) => {
      void applyPayload(event.payload)
    }),
    await appWindow.onMoved(({ payload }) => {
      if (claimWalkMove(payload)) return
      markDragging()
      // 用户拖动改的是锚点本身；巡游偏移永远不参与落盘。
      anchorX = payload.x
      anchorY = payload.y
      walkOffset = 0
      if (!revealed) return
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        void invoke('desko_hud_save_position', {
          x: Math.round(payload.x),
          y: Math.round(payload.y),
        }).catch(() => {})
      }, 300)
    }),
  ]
  await reanchor()
  scheduleWalk()
  await emitTo('main', 'codex-hud:ready')
})

onUnmounted(() => {
  clearTimeout(saveTimer)
  clearTimeout(dragSettleTimer)
  clearTimeout(pokeTimer)
  clearTimeout(walkTimer)
  clearTimeout(moveTimer)
  clearDwell()
  unlisten.forEach((stop) => stop())
  unlisten = []
})
</script>

<template>
  <div
    class="hud"
    role="img"
    :aria-label="ariaLabel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @pointerleave="onRootPointerLeave"
  >
    <div class="walk" :style="walkStyle">
      <CodexHudSprite
        v-if="state"
        :state="state"
        :expanded="expanded"
        :poke="poke"
        :lift="walkLift"
        :gait="walkGait"
        :gait-ms="walkGaitMs"
        :move="moveId"
        idle
        react
        @pointerenter="onSpritePointerEnter"
      />
    </div>
  </div>
</template>

<style scoped>
.hud {
  width: 100%;
  height: 100%;
  padding: 4px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
}
/* 走动的位移、起伏、转身全压在这一层：一个元素一条 transform，不与角色内部的呼吸层打架。
   轴心落在脚底，挤压掉头时脚不会飘。 */
.walk {
  flex: none;
  transform-origin: 50% 100%;
  transition-property: transform;
  will-change: transform;
}
</style>
