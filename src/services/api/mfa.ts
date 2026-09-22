import { invoke } from '@tauri-apps/api/core'

export interface MfaTokenInfo {
  id: string
  issuer: string
  label: string
  algorithm: string
  digits: number
  period: number
  createdAt: number
}

export interface MfaCode {
  id: string
  issuer: string
  label: string
  code: string
  digits: number
  period: number
  remaining: number
}

export const mfaApi = {
  addUri: (uri: string): Promise<MfaTokenInfo> =>
    invoke('mfa_add_uri', { uri }),
  addManual: (label: string, secret: string, issuer?: string): Promise<MfaTokenInfo> =>
    invoke('mfa_add_manual', { label, secret, issuer: issuer ?? null }),
  codes: (): Promise<MfaCode[]> =>
    invoke('mfa_codes'),
  remove: (id: string): Promise<void> =>
    invoke('mfa_remove', { id }),
  /** 二维码截图交前端 jsQR 解码，后端只负责把文件读成 base64 */
  readImage: (path: string): Promise<string> =>
    invoke('mfa_read_image', { path }),
}
