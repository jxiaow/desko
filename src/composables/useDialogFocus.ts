import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import { usePageActive } from './usePageActive'

/** 弹窗初始移焦、Tab 循环与关闭后归还焦点。 */
export function useDialogFocus(dialog: Ref<HTMLElement | null>) {
  const pageActive = usePageActive()
  let previousFocus: HTMLElement | null = null
  let active = true
  let observer: MutationObserver | null = null

  function controls() {
    return Array.from(dialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
    ) ?? []).filter(element => {
      for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        if (node.hidden || getComputedStyle(node).display === 'none' || getComputedStyle(node).visibility === 'hidden') return false
        if (node === dialog.value) break
      }
      return true
    })
  }

  onMounted(() => {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  })
  watch(dialog, async element => {
    observer?.disconnect()
    if (!element) return
    await nextTick()
    if (!active || !pageActive.value || dialog.value !== element) return
    ;(controls()[0] ?? element).focus()
    // 发起/等待/失败会替换或禁用聚焦按钮，避免焦点随旧节点移回背景。
    observer = new MutationObserver(() => {
      if (!active || !pageActive.value || dialog.value !== element) return
      const focused = document.activeElement
      if (focused === document.body || (element.contains(focused) && focused?.matches(':disabled'))) {
        (controls()[0] ?? element).focus()
      }
    })
    observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] })
  }, { flush: 'post' })
  onBeforeUnmount(() => {
    active = false
    observer?.disconnect()
    if (previousFocus?.isConnected) previousFocus.focus()
  })

  function trapFocus(event: KeyboardEvent) {
    const items = controls()
    if (!items.length) { event.preventDefault(); dialog.value?.focus(); return }
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && (document.activeElement === first || !dialog.value?.contains(document.activeElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.value?.contains(document.activeElement))) {
      event.preventDefault()
      first.focus()
    }
  }

  return { trapFocus }
}
