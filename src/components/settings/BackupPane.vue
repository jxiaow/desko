<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { backupApi, errText } from '../../services/api/backup'
import type { BackupPackage, BackupRunResult, BackupStatus } from '../../services/api/backup'
import { cloudApi } from '../../services/api/cloud'
import type { CloudStatus, RemotePackage } from '../../services/api/cloud'
import { dataApi } from '../../services/api/data'
import { settingsApi } from '../../services/api/settings'
import { notesApi } from '../../services/api/notes'
import type { OrphanFile } from '../../services/api/notes'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'
import { useEscapeClose } from '../../composables/useEscapeClose'
import { useClipboard } from '../../composables/useClipboard'
import OptionSelect from '../shared/OptionSelect.vue'
import AppIcon from '../shared/AppIcon.vue'

const toastStore = useToastStore()
const confirmStore = useConfirmStore()
const { copyToClipboard } = useClipboard()

const emit = defineEmits<{ restored: [] }>()

const status = ref<BackupStatus | null>(null)
const cloud = ref<CloudStatus>({
  configured: false, server: '', account: '',
  keepRemote: 20, lastSyncAt: 0, syncedPackages: 0, syncedAttachments: 0,
})
const dbPath = ref('')
const busy = ref<{ op: string; text: string; pct: number } | null>(null)
const testing = ref(false)
const orphans = ref<OrphanFile[]>([])

/** 模板沿用原型的数据形状 */
const st = computed(() => ({
  hasPassword: status.value?.hasPassword ?? false,
  intervalMin: status.value?.intervalMin ?? 5,
  realtime: status.value?.realtime ?? false,
  pending: status.value?.pending ?? 0,
  lastRoundAt: status.value?.lastRoundAt ?? 0,
  cloud: cloud.value,
}))

