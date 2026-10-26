<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import CodexHudSprite from './CodexHudSprite.vue'
import {
  HUD_ALERT_MOVES,
  HUD_DOZE_EVERY,
  HUD_DOZE_GAP_MS,
  HUD_DOZE_MOVE,
  HUD_FIRST_SCENE_MS,
  HUD_LIFE_MOVES,
  HUD_MOVE_MS,
  HUD_SCENE_GAPS_MS,
  hudAriaLabel,
  type CodexHudEventPayload,
  type CodexHudMove,
  type CodexHudState,
} from '../../../utils/codexHud'

const state = ref<CodexHudState | null>(null)
const expanded = ref(false)
const pinned = ref(false)
const appWindow = getCurrentWindow()
const ariaLabel = computed(() => {
  if (!state.value) return 'Codex 桌面挂件'
  const base = hudAriaLabel(state.value)
  if (!expanded.value) return `${base}；悬停展开，点击角色看下一个动作`
  if (pinned.value) return `${base}；已固定展开，可在挂件设置中取消，点击面板打开 Codex`
  return `${base}；移开鼠标收起，点击角色看下一个动作，点击面板打开 Codex`
})

/** 掠过窗口不该弹面板，停一下才算“想看”；这个停留时长就是两者的分界。 */
const HOVER_DWELL_MS = 160
const DRAG_SETTLE_MS = 150

let unlisten: UnlistenFn[] = []
let revealed = false
let revealing = false
let saveTimer: ReturnType<typeof setTimeout> | undefined
let dwellTimer: ReturnType<typeof setTimeout> | undefined
let dragSettleTimer: ReturnType<typeof setTimeout> | undefined
let sceneTimer: ReturnType<typeof setTimeout> | undefined
let moveTimer: ReturnType<typeof setTimeout> | undefined
let armed = false
let dragging = false
let hovered = false
let pressedPanel = false
let pressX = 0
let pressY = 0
let ambientEnabled = true
/** 导演只数数：间隔、动作、打盹插入点全部按计数器轮转，第几秒放哪一手能数出来。 */
let gapTurn = 0
let moveTurn = 0
let sceneCount = 0
/** 被闸门挡下的那一档间隔；指针离开后按它续排，不重掷。 */
let pendingGap = HUD_FIRST_SCENE_MS
/** 上一次推过来的快照是否已经在告警：告警动作只给「刚变成告警」那一次 */
let wasAlert = false

/** 系统偏好在挂件运行期间也可能改变，动作要跟着收。 */
const motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)')
const reducedMotion = ref(motionMedia.matches)
/** 时长不进 prop：sprite 按动作名从同一张表里取，JS 收尾与 CSS 同源 */
const moveId = ref<CodexHudMove | ''>('')

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
    await invoke('desko_hud_reveal')
    revealed = true
    if (expanded.value) await invoke('desko_hud_set_expanded', { expanded: true })
    resetDirector()
    scheduleScene(HUD_FIRST_SCENE_MS)
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
  const skinChanged = state.value !== null && state.value.skin !== payload.state.skin
  wasAlert = alert
  state.value = payload.state
  applyTheme(payload.state)
  ambientEnabled = payload.ambient !== false
  const pinnedChanged = pinned.value !== (payload.pinned === true)
  pinned.value = payload.pinned === true
  // 固定展开来自设置，重建窗口和锁定后继续保留。
  if (payload.reveal) {
    clearDwell()
    hovered = false
    expanded.value = pinned.value
    cancelMove()
    resetDirector()
  } else {
    if (pinnedChanged) {
      clearDwell()
      setExpanded(pinned.value || hovered)
    }
    // 换皮肤就是重新开始：计数归零、整档重等，不吃旧池子排到一半的档期。
    if (skinChanged) {
      cancelMove()
      resetDirector()
      scheduleScene(HUD_FIRST_SCENE_MS)
    } else if (canAmbient()) {
      resumeSchedule()
    } else {
      stopScenes()
    }
  }
  // 告警那一下只在「变化」与「窗已经亮着」时放：首次快照窗还没 show，解锁重亮相也不该再缩一次。
  if (alertRisen && revealed && !reducedMotion.value) {
    void playMove(HUD_ALERT_MOVES[payload.state.skin], takeGap())
  }
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

/** 有人在看它、按着它、拖着它、窗还没亮、或系统与设置不让动 —— 都不排新场景。 */
function canAmbient(): boolean {
  return ambientEnabled
    && !reducedMotion.value
    && revealed
    && state.value !== null
    && !expanded.value
    && !pinned.value
    && !dragging
    && !hovered
    && !armed
    && document.visibilityState !== 'hidden'
}

function poolMove(): CodexHudMove {
  const pool = HUD_LIFE_MOVES[state.value?.skin ?? 'bunny']
  return pool[moveTurn % pool.length]
}

