import { invoke } from '../transport'
export type WebServiceKind = 'app' | 'codex'
export interface WebAccessStatus { running: boolean; lan: boolean; port: number; urls: string[]; pid?: number }
function publish(status: WebAccessStatus) {
  window.dispatchEvent(new CustomEvent('desko:web-access-status', { detail: status }))
  return status
}
export const webAccessApi = {
  status: (kind: WebServiceKind = 'app') => invoke<WebAccessStatus>('web_access_status', { kind }),
  start: async (input: { port: number; lan: boolean; kind?: WebServiceKind }) => {
    const status = await invoke<WebAccessStatus>('web_access_start', { input })
    return input.kind === 'codex' ? status : publish(status)
  },
  stop: async (kind: WebServiceKind = 'app') => {
    await invoke<void>('web_access_stop', { kind })
    if (kind === 'app') publish({ running: false, lan: false, port: 0, urls: [] })
  },
}
