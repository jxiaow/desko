import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { emitTo, listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import CodexHudApp from './CodexHudApp.vue'
import {
  HUD_DOZE_EVERY,
  HUD_DOZE_GAP_MS,
  HUD_FIRST_SCENE_MS,
  HUD_MOVE_MS,
  HUD_SCENE_GAPS_MS,
  type CodexHudEventPayload,
  type CodexHudMove,
  type CodexHudState,
} from '../../../utils/codexHud'

const { onMoved, startDragging, setPosition, invokeMock, movedHandler, reduce } = vi.hoisted(() => ({
  onMoved: vi.fn(),
  startDragging: vi.fn(),
  setPosition: vi.fn(),
  invokeMock: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  movedHandler: { current: undefined as ((arg: { payload: { x: number; y: number } }) => void) | undefined },
  reduce: { on: false, handlers: new Set<(event: MediaQueryListEvent) => void>() },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(), emitTo: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onMoved, startDragging, setPosition }),
}))
// jsdom 没有 matchMedia，而挂件开机第一件事就是读降低动效那一档
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: query.includes('reduced-motion') && reduce.on,
  media: query,
  addEventListener: (_: string, handler: (event: MediaQueryListEvent) => void) => reduce.handlers.add(handler),
  removeEventListener: (_: string, handler: (event: MediaQueryListEvent) => void) => reduce.handlers.delete(handler),
  addListener: () => {},
  removeListener: () => {},
}))
// 亮相要等两帧，真跑掉几十毫秒会把导演那 3 秒的边界糊掉：帧改成即时，秒表从 0 起算
const runFrameImmediately = (callback: FrameRequestCallback) => { callback(0); return 1 }

const state: CodexHudState = {
  skin: 'bunny',
  theme: { theme: 'paper', base: 'light', accent: 'ink', atmosphere: false },
  primary: { label: '5h', percentage: 68 },
  secondary: { label: 'w', percentage: 42 },
  placeholder: null,
  severe: false,
  stale: false,
  placeholderAlert: false,
  today: { tokens: 1_942_000, costUsd: 12.34 },
  updatedAt: 1_800_000_000,
}

/**
 * 兔子的时间线：等待 = 上一场结束到这一场开始。
 * 首档 3s，之后取间隔表轮转；打盹那档不走间隔表。
 */
const PLAN: Array<[number, CodexHudMove]> = [
  [HUD_FIRST_SCENE_MS, 'bow'],
  [HUD_SCENE_GAPS_MS[0], 'hop'],
  [HUD_SCENE_GAPS_MS[1], 'fold'],
  [HUD_SCENE_GAPS_MS[2], 'bow'],
  [HUD_SCENE_GAPS_MS[3], 'doze'],
  [HUD_DOZE_GAP_MS, 'hop'],
]

const off = vi.fn()
let wrapper: VueWrapper | undefined

function expandedCalls(): boolean[] {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === 'desko_hud_set_expanded')
    .map(([, args]) => args?.expanded as boolean)
}

function push(payload: CodexHudEventPayload): void {
  // 一次测例里可能挂载两次（先未亮相、再亮相），旧实例的注册还在数组里
  const calls = vi.mocked(listen).mock.calls
  const handler = calls[calls.length - 1][1] as (event: { payload: CodexHudEventPayload }) => void
  handler({ payload })
}

function enterCharacter(wrapper: VueWrapper): void {
  wrapper.get('.sprite').element.dispatchEvent(new Event('pointerenter'))
}

function leaveWindow(wrapper: VueWrapper): void {
  wrapper.get('.hud').element.dispatchEvent(new Event('pointerleave'))
}

function press(wrapper: VueWrapper, selector: string, x = 20, y = 20): void {
  wrapper.get(selector).element.dispatchEvent(
    new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0 }),
  )
}

function release(wrapper: VueWrapper, selector: string, x = 20, y = 20): void {
  wrapper.get(selector).element.dispatchEvent(
    new MouseEvent('pointerup', { bubbles: true, clientX: x, clientY: y, button: 0 }),
  )
}

/** 走表：定时器与 Vue 更新都得跟上，否则读到的还是上一帧的 class。 */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  await flushPromises()
}

