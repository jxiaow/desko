<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import {
  fsBusy,
  fsConfig,
  fsLoaded,
  fsHasPassword,
  fsSaveConfig,
  fsSetPassword,
} from '../../services/fileshareSettings'
import { errText } from '../../services/api/backup'
import { useToastStore } from '../../stores/toast'
import { isWebRuntime } from '../../services/runtime'
import AppIcon from '../../components/shared/AppIcon.vue'

const toastStore = useToastStore()
const webRuntime = isWebRuntime()

const fsPortInput = ref(8000)
const fsLocalOnly = ref(false)
const fsShowPwInput = ref(false)
const fsPasswordInput = ref('')
const fsShowDirAdd = ref(false)
const fsDirInput = ref('')
const fsDirInputEl = ref<HTMLInputElement | null>(null)

const cfg = computed(() => fsConfig.value)
const dirs = computed(() => cfg.value?.shareDirs ?? [])
const dirsReady = computed(() => fsLoaded.value && !!cfg.value)

function baseName(p: string) {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

async function saveDirs(next: string[]): Promise<boolean> {
  const c = cfg.value
  if (!c || fsBusy.value) return false
  try {
    await fsSaveConfig(next, c.port, c.localOnly)
    toastStore.showToast('共享目录已更新')
    return true
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
    return false
  }
}

async function addDirPath(raw: string): Promise<boolean> {
  const path = raw.trim()
  if (!path) {
    toastStore.showToast('请输入目录路径', 'error')
    return false
  }
  if (dirs.value.some((d) => d.toLowerCase() === path.toLowerCase())) {
    toastStore.showToast('该目录已在列表里', 'error')
    return false
  }
  return saveDirs([...dirs.value, path])
}

async function revealDirInput() {
  fsShowDirAdd.value = true
  await nextTick()
  fsDirInputEl.value?.focus()
}

async function addDirectory() {
  if (fsBusy.value || !dirsReady.value) return
  if (webRuntime) {
    await revealDirInput()
    return
  }
  try {
    const path = await dialogOpen({ directory: true, multiple: false, title: '添加共享文件夹' })
    if (typeof path === 'string') await addDirPath(path)
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
}

async function submitDir() {
  if (await addDirPath(fsDirInput.value)) {
    fsDirInput.value = ''
    fsShowDirAdd.value = false
  }
}

function cancelDirAdd() {
  fsShowDirAdd.value = false
  fsDirInput.value = ''
}

async function removeDir(index: number) {
  if (fsBusy.value) return
  if (dirs.value.length <= 1) {
    toastStore.showToast('至少保留一个共享目录', 'error')
    return
  }
  await saveDirs(dirs.value.filter((_, i) => i !== index))
}

const syncFileshareForm = () => {
  const c = cfg.value
  if (!c) return
  fsPortInput.value = c.port
  fsLocalOnly.value = c.localOnly
}

watch(cfg, syncFileshareForm, { immediate: true })

const applyFsPort = async () => {
  const c = cfg.value
  if (!c || fsBusy.value) return
  const port = Math.max(1, Math.min(65535, fsPortInput.value || c.port))
  fsPortInput.value = port
  if (port === c.port) return
  try {
    await fsSaveConfig(c.shareDirs, port, c.localOnly)
    toastStore.showToast('端口已更新')
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    syncFileshareForm()
  }
}

const applyFsLocalOnly = async () => {
  const c = cfg.value
  if (!c || fsBusy.value) return
  const want = fsLocalOnly.value
  try {
    await fsSaveConfig(c.shareDirs, fsPortInput.value, want)
    toastStore.showToast(want ? '已切到仅本机访问' : '已对局域网开放')
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
    fsLocalOnly.value = !want
  } finally {
    syncFileshareForm()
  }
}

const applyFsPassword = async () => {
  if (fsBusy.value) return
  try {
    await fsSetPassword(fsPasswordInput.value)
    toastStore.showToast('访问口令已更新')
    fsPasswordInput.value = ''
    fsShowPwInput.value = false
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
}

const clearFsPassword = async () => {
  if (fsBusy.value) return
  try {
    await fsSetPassword('')
    toastStore.showToast('已清除访问口令')
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
}
</script>

<template>
  <h4 class="settings-section-label">连接</h4>
  <div class="group-content">
    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-name">端口</span>
        <span class="setting-desc">端口被占用时自动换用，实际端口见传输页</span>
      </div>
      <input
        v-model.number="fsPortInput"
        class="number-input fs-port-input"
        type="number"
        min="1"
        max="65535"
        @change="applyFsPort"
        @keyup.enter="applyFsPort"
      />
    </div>
    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-name">仅本机访问</span>
        <span class="setting-desc">开启后其他设备无法访问</span>
      </div>
      <label class="switch">
        <input type="checkbox" v-model="fsLocalOnly" @change="applyFsLocalOnly" />
        <span class="switch-slider"></span>
      </label>
    </div>
    <div class="setting-item stacked-row">
      <div class="row-head">
        <div class="setting-info">
          <span class="setting-name">访问口令</span>
          <span class="setting-desc">{{ fsHasPassword ? '访问共享文件需验证口令' : '未设置，访问时无需验证' }}</span>
        </div>
        <div class="setting-actions fs-pw-ctl">
          <button v-if="!fsShowPwInput" class="action-btn" @click="fsShowPwInput = true">
            {{ fsHasPassword ? '修改口令' : '设置口令' }}
          </button>
          <button v-if="fsHasPassword" class="action-btn" :disabled="fsBusy" @click="clearFsPassword">清除口令</button>
        </div>
      </div>
      <div v-if="fsShowPwInput" class="row-detail fs-pw-row">
        <input
          v-model="fsPasswordInput"
          class="fs-pw-input"
          type="password"
          placeholder="新口令"
          autocomplete="new-password"
          @keyup.enter="applyFsPassword"
        />
        <div class="row-actions">
          <button class="action-btn primary" :disabled="fsBusy || !fsPasswordInput" @click="applyFsPassword">设置</button>
          <button class="action-btn" @click="fsShowPwInput = false; fsPasswordInput = ''">取消</button>
        </div>
      </div>
    </div>
  </div>

  <h4 class="settings-section-label">共享目录</h4>
  <div class="group-content">
    <div class="setting-item stacked-row">
      <div class="row-head">
        <div class="setting-info">
          <span class="setting-name">共享文件夹</span>
          <span class="setting-desc">其他设备可浏览、下载和上传这些文件夹里的文件；投递文件时从中选择目标。</span>
        </div>
        <button class="action-btn fs-dir-add-btn" type="button" :disabled="fsBusy || !dirsReady" @click="addDirectory">
          <AppIcon :name="webRuntime ? 'plus' : 'folder'" :size="14" />{{ webRuntime ? '手动添加' : '添加文件夹' }}
        </button>
      </div>
      <div class="row-detail">
        <ul class="fs-dir-list" aria-label="共享文件夹">
          <li v-for="(d, i) in dirs" :key="d" class="fs-dir-item">
            <AppIcon class="fs-dir-icon" name="folder" :size="16" />
            <span class="fs-dir-text">
              <span class="fs-dir-name">{{ baseName(d) }}</span>
              <span class="fs-dir-path" :title="d">{{ d }}</span>
            </span>
            <button
              class="ib fs-dir-remove"
              type="button"
              :disabled="fsBusy"
              :aria-label="`移除共享文件夹 ${baseName(d)}`"
              :title="dirs.length <= 1 ? '至少保留一个共享目录' : '移除该目录'"
              @click="removeDir(i)"
            >
              <AppIcon name="trash" :size="15" />
            </button>
          </li>
        </ul>
        <p v-if="!dirsReady" class="fs-dir-empty">正在读取共享目录…</p>
        <p v-else-if="!dirs.length" class="fs-dir-empty">尚未添加共享目录。</p>
        <form v-if="fsShowDirAdd" class="fs-dir-add" @submit.prevent="submitDir">
          <input
            ref="fsDirInputEl"
            v-model="fsDirInput"
            class="fs-dir-input"
            type="text"
            placeholder="输入此电脑上的文件夹路径"
            aria-label="共享目录路径"
            autocomplete="off"
            spellcheck="false"
            :disabled="fsBusy"
          />
          <button class="action-btn primary" type="submit" :disabled="fsBusy || !fsDirInput.trim()">添加</button>
          <button class="action-btn" type="button" :disabled="fsBusy" @click="cancelDirAdd">取消</button>
        </form>
        <button v-else-if="!webRuntime" class="fs-manual-add" type="button" :disabled="fsBusy || !dirsReady" @click="revealDirInput">手动输入路径</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fs-port-input { width: 84px; }
.fs-pw-row { flex-direction: row; align-items: center; }
.fs-pw-input {
  flex: 1;
  min-width: 140px;
  height: 28px;
  padding: 0 10px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: var(--text-xs);
  font-family: inherit;
}
.fs-pw-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
.fs-dir-add-btn { flex: none; }
.fs-dir-list { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.fs-dir-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 4px var(--space-2);
  margin: 0 calc(var(--space-2) * -1);
  border-radius: var(--radius-tag);
  transition: background var(--transition);
}
.fs-dir-item:hover { background: var(--hover); }
.fs-dir-icon { flex: none; color: var(--text-muted); }
.fs-dir-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.fs-dir-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-description);
  line-height: 18px;
  color: var(--text);
}
.fs-dir-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  line-height: 16px;
  color: var(--text-muted);
}
.fs-dir-remove { flex: none; width: 30px; height: 30px; color: var(--text-muted); }
.fs-dir-remove:hover:not(:disabled) { color: var(--danger); }
.fs-dir-empty { margin: 4px 0 0; color: var(--text-muted); font-size: var(--text-xs); line-height: 20px; }
.fs-dir-add { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.fs-dir-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 10px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: var(--text-xs);
  font-family: inherit;
}
.fs-dir-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
.fs-manual-add {
  align-self: flex-start;
  min-height: 26px;
  margin-top: 2px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-xs);
}
.fs-manual-add:hover:not(:disabled) { color: var(--text); }
.fs-manual-add:disabled { cursor: not-allowed; }
@media (max-width: 600px) {
  .fs-dir-add-btn { min-height: 44px; }
  .fs-dir-item { min-height: 52px; }
  .fs-dir-remove { width: 44px; height: 44px; }
  .fs-dir-add { flex-wrap: wrap; }
  .fs-dir-input { flex-basis: 100%; height: 44px; font-size: var(--text-sm); }
  .fs-dir-add .action-btn { min-height: 44px; }
  .fs-manual-add { min-height: 44px; }
}
</style>
