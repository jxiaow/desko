/**
 * 全局 tooltip：自动接管所有元素上的 title 属性，用应用内的深色气泡代替系统 tooltip。
 * document 级事件委托 + 懒收编（悬停时才摘取 title），新增按钮无需任何指令。
 */
const SHOW_DELAY = 140
const GAP = 6
const EDGE = 8

let node: HTMLDivElement | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let current: HTMLElement | null = null

const tipNode = () => {
  if (!node) {
    node = document.createElement('div')
    node.className = 'app-tip'
    node.setAttribute('role', 'tooltip')
    document.body.appendChild(node)
  }
  return node
}

const hide = () => {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  current = null
  node?.classList.remove('show')
}

export const hideGlobalTip = hide

/** 先按目标定位再显示：反过来会让气泡首帧闪在旧位置 */
const place = (target: HTMLElement, text: string) => {
  const el = tipNode()
  el.textContent = text
  el.classList.add('show')
  const box = target.getBoundingClientRect()
  const tip = el.getBoundingClientRect()
  // 图标轨贴着窗口边缘，居中放只会把每个气泡横躺回轨道、盖住 logo 和相邻图标。
  // 轨内目标一律向右展开，并垂直居中；右侧放不下才翻到左侧。
  if (target.closest('.sidebar')) {
    let left = box.right + GAP
    if (left + tip.width > window.innerWidth - EDGE) left = Math.max(EDGE, box.left - tip.width - GAP)
    const top = Math.min(Math.max(EDGE, box.top + box.height / 2 - tip.height / 2), window.innerHeight - tip.height - EDGE)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    return
  }
  let left = box.left + box.width / 2 - tip.width / 2
  left = Math.min(Math.max(EDGE, left), window.innerWidth - tip.width - EDGE)
  const top = box.top - tip.height - GAP < EDGE ? box.bottom + GAP : box.top - tip.height - GAP
  el.style.left = `${left}px`
  el.style.top = `${top}px`
}

/** 摘走 title 换成 data-tip，系统 tooltip 就此绝迹 */
const adopt = (el: HTMLElement): string => {
  const text = el.getAttribute('title')
  if (text !== null) {
    el.removeAttribute('title')
    if (text) el.dataset.tip = text
    else delete el.dataset.tip
    return text
  }
  return el.dataset.tip || ''
}

const findTarget = (start: EventTarget | null): HTMLElement | null =>
  start instanceof Element ? start.closest<HTMLElement>('[data-tip], [title]') : null

const showFor = (el: HTMLElement) => {
  // 窗口恢复时 WebView 会用缓存的事件目标重放 pointerover，绕过遮罩直达按钮
  if (document.documentElement.classList.contains('hover-suppressed')) return
  const text = adopt(el)
  if (!text) return
  current = el
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    if (current !== el) return
    // 悬停期间 data-tip 可能被状态改写（如目录开合），显示前再取一次
    const latest = adopt(el)
    if (latest) place(el, latest)
  }, SHOW_DELAY)
}

let installed = false

export function setupGlobalTips() {
  if (installed || typeof window === 'undefined') return
  installed = true

  document.addEventListener('pointerover', (e) => {
    const el = findTarget(e.target)
    if (el && el !== current) showFor(el)
    else if (!el) hide()
  })

  document.addEventListener('pointerout', (e) => {
    const from = findTarget(e.target)
    if (from && from === current && !findTarget(e.relatedTarget)) hide()
  })

  document.addEventListener('focusin', (e) => {
    const el = findTarget(e.target)
    if (el) showFor(el)
  })

  document.addEventListener('focusout', hide)
  window.addEventListener('scroll', hide, true)
  document.addEventListener('pointerdown', hide)

  // Vue 在绑定值变化时会把 title 写回来；悬停期间也要保持接管。
  // data-tip 虽不是系统 title，状态改写后同样要同步到已展开的气泡。
  new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target as HTMLElement
      if (el.nodeType !== 1) continue
      if (el.hasAttribute('title')) {
        const text = adopt(el)
        if (el === current && text && node?.classList.contains('show')) place(el, text)
        continue
      }
      if (el !== current || !node?.classList.contains('show')) continue
      const latest = el.dataset.tip || ''
      if (latest) place(el, latest)
      else hide()
    }
  }).observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['title', 'data-tip'],
  })
}
