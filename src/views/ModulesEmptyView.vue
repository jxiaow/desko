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
      <div class="empty-title">暂无已启用的模块</div>
      <div class="empty-desc">在设置中启用模块后，即可开始使用。</div>
      <button class="action-btn primary" type="button" @click="openModules">管理模块</button>
    </div>
  </div>
</template>

<style scoped>
.empty-state .action-btn {
  margin-top: var(--space-5);
}
</style>
