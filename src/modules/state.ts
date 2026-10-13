import { computed, reactive } from 'vue'
import { settingsApi } from '../services/api/settings'
import { MODULES, moduleById, type ModuleDef, type ModuleId } from './registry'

/** 各模块总开关的当前值。默认按注册表缺省播种，首帧即是终态候选，不靠异步填。 */
export const moduleFlags = reactive<Record<ModuleId, boolean>>(
  Object.fromEntries(MODULES.map((m) => [m.id, m.defaultEnabled])) as Record<ModuleId, boolean>
)

let loaded = false

/** 默认开的模块读 `!== 'false'`：老库里没有这个键，按 `=== 'true'` 判会把主页面整个变没 */
function parseFlag(raw: string, m: ModuleDef): boolean {
  return m.defaultEnabled ? raw !== 'false' : raw === 'true'
}

/** bootstrap 阶段跑一次：路由、侧栏、设置页都必须在挂载前就看到终态开关 */
export async function loadModuleFlags(): Promise<void> {
  if (loaded) return
  await Promise.all(
    MODULES.map(async (m) => {
      try {
        moduleFlags[m.id] = parseFlag(await settingsApi.getSetting(m.settingKey), m)
      } catch {
        /* 读不到就按注册表缺省 */
      }
    })
  )
  loaded = true
}

export function isModuleEnabled(id: ModuleId): boolean {
  return moduleFlags[id]
}

export const enabledModules = computed(() => MODULES.filter((m) => moduleFlags[m.id]))

/** 落地页：启用模块里排最前的那个；全关时没有页面可去，交给空态壳 */
export function landingPath(): string | null {
  const first = enabledModules.value[0]
  return first ? '/' + first.id : null
}

export async function setModuleEnabled(id: ModuleId, on: boolean): Promise<void> {
  const m = moduleById(id)
  const prev = moduleFlags[id]
  moduleFlags[id] = on
  loaded = true
  try {
    await settingsApi.setSetting(m.settingKey, on.toString())
  } catch (e) {
    // 写设置失败：扳回开关，别让侧栏出现一个没落库的入口
    moduleFlags[id] = prev
    throw e
  }
  if (!on && m.onDisable) {
    try {
      await m.onDisable()
    } catch {
      /* 停不掉由作业对象/端口超时兜底，不打断关开关这个动作 */
    }
  }
}

/** 解锁后只给启用的模块补它那份数据；关掉的模块连一次 invoke 都不该发 */
export async function bootEnabledModules(): Promise<void> {
  await Promise.all(enabledModules.value.map((m) => m.boot?.()))
}

/** 关闭过的模块也可能有待保存内容和敏感缓存，锁定时一并处理。 */
export async function flushModulesBeforeLock(): Promise<void> {
  await Promise.all(MODULES.map(m => m.beforeLock?.()))
}

/** 锁定：各模块收回会话态，不受当前开关影响。 */
export function lockEnabledModules(): void {
  for (const m of MODULES) m.onLock?.()
}
