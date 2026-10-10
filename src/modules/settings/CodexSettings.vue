<script setup lang="ts">
import { storagePaths, loadStoragePaths } from '../../services/codexState'
import { codexApi } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../../components/shared/AppIcon.vue'

const toastStore = useToastStore()

const openCodexConfig = async () => {
  try {
    await codexApi.openConfigToml()
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
}

loadStoragePaths()
</script>

<template>
  <div class="group-content">
    <div v-if="storagePaths?.authPath" class="setting-item">
      <div class="setting-info">
        <span class="setting-name">官方凭据路径</span>
        <span class="setting-desc">当前账号的授权文件位置</span>
        <div class="codex-path">
          <code class="mono" :title="storagePaths.authPath">{{ storagePaths.authPath }}</code>
          <button class="action-btn" type="button" @click="openCodexConfig">
            <AppIcon name="file" :size="13" />打开 config.toml
          </button>
        </div>
      </div>
    </div>
    <div v-else class="setting-item">
      <div class="setting-info">
        <span class="setting-name">官方凭据路径</span>
        <span class="setting-desc">还没有配置 Codex 账号</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.codex-path {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.codex-path code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}
.codex-path .action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}
</style>
