import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { MODULES, modulePath } from '../modules/registry'
import { landingPath, isModuleEnabled } from '../modules/state'

/** 零模块态的落脚点：它自己不是模块，没有开关 */
export const EMPTY_PATH = '/start'

const toEmpty = () => landingPath() ?? EMPTY_PATH

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: toEmpty },
    {
      path: EMPTY_PATH,
      name: 'start',
      meta: { title: '首页' },
      component: () => import('../views/ModulesEmptyView.vue'),
    },
    // 关掉模块即撤表，直敲 URL 也进不去；这条兜底把它领回落地页
    { path: '/:pathMatch(.*)*', redirect: toEmpty },
  ],
})

/** 路由表跟着开关走：没启用的模块不注册，它的 chunk 也就不会被下载 */
export function syncModuleRoutes(): void {
  for (const m of MODULES) {
    const on = isModuleEnabled(m.id)
    if (on && !router.hasRoute(m.id)) {
      const route: RouteRecordRaw = {
        path: modulePath(m.id),
        name: m.id,
        meta: { title: m.title },
        component: m.view,
      }
      router.addRoute(route)
    } else if (!on && router.hasRoute(m.id)) {
      router.removeRoute(m.id)
    }
  }
}

export default router