function revealCount(): number {
  return invokeMock.mock.calls.filter(([cmd]) => cmd === 'desko_hud_reveal').length
}

/** 亮相整条链都在微任务里（字体与两帧已被桩压成即时）：排空队列，不消耗一毫秒。 */
async function drainToReveal(times = 1): Promise<void> {
  for (let i = 0; i < 8; i++) await advance(0)
  expect(revealCount()).toBe(times)
}

async function mountApp(): Promise<VueWrapper> {
  const next = mount(CodexHudApp)
  await flushPromises()
  push({ state, reveal: false })
  await flushPromises()
  return next
}

/** 窗已经亮着：导演在亮相那一刻排第一档，测例的秒表要从那一刻起算。 */
async function mountRevealed(): Promise<VueWrapper> {
  const next = mount(CodexHudApp)
  await flushPromises()
  push({ state, reveal: true })
  await drainToReveal()
  return next
}

async function clickCharacter(wrapper: VueWrapper): Promise<void> {
  press(wrapper, '.sprite')
  release(wrapper, '.sprite')
  await advance(0)
}

/** 从亮相那一刻沿时间线走到第 index 场开始，并校验它演的是哪一手；秒表只够走一次。 */
async function toSceneStart(index: number): Promise<void> {
  for (let i = 0; i < index; i++) {
    await advance(PLAN[i][0] + HUD_MOVE_MS[PLAN[i][1]])
  }
  await advance(PLAN[index][0])
  expect(moveClass()).toBe(`mv-${PLAN[index][1]}`)
}

function savedPositions(): unknown[] {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === 'desko_hud_save_position')
    .map(([, args]) => ({ x: args?.x, y: args?.y }))
}

function spriteClasses(): string[] {
  return wrapper?.get('.sprite').classes() ?? []
}

/** 招牌动作在 DOM 上只留一个 class：mv-bow / mv-hop / mv-doze… */
function moveClass(): string {
  return spriteClasses().find((c) => c.startsWith('mv-')) ?? ''
}

function cssVar(name: string): string {
  const style = String(wrapper?.get('.sprite').attributes('style') ?? '')
  return style.match(new RegExp(`${name}: ([^;]+);`))?.[1] ?? ''
}

function setReducedMotion(on: boolean): void {
  for (const handler of reduce.handlers) handler({ matches: on } as MediaQueryListEvent)
}