/** 第 5 场换成打盹；它不占池子名额，醒来接着从原来那一手走。 */
function nextSceneMove(): CodexHudMove {
  return sceneCount % HUD_DOZE_EVERY === 0 ? HUD_DOZE_MOVE : poolMove()
}

function takeGap(): number {
  const gap = HUD_SCENE_GAPS_MS[gapTurn % HUD_SCENE_GAPS_MS.length]
  gapTurn += 1
  return gap
}

function scheduleScene(gapMs: number): void {
  pendingGap = gapMs
  stopScenes()
  if (!canAmbient()) return
  sceneTimer = setTimeout(() => {
    sceneTimer = undefined
    runScene()
  }, gapMs)
}

function stopScenes(): void {
  clearTimeout(sceneTimer)
  sceneTimer = undefined
}

/** 闸门放开接着排；手上那一场还在演就不掐断，由它自己收尾接下一档。 */
function resumeSchedule(): void {
  if (sceneTimer || moveId.value || !canAmbient()) return
  scheduleScene(pendingGap)
}

function runScene(): void {
  if (!canAmbient()) return
  sceneCount += 1
  if (nextSceneMove() === HUD_DOZE_MOVE) {
    void playMove(HUD_DOZE_MOVE, HUD_DOZE_GAP_MS)
    return
  }
  const move = poolMove()
  moveTurn += 1
  void playMove(move, takeGap())
}

/** 同一个动作连放两次不会重启动画：先把 class 摘掉、等一帧渲染，再挂回去。 */
async function playMove(move: CodexHudMove, gapAfter: number): Promise<void> {
  // 告警或点击插进来时，先撤掉正在排的那一档，别让场景把这一手掐了
  stopScenes()
  clearTimeout(moveTimer)
  moveTimer = undefined
  if (moveId.value === move) {
    moveId.value = ''
    await nextTick()
  }
  moveId.value = move
  moveTimer = setTimeout(() => {
    moveTimer = undefined
    moveId.value = ''
    scheduleScene(gapAfter)
  }, HUD_MOVE_MS[move])
}

function cancelMove(): void {
  clearTimeout(moveTimer)
  moveTimer = undefined
  moveId.value = ''
}

function resetDirector(): void {
  gapTurn = 0
  moveTurn = 0
  sceneCount = 0
  pendingGap = HUD_FIRST_SCENE_MS
}

/** 点角色只演下一手；固定展开统一由设置管理。 */
async function playLifeMove(): Promise<void> {
  if (reducedMotion.value || !state.value) return
  const move = poolMove()
  moveTurn += 1
  await playMove(move, takeGap())
}

/** 右键打开原生设置入口。 */
function onContextMenu(): void {
  void invoke('desko_hud_context_menu').catch(() => {})
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
  stopScenes()
  armHoverReveal()
}

function onRootPointerLeave(): void {
  armed = false
  hovered = false
  clearDwell()
  if (!pinned.value) setExpanded(false)
  resumeSchedule()
}

/** 拖动由 onMoved 判定：startDragging 之后页面收得到移动窗口事件，未必收得到 pointerup。 */
function markDragging(): void {
  stopScenes()
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
    resumeSchedule()
  }, DRAG_SETTLE_MS)
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  armed = true
  stopScenes()
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
      if (!pinned.value) setExpanded(false)
      void invoke('desko_hud_open_codex').catch(() => {})
    } else {
      void playLifeMove()
    }
  }
  pressedPanel = false
  if (!dragging) resumeSchedule()
}

function onPointerCancel(): void {
  armed = false
  resumeSchedule()
}

function onMotionPreferenceChange(event: MediaQueryListEvent): void {
  reducedMotion.value = event.matches
  if (event.matches) {
    cancelMove()
    stopScenes()
    return
  }
  resumeSchedule()
}

/** 窗口被隐藏期间不空转计时器。 */
function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') stopScenes()
  else resumeSchedule()
}

onMounted(async () => {
  motionMedia.addEventListener('change', onMotionPreferenceChange)
  document.addEventListener('visibilitychange', onVisibilityChange)
  unlisten = [
    await listen<CodexHudEventPayload>('codex-hud:state', (event) => {
      void applyPayload(event.payload)
    }),
    await appWindow.onMoved(({ payload }) => {
      // 生活场景不搬窗口，能收到 Moved 的就只有用户拖动。
      markDragging()
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
  await emitTo('main', 'codex-hud:ready')
})

onUnmounted(() => {
  motionMedia.removeEventListener('change', onMotionPreferenceChange)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  clearTimeout(saveTimer)
  clearTimeout(dragSettleTimer)
  clearTimeout(sceneTimer)
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
    @contextmenu.prevent="onContextMenu"
  >
    <CodexHudSprite
      v-if="state"
      :state="state"
      :expanded="expanded"
      :pinned="pinned"
      :move="moveId"
      idle
      react
      @pointerenter="onSpritePointerEnter"
    />
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
</style>
