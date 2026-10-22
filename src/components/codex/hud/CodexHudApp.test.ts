import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { emitTo, listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import CodexHudApp from './CodexHudApp.vue'
import type { CodexHudEventPayload, CodexHudState } from '../../../utils/codexHud'

const { onMoved, startDragging, setPosition, outerPosition, scaleFactor, invokeMock, movedHandler } =
  vi.hoisted(() => ({
    onMoved: vi.fn(),
    startDragging: vi.fn(),
    setPosition: vi.fn(),
    outerPosition: vi.fn(),
    scaleFactor: vi.fn(),
    invokeMock: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
    movedHandler: { current: undefined as ((arg: { payload: { x: number; y: number } }) => void) | undefined },
  }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(), emitTo: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onMoved, startDragging, setPosition, outerPosition, scaleFactor }),
}))

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

const off = vi.fn()
let wrapper: VueWrapper | undefined

function expandedCalls(): boolean[] {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === 'desko_hud_set_expanded')
    .map(([, args]) => args?.expanded as boolean)
}

function push(payload: CodexHudEventPayload): void {
  const handler = vi.mocked(listen).mock.calls[0][1] as (event: { payload: CodexHudEventPayload }) => void
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

async function mountApp(): Promise<VueWrapper> {
  const next = mount(CodexHudApp)
  await flushPromises()
  push({ state, reveal: false })
  await flushPromises()
  return next
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  invokeMock.mockResolvedValue(undefined)
  startDragging.mockResolvedValue(undefined)
  setPosition.mockResolvedValue(undefined)
  outerPosition.mockResolvedValue({ x: 1000, y: 700 })
  scaleFactor.mockResolvedValue(1)
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
  vi.useRealTimers()
})

describe('挂件展开手势', () => {
  it('鼠标停在角色上 160ms 才展开，掠过不弹', async () => {
    wrapper = await mountApp()
    enterCharacter(wrapper)
    vi.advanceTimersByTime(100)
    expect(expandedCalls()).toEqual([])
    leaveWindow(wrapper)
    vi.advanceTimersByTime(500)
    expect(expandedCalls()).toEqual([])
    expect(wrapper.find('.tag').exists()).toBe(false)
  })

  it('停留到位即展开，移开鼠标收起', async () => {
    wrapper = await mountApp()
    enterCharacter(wrapper)
    vi.advanceTimersByTime(160)
    await flushPromises()
    expect(expandedCalls()).toEqual([true])
    expect(wrapper.find('.tag').exists()).toBe(true)
    leaveWindow(wrapper)
    await flushPromises()
    expect(expandedCalls()).toEqual([true, false])
    expect(wrapper.find('.tag').exists()).toBe(false)
  })

  it('点角色钉住后移开不收起，再点取消并收起', async () => {
    wrapper = await mountApp()
    enterCharacter(wrapper)
    vi.advanceTimersByTime(160)
    press(wrapper, '.sprite')
    release(wrapper, '.sprite')
    expect(expandedCalls()).toEqual([true])
    leaveWindow(wrapper)
    expect(expandedCalls()).toEqual([true])
    press(wrapper, '.sprite')
    release(wrapper, '.sprite')
    expect(expandedCalls()).toEqual([true, false])
    expect(wrapper.attributes('aria-label')).toContain('悬停或点击角色展开')
  })

  it('点面板打开 Codex 并收起、解钉', async () => {
    wrapper = await mountApp()
    enterCharacter(wrapper)
    vi.advanceTimersByTime(160)
    await flushPromises()
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
    vi.advanceTimersByTime(160)
    expect(expandedCalls()).toEqual([])
    vi.advanceTimersByTime(200)
    expect(expandedCalls()).toEqual([true])
  })
})

function savedPositions(): unknown[] {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === 'desko_hud_save_position')
    .map(([, args]) => ({ x: args?.x, y: args?.y }))
}

/** 兔子那一档：跨步 340ms 缓出 + 落地停 210ms，一步 6px。 */
const GLIDE_MS = 340
const HOLD_MS = 210
const STRIDE_PX = 6

function walkTransform(): string {
  return String(wrapper?.get('.walk').attributes('style') ?? '')
}

