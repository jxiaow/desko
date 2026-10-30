<script setup lang="ts">
import WebServicePane from './WebServicePane.vue'
</script>

<template>
  <div class="web-services">
    <p class="pane-hint">使用主密码登录；退出 Desko 后服务停止。</p>
    <WebServicePane title="Desko Web" :default-port="8420" />
  </div>
</template>

<style scoped>
.web-services { display: flex; flex-direction: column; gap: 24px; }
.web-services > :deep(.web-access-pane) + :deep(.web-access-pane) { border-top: 1px solid var(--border); padding-top: 24px; }
.pane-hint { margin: 0; line-height: 1.7; }
</style>
