import { onUnmounted, watch } from 'vue'
import { usePageActive } from './usePageActive'

type EscapeEntry = { when: () => boolean; close: () => void; afterTarget: boolean }

/** 可见弹窗的注册表，后开的排在后面。 */
const stack: EscapeEntry[] = []

const onKeydown = (e: KeyboardEvent, afterTarget: boolean) => {
  if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return
  for (let i = stack.length - 1; i >= 0; i--) {
    if (!stack[i].when()) continue
    // 编辑器先处理自己的菜单；底下的目录与页面不能接走同一次 Escape。
    if (stack[i].afterTarget !== afterTarget) return
    e.stopPropagation()
    stack[i].close()
    return
  }
}
const onCapture = (e: KeyboardEvent) => onKeydown(e, false)
const onBubble = (e: KeyboardEvent) => onKeydown(e, true)

const syncListener = () => {
  if (stack.length) {
    window.addEventListener('keydown', onCapture, true)
    window.addEventListener('keydown', onBubble)
  } else {
    window.removeEventListener('keydown', onCapture, true)
    window.removeEventListener('keydown', onBubble)
  }
}

/**
 * Esc 关闭弹窗。只关最上面那层——弹窗叠着时（详情 + 删除确认）一次按键不该关掉两个。
 *
 * @param close 关闭动作
 * @param when 是否可见；组件本身随弹窗挂载时用默认的 () => true，
 *             常驻组件（确认框、页面内弹窗）要传进来，否则注册顺序会按挂载算而不是按打开算
 * @param options afterTarget 让编辑器优先关闭命令菜单，未消费的 Escape 才关闭外层
 */
export function useEscapeClose(close: () => void, when: () => boolean = () => true, options: { afterTarget?: boolean } = {}): void {
  const pageActive = usePageActive()
  const visible = () => pageActive.value && when()
  const entry: EscapeEntry = { when: visible, close, afterTarget: options.afterTarget === true }
  let open = visible()
  if (open) {
    stack.push(entry)
    syncListener()
  }

  // sync：可见性一变就立刻登记/注销，不等下一帧，否则同一次按键可能赶上注册空档
  const stop = watch(visible, (v) => {
    if (v === open) return
    open = v
    if (v) stack.push(entry)
    else {
      const i = stack.indexOf(entry)
      if (i >= 0) stack.splice(i, 1)
    }
    syncListener()
  }, { flush: 'sync' })

  onUnmounted(() => {
    stop()
    if (!open) return
    const i = stack.indexOf(entry)
    if (i >= 0) stack.splice(i, 1)
    syncListener()
  })
}
