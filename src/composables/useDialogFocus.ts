import { nextTick, onBeforeMount, onBeforeUnmount, watch, type Ref } from 'vue'
import { usePageActive } from './usePageActive'

interface DialogFocusOptions {
  /** 常驻组件内用 v-if 开关弹窗时，在渲染前记录触发控件。 */
  when?: () => boolean
  initialFocus?: string
}

/** 弹窗初始移焦、Tab 循环与关闭后归还焦点。 */
export function useDialogFocus(dialog: Ref<HTMLElement | null>, options: DialogFocusOptions = {}) {
  const pageActive = usePageActive()
  const { initialFocus } = options
  let previousFocus: HTMLElement | null = null
  let active = true

  function controls() {
    return Array.from(dialog.value?.querySelectorAll<HTMLElement>(
      'button, input:not([type="hidden"]), textarea, select, a[href], [tabindex], [contenteditable="true"]',
    ) ?? []).filter(element => {
      if (element.tabIndex < 0 || element.matches(':disabled')) return false
      for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        if (node.hidden || node.inert || getComputedStyle(node).display === 'none' || getComputedStyle(node).visibility === 'hidden') return false
        if (node === dialog.value) break
      }
      return true
    })
  }

  function rememberFocus() {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }

  function restoreFocus(element: HTMLElement | null) {
    const target = previousFocus
    previousFocus = null
    if (!target || target === document.body) return
    const focusTrigger = () => {
      const focused = document.activeElement
      if (target.isConnected && (focused === document.body || element?.contains(focused))) {
        target.focus({ preventScroll: true })
      }
    }
    focusTrigger()
    // 子弹窗关闭时，触发按钮可能还在待显示的父弹窗里。
    if (document.activeElement !== target) void nextTick(focusTrigger)
  }

  if (options.when) {
    watch(options.when, open => { if (open) rememberFocus() }, { immediate: true, flush: 'pre' })
  } else {
    onBeforeMount(rememberFocus)
  }

  watch(dialog, async (element, oldElement, onCleanup) => {
    if (!element) {
      restoreFocus(oldElement)
      return
    }
    await nextTick()
    if (!active || !pageActive.value || dialog.value !== element) return
    if (!element.contains(document.activeElement)) {
      const items = controls()
      const initial = initialFocus ? items.find(item => item.matches(initialFocus)) : items[0]
      ;(initial ?? element).focus({ preventScroll: true })
    }
    // 发起/等待/失败会替换或禁用聚焦按钮。
    const observer = new MutationObserver(() => {
      if (!active || !pageActive.value || dialog.value !== element) return
      const focused = document.activeElement
      if (getComputedStyle(element).display === 'none') return
      if (focused === document.body || (element.contains(focused) && focused?.matches(':disabled'))) {
        (controls()[0] ?? element).focus({ preventScroll: true })
      }
    })
    observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] })
    onCleanup(() => observer.disconnect())
  }, { flush: 'post' })
  onBeforeUnmount(() => {
    active = false
    restoreFocus(dialog.value)
  })

  function trapFocus(event: KeyboardEvent) {
    if (event.defaultPrevented || !pageActive.value) return
    const items = controls()
    if (!items.length) { event.preventDefault(); dialog.value?.focus(); return }
    const first = items[0]
    const last = items[items.length - 1]
    const focused = document.activeElement
    if (event.shiftKey && (focused === first || focused === dialog.value || !dialog.value?.contains(focused))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (focused === last || !dialog.value?.contains(focused))) {
      event.preventDefault()
      first.focus()
    }
  }

  return { trapFocus }
}
