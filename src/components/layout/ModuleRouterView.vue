<script setup lang="ts">
import { computed, nextTick, onMounted, watch } from 'vue'
import { useRoute, type RouteRecordName } from 'vue-router'
import { enabledModules } from '../../modules/state'

// 视图以模块 id 命名；关闭开关会淘汰对应缓存，锁定时整个路由出口卸载。
const cachedViews = computed(() => enabledModules.value.map(module => module.id))
const route = useRoute()
const scrollPositions = new Map<RouteRecordName, { element: HTMLElement; top: number; left: number }[]>()

// DOM 移入 KeepAlive 的离屏容器会丢失滚动位置，必须在路由视图更新前读取。
watch(() => route.name, (_name, previous) => {
  if (previous != null) {
    const elements = document.querySelectorAll<HTMLElement>(
      '.main-content, .main-content *, #workspace-directory-content, #workspace-directory-content *, #workspace-surface > .fs, #workspace-surface > .fs *',
    )
    scrollPositions.set(previous, Array.from(elements)
      .filter(element => element.scrollTop !== 0 || element.scrollLeft !== 0)
      .map(element => ({ element, top: element.scrollTop, left: element.scrollLeft })))
  }
}, { flush: 'sync' })

// 切页时给内容区重放一次淡入：KeepAlive 的缓存页不会重新挂载，
// 所以在 .main-content 上换类名重启动画，只动透明度、不动几何。
function playPageEnter() {
  const el = document.querySelector<HTMLElement>('.main-content')
  if (!el) return
  el.classList.remove('page-enter')
  void el.offsetWidth
  el.classList.add('page-enter')
}
onMounted(playPageEnter)

watch(() => route.name, async name => {
  await nextTick()
  if (name == null || route.name !== name) return
  playPageEnter()
  document.getElementById('workspace-directory-content')?.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  for (const { element, top, left } of scrollPositions.get(name) ?? []) {
    element.scrollTo({ top, left, behavior: 'instant' })
  }
}, { flush: 'post' })

watch(cachedViews, names => {
  for (const name of scrollPositions.keys()) {
    if (!names.some(id => id === name)) scrollPositions.delete(name)
  }
})
</script>

<template>
  <router-view v-slot="{ Component, route }">
    <KeepAlive :include="cachedViews">
      <component :is="Component" :key="route.name" />
    </KeepAlive>
  </router-view>
</template>
