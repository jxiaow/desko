<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  fsBusy,
  fsConfig,
  fsHasPassword,
  fsSaveConfig,
  fsSetPassword,
} from '../../services/fileshareSettings'
import { errText } from '../../services/api/backup'
import { useToastStore } from '../../stores/toast'

const toastStore = useToastStore()

const fsPortInput = ref(8000)
const fsLocalOnly = ref(false)
const fsShowPwInput = ref(false)
const fsPasswordInput = ref('')

const cfg = computed(() => fsConfig.value)

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
  <div class="group-content">
    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-name">端口</span>
        <span class="setting-desc">被占用时自动向后漂移，实际端口见传输页顶部</span>
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
        <span class="setting-desc">只监听 127.0.0.1，其他设备无法连接</span>
      </div>
      <label class="switch">
        <input type="checkbox" v-model="fsLocalOnly" @change="applyFsLocalOnly" />
        <span class="switch-slider"></span>
      </label>
    </div>
    <div class="setting-item" :class="{ stacked: fsShowPwInput }">
      <div class="setting-info">
        <span class="setting-name">访问口令</span>
        <span class="setting-desc">启用后网页端所有页面都要先输口令</span>
      </div>
      <div class="fs-pw-ctl">
        <span class="fs-tag" :class="{ on: fsHasPassword }">{{ fsHasPassword ? '已启用' : '未启用' }}</span>
        <button v-if="!fsShowPwInput" class="action-btn" @click="fsShowPwInput = true">
          {{ fsHasPassword ? '修改口令' : '设置口令' }}
        </button>
        <button v-if="fsHasPassword" class="action-btn" :disabled="fsBusy" @click="clearFsPassword">清除口令</button>
      </div>
      <div v-if="fsShowPwInput" class="fs-pw-row">
        <input
          v-model="fsPasswordInput"
          class="fs-pw-input"
          type="password"
          placeholder="新口令"
          autocomplete="new-password"
          @keyup.enter="applyFsPassword"
        />
        <button class="action-btn primary" :disabled="fsBusy || !fsPasswordInput" @click="applyFsPassword">设置</button>
        <button class="action-btn" @click="fsShowPwInput = false; fsPasswordInput = ''">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stacked { flex-wrap: wrap; }
.fs-port-input { width: 84px; }
.fs-pw-ctl { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
.fs-tag {
  font-size: var(--text-2xs);
  font-weight: 500;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.fs-tag.on { border-color: var(--success); color: var(--success); }
.fs-pw-row { display: flex; align-items: center; gap: var(--space-2); width: 100%; padding-bottom: var(--space-1); }
.fs-pw-input {
  flex: 1;
  min-width: 140px;
  height: 28px;
  padding: 0 10px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: var(--text-xs);
  font-family: inherit;
}
.fs-pw-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
</style>
