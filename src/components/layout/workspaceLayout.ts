import { inject, type ComputedRef, type InjectionKey } from 'vue'

export const workspaceLayoutKey: InjectionKey<boolean> = Symbol('workspaceLayout')
export const workspaceDirectoryTarget = '#workspace-directory-content'
export const workspaceToolbarTarget = '#workspace-page-toolbar'
export const workspaceSurfaceTarget = '#workspace-surface'
export const workspaceDirectoryKey: InjectionKey<{ visible: ComputedRef<boolean>; toggle: () => void }> = Symbol('workspaceDirectory')
export const workspaceDirectoryMediaQuery = '(min-width: 1100px)'
export const hasWorkspaceDirectory = (moduleId: string) => ['notes', 'entries'].includes(moduleId)
export const useWorkspaceLayout = () => inject(workspaceLayoutKey, false)
