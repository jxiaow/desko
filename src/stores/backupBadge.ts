import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { backupApi, errText, type BackupStatus } from '../services/api/backup'
import { useToastStore } from './toast'

/** 标题栏备份徽标：进度与结果靠事件推送，轮询只兜「事件间隙」的状态 */
const POLL_MS = 30_000
/** 末条进度事件到闸门释放之间的那口气（真实后端里这两步只差几毫秒，留 1.5s 富余） */
const SETTLE_GRACE = 1_500

export const useBackupBadgeStore = defineStore('backupBadge', () => {
  const toast = useToastStore()
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

  /** 进度事件说这轮收尾了。闸门在那一瞬间还没释放（末条事件是 sync_and_settle 末尾推的，
      BusyGuard 要等命令返回才落），所以这几秒内不许拿 busy 把图标又点亮成「在跑」 */
  let settledAt = 0

  async function refresh() {
    try {
      const s = await backupApi.status()
      status.value = s
      // 闸门是这颗钮唯一的真相：进度事件可能整段错过（徽标刚挂载、窗口藏在托盘里、
      // 单个大附件传几分钟中间不推事件），漏了也得转——点下去撞的是同一道闸
      if (s.busy) {
        if (!syncing.value && Date.now() - settledAt > SETTLE_GRACE) {
          syncing.value = { text: '本轮由后台发起', pct: 0 }
        }
      } else {
        syncing.value = null
      }
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
          settledAt = Date.now()
          void refresh()
        }
      }),
      await backupApi.onSyncNote((msg) => {
        syncing.value = null
        note.value = msg
        settledAt = Date.now()
        void refresh()
      }),
      // 定时轮打包完的时机：状态里 pending 变了，顺手拉一次
      await backupApi.onAutoRound(() => void refresh()),
    )
  }

  /** 标题栏那颗同步钮：手动跑一轮（打包 + 上云）。闸门未开时进度事件会来盖掉这里的起手态 */
  async function syncNow() {
    // 先要一次新状态再判闸门：缓存里的 busy 会过期——末条进度事件比 Rust 那侧释放闸门早到，
    // 而那条事件正好顺手拉了一次状态，于是每一轮跑完都会留下一份 busy:true 的缓存，
    // 拿它当判据就等于这 30 秒里点这颗钮没反应
    await refresh()
    if (syncing.value) {
      toast.showToast('已有一轮备份在跑，等它收尾')
      return
    }
    syncing.value = { text: '准备中', pct: 0 }
    note.value = null
    try {
      const res = await backupApi.run()
      if (res.uploaded) {
        toast.showToast('已传云端')
      } else {
        note.value = res.error ?? '云端没接上'
        toast.showToast(`上传失败：${note.value}`, 'error')
      }
    } catch (e) {
      note.value = errText(e)
      toast.showToast(note.value, 'error')
    } finally {
      syncing.value = null
      await refresh()
    }
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    unlistens.forEach((u) => u())
    unlistens = []
  }

  return { status, syncing, note, visible, pending, refresh, start, stop, syncNow }
})
