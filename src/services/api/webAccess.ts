import { invoke } from '../transport'
export interface WebAccessStatus { running: boolean; lan: boolean; port: number; urls: string[]; pid?: number }
function publish(status: WebAccessStatus) {
  window.dispatchEvent(new CustomEvent('desko:web-access-status', { detail: status }))
  return status
}
export const webAccessApi = {
  status: () => invoke<WebAccessStatus>('web_access_status'),
  start: async (input: { port: number; lan: boolean }) => publish(await invoke<WebAccessStatus>('web_access_start', { input })),
  stop: async () => {
    await invoke<void>('web_access_stop')
    publish({ running: false, lan: false, port: 0, urls: [] })
  },
}