function setVisibility(value: 'visible' | 'hidden'): void {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value)
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  // useFakeTimers 会接管 requestAnimationFrame，桩必须打在它之后
  vi.stubGlobal('requestAnimationFrame', runFrameImmediately)
  vi.resetAllMocks()
  reduce.on = false
  reduce.handlers.clear()
  invokeMock.mockResolvedValue(undefined)
  startDragging.mockResolvedValue(undefined)
  setPosition.mockResolvedValue(undefined)
  vi.mocked(listen).mockResolvedValue(off)
  vi.mocked(emitTo).mockResolvedValue()
  onMoved.mockImplementation((handler: (arg: { payload: { x: number; y: number } }) => void) => {
    movedHandler.current = handler
    return Promise.resolve(off)
  })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('挂件展开手势', () => {
  it('鼠标停在角色上 160ms 才展开，掠过不弹', async () => {
    wrapper = await mountApp()
    enterCharacter(wrapper)
    await advance(100)
    expect(expandedCalls()).toEqual([])
    leaveWindow(wrapper)
    await advance(500)
    expect(expandedCalls()).toEqual([])
    expect(wrapper.find('.tag').exists()).toBe(false)
  })

  it('停留到位即展开，移开鼠标收起', async () => {
    wrapper = await mountApp()
    enterCharacter(wrapper)
    await advance(160)
    expect(expandedCalls()).toEqual([true])
    expect(wrapper.find('.tag').exists()).toBe(true)
    leaveWindow(wrapper)
    await advance(0)
    expect(expandedCalls()).toEqual([true, false])
    expect(wrapper.find('.tag').exists()).toBe(false)
  })

  it('设置固定展开后移开不收起，取消固定后恢复悬停展开', async () => {
    wrapper = await mountApp()
    push({ state, reveal: false, pinned: true })
    await advance(0)
    expect(wrapper.get('.pin-mark').attributes('title')).toContain('挂件设置')
    expect(expandedCalls()).toEqual([true])
    leaveWindow(wrapper)
    await clickCharacter(wrapper)
    expect(wrapper.find('.pin-mark').exists()).toBe(true)
    expect(wrapper.find('.tag').exists()).toBe(true)
    push({ state, reveal: false, pinned: false })
    await advance(0)
    expect(wrapper.find('.pin-mark').exists()).toBe(false)
    expect(expandedCalls()).toEqual([true, false])
    expect(wrapper.attributes('aria-label')).toContain('悬停展开，点击角色看下一个动作')
  })

  it('重建窗口时恢复固定展开，打开 Codex 也不清除固定设置', async () => {
    wrapper = await mountApp()
    push({ state, reveal: true, pinned: true })
    await drainToReveal()
    expect(expandedCalls()).toEqual([true])
    expect(wrapper.find('.tag').exists()).toBe(true)
    press(wrapper, '.tag')
    release(wrapper, '.tag')
    expect(invoke).toHaveBeenCalledWith('desko_hud_open_codex')
    expect(wrapper.find('.pin-mark').exists()).toBe(true)
    expect(expandedCalls()).toEqual([true])
  })

  it('锁定后仍显示额度并标明解锁后更新', async () => {
    wrapper = await mountRevealed()
    push({ state, reveal: false, pinned: true, locked: true })
    await advance(0)
    expect(wrapper.get('.hud-row1').text()).toContain('68%')
    expect(wrapper.get('.hud-row3').text()).toContain('解锁后更新')
    expect(wrapper.attributes('aria-label')).toContain('应用已锁定')
  })

  it('点面板打开 Codex 并收起未固定的面板', async () => {
    wrapper = await mountApp()
    enterCharacter(wrapper)
    await advance(160)
    press(wrapper, '.sprite')
    release(wrapper, '.sprite')
    press(wrapper, '.tag')
    release(wrapper, '.tag')
    expect(expandedCalls()).toEqual([true, false])
    expect(invoke).toHaveBeenCalledWith('desko_hud_open_codex')
    leaveWindow(wrapper)
    expect(expandedCalls()).toEqual([true, false])
  })

  it('按下即拖不会展开，拖定后仍在角色上则补一次展开', async () => {
    wrapper = await mountApp()
    enterCharacter(wrapper)
    press(wrapper, '.sprite')
    wrapper.get('.hud').element.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 60, clientY: 60, button: 0 }),
    )
    expect(startDragging).toHaveBeenCalledTimes(1)
    movedHandler.current?.({ payload: { x: 800, y: 400 } })
    await advance(160)
    expect(expandedCalls()).toEqual([])
    await advance(200)
    expect(expandedCalls()).toEqual([true])
  })

  it('只有亮过窗的拖动才落盘', async () => {
    wrapper = await mountApp()
    movedHandler.current?.({ payload: { x: 900, y: 660 } })
    await advance(400)
    expect(savedPositions()).toEqual([])
    wrapper.unmount()
    wrapper = await mountRevealed()
    movedHandler.current?.({ payload: { x: 900, y: 660 } })
    await advance(320)
    expect(savedPositions()).toEqual([{ x: 900, y: 660 }])
  })

  it('右键只请 Rust 弹挂件菜单，不展开也不钉住', async () => {
    wrapper = await mountApp()
    wrapper.get('.hud').element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await advance(0)
    expect(invoke).toHaveBeenCalledWith('desko_hud_context_menu')
    expect(wrapper.find('.tag').exists()).toBe(false)
    expect(wrapper.find('.pin-mark').exists()).toBe(false)
  })
})

