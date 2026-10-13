<script setup lang="ts">
import AppIcon from '../components/shared/AppIcon.vue'
import { usePageHeadStore } from '../stores/pageHead'

/** 零模块态：所有页面模块都关掉时唯一的落脚点，自己不是模块、没有开关 */
usePageHeadStore().setHead('')
const openModules = () => {
  window.dispatchEvent(new CustomEvent('desko:open-settings-tab', { detail: 'modules' }))
}
</script>

<template>
  <div class="content-inner">
    <div class="empty-state">
      <div class="empty-icon">
        <AppIcon name="gear" :size="24" />
      </div>
      <div class="empty-title">还没有开启任何模块</div>
      <div class="empty-desc">案头的每块功能都是一个模块，开哪个用哪个</div>
      <button class="action-btn primary" type="button" @click="openModules">去开启模块</button>
    </div>
  </div>
</template>

<style scoped>
.empty-state .action-btn {
  margin-top: var(--space-5);
}
</style>
