import router, { EMPTY_PATH, syncModuleRoutes } from '../router'
import { MODULES, modulePath, type ModuleId } from './registry'
import { landingPath, loadModuleFlags, moduleFlags, setModuleEnabled, WEB_EXTRA_MODULES } from './state'
import { listen } from '../services/events'
import { isWebRuntime } from '../services/runtime'

let stopSync: (() => void) | null = null
let syncGeneration = 0
export function stopModuleSync(): void { syncGeneration++; stopSync?.(); stopSync = null }
export async function startModuleSync(): Promise<void> {
  if (stopSync) return
  const generation = ++syncGeneration
  const stop = await listen<{ id: ModuleId; enabled: boolean }>('desko:module-changed', async ({ payload }) => {
    if (!MODULES.some(module => module.id === payload.id) || typeof payload.enabled !== 'boolean') return
    if (isWebRuntime() && !WEB_EXTRA_MODULES.some(id => id === payload.id)) return
    moduleFlags[payload.id] = payload.enabled
    syncModuleRoutes()
    if (!payload.enabled && router.currentRoute.value.path === modulePath(payload.id)) await router.replace(landingPath() ?? EMPTY_PATH)
  })
  if (generation === syncGeneration) stopSync = stop
  else stop()
}

/** 挂载前跑一次：开关和路由表必须同源，否则首帧会出现侧栏没有、URL 却进得去的页面 */
export async function installModules(): Promise<void> {
  await loadModuleFlags()
  syncModuleRoutes()
  if (!isWebRuntime()) await startModuleSync()
}

/** 开关的唯一入口：落库 → 撤/补路由 → 正停在这个页面上就带回落地页 */
export async function toggleModule(id: ModuleId, on: boolean): Promise<void> {
  await setModuleEnabled(id, on)
  syncModuleRoutes()
  if (!on && router.currentRoute.value.path === modulePath(id)) {
    await router.replace(landingPath() ?? EMPTY_PATH)
  }
}