describe('挂件生活场景导演', () => {
  it('亮相 3 秒才演第一手，之后按 7/11/8/14 轮档，第 5 场插打盹', async () => {
    wrapper = await mountRevealed()
    await advance(HUD_FIRST_SCENE_MS - 1)
    expect(moveClass()).toBe('')
    await advance(1)
    expect(moveClass()).toBe('mv-bow')
    expect(cssVar('--mv-dur')).toBe(`${HUD_MOVE_MS.bow}ms`)
    await advance(HUD_MOVE_MS.bow + HUD_SCENE_GAPS_MS[0])
    expect(moveClass()).toBe('mv-hop')
    await advance(HUD_MOVE_MS.hop + HUD_SCENE_GAPS_MS[1])
    expect(moveClass()).toBe('mv-fold')
    await advance(HUD_MOVE_MS.fold + HUD_SCENE_GAPS_MS[2])
    expect(moveClass()).toBe('mv-bow')
    await advance(HUD_MOVE_MS.bow + HUD_SCENE_GAPS_MS[3])
    expect(moveClass()).toBe('mv-doze')
  })

  it('打盹醒来的档期走 18 秒，不吃间隔表', async () => {
    wrapper = await mountRevealed()
    await toSceneStart(HUD_DOZE_EVERY - 1)
    expect(moveClass()).toBe('mv-doze')
    await advance(HUD_MOVE_MS.doze + HUD_DOZE_GAP_MS - 1)
    expect(moveClass()).toBe('')
    await advance(1)
    expect(moveClass()).toBe('mv-hop')
  })

  it('鼠标停在角色上就停排程，离开后按同一档重等', async () => {
    wrapper = await mountRevealed()
    await advance(HUD_FIRST_SCENE_MS - 1000)
    enterCharacter(wrapper)
    await advance(3000)
    expect(moveClass()).toBe('')
    leaveWindow(wrapper)
    await advance(HUD_FIRST_SCENE_MS - 1)
    expect(moveClass()).toBe('')
    await advance(1)
    expect(moveClass()).toBe('mv-bow')
  })

  it('正在演的那一场不被悬停掐断，收完才静下来', async () => {
    wrapper = await mountRevealed()
    await advance(HUD_FIRST_SCENE_MS)
    expect(moveClass()).toBe('mv-bow')
    enterCharacter(wrapper)
    await advance(HUD_MOVE_MS.bow)
    expect(moveClass()).toBe('')
    await advance(HUD_SCENE_GAPS_MS[0] + HUD_FIRST_SCENE_MS)
    expect(moveClass()).toBe('')
    leaveWindow(wrapper)
    await advance(HUD_SCENE_GAPS_MS[0])
    expect(moveClass()).toBe('mv-hop')
  })

  it('设置固定展开后不再排场景', async () => {
    wrapper = await mountRevealed()
    push({ state, reveal: false, pinned: true })
    await advance(HUD_MOVE_MS.bow + 60000)
    expect(moveClass()).toBe('')
    expect(setPosition).not.toHaveBeenCalled()
    expect(savedPositions()).toEqual([])
  })

  it('生活场景只演不动窗：全程不碰 setPosition，也不落盘', async () => {
    wrapper = await mountRevealed()
    await toSceneStart(4)
    expect(moveClass()).toBe('mv-doze')
    await advance(HUD_MOVE_MS.doze + HUD_DOZE_GAP_MS)
    expect(moveClass()).toBe('mv-hop')
    expect(setPosition).not.toHaveBeenCalled()
    expect(savedPositions()).toEqual([])
  })

  it('点角色就演下一手，第二次点是另一手', async () => {
    wrapper = await mountRevealed()
    await clickCharacter(wrapper)
    expect(moveClass()).toBe('mv-bow')
    expect(wrapper.find('.pin-mark').exists()).toBe(false)
    await advance(HUD_MOVE_MS.bow)
    await clickCharacter(wrapper)
    expect(moveClass()).toBe('mv-hop')
    expect(wrapper.find('.pin-mark').exists()).toBe(false)
  })

  it('打盹时点它会掐掉打盹，立刻演下一手', async () => {
    wrapper = await mountRevealed()
    await toSceneStart(HUD_DOZE_EVERY - 1)
    expect(moveClass()).toBe('mv-doze')
    await clickCharacter(wrapper)
    expect(moveClass()).toBe('mv-hop')
  })

  it('告警撤掉在排的那一档自己上，且不占生活池名额', async () => {
    wrapper = await mountRevealed()
    const low = { ...state, severe: true, primary: { label: '5h', percentage: 9 } }
    await advance(1000)
    push({ state: low, reveal: false })
    await advance(0)
    // 兔子没壳可缩，用它自己那条「收一下」的形
    expect(moveClass()).toBe('mv-fold')
    expect(cssVar('--mv-dur')).toBe(`${HUD_MOVE_MS.fold}ms`)
    await advance(HUD_MOVE_MS.fold)
    expect(moveClass()).toBe('')
    // 原本 3 秒那档已被撤走：跨过它也不会插进第二场
    await advance(1500)
    expect(moveClass()).toBe('')
    await advance(HUD_SCENE_GAPS_MS[0] - 1500)
    expect(moveClass()).toBe('mv-bow')
    // 告警不占池子名额：同一状态再推一次也不重放
    push({ state: low, reveal: false })
    await advance(0)
    expect(moveClass()).toBe('mv-bow')
  })

  it('窗还没亮就不放告警：首帧快照只对齐状态', async () => {
    wrapper = await mountApp()
    push({ state: { ...state, severe: true, primary: { label: '5h', percentage: 4 } }, reveal: false })
    await advance(0)
    expect(moveClass()).toBe('')
  })

  it('换皮肤就换一手，并从新池子第一手重新开始', async () => {
    wrapper = await mountRevealed()
    await advance(HUD_FIRST_SCENE_MS)
    expect(moveClass()).toBe('mv-bow')
    await advance(HUD_MOVE_MS.bow)
    push({ state: { ...state, skin: 'penguin' }, reveal: false })
    await advance(HUD_FIRST_SCENE_MS)
    expect(moveClass()).toBe('mv-waddle')
  })

  it('重新亮相把计数归零：第一手还是池子第一手', async () => {
    wrapper = await mountRevealed()
    await toSceneStart(1)
    expect(moveClass()).toBe('mv-hop')
    push({ state, reveal: true })
    await drainToReveal(2)
    expect(moveClass()).toBe('')
    await advance(HUD_FIRST_SCENE_MS - 1)
    expect(moveClass()).toBe('')
    await advance(1)
    expect(moveClass()).toBe('mv-bow')
  })

  it('设置关掉小动作后不排场景，点角色仍会演一手', async () => {
    wrapper = await mountRevealed()
    push({ state, reveal: false, ambient: false })
    await advance(120000)
    expect(moveClass()).toBe('')
    await clickCharacter(wrapper)
    expect(moveClass()).toBe('mv-bow')
  })

  it('窗口隐藏期间不空转计时器，恢复可见才接着排', async () => {
    wrapper = await mountRevealed()
    setVisibility('hidden')
    await advance(120000)
    expect(moveClass()).toBe('')
    setVisibility('visible')
    await advance(HUD_FIRST_SCENE_MS)
    expect(moveClass()).toBe('mv-bow')
  })
})

