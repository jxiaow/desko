<script setup lang="ts">
import { computed } from 'vue'
import {
  storagePaths,
  loadStoragePaths,
  quotaRefreshMinutes,
  quotaAlertThreshold,
  QUOTA_REFRESH_CHOICES,
  QUOTA_ALERT_CHOICES,
  loadQuotaSettings,
  saveQuotaSettings,
  syncQuotaTicker,
} from '../../services/codexState'
import { codexApi } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../../components/shared/AppIcon.vue'
import OptionSelect from '../../components/shared/OptionSelect.vue'

const toastStore = useToastStore()

const openCodexConfig = async () => {
  try {
    await codexApi.openConfigToml()
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
}

const refreshOptions = computed(() =>
  QUOTA_REFRESH_CHOICES.map((m) => ({ value: m, label: m === 0 ? '不自动' : `${m} 分钟` }))
)
const alertOptions = computed(() =>
  QUOTA_ALERT_CHOICES.map((p) => ({ value: p, label: `剩余 ${p}%` }))
)

const refreshDesc = computed(() =>
  quotaRefreshMinutes.value === 0
    ? '已关闭，只在进页面或手动点「刷新配额」时取数'
    : `开着 Codex 页时每 ${quotaRefreshMinutes.value} 分钟静默取一次数，离开页面即停`
)

async function pickRefresh(minutes: string | number) {
  await saveQuotaSettings(Number(minutes), quotaAlertThreshold.value)
  syncQuotaTicker()
}

async function pickAlert(threshold: string | number) {
  await saveQuotaSettings(quotaRefreshMinutes.value, Number(threshold))
}

void loadStoragePaths()
void loadQuotaSettings()
</script>

<template>
  <div class="group-content">
    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-name">备份范围</span>
        <span class="setting-desc">Codex 只备份账号与账号配置；会话、历史和用量仅在本机，不参与坚果云备份、迁移导出或恢复。</span>
      </div>
    </div>
    <div v-if="storagePaths?.authPath" class="setting-item">
      <div class="setting-info">
        <span class="setting-name">官方凭据路径</span>
        <span class="setting-desc">当前账号的授权文件位置</span>
        <div class="codex-path">
          <code :title="storagePaths.authPath">{{ storagePaths.authPath }}</code>
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

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-name">配额自动刷新</span>
        <span class="setting-desc">{{ refreshDesc }}</span>
      </div>
      <div class="setting-control">
        <OptionSelect
          :model-value="quotaRefreshMinutes"
          :options="refreshOptions"
          @update:model-value="pickRefresh"
        />
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-name">配额预警</span>
        <span class="setting-desc">当前账号的 5 小时或周窗口低于阈值时提示一次，同一档位不重复打扰</span>
      </div>
      <div class="setting-control">
        <OptionSelect
          :model-value="quotaAlertThreshold"
          :options="alertOptions"
          @update:model-value="pickAlert"
        />
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
  font-family: var(--font-mono);
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
