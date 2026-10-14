<script setup lang="ts">
import { computed } from 'vue'
import type { CodexAccount } from '../../services/api/codex'
import { codexPlan } from '../../utils/codexPlan'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{ account: CodexAccount }>()
const plan = computed(() => codexPlan(props.account))
</script>

<template>
  <span class="tier" :class="`plan-${plan.kind}`" :title="`账号类型：${plan.label}`">
    <AppIcon :name="plan.icon" :size="12" :filled="plan.kind === 'pro' || plan.kind === 'pro-max'" />
    {{ plan.label }}
  </span>
</template>

<style scoped>
.tier {
  display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
  padding: 2px 7px; border: 1px solid transparent; border-radius: var(--radius-xs);
  font-size: var(--text-2xs); font-weight: 600; line-height: 18px; letter-spacing: .03em;
  color: var(--text-secondary); background: var(--fill); white-space: nowrap;
}
.plan-plus { color: #176746; background: #e9f5ee; border-color: #c8e4d4; }
.plan-go { color: #1f6480; background: #eaf4f8; border-color: #cce2eb; }
.plan-pro-lite { color: #675194; background: #f0ecf8; border-color: #dcd1ef; }
.plan-pro { color: #715224; background: #f8efde; border-color: #e4cfa4; }
.plan-pro-max { color: #fae7ba; background: #705080; border-color: #b39a71; }
.plan-team { color: #335f97; background: #eaf0fa; border-color: #cedcf0; }
.plan-business { color: #35526d; background: #e9eff4; border-color: #c9d7e3; }
.plan-enterprise { color: #536078; background: #edf0f6; border-color: #cdd4e0; }
.plan-edu { color: #8c4967; background: #f7ecf1; border-color: #e8cfda; }
.plan-api { color: var(--text-secondary); background: var(--fill); border-color: var(--border); }
[data-base='dark'] .plan-plus { color: #95d6b0; background: #243a30; border-color: #385547; }
[data-base='dark'] .plan-go { color: #9ccde1; background: #24343e; border-color: #3a5261; }
[data-base='dark'] .plan-pro-lite { color: #c4b3e8; background: #342e43; border-color: #534666; }
[data-base='dark'] .plan-pro { color: #e7cc96; background: #3e3525; border-color: #66563a; }
[data-base='dark'] .plan-team { color: #a6c4ef; background: #293649; border-color: #415674; }
[data-base='dark'] .plan-business { color: #b3c9df; background: #2b3742; border-color: #465766; }
[data-base='dark'] .plan-enterprise { color: #c1cadc; background: #333944; border-color: #515d70; }
[data-base='dark'] .plan-edu { color: #e4b0c8; background: #422f38; border-color: #654656; }
</style>