describe('挂件减少动效', () => {
  it('系统要求减少动效时不排场景也不演动作，悬停仍能展开', async () => {
    reduce.on = true
    wrapper = await mountRevealed()
    await advance(120000)
    expect(moveClass()).toBe('')
    expect(setPosition).not.toHaveBeenCalled()
    enterCharacter(wrapper)
    await advance(160)
    expect(wrapper.find('.tag').exists()).toBe(true)
  })

  it('运行中开启减少动效会掐掉当前动作，关闭后按整档重排', async () => {
    wrapper = await mountRevealed()
    await advance(HUD_FIRST_SCENE_MS)
    expect(moveClass()).toBe('mv-bow')
    setReducedMotion(true)
    await advance(0)
    expect(moveClass()).toBe('')
    await advance(120000)
    expect(moveClass()).toBe('')
    setReducedMotion(false)
    await advance(HUD_FIRST_SCENE_MS - 1)
    expect(moveClass()).toBe('')
    await advance(1)
    // 掐掉的那一场已经计过数：下一场是池子第二手
    expect(moveClass()).toBe('mv-hop')
  })

  it('减少动效时点角色也不演', async () => {
    reduce.on = true
    wrapper = await mountRevealed()
    await clickCharacter(wrapper)
    expect(moveClass()).toBe('')
    expect(wrapper.find('.pin-mark').exists()).toBe(false)
  })

  it('卸载时撤销偏好监听', async () => {
    wrapper = await mountRevealed()
    wrapper.unmount()
    wrapper = undefined
    expect(reduce.handlers.size).toBe(0)
  })
})
