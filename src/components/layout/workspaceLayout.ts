import { inject, type ComputedRef, type InjectionKey } from 'vue'

export const workspaceLayoutKey: InjectionKey<boolean> = Symbol('workspaceLayout')
export const workspaceDirectoryTarget = '#workspace-directory-content'
/** 页级动作带：搜索、筛选、新建这一排控件 teleport 到这里，落在内容区页头。
 *  件数多的模块（Codex）在同一条带子里排第二排，不在正文上方另起一条页栏。 */
export const workspaceToolbarTarget = '#workspace-page-toolbar'
/** 小记全屏操作仍放在窗口标题栏。 */
export const workspaceFsTarget = '#workspace-fs-slot'
export const workspaceSurfaceTarget = '#workspace-surface'
export const workspaceDirectoryKey: InjectionKey<{ visible: ComputedRef<boolean>; toggle: () => void }> = Symbol('workspaceDirectory')
export const workspaceDirectoryMediaQuery = '(min-width: 1100px)'
export const hasWorkspaceDirectory = (moduleId: string) => ['notes', 'entries'].includes(moduleId)
export const useWorkspaceLayout = () => inject(workspaceLayoutKey, false)
