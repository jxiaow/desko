<script setup lang="ts">
defineProps<{ variant: 'sessions' | 'usage' }>()
</script>

<template>
  <div class="codex-skeleton" :class="variant" role="status" :aria-label="variant === 'sessions' ? '正在读取会话' : '正在统计用量'">
    <div class="rcard skeleton-summary" aria-hidden="true">
      <div class="skeleton-heading"><span class="bone label"></span><span class="bone caption"></span></div>
      <div class="skeleton-metrics"><span v-for="n in (variant === 'sessions' ? 3 : 4)" :key="n" class="bone metric"></span></div>
      <span class="bone caption"></span>
    </div>
    <template v-if="variant === 'sessions'">
      <div v-for="n in 3" :key="n" class="rcard skeleton-project" aria-hidden="true">
        <div class="skeleton-heading"><span class="bone label"></span><span class="bone caption"></span></div>
        <span class="bone caption project-path"></span>
        <span class="bone title project-total"></span>
      </div>
    </template>
    <template v-else>
      <div class="rcard skeleton-chart" aria-hidden="true"><span class="bone label"></span><div class="bone plot"></div><span class="bone caption"></span></div>
      <div class="rcard skeleton-project" aria-hidden="true"><span class="bone label"></span><div v-for="n in 3" :key="n" class="loading-row"><span class="bone title"></span><span class="bone number"></span></div></div>
    </template>
  </div>
</template>

<style scoped>
.codex-skeleton { display: grid; gap: 10px; }
.codex-skeleton > .rcard { margin: 0; }
.skeleton-summary, .skeleton-project, .skeleton-chart { padding: 16px 20px; }
.sessions .skeleton-summary { height: 72px; padding: 12px 20px; }
.sessions .skeleton-summary .skeleton-heading { display: none; }
.sessions .skeleton-summary .skeleton-metrics { grid-template-columns: minmax(0, 1fr) 140px 72px; margin: 0 0 10px; }
.sessions .metric:first-child { max-width: 110px; }
.sessions .skeleton-project { min-height: 82px; padding: 12px 20px; }
.project-path { margin-top: 6px; }
.project-total { height: 10px; margin-top: 8px; }
.usage .skeleton-summary { min-height: 158px; }
.skeleton-heading { display: flex; justify-content: space-between; gap: 24px; align-items: center; }
.skeleton-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 28px; margin: 22px 0; }
.bone { display: block; background: var(--border); border-radius: 4px; animation: codex-loading 1.6s ease-in-out infinite; }
.label { width: 110px; height: 14px; }
.caption { width: 26%; height: 10px; }
.metric { width: 80%; height: 24px; }
.loading-row { display: flex; justify-content: space-between; gap: 24px; align-items: center; min-height: 48px; }
.skeleton-project .skeleton-heading { margin-bottom: 0; }
.title { width: 48%; height: 12px; }
.title.short { width: 36%; }
.number { width: 72px; height: 10px; }
.plot { height: 180px; margin: 16px 0 8px; opacity: .5; }
@keyframes codex-loading { 50% { opacity: .4; } }
@media (prefers-reduced-motion: reduce) { .bone { animation: none; } }
</style>
