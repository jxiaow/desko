import { invoke } from '../transport'

/** 与后端 ProfileDto 同档（camelCase） */
export interface Profile {
  id: string
  name: string
  /** 建档后不可改的云命名空间 */
  cloudNs: string
  /** 实际云目录基名：默认档 desko，其余 desko-<ns> */
  cloudBase: string
  isActive: boolean
  createdAt: number
  lastUsedAt: number
}

export interface ProfileList {
  activeId: string
  profiles: Profile[]
}

export const profilesApi = {
  list: (): Promise<ProfileList> => invoke('profiles_list'),
  active: (): Promise<Profile | null> => invoke('profiles_active'),
  /** cloudNs 留空 → 后端按 id 自动生成 */
  create: (name: string, cloudNs?: string): Promise<Profile> =>
    invoke('profiles_create', { name, cloudNs: cloudNs || null }),
  rename: (id: string, name: string): Promise<void> => invoke('profiles_rename', { id, name }),
  delete: (id: string): Promise<void> => invoke('profiles_delete', { id }),
  /** 写 active 后重启进程换根，调用即分叉不再返回 */
  switchTo: (id: string): Promise<void> => invoke('profiles_switch', { id }),
}
