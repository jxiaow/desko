<script setup lang="ts">
import WebServicePane from './WebServicePane.vue'
import { moduleFlags } from '../../modules/state'
import { CODEX_DIALOG_ENABLED } from '../../services/featureFlags'
</script>

<template>
  <div class="web-services">
    <p class="pane-hint">使用主密码登录；退出 Desko 后服务停止。</p>
    <WebServicePane kind="app" title="Desko Web" :default-port="8420" />
    <WebServicePane v-if="CODEX_DIALOG_ENABLED && moduleFlags.codex" kind="codex" title="Codex Web UI" :default-port="8421" />
    <p v-else-if="CODEX_DIALOG_ENABLED" class="pane-hint">启用 Codex 模块后可启动 Codex Web UI。</p>
  </div>
</template>

<style scoped>
.web-services { display: flex; flex-direction: column; gap: 24px; }
.web-services > :deep(.web-access-pane) + :deep(.web-access-pane) { border-top: 1px solid var(--border); padding-top: 24px; }
.pane-hint { margin: 0; line-height: 1.7; }
</style>
