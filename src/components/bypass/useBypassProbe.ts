import { computed, onUnmounted, ref } from 'vue'
import { bypassApi, type ProbeReport } from '../../services/api/bypass'
import { errText } from '../../services/api/backup'

export type ProbeKind = 'probe' | 'row' | 'edit' | 'revalidate'
export type ProbeJob = {
  requestId: string
  target: string
  kind: ProbeKind
  rowId?: string
  startedAt: number
  cancelling: boolean
  settled: boolean
}

export function useBypassProbe() {
  const active = ref<ProbeJob | null>(null)
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined
  let mounted = true
  const elapsed = computed(() => active.value ? Math.floor((now.value - active.value.startedAt) / 1000) : 0)

  function release(requestId: string) {
    if (active.value?.requestId !== requestId) return
    active.value = null
    clearInterval(timer)
  }

  async function run(kind: ProbeKind, target: string, work: (requestId: string) => Promise<ProbeReport>, rowId?: string) {
    if (active.value) throw new Error('已有探测正在运行')
    const requestId = crypto.randomUUID()
    now.value = Date.now()
    active.value = { requestId, kind, target, rowId, startedAt: now.value, cancelling: false, settled: false }
    timer = setInterval(() => { now.value = Date.now() }, 1000)
    try {
      const report = await work(requestId)
      if (!mounted || active.value?.requestId !== requestId || active.value.cancelling) return
      return report
    } catch (error) {
      if (!mounted || active.value?.requestId !== requestId || active.value.cancelling || errText(error) === '__bypass_probe_cancelled__') return
      throw error
    } finally {
      if (active.value?.requestId === requestId) {
        active.value.settled = true
        if (!active.value.cancelling) release(requestId)
      }
    }
  }

  async function cancel() {
    const job = active.value
    if (!job || job.cancelling) return false
    job.cancelling = true
    try {
      await bypassApi.cancelProbe(job.requestId)
      release(job.requestId)
      return true
    } catch (error) {
      if (active.value?.requestId === job.requestId) {
        active.value.cancelling = false
        if (active.value.settled) release(job.requestId)
      }
      throw error
    }
  }

  onUnmounted(() => {
    mounted = false
    if (active.value) void bypassApi.cancelProbe(active.value.requestId).catch(() => {})
    active.value = null
    clearInterval(timer)
  })

  return { active, elapsed, run, cancel }
}
