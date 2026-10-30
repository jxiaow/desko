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
    <AppIcon :name="plan.icon" :size="12" :filled="plan.kind.startsWith('pro')" />
    {{ plan.label }}
  </span>
</template>

<style scoped>
/* 档位片只有一个色：中性片，和 PRO 家族的品牌淡染。
   原先 9 个档位各配一套手写 pastel（绿/蓝/紫/金/粉/石青…），单看都还行，
   放到一列账号里就成了一张调色板——而且和页面其余部分（灰阶 + 一个 accent）不是一套语言。
   档位名已经写着 PLUS / PRO 200 / TEAM，颜色不需要再复述一遍；
   只有 PRO 家族值得被强调，于是沿用「当前」「主操作」同一支强调色。
   尺寸也对齐 global 的 .badge（20px、无描边）：它和「当前」并排在同一行，
   一个是 22px 带框、一个是 20px 无框，会读成两套牌。 */
.tier {
  display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
  height: 20px; padding: 0 7px; border-radius: var(--radius-tag);
  font-size: var(--text-2xs); font-weight: 600; letter-spacing: .03em;
  color: var(--text-secondary); background: var(--fill); white-space: nowrap;
}
.plan-pro-lite,
.plan-pro,
.plan-pro-max { color: var(--text-brand); background: var(--accent-soft); }
</style>
