import router, { EMPTY_PATH, syncModuleRoutes } from '../router'
import { modulePath, type ModuleId } from './registry'
import { landingPath, loadModuleFlags, setModuleEnabled } from './state'

/** 挂载前跑一次：开关和路由表必须同源，否则首帧会出现侧栏没有、URL 却进得去的页面 */
export async function installModules(): Promise<void> {
  await loadModuleFlags()
  syncModuleRoutes()
}

/** 开关的唯一入口：落库 → 撤/补路由 → 正停在这个页面上就带回落地页 */
export async function toggleModule(id: ModuleId, on: boolean): Promise<void> {
  await setModuleEnabled(id, on)
  syncModuleRoutes()
  if (!on && router.currentRoute.value.path === modulePath(id)) {
    await router.replace(landingPath() ?? EMPTY_PATH)
  }
}
