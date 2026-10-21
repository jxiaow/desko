import router, { EMPTY_PATH, syncModuleRoutes } from '../router'
import { MODULES, modulePath, type ModuleId } from './registry'
import { landingPath, loadModuleFlags, moduleFlags, refreshWebModuleFlags, setModuleEnabled, WEB_MODULE_IDS } from './state'
import { listen } from '../services/events'
import { isWebRuntime } from '../services/runtime'
import { getActivePinia } from 'pinia'
import { useAuthStore } from '../stores/auth'

let stopSync: (() => void) | null = null
let syncGeneration = 0
let initialWebPath: string | null = isWebRuntime() ? window.location.pathname : null
let landingHeld = false
export function stopModuleSync(): void { syncGeneration++; stopSync?.(); stopSync = null }

/** 首个模块选择页打开期间，启用模块不得把页面自动带走 */
export function holdModuleLanding(hold: boolean): void { landingHeld = hold }

const shouldAutoLand = (enabled: boolean, currentPath: string) =>
  enabled && currentPath === EMPTY_PATH && !landingHeld
export async function startModuleSync(): Promise<void> {
  if (stopSync) return
  const generation = ++syncGeneration
  const stop = await listen<{ id: ModuleId; enabled: boolean }>('desko:module-changed', async ({ payload }) => {
    if (!MODULES.some(module => module.id === payload.id) || typeof payload.enabled !== 'boolean') return
    if (isWebRuntime() && !WEB_MODULE_IDS.some(id => id === payload.id)) return
    const wasEnabled = moduleFlags[payload.id]
    moduleFlags[payload.id] = payload.enabled
    syncModuleRoutes()
    const currentPath = router.currentRoute.value.path
    if ((!payload.enabled && currentPath === modulePath(payload.id)) || shouldAutoLand(payload.enabled, currentPath)) await router.replace(landingPath() ?? EMPTY_PATH)
    const pinia = getActivePinia()
    if (payload.enabled && !wasEnabled && pinia && useAuthStore(pinia).appState === 'unlocked') await MODULES.find(module => module.id === payload.id)?.boot?.()
  })
  if (generation === syncGeneration) stopSync = stop
  else stop()
}

/** Read shared flags before showing the browser workspace or fetching module data. */
export async function prepareWebModules(): Promise<void> {
  try {
    await startModuleSync()
    await refreshWebModuleFlags()
    syncModuleRoutes()
    const requested = initialWebPath ?? router.currentRoute.value.path
    initialWebPath = null
    const enabled = MODULES.some(module => moduleFlags[module.id] && modulePath(module.id) === requested)
    await router.replace(enabled ? requested : landingPath() ?? EMPTY_PATH)
  } catch (error) {
    stopModuleSync()
    throw error
  }
}

/** 挂载前跑一次：开关和路由表必须同源，否则首帧会出现侧栏没有、URL 却进得去的页面 */
export async function installModules(): Promise<void> {
  await loadModuleFlags()
  syncModuleRoutes()
  if (!isWebRuntime()) await startModuleSync()
}

/** 开关的唯一入口：落库 → 撤/补路由 → 关闭当前模块或启用空首页时重新落地。 */
export async function toggleModule(id: ModuleId, on: boolean): Promise<void> {
  const module = MODULES.find(module => module.id === id)!
  const wasEnabled = moduleFlags[id]
  if (!on) await module.beforeLock?.()
  await setModuleEnabled(id, on)
  syncModuleRoutes()
  const currentPath = router.currentRoute.value.path
  if ((!on && currentPath === modulePath(id)) || shouldAutoLand(on, currentPath)) {
    await router.replace(landingPath() ?? EMPTY_PATH)
  }
  if (on && !wasEnabled) await module.boot?.()
}
