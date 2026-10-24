import { inject, type ComputedRef, type InjectionKey } from 'vue'

export const workspaceLayoutKey: InjectionKey<boolean> = Symbol('workspaceLayout')
export const workspaceDirectoryTarget = '#workspace-directory-content'
/** 页栏声明 data-workspace-heading="inline" 让页名按内容宽度排列，
 *  "replace" 隐藏骨架页名；data-workspace-toolbar="exclusive" 独占整个页栏。 */
export const workspaceToolbarTarget = '#workspace-page-toolbar'
export const workspaceSurfaceTarget = '#workspace-surface'
export const workspaceDirectoryKey: InjectionKey<{ visible: ComputedRef<boolean>; toggle: () => void }> = Symbol('workspaceDirectory')
export const workspaceDirectoryMediaQuery = '(min-width: 1100px)'
export const hasWorkspaceDirectory = (moduleId: string) => ['notes', 'entries', 'codex'].includes(moduleId)
export const useWorkspaceLayout = () => inject(workspaceLayoutKey, false)
