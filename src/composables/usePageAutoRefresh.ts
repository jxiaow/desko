import { onMounted, onUnmounted } from 'vue'

/** 只在当前可见页面轮询，切回窗口时补取；重请求由调用方的忙碌状态拦住。 */
export function usePageAutoRefresh(refresh: () => Promise<void>, busy: () => boolean): void {
  let timer: ReturnType<typeof setInterval>
  const update = () => {
    if (document.visibilityState === 'hidden' || busy()) return
    void refresh()
  }
  onMounted(() => {
    timer = setInterval(update, 30_000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
  })
  onUnmounted(() => {
    clearInterval(timer)
    window.removeEventListener('focus', update)
    document.removeEventListener('visibilitychange', update)
  })
}
