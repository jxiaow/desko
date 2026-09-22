import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { backupApi, type BackupStatus } from '../services/api/backup'

/** 标题栏备份徽标：进度与结果靠事件推送，轮询只兜「事件间隙」的状态 */
const POLL_MS = 30_000

export const useBackupBadgeStore = defineStore('backupBadge', () => {
  const status = ref<BackupStatus | null>(null)
  /** 非 null = 正有一轮在跑 */
  const syncing = ref<{ text: string; pct: number } | null>(null)
  /** 最近一次上云失败的人话原因 */
  const note = ref<string | null>(null)
  let unlistens: UnlistenFn[] = []
  let timer: ReturnType<typeof setInterval> | null = null

  const visible = computed(() => {
    const s = status.value
    return !!s && s.hasPassword && s.cloudConfigured
  })
  const pending = computed(() => status.value?.pending ?? 0)

  async function refresh() {
    try {
      const s = await backupApi.status()
      status.value = s
      // 闸门已释放：不管进度事件停在第几步，这轮都算结束了
      if (!s.busy) syncing.value = null
    } catch { /* 锁屏瞬间拿不到状态，等下一次轮询 */ }
  }

  async function start() {
    await refresh()
    if (timer) return
    timer = setInterval(() => void refresh(), POLL_MS)
    unlistens.push(
      await backupApi.onProgress((p) => {
        if (p.op === 'pack' || (p.op === 'upload' && p.pct < 100)) {
          syncing.value = { text: p.text, pct: p.pct }
          note.value = null
        } else if (p.op === 'upload') {
          syncing.value = null
          note.value = null
          void refresh()
        }
      }),
      await backupApi.onSyncNote((msg) => {
        syncing.value = null
        note.value = msg
        void refresh()
      }),
      // 定时轮打包完的时机：状态里 pending 变了，顺手拉一次
      await backupApi.onAutoRound(() => void refresh()),
    )
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    unlistens.forEach((u) => u())
    unlistens = []
  }

  return { status, syncing, note, visible, pending, refresh, start, stop }
})
