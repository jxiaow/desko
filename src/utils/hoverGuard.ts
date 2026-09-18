/**
 * 窗口隐藏/最小化时 WebView 收不到 mouseleave，:hover 与 tooltip 会残留到下次打开。
 * 抑制期间盖一层透明遮罩，把 hover 全部截留在遮罩上；鼠标真正移动后解除。
 * 注意两种假移动：① 抑制后窗口尚未隐藏时的原地微动竞态；
 * ② 窗口恢复时 WebView2 会在旧坐标重放一次 pointermove。
 * 因此只有坐标不同于冻结点（= 抑制前最后指针位置）的移动才允许解除。
 */
import { hideGlobalTip } from './tooltip'

let blocker: HTMLElement | null = null
let lastX = -1
let lastY = -1
let frozenX = -1
let frozenY = -1

export function suppressHover() {
  if (blocker) return
  document.documentElement.classList.add('hover-suppressed')
  blocker = document.createElement('div')
  blocker.className = 'hover-blocker'
  document.body.appendChild(blocker)
  frozenX = lastX
  frozenY = lastY
  hideGlobalTip()
}

export function releaseHover() {
  document.documentElement.classList.remove('hover-suppressed')
  blocker?.remove()
  blocker = null
}

export function installHoverGuard() {
  window.addEventListener('blur', suppressHover)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) suppressHover()
  })
  document.addEventListener('pointermove', (e) => {
    if (blocker && e.clientX === frozenX && e.clientY === frozenY) return
    lastX = e.clientX
    lastY = e.clientY
    if (blocker) releaseHover()
  }, { passive: true })
}