async function refresh() {
  try {
    status.value = await backupApi.status()
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
  try {
    cloud.value = await cloudApi.status()
  } catch { /* 未解锁等场景静默，云端段显示未配置 */ }
  try {
    orphans.value = await notesApi.orphans()
  } catch { orphans.value = [] }
}

let unlistenProgress: (() => void) | null = null
onMounted(async () => {
  await refresh()
  try {
    dbPath.value = await dataApi.getDbPath()
  } catch {
    dbPath.value = '未知'
  }
  const unlisten = await backupApi.onProgress((p) => {
    const b = busy.value
    if (!b) return
    // 一轮备份在后端分 pack/upload 两段播报，本地这一栏都算进 'backup' 的进度
    if (b.op === p.op || (b.op === 'backup' && (p.op === 'pack' || p.op === 'upload'))) {
      busy.value = { op: b.op, text: p.text, pct: p.pct }
    }
  })
  unlistenProgress = unlisten
})
onUnmounted(() => unlistenProgress?.())

const fmtSize = (b: number) =>
  b >= 1_048_576 ? (b / 1_048_576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'

/* ---------- 未引用附件清理 ---------- */
const orphanBytes = computed(() => orphans.value.reduce((s, f) => s + f.size, 0))
const orphanText = computed(() =>
  orphans.value.length
    ? `${orphans.value.length} 个文件 · ${fmtSize(orphanBytes.value)} 不被任何小记引用`
    : '没有未被引用的附件',
)

const doCleanOrphans = () => {
  const list = orphans.value.slice(0, 3).map(f => f.name).join('、')
  const more = orphans.value.length > 3 ? ` 等 ${orphans.value.length} 个` : ''
  confirmStore.showConfirm(
    '清理未引用附件',
    `将永久删除 ${orphans.value.length} 个附件文件（${fmtSize(orphanBytes.value)}）：${list}${more}。它们既不在任何小记正文里，也没有附件登记。正在编辑的草稿图片不会被删。`,
    async () => {
      busy.value = { op: 'clean', text: '清理中…', pct: 60 }
      try {
        const n = await notesApi.cleanupOrphans(orphans.value.map(f => f.name))
        toastStore.showToast(n ? `已清理 ${n} 个未引用附件` : '没有需要清理的文件')
      } catch (e) {
        toastStore.showToast(errText(e), 'error')
      } finally {
        busy.value = null
        await refresh()
      }
    },
  )
}

const fmtTime = (ts: number | null) => {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/+$/, '')

/** 没连上云端之前，备份这一档每个控件都只能摆着看：不是藏起来，是明晃晃地灰着 */
const cloudReady = computed(() => cloud.value.configured)
const schedulable = computed(() => cloudReady.value && st.value.hasPassword)

const connText = computed(() => {
  if (!cloud.value.configured) return '未配置 · 点右侧「配置」连接坚果云'
  const base = `已连接 · ${hostOf(cloud.value.server)}（${cloud.value.account}）`
  return cloud.value.lastSyncAt ? `${base} · 上次上传 ${fmtTime(cloud.value.lastSyncAt)}` : `${base} · 尚未上传`
})

/** 本地那份只是等上传的中转副本，报"最近一轮 + 还欠多少"就够，不必列文件 */
const roundText = computed(() => {
  if (!st.value.lastRoundAt) return '尚无备份'
  const base = `最近一轮：${fmtTime(st.value.lastRoundAt)}`
  return st.value.pending ? `${base} · ${st.value.pending} 份待传` : `${base} · 已全部上传`
})

/** 真实命令的进度走事件，这里只兜住起止；done 给人话 */
async function run(
  op: string,
  task: () => Promise<unknown>,
  done: string | ((res: unknown) => string),
): Promise<unknown> {
  if (busy.value) return
  busy.value = { op, text: '准备中…', pct: 0 }
  let res: unknown
  try {
    res = await task()
    toastStore.showToast(typeof done === 'function' ? done(res) : done)
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    busy.value = null
    await refresh()
  }
  return res
}

/* ---------- 备份密码 ---------- */
const showPwd = ref(false)
const pwd = ref({ pw: '', pw2: '' })
const pwdErr = ref('')
const closePwd = () => { showPwd.value = false; pwd.value = { pw: '', pw2: '' }; pwdErr.value = '' }
useEscapeClose(closePwd, () => showPwd.value)

const submitPwd = async () => {
  pwdErr.value = ''
  if ([...pwd.value.pw].length < 8) { pwdErr.value = '备份密码至少 8 位'; return }
  if (pwd.value.pw !== pwd.value.pw2) { pwdErr.value = '两次输入不一致'; return }
  const had = st.value.hasPassword
  const skipped = await run('pwd', () => backupApi.setPassword(pwd.value.pw), had ? '备份密码已更新' : '备份密码已设置') as string[] | undefined
  if (skipped?.length) {
    toastStore.showToast(`有 ${skipped.length} 个备份文件没能换成新密码，它们仍要用旧密码恢复：${skipped.join('、')}`, 'error')
  }
  closePwd()
}

/* ---------- 备份节奏（都只在连上云端之后才有意义） ---------- */
const INTERVAL_OPTIONS = [
  { value: 0, label: '关闭 · 只留手动' },
  { value: 1, label: '每 1 分钟' },
  { value: 5, label: '每 5 分钟' },
  { value: 15, label: '每 15 分钟' },
  { value: 30, label: '每 30 分钟' },
  { value: 60, label: '每小时' },
]

const doBackup = () => run('backup', () => backupApi.run(), (res) => {
  const r = res as BackupRunResult
  return r.uploaded ? '备份完成，已传云端' : `包已打好，传云端失败：${r.error ?? '未知原因'}`
})

/** 改设置本身就算一次数据变更，下一轮判定会跟着补一次备份，这是对的 */
const saveInterval = async (v: number) => {
  const n = Number.isFinite(v) ? v : 5
  try {
    await settingsApi.setSetting('auto_backup_interval', String(n))
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
  refresh()
}

const saveRealtime = async (v: boolean) => {
  try {
    await settingsApi.setSetting('auto_backup_realtime', v ? 'true' : 'false')
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
  refresh()
}

/* ---------- 恢复（需要备份密码，云端/迁移文件共用一个弹窗） ---------- */
type RestoreMode = 'cloud' | 'file'
const showRestore = ref(false)
const restoreTarget = ref<BackupPackage | null>(null)
const restoreMode = ref<RestoreMode>('cloud')
const restorePw = ref('')
const restoreErr = ref('')
const closeRestore = () => { showRestore.value = false; restorePw.value = ''; restoreErr.value = '' }
useEscapeClose(closeRestore, () => showRestore.value)

const openRestore = (name: string, mode: RestoreMode) => {
  restoreTarget.value = { name, time: 0, size: 0, attachments: null }
  restoreMode.value = mode
  restorePw.value = ''
  restoreErr.value = ''
  showRestore.value = true
}

const submitRestore = async () => {
  if (!restoreTarget.value || !restorePw.value) { restoreErr.value = '请输入备份密码'; return }
  restoreErr.value = ''
  const name = restoreTarget.value.name
  const pw = restorePw.value
  const mode = restoreMode.value
  closeRestore()
  busy.value = { op: 'restore', text: '准备中…', pct: 0 }
  try {
    if (mode === 'cloud') await cloudApi.restore(name, pw)
    else await backupApi.restoreFile(name, pw)
    toastStore.showToast('恢复完成，请用备份当时的主密码重新解锁')
    emit('restored')
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    busy.value = null
    await refresh()
  }
}

/* ---------- 云端配置（坚果云 WebDAV） ---------- */
const DEFAULT_SERVER = 'https://dav.jianguoyun.com/dav/'
const showCloud = ref(false)
const cloudCfg = ref({ server: DEFAULT_SERVER, account: '', appPassword: '' })
const cloudErr = ref('')
const cloudOk = ref('')
const closeCloud = () => { showCloud.value = false; cloudErr.value = ''; cloudOk.value = '' }
useEscapeClose(closeCloud, () => showCloud.value)

const openCloud = () => {
  cloudCfg.value = {
    server: cloud.value.server || DEFAULT_SERVER,
    account: cloud.value.account,
    appPassword: '',
  }
  cloudErr.value = ''
  cloudOk.value = ''
  showCloud.value = true
}

const testConn = async () => {
  cloudErr.value = ''
  cloudOk.value = ''
  testing.value = true
  try {
    await cloudApi.testConfig(cloudCfg.value.server, cloudCfg.value.account, cloudCfg.value.appPassword)
    cloudOk.value = '连接成功'
  } catch (e) {
    cloudErr.value = errText(e)
  } finally {
    testing.value = false
  }
}

/** 坚果云官方应用密码说明，用系统浏览器打开（WebView 里 target=_blank 是死路） */
const openHelp = async () => {
  try {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open('https://help.jianguoyun.com/?p=2064')
  } catch {
    toastStore.showToast('无法打开浏览器', 'error')
  }
}

const saveCloud = async () => {
  cloudErr.value = ''
  testing.value = true
  try {
    await cloudApi.saveConfig(cloudCfg.value.server, cloudCfg.value.account, cloudCfg.value.appPassword)
    closeCloud()
    await refresh()
    toastStore.showToast('已连接坚果云')
  } catch (e) {
    cloudErr.value = errText(e)
  } finally {
    testing.value = false
  }
}

const doDisconnect = () => {
  confirmStore.showConfirm('断开云端', '断开后不再打包上传，自动备份随之暂停；云端已有文件不受影响（可在坚果云网页端删除）。', async () => {
    try {
      await cloudApi.disconnect()
      await refresh()
      toastStore.showToast('已断开')
    } catch (e) {
      toastStore.showToast(errText(e), 'error')
    }
  })
}

const saveKeepRemote = async (v: number) => {
  const n = Math.max(1, Math.min(100, v || 1))
  try {
    await settingsApi.setSetting('keep_remote', String(n))
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
  refresh()
}

/* ---------- 云端列表 / 从云端恢复 ---------- */
const showRemote = ref(false)
const remoteFiles = ref<RemotePackage[]>([])
const remoteLoading = ref(false)
const closeRemote = () => { showRemote.value = false }
useEscapeClose(closeRemote, () => showRemote.value)

const openRemote = async () => {
  showRemote.value = true
  remoteLoading.value = true
  remoteFiles.value = []
  try {
    remoteFiles.value = await cloudApi.list()
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
    showRemote.value = false
  } finally {
    remoteLoading.value = false
  }
}

const doRemoteRestore = (f: RemotePackage) => {
  closeRemote()
  openRestore(f.name, 'cloud')
}

/* ---------- 迁移：单文件导出 / 从任意文件恢复 ---------- */
/** 导出名带日期就够，同一天多次导出由对话框里的默认名自己区分 */
const exportName = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `desko-迁移-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.dsbk`
}

/** 原生对话框取不到路径就是用户取消，不必报错 */
async function pickSavePath(): Promise<string | null> {
  try {
    const { save } = await import('@tauri-apps/plugin-dialog')
    return (await save({
      defaultPath: exportName(),
      filters: [{ name: 'Desko 备份', extensions: ['dsbk'] }],
    })) ?? null
  } catch {
    toastStore.showToast('无法打开保存对话框', 'error')
    return null
  }
}

async function pickOpenPath(): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const r = await open({
      multiple: false,
      filters: [{ name: 'Desko 备份', extensions: ['dsbk'] }],
    })
    return typeof r === 'string' ? r : null
  } catch {
    toastStore.showToast('无法打开文件选择对话框', 'error')
    return null
  }
}

const doExport = async () => {
  const dest = await pickSavePath()
  if (!dest) return
  await run('export', () => backupApi.exportPackage(dest), '迁移包已导出，拷这一个文件就能换机恢复')
}

const doRestoreFile = async () => {
  const src = await pickOpenPath()
  if (!src) return
  openRestore(src, 'file')
}
</script>

<template>
  <div class="backup-pane">
    <h4 class="section-label">数据</h4>
    <div class="group-content">
      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-name">数据库路径</span>
          <span class="setting-desc db-path" :title="dbPath">{{ dbPath }}</span>
        </div>
        <div class="setting-actions">
          <button class="action-btn" :disabled="dbPath === '未知'" @click="copyToClipboard(dbPath, '路径')">复制路径</button>
        </div>
      </div>
      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-name">未引用附件</span>
          <span class="setting-desc">{{ orphanText }}</span>
        </div>
        <div class="setting-actions">
          <button class="action-btn" :disabled="!orphans.length || !!busy" @click="doCleanOrphans">清理</button>
        </div>
      </div>
    </div>

    <h4 class="section-label">云端备份<span class="label-tag">坚果云 WebDAV</span></h4>
    <div class="group-content">
      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-name">备份密码</span>
          <span class="setting-desc">
            {{ st.hasPassword ? '已设置 · 独立于主密码，丢失后备份无法解密' : '未设置 · 设置后才能生成备份' }}
          </span>
        </div>
        <div class="setting-actions">
          <button class="action-btn" @click="showPwd = true">{{ st.hasPassword ? '修改' : '设置' }}</button>
        </div>
      </div>
      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-name conn-name">
            <span class="live-dot" :class="{ idle: !st.cloud.configured }" :aria-label="st.cloud.configured ? '云端已连接' : '云端未连接'" />
            连接
          </span>
          <span class="setting-desc">{{ connText }}</span>
        </div>
        <div class="setting-actions">
          <button class="action-btn" @click="openCloud">配置</button>
          <button v-if="st.cloud.configured" class="action-btn danger" @click="doDisconnect">断开</button>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-name">立即备份</span>
          <span v-if="busy?.op === 'backup'" class="row-progress">
            <span class="rp-text">{{ busy.text }}</span>
            <span class="rp-bar"><span class="rp-bar-in" :style="{ width: busy.pct + '%' }" /></span>
            <span class="rp-pct">{{ busy.pct }}%</span>
          </span>
          <span v-else class="setting-desc">{{ cloudReady ? roundText : '未配置云端 · 请先配置上方' }}</span>
        </div>
        <div class="setting-actions">
          <button class="action-btn primary" :disabled="!!busy || !schedulable" @click="doBackup">
            <AppIcon name="download" :size="14" />
            备份
          </button>
        </div>
      </div>
      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-name">自动备份</span>
          <span class="setting-desc">到点自动打包上传；数据无变化则跳过本轮</span>
        </div>
        <div class="setting-control">
          <OptionSelect
            :model-value="st.intervalMin"
            :options="INTERVAL_OPTIONS"
            :disabled="!schedulable"
            @update:model-value="saveInterval(Number($event))"
          />
        </div>
      </div>
      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-name">即时备份</span>
          <span class="setting-desc">最后一次写入 8 秒后备跑一轮，不等定时周期</span>
        </div>
        <label class="switch" :class="{ off: !schedulable }">
          <input type="checkbox" :checked="st.realtime" :disabled="!schedulable" @change="saveRealtime(($event.target as HTMLInputElement).checked)" />
          <span class="switch-slider"></span>
        </label>
      </div>
      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-name">云端保留份数</span>
          <span class="setting-desc">只轮转库包；云端附件密文永不删除</span>
        </div>
        <div class="setting-control">
          <input
            type="number" class="number-input" min="1" max="100" :value="st.cloud.keepRemote" :disabled="!cloudReady"
            @change="saveKeepRemote(parseInt(($event.target as HTMLInputElement).value))"
          />
          <span class="unit">份</span>
        </div>
      </div>
      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-name">从云端恢复</span>
          <span class="setting-desc">下载远端备份包，整机覆盖当前数据</span>
        </div>
        <div class="setting-actions">
          <button class="action-btn" :disabled="!cloudReady" @click="openRemote">云端列表</button>
        </div>
      </div>
    </div>

    <h4 class="section-label">迁移<span class="label-tag">不依赖云端</span></h4>
    <div class="group-content">
      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-name">导出迁移包</span>
          <span class="setting-desc">库 + 全部附件打包为单个 .dsbk，换机拷贝这一个文件即可恢复</span>
        </div>
        <div class="setting-actions">
          <button v-if="busy?.op === 'export'" class="action-btn" disabled>{{ busy.text }} {{ busy.pct }}%</button>
          <button v-else class="action-btn" :disabled="!!busy || !st.hasPassword" @click="doExport">导出</button>
        </div>
      </div>
      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-name">从文件恢复</span>
          <span class="setting-desc">选本机或网盘里的 .dsbk，整机覆盖当前数据</span>
        </div>
        <div class="setting-actions">
          <button class="action-btn" :disabled="!!busy" @click="doRestoreFile">选文件</button>
        </div>
      </div>
    </div>

    <p class="pane-note">
      云端备份：持续增量，日常灾备。<br />
      迁移导出：一次性全量，换机即用。<br />
      全部数据在本机加密（AES-256-GCM）后才存出，云端只见密文。
    </p>

    <!-- 备份密码弹窗 -->
    <Transition name="dialog">
      <div v-if="showPwd" class="dialog-overlay pane-overlay">
        <div class="dialog dialog-sm" role="dialog" aria-modal="true" :aria-label="st.hasPassword ? '修改备份密码' : '设置备份密码'">
          <div class="dialog-header">
            <h3>{{ st.hasPassword ? '修改备份密码' : '设置备份密码' }}</h3>
            <button class="dialog-close" title="关闭" @click="closePwd">
              <AppIcon name="x" :size="16" />
            </button>
          </div>
          <div class="dialog-body">
            <p class="lead">备份密码独立于主密码，丢失后备份无法解密。改密只更新密钥，已有备份不必重做。</p>
            <div class="form-group">
              <label>备份密码</label>
              <input v-model="pwd.pw" type="password" placeholder="至少 8 位，可用一句短语" />
            </div>
            <div class="form-group">
              <label>确认备份密码</label>
              <input v-model="pwd.pw2" type="password" placeholder="再次输入" @keyup.enter="submitPwd" />
            </div>
            <p v-if="pwdErr" class="dialog-err">{{ pwdErr }}</p>
          </div>
          <div class="dialog-footer">
            <button class="btn-secondary" @click="closePwd">取消</button>
            <button class="btn-primary" :disabled="!!busy" @click="submitPwd">{{ busy?.op === 'pwd' ? '处理中…' : '保存' }}</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 恢复确认弹窗（要备份密码） -->
    <Transition name="dialog">
      <div v-if="showRestore" class="dialog-overlay pane-overlay">
        <div class="dialog dialog-sm" role="dialog" aria-modal="true" :aria-label="restoreMode === 'cloud' ? '从云端恢复' : '从文件恢复'">
          <div class="dialog-header">
            <h3>{{ restoreMode === 'cloud' ? '从云端恢复' : '从文件恢复' }}</h3>
            <button class="dialog-close" title="关闭" @click="closeRestore">
              <AppIcon name="x" :size="16" />
            </button>
          </div>
          <div class="dialog-body">
            <p class="lead">
              用 <b style="word-break: break-all">{{ restoreTarget?.name }}</b> 覆盖当前全部数据（库与附件）。
              覆盖前自动留一份现状备份；完成后需用该备份当时的主密码解锁。
            </p>
            <div class="form-group">
              <label>备份密码</label>
              <input v-model="restorePw" type="password" placeholder="该备份加密时用的备份密码" @keyup.enter="submitRestore" />
            </div>
            <p v-if="restoreErr" class="dialog-err">{{ restoreErr }}</p>
          </div>
          <div class="dialog-footer">
            <button class="btn-secondary" @click="closeRestore">取消</button>
            <button class="btn-primary" @click="submitRestore">恢复</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 坚果云连接弹窗 -->
    <Transition name="dialog">
      <div v-if="showCloud" class="dialog-overlay pane-overlay">
        <div class="dialog dialog-sm" role="dialog" aria-modal="true" aria-label="连接坚果云">
          <div class="dialog-header">
            <h3>连接坚果云</h3>
            <button class="dialog-close" title="关闭" @click="closeCloud">
              <AppIcon name="x" :size="16" />
            </button>
          </div>
          <div class="dialog-body">
            <div class="form-group">
              <label>服务器地址</label>
              <input v-model="cloudCfg.server" type="text" placeholder="https://dav.jianguoyun.com/dav/" />
              <p class="lead">个人版保持默认即可；企业版改成自己的 WebDAV 域名，必须 https。</p>
            </div>
            <div class="form-group">
              <label>账号</label>
              <input v-model="cloudCfg.account" type="text" placeholder="坚果云登录邮箱" />
            </div>
            <div class="form-group">
              <label>应用密码</label>
              <input v-model="cloudCfg.appPassword" type="password" :placeholder="st.cloud.configured ? '留空保持不变' : '不是你的登录密码'" />
              <p class="lead">
                用坚果云「账户信息 → 安全选项 → 添加应用」生成的应用密码，<b>不是登录密码</b>。
                <a class="help-link" href="#" @click.prevent="openHelp">看官方说明</a>
              </p>
            </div>
            <p v-if="cloudErr" class="dialog-err">{{ cloudErr }}</p>
            <p v-if="cloudOk" class="dialog-ok">{{ cloudOk }}</p>
          </div>
          <div class="dialog-footer">
            <button class="btn-secondary" :disabled="testing" @click="testConn">{{ testing ? '测试中…' : '测试连接' }}</button>
            <span class="footer-spacer" />
            <button class="btn-secondary" @click="closeCloud">取消</button>
            <button class="btn-primary" @click="saveCloud">保存</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 云端备份列表弹窗 -->
    <Transition name="dialog">
      <div v-if="showRemote" class="dialog-overlay pane-overlay">
        <div class="dialog dialog-sm" role="dialog" aria-modal="true" :aria-label="`云端备份 · ${hostOf(st.cloud.server)}`">
          <div class="dialog-header">
            <h3>云端备份 · {{ hostOf(st.cloud.server) }}</h3>
            <button class="dialog-close" title="关闭" @click="closeRemote">
              <AppIcon name="x" :size="16" />
            </button>
          </div>
          <div class="dialog-body remote-list">
            <div v-if="remoteLoading" class="empty-line">正在列出云端备份…</div>
            <div v-else-if="!remoteFiles.length" class="empty-line">云端还没有备份，先点一次「备份」。</div>
            <div v-for="f in remoteFiles" :key="f.name" class="file-row">
              <span class="file-name">{{ f.name }}</span>
              <span class="file-meta">{{ fmtSize(f.size) }}</span>
              <span class="file-actions">
                <button class="row-btn" :disabled="!!busy" @click="doRemoteRestore(f)">恢复</button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.backup-pane {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: var(--space-2) 0 0;
  font-size: var(--text-2xs);
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--text-muted);
}
.label-tag {
  font-weight: 500;
  font-size: var(--text-2xs);
  padding: 0 6px;
  border-radius: 8px;
  background: var(--hover);
  color: var(--text-muted);
}

/* 路径是给人抄的，不是给人猜的：等宽体让 \ 与 l、0 与 O 分得开 */
.db-path { font-family: var(--font-mono); font-size: var(--text-xs); }
.conn-name { display: inline-flex; align-items: center; gap: 7px; }

/* 行内进度：替换所在行的说明行，不撑高、不挪布局 */
.row-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.rp-text {
  font-size: var(--text-2xs);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rp-bar {
  flex: 1;
  max-width: 180px;
  height: 3px;
  border-radius: 2px;
  background: var(--border);
  overflow: hidden;
}
.rp-bar-in {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.2s;
}
.rp-pct { font-size: var(--text-2xs); color: var(--text-muted); font-variant-numeric: tabular-nums; }

.file-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 40px;
  padding: 6px var(--space-4);
  border-bottom: 1px solid var(--border);
}
.file-row:last-child { border-bottom: none; }
.file-name {
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-meta { font-size: var(--text-2xs); color: var(--text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.file-actions { display: flex; gap: 4px; flex-shrink: 0; }

.row-btn {
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: var(--text-2xs);
  font-weight: 500;
  color: var(--text-secondary);
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}
.row-btn:hover:not(:disabled) { background: var(--hover); color: var(--accent); }
/* 裸文字钮没有面可洗：禁用时沿字色阶降一档（muted ≈4.4:1 仍读得清），不整颗淡出 */
.row-btn:disabled { color: var(--text-muted); cursor: default; }

.empty-line {
  padding: 14px var(--space-4);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.pane-note {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--text-muted);
}

/* 叠在设置弹窗之上：同为 fixed z-1000，DOM 靠后自然压上 */
.pane-overlay { z-index: 1100; }
/* 列表型正文上下收一档；预留列表高度，loading 一行 → 列表撑开会跳，固定住再滚动 */
.remote-list { min-height: 240px; padding-top: var(--space-2); padding-bottom: var(--space-2); overflow-y: auto; scrollbar-gutter: stable; }

.help-link { color: var(--accent); text-decoration: none; white-space: nowrap; }
.help-link:hover { text-decoration: underline; }
.footer-spacer { flex: 1; }
</style>