function lanePx(): number {
  return Number(/translate3d\(([-\d.]+)px/.exec(walkTransform())?.[1] ?? NaN)
}

function faceX(): string {
  return String(/scaleX\(([-\d.]+)\)/.exec(walkTransform())?.[1] ?? '')
}

function movedXs(): number[] {
  return setPosition.mock.calls.map(([pos]) => (pos as { x: number }).x)
}

describe('挂件绕锚点走动', () => {
  it('滑到位那一帧才跟位：窗口挪的量正好等于角色已经滑出的量', async () => {
    wrapper = await mountApp()
    vi.advanceTimersByTime(GLIDE_MS + HOLD_MS)
    await flushPromises()
    expect(lanePx()).toBe(STRIDE_PX)
    expect(setPosition).not.toHaveBeenCalled()
    const screenBefore = 1000 + lanePx()
    vi.advanceTimersByTime(GLIDE_MS)
    await flushPromises()
    expect(setPosition).toHaveBeenCalledTimes(1)
    expect(setPosition.mock.calls[0][0]).toEqual(expect.objectContaining({ x: 1006, y: 700 }))
    expect(lanePx()).toBe(0)
    // 屏幕位置连续：窗口接手了角色已经走完的那 6px
    expect(1006 + lanePx()).toBe(screenBefore)
    expect(savedPositions()).toEqual([])
  })

  it('每四步插一拍张望，那一拍不跟位', async () => {
    wrapper = await mountApp()
    vi.advanceTimersByTime(GLIDE_MS + HOLD_MS)
    const moves: number[] = []
    const looks: boolean[] = []
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(GLIDE_MS)
      await flushPromises()
      moves.push(setPosition.mock.calls.length)
      vi.advanceTimersByTime(HOLD_MS)
      await flushPromises()
      looks.push(wrapper.get('.sprite').classes().includes('look'))
    }
    expect(moves).toEqual([1, 2, 3, 4, 4, 4])
    expect(looks).toEqual([false, false, false, true, true, false])
  })

  it('走到系绳尽头挤压掉头，锚点仍是放它的那一点', async () => {
    wrapper = await mountApp()
    const faces = new Set<string>()
    for (let i = 0; i < 90; i++) {
      vi.advanceTimersByTime(120)
      await flushPromises()
      faces.add(faceX())
    }
    const xs = movedXs()
    expect(Math.max(...xs)).toBeLessThanOrEqual(1048)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(952)
    expect(xs).toContain(1048)
    expect(faces.has('0.84')).toBe(true)
    expect(faces.has('-1')).toBe(true)
    expect(savedPositions()).toEqual([])
  })

  it('钉住后停在原地', async () => {
    wrapper = await mountApp()
    enterCharacter(wrapper)
    vi.advanceTimersByTime(160)
    await flushPromises()
    press(wrapper, '.sprite')
    release(wrapper, '.sprite')
    leaveWindow(wrapper)
    vi.advanceTimersByTime(20000)
    await flushPromises()
    expect(setPosition).not.toHaveBeenCalled()
  })

  it('刚碰过它的 1.5s 冷却期内不走，冷却过了才继续', async () => {
    wrapper = await mountApp()
    enterCharacter(wrapper)
    leaveWindow(wrapper)
    vi.advanceTimersByTime(1500)
    await flushPromises()
    expect(setPosition).not.toHaveBeenCalled()
    vi.advanceTimersByTime(600)
    await flushPromises()
    expect(setPosition).toHaveBeenCalledTimes(1)
  })

  it('指针一落到角色上，滑出去的那半拍收回来', async () => {
    wrapper = await mountApp()
    vi.advanceTimersByTime(GLIDE_MS + HOLD_MS + 120)
    await flushPromises()
    expect(lanePx()).toBe(STRIDE_PX)
    enterCharacter(wrapper)
    await flushPromises()
    expect(lanePx()).toBe(0)
    expect(setPosition).not.toHaveBeenCalled()
  })

  it('巡游自己触发的 Moved 既不当拖动也不改锚点', async () => {
    wrapper = await mountApp()
    vi.advanceTimersByTime(GLIDE_MS + HOLD_MS + GLIDE_MS)
    await flushPromises()
    expect(setPosition).toHaveBeenCalledTimes(1)
    movedHandler.current?.({ payload: { x: 1006, y: 700 } })
    vi.advanceTimersByTime(GLIDE_MS + HOLD_MS)
    await flushPromises()
    expect(savedPositions()).toEqual([])
    // 锚点没被自己的 Moved 挪走：第二跟位仍是 1000 + 6 + 6
    expect(setPosition.mock.calls[1][0]).toEqual(expect.objectContaining({ x: 1012, y: 700 }))
  })

  it('用户真拖动改的是锚点，之后的走动绕新锚点', async () => {
    wrapper = await mountApp()
    vi.advanceTimersByTime(1400)
    await flushPromises()
    expect(setPosition).toHaveBeenCalledTimes(1)
    enterCharacter(wrapper)
    press(wrapper, '.sprite')
    wrapper.get('.hud').element.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 60, clientY: 60, button: 0 }),
    )
    movedHandler.current?.({ payload: { x: 900, y: 660 } })
    leaveWindow(wrapper)
    vi.advanceTimersByTime(4000)
    await flushPromises()
    expect(setPosition).toHaveBeenLastCalledWith(expect.objectContaining({ x: 906, y: 660 }))
    expect(savedPositions()).toEqual([]) // 未 reveal 的窗口不落盘：这条闸门是既有行为
  })

  it('设置关掉走动后停在原地', async () => {
    wrapper = await mountApp()
    push({ state, reveal: false, walk: false })
    await flushPromises()
    vi.advanceTimersByTime(20000)
    await flushPromises()
    expect(setPosition).not.toHaveBeenCalled()
  })

  it('走到半路被关掉，会送回放置的那一点且仍不落盘', async () => {
    wrapper = await mountApp()
    vi.advanceTimersByTime(1400)
    await flushPromises()
    expect(setPosition).toHaveBeenLastCalledWith(expect.objectContaining({ x: 1006, y: 700 }))
    push({ state, reveal: false, walk: false })
    await flushPromises()
    expect(setPosition).toHaveBeenLastCalledWith(expect.objectContaining({ x: 1000, y: 700 }))
    vi.advanceTimersByTime(20000)
    await flushPromises()
    expect(setPosition).toHaveBeenCalledTimes(2)
    expect(savedPositions()).toEqual([])
  })
})
