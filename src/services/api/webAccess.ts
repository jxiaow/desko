import { invoke } from '../transport'
export interface WebAccessStatus { running: boolean; lan: boolean; port: number; urls: string[] }
export const webAccessApi = {
  status: () => invoke<WebAccessStatus>('web_access_status'),
  start: (input: { port: number; lan: boolean; password: string }) => invoke<WebAccessStatus>('web_access_start', { input }),
  stop: () => invoke<void>('web_access_stop'),
}
