import { onUnmounted, watch } from 'vue'

type EscapeEntry = { when: () => boolean; close: () => void }

/** 可见弹窗的注册表，后开的排在后面。 */
const stack: EscapeEntry[] = []

const onKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  for (let i = stack.length - 1; i >= 0; i--) {
    if (!stack[i].when()) continue
    // 捕获阶段截住：页面级的小记展开/收起不跟弹窗抢同一次按键
    e.stopPropagation()
    stack[i].close()
    return
  }
}

const syncListener = () => {
  if (stack.length) window.addEventListener('keydown', onKeydown, true)
  else window.removeEventListener('keydown', onKeydown, true)
}

/**
 * Esc 关闭弹窗。只关最上面那层——弹窗叠着时（详情 + 删除确认）一次按键不该关掉两个。
 *
 * @param close 关闭动作
 * @param when 是否可见；组件本身随弹窗挂载时用默认的 () => true，
 *             常驻组件（确认框、页面内弹窗）要传进来，否则注册顺序会按挂载算而不是按打开算
 */
export function useEscapeClose(close: () => void, when: () => boolean = () => true): void {
  const entry: EscapeEntry = { when, close }
  let open = when()
  if (open) {
    stack.push(entry)
    syncListener()
  }

  // sync：可见性一变就立刻登记/注销，不等下一帧，否则同一次按键可能赶上注册空档
  const stop = watch(when, (v) => {
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
