import { invoke } from '../transport'

export const authApi = {
  isInitialized: (): Promise<boolean> => invoke('is_initialized'),
  setupMasterPassword: (password: string): Promise<void> =>
    invoke('setup_master_password', { password }),
  unlock: (password: string): Promise<void> =>
    invoke('unlock', { password }),
  lock: (): Promise<void> => invoke('lock'),
  changeMasterPassword: (oldPassword: string, newPassword: string): Promise<void> =>
    invoke('change_master_password', { oldPassword, newPassword }),
}
