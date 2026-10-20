import { computed, inject, onActivated, onDeactivated, provide, ref, type ComputedRef, type InjectionKey } from 'vue'

const pageActiveKey: InjectionKey<ComputedRef<boolean>> = Symbol('pageActive')

/** 缓存页面只在可见时处理窗口事件、轮询和共享标题。独立挂载时始终可用。 */
export function usePageActive() {
  const parentActive = inject(pageActiveKey, null)
  const locallyActive = ref(true)
  // 缓存页面仍会接收异步更新，新建子组件必须继承父页面的隐藏状态。
  const active = computed(() => locallyActive.value && (parentActive?.value ?? true))
  provide(pageActiveKey, active)
  onActivated(() => { locallyActive.value = true })
  onDeactivated(() => { locallyActive.value = false })
  return active
}
