import { invoke } from '../transport'

export interface CloudStatus {
  configured: boolean
  server: string
  account: string
  keepRemote: number
  lastSyncAt: number
  syncedPackages: number
  syncedAttachments: number
}

export interface RemotePackage {
  name: string
  size: number
}

export const cloudApi = {
  status: () => invoke<CloudStatus>('cloud_status'),
  testConfig: (server: string, account: string, appPassword: string) =>
    invoke<void>('cloud_test_config', { server, account, appPassword }),
  saveConfig: (server: string, account: string, appPassword: string) =>
    invoke<void>('cloud_save_config', { server, account, appPassword }),
  disconnect: () => invoke<void>('cloud_disconnect'),
  list: () => invoke<RemotePackage[]>('cloud_list'),
  restore: (name: string, password: string) => invoke<void>('cloud_restore', { name, password }),
}
