<script lang="ts">
/** clipPath id 必须跨实例唯一：设置页三张预览会同时挂载 */
let hudSpriteSeq = 0
</script>

<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '../../shared/AppIcon.vue'
import { formatTokenCount } from '../../../utils/codexUsage'
import {
  formatHudCost,
  HUD_MOVE_MS,
  type CodexHudMove,
  type CodexHudState,
} from '../../../utils/codexHud'

const props = defineProps<{
  state: CodexHudState
  expanded?: boolean
  pinned?: boolean
  /** 常驻微动（呼吸 / 摆耳 / 眨眼）：桌面窗口和设置页预览都传 */
  idle?: boolean
  /** 交互触发（展开小跳）：只有桌面窗口传，预览不伪装成可交互 */
  react?: boolean
  /** 生活场景动作：导演按池轮转放，点角色推进一步；只有桌面窗口传 */
  move?: CodexHudMove | ''
}>()

const f = (n: number) => n.toFixed(2)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function spiralPath(cx: number, cy: number, r0: number, r1: number, turns: number, start: number): string {
  const steps = Math.ceil(turns * 44)
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const a = start + t * turns * Math.PI * 2
    const r = r0 + (r1 - r0) * t
    d += `${i ? ' L' : 'M'} ${f(cx + Math.cos(a) * r)},${f(cy + Math.sin(a) * r)}`
  }
  return d
}

function bunny(p: number, w: number | null): string {
  const id = `hud-b${hudSpriteSeq++}`
  const innerL = 'M 49.4,28.6 C 44,23.4 38.4,11.6 41,7 C 42.8,4.4 46,6.4 48.4,12 C 50.4,16.6 51,23.6 51.2,28.6 Z'
  const innerR = 'M 62.6,28.6 C 68,23.4 73.6,11.6 71,7 C 69.2,4.4 66,6.4 63.6,12 C 61.6,16.6 61,23.6 60.8,28.6 Z'
  const base = 30
  const tip = 4
  const lt = f(base - (base - tip) * p)
  const rt = f(base - (base - tip) * (w ?? 0))
  // 耳 + 头 + 五官 + 胡须包成一组：鞠躬是「头沉」，得把耳朵一起带走。
  return `
<g class="figure"><g class="act"><g class="mv-fig">
<path class="body" d="M 41,66 C 41,58.6 47.6,54.5 56,54.5 C 64.4,54.5 71,58.6 71,66 Z"/>
<g class="mv-head">
<g class="ear-l"><g class="mv-ear-l"><g class="ear-flick">
<path class="ear" d="M 49,31 C 42,25 34,11 38,4.6 C 40.6,1.4 46,3.8 49.6,10.8 C 52.2,16 53,24.6 53.4,31 Z"/>
<path class="ear-inner" d="${innerL}"/>
<clipPath id="${id}a"><path d="${innerL}"/></clipPath>
<g clip-path="url(#${id}a)">
  <rect class="ear-fill primary" x="36" y="${lt}" width="18" height="${f(30 - Number(lt))}"/>
  <path class="fill-edge" d="M 38,${lt} L 52,${lt}"/>
</g>
</g></g></g>
<g class="ear-r"><g class="mv-ear-r"><g class="ear-flick">
<path class="ear" d="M 63,31 C 70,25 78,11 74,4.6 C 71.4,1.4 66,3.8 62.4,10.8 C 59.8,16 59,24.6 58.6,31 Z"/>
<path class="ear-inner" d="${innerR}"/>
<clipPath id="${id}b"><path d="${innerR}"/></clipPath>
${w === null ? '' : `<g clip-path="url(#${id}b)">
  <rect class="ear-fill week" x="58" y="${rt}" width="18" height="${f(30 - Number(rt))}"/>
  <path class="fill-edge week" d="M 60,${rt} L 74,${rt}"/>
</g>`}
</g></g></g>
<path class="head" d="M 56,26 C 45,26 36,33.5 36,43 C 36,52.5 45,59.5 56,59.5 C 67,59.5 76,52.5 76,43 C 76,33.5 67,26 56,26 Z"/>
<g class="mug">
<g class="eyes">
<path class="face" d="M 44.5,41.5 Q 47.5,37.8 50.5,41.5"/>
<path class="face" d="M 61.5,41.5 Q 64.5,37.8 67.5,41.5"/>
</g>
<path class="nose" d="M 54.6,45.6 Q 56,45.1 57.4,45.6 Q 57.2,47.4 56,48.2 Q 54.8,47.4 54.6,45.6 Z"/>
<path class="mouth" d="M 53.4,49.6 Q 56,51.8 58.6,49.6"/>
<ellipse class="blush" cx="41.5" cy="46.8" rx="3.4" ry="2"/>
<ellipse class="blush" cx="70.5" cy="46.8" rx="3.4" ry="2"/>
</g>
<path class="whisker" d="M 29.5,43.6 L 37.6,43"/>
<path class="whisker" d="M 29.5,47.4 L 37.6,47.8"/>
<path class="whisker" d="M 82.5,43.6 L 74.4,43"/>
<path class="whisker" d="M 82.5,47.4 L 74.4,47.8"/>
</g>
<ellipse class="paw paw-a" cx="47.5" cy="64" rx="4.6" ry="3.1"/>
<ellipse class="paw paw-b" cx="64.5" cy="64" rx="4.6" ry="3.1"/>
</g></g></g>`
}

function penguin(p: number): string {
  const id = `hud-p${hudSpriteSeq++}`
  const body = 'M 56,5 C 38,5 27,20 27,38 C 27,54 39,63 56,63 C 73,63 85,54 85,38 C 85,20 74,5 56,5 Z'
  const t1 = f(60 - 24 * p)
  const t2 = f(60 - 24 * p - 0.7)
  return `
<g class="figure"><g class="act"><g class="mv-fig">
<path class="flipper flip-l" d="M 30,34 C 24,38 22.5,46 25.5,52.5 C 26.6,54.8 29.4,54.5 30.4,51.6 C 31.8,47.5 31.4,41.5 32.6,38 Z"/>
<path class="flipper flip-r" d="M 82,34 C 88,38 89.5,46 86.5,52.5 C 85.4,54.8 82.6,54.5 81.6,51.6 C 80.2,47.5 80.6,41.5 79.4,38 Z"/>
<g class="foot-a"><ellipse class="foot" cx="45.5" cy="63.5" rx="5.8" ry="3"/><path class="toe" d="M 42.8,65.2 Q 45.5,66.4 48.2,65.2"/></g>
<g class="foot-b"><ellipse class="foot" cx="66.5" cy="63.5" rx="5.8" ry="3"/><path class="toe" d="M 63.8,65.2 Q 66.5,66.4 69.2,65.2"/></g>
<path class="body" d="${body}"/>
<ellipse class="belly" cx="56" cy="48" rx="16" ry="12"/>
<clipPath id="${id}a"><ellipse cx="56" cy="48" rx="16" ry="12"/></clipPath>
<clipPath id="${id}b"><path d="${body}"/></clipPath>
<g clip-path="url(#${id}a)">
  <path class="belly-fill" d="M 38,${t1} Q 42,${t2} 46,${t1} T 54,${t1} T 62,${t1} T 70,${t1} T 78,${t1} L 78,62 L 38,62 Z"/>
  <path class="fill-edge" d="M 38,${t1} Q 42,${t2} 46,${t1} T 54,${t1} T 62,${t1} T 70,${t1} T 78,${t1}"/>
</g>
<ellipse class="belly-line" cx="56" cy="48" rx="16" ry="12"/>
<g clip-path="url(#${id}b)">
  <path class="cap" d="M 27,34 C 27,17 40,5 56,5 C 72,5 85,17 85,34 C 81,25 73,21 66,21 C 61,21 58.5,23.4 56,23.4 C 53.5,23.4 51,21 46,21 C 39,21 31,25 27,34 Z"/>
</g>
<path class="body-line" d="${body}"/>
<g class="eyes">
  <circle class="eye-dot" cx="46.5" cy="27" r="1.4"/>
  <circle class="eye-dot" cx="65.5" cy="27" r="1.4"/>
</g>
<path class="beak" d="M 56,28 L 59.4,30.8 Q 56,33.2 52.6,30.8 Z"/>
<ellipse class="blush" cx="40.5" cy="31" rx="3" ry="1.8"/>
<ellipse class="blush" cx="71.5" cy="31" rx="3" ry="1.8"/>
</g></g></g>`
}

function snail(p: number): string {
  const id = `hud-s${hudSpriteSeq++}`
  const t1 = f(46.4 - 42.8 * p)
  const t2 = f(46.4 - 42.8 * p - 0.8)
  const spiral = spiralPath(53, 26, 1.2, 17.5, 2.35, -0.9)
  // 身体（颈 + 触角）与壳分家：伸脖子、缩壳都是身体在刚体壳下面动。
  return `
<g class="figure"><g class="act"><g transform="translate(0,10)">
<g class="mv-body">
<path class="body" d="M 14,47.6 C 14,44.8 18.4,43 23.6,43 L 75.6,43 C 77.2,38.6 80.4,34.8 84.4,32.2 C 87.8,29.8 92,29.6 95,31.6 C 98.4,33.8 99.6,37.8 98.6,42 C 97.4,46.8 92.8,50.6 86,51 L 24.4,51.2 C 18,51.2 14,50.2 14,47.6 Z"/>
<path class="mouth" d="M 88.4,40.8 Q 90.4,42.8 92.4,40.8"/>
<ellipse class="blush" cx="96.4" cy="39.2" rx="2.6" ry="1.5"/>
<g class="antennae">
<g class="stalk-l">
<path class="stalk" d="M 87.6,32.8 C 85.8,28.2 84.6,23.8 84,21.2"/>
<g class="eyes">
  <circle class="eye-dot" cx="83.7" cy="20.2" r="1.9"/>
  <circle class="eye-glint" cx="84.1" cy="19.6" r=".55"/>
</g>
</g>
<g class="stalk-r">
<path class="stalk" d="M 94,31.8 C 95.8,27.8 97.2,24.8 98,22.9"/>
<g class="eyes">
  <circle class="eye-dot" cx="98.3" cy="21.9" r="1.9"/>
  <circle class="eye-glint" cx="98.7" cy="21.3" r=".55"/>
</g>
</g>
</g>
</g>
<g class="mv-shell">
<circle class="shell" cx="51" cy="25" r="21.5"/>
<clipPath id="${id}a"><circle cx="51" cy="25" r="21.5"/></clipPath>
<g clip-path="url(#${id}a)">
  <path class="shell-fill" d="M 28,${t1} Q 32,${t2} 36,${t1} T 44,${t1} T 52,${t1} T 60,${t1} T 68,${t1} T 76,${t1} L 76,48 L 28,48 Z"/>
  <path class="fill-edge" d="M 28,${t1} Q 32,${t2} 36,${t1} T 44,${t1} T 52,${t1} T 60,${t1} T 68,${t1} T 76,${t1}"/>
</g>
<path class="spiral" d="${spiral}"/>
<circle class="shell-line" cx="51" cy="25" r="21.5"/>
</g>
</g></g></g>`
}

const empty = computed(() => props.state.placeholder !== null)
const low = computed(() => !empty.value && props.state.severe)
const primaryP = computed(() => clamp01((props.state.primary?.percentage ?? 0) / 100))
const secondaryP = computed(() =>
  props.state.secondary ? clamp01(props.state.secondary.percentage / 100) : null,
)

const charMarkup = computed(() => {
  const p = primaryP.value
  const shape = props.state.skin === 'penguin'
    ? penguin(p)
    : props.state.skin === 'snail'
      ? snail(p)
      : bunny(p, secondaryP.value)
  // v-html 在 HTML 里必须自带 svg 根，否则 path 只是惰性节点，什么也不画。
  return `<svg viewBox="0 0 112 66" xmlns="http://www.w3.org/2000/svg" focusable="false">${shape}</svg>`
})

/** 动作名与时长同源：class 决定放哪组 keyframes，--mv-dur 决定它多长。 */
const moveClass = computed(() => (props.move ? `mv-${props.move}` : ''))
const motionVars = computed<Record<string, string>>(() => ({
  '--mv-dur': `${props.move ? HUD_MOVE_MS[props.move] : 0}ms`,
}))

const primaryValue = computed(() => {
  const primary = props.state.primary
  if (!primary) return ''
  return primary.unlimited ? '∞' : `${primary.percentage}%`
})

const secondaryValue = computed(() => {
  const secondary = props.state.secondary
  if (secondary?.unlimited) return '∞'
  return secondary ? `${secondary.percentage}%` : ''
})

const promptTone = computed(() => {
  if (props.state.severe) return 'danger'
  if (props.state.stale || props.state.placeholderAlert) return 'warn'
  return ''
})

const statusMessage = computed(() => {
  if (props.state.stale) return '刷新失败 · 缓存'
  if (props.state.placeholderAlert) return props.state.placeholder || '额度获取失败'
  if (!props.state.severe) return ''
  const remaining = props.state.primary?.percentage
  if (remaining === 0) return '额度已用尽'
  return remaining != null && remaining <= 9 ? '额度偏低' : '额度暂不可用'
})

const todayValue = computed(() =>
  props.state.today ? formatTokenCount(props.state.today.tokens) : '—'
)

const costValue = computed(() =>
  props.state.today ? formatHudCost(props.state.today.costUsd) : '未定价'
)
</script>

<template>
  <div
    class="sprite"
    :class="[{ empty, low, expanded, idle, react }, moveClass]"
    :style="motionVars"
    :data-theme="state.theme.base === 'dark' ? 'ink' : 'paper'"
    :data-kind="state.skin"
    aria-hidden="true"
  >
    <span v-if="pinned" class="pin-mark" title="已固定展开，可在挂件设置中取消"><AppIcon name="pin" :size="12" /></span>
    <span v-if="promptTone && !expanded" class="status-mark" :class="promptTone" :title="statusMessage">!</span>
    <div class="tag" v-if="expanded">
      <div class="hud-row1">
        <span v-if="promptTone" class="prompt" :class="promptTone" :title="statusMessage">!</span>
        <template v-if="state.primary">
          <span class="k">{{ state.primary.label }}</span>
          <b class="v">{{ primaryValue }}</b>
          <template v-if="state.secondary">
            <span class="k week">{{ state.secondary.label }}</span>
            <b class="v2">{{ secondaryValue }}</b>
          </template>
          <i class="caret" :class="promptTone"></i>
        </template>
        <span v-else class="placeholder">{{ state.placeholder }}</span>
      </div>
      <div class="hud-row2">
        <b :class="state.today ? 'tok' : 'none'">{{ todayValue }}</b>
        <span class="unit">tok</span>
      </div>
      <div class="hud-row3">
        <span v-if="statusMessage" class="status-text" :class="promptTone" :title="`${statusMessage}；${costValue}`">{{ statusMessage }}</span>
        <span v-else class="est">{{ costValue }}</span>
        <span class="open" aria-hidden="true">↗</span>
      </div>
    </div>
    <div class="char" v-html="charMarkup" />
  </div>
</template>

<style scoped>
.sprite { position: relative; width: 128px; height: 66px; color: var(--text); }
.sprite.expanded { height: 136px; }
.pin-mark, .status-mark {
  position: absolute; top: 4px; right: 2px; z-index: 4;
  display: grid; place-items: center; width: 18px; height: 18px;
  border-radius: 50%; background: var(--panel-bg); color: var(--text-brand);
  border: 1px solid var(--border);
}
.status-mark { left: 2px; right: auto; font-size: 12px; font-weight: 700; }
.status-mark.danger, .status-text.danger { color: var(--danger); }
.status-mark.warn, .status-text.warn { color: var(--warning); }
.char {
  position: absolute; left: 50%; top: 0; width: 112px; height: 66px; margin-left: -56px;
  z-index: 3; pointer-events: none;
  filter: drop-shadow(0 2px 2px rgb(0 0 0 / 14%));
}
.sprite[data-theme="ink"] .char { filter: drop-shadow(0 2px 4px rgb(0 0 0 / 45%)); }
.char :deep(svg) { display: block; width: 112px; height: 66px; overflow: visible; }

.sprite :deep(.ear),
.sprite :deep(.head),
.sprite :deep(.body),
.sprite :deep(.shell),
.sprite :deep(.paw),
.sprite :deep(.flipper),
.sprite :deep(.belly) { fill: #f6f2e7; stroke: #24262b; stroke-width: 1.2; stroke-linejoin: round; }
.sprite :deep(.belly) { fill: #fbf7ee; stroke-width: .9; opacity: 1; }
.sprite :deep(.ear-inner) { fill: #efe4d4; }
.sprite :deep(.ear-fill) { fill: var(--accent); }
.sprite :deep(.ear-fill.week) { fill: color-mix(in srgb, var(--accent) 66%, #f6f2e7); }
.sprite[data-theme="ink"] :deep(.ear-fill.week) { fill: color-mix(in srgb, var(--accent) 68%, #24262b); }
.sprite.low :deep(.ear-fill.primary) { fill: #e08079; }
.sprite :deep(.belly-fill),
.sprite :deep(.shell-fill) { fill: var(--accent); }
.sprite.low :deep(.belly-fill),
.sprite.low :deep(.shell-fill) { fill: #e08079; }
.sprite :deep(.fill-edge) {
  fill: none; stroke: color-mix(in srgb, var(--accent) 68%, #24262b); stroke-width: .8; opacity: .9;
}
.sprite.low :deep(.fill-edge) { stroke: #b85a52; }
.sprite :deep(.fill-edge.week) { stroke: color-mix(in srgb, var(--accent) 45%, #24262b); opacity: .55; }

.sprite :deep(.face) { fill: none; stroke: #24262b; stroke-width: 1.2; stroke-linecap: round; }
.sprite :deep(.nose) { fill: #24262b; opacity: .82; }
.sprite :deep(.mouth) {
  fill: none; stroke: #24262b; stroke-width: .8; stroke-linecap: round; opacity: .75;
}
.sprite :deep(.whisker) {
  fill: none; stroke: #24262b; stroke-width: .55; stroke-linecap: round; opacity: .3;
}
.sprite :deep(.blush) { fill: var(--danger); opacity: .2; }
.sprite :deep(.beak),
.sprite :deep(.foot) { fill: var(--warning); stroke: #24262b; stroke-width: .65; stroke-linejoin: round; }
.sprite :deep(.toe) { fill: none; stroke: #24262b; stroke-width: .55; stroke-linecap: round; opacity: .35; }
.sprite :deep(.cap),
.sprite :deep(.flipper) { fill: #24262b; }
.sprite :deep(.stalk) { fill: none; stroke: #24262b; stroke-width: .9; stroke-linecap: round; }
.sprite :deep(.eye-dot) { fill: #24262b; }
.sprite :deep(.spiral) {
  fill: none; stroke: #24262b; stroke-width: .8; stroke-linecap: round; opacity: .5;
}
.sprite :deep(.ground) { fill: #24262b; opacity: .1; }
.sprite[data-theme="ink"] :deep(.ground) { opacity: .22; }
.sprite :deep(.belly-line),
.sprite :deep(.shell-line),
.sprite :deep(.body-line) { fill: none; stroke: #24262b; stroke-width: .9; stroke-linejoin: round; }
.sprite :deep(.body-line),
.sprite :deep(.shell-line) { stroke-width: 1.2; }
.sprite :deep(.eye-glint) { fill: #f6f2e7; opacity: .9; }
.sprite[data-theme="ink"] :deep(.cap),
.sprite[data-theme="ink"] :deep(.flipper) {
  stroke: color-mix(in srgb, var(--text) 38%, #24262b); stroke-width: .7;
}

.sprite.empty :deep(.ear),
.sprite.empty :deep(.head),
.sprite.empty :deep(.body),
.sprite.empty :deep(.shell),
.sprite.empty :deep(.paw),
.sprite.empty :deep(.flipper),
.sprite.empty :deep(.belly) {
  fill: none; stroke: var(--text-muted); stroke-width: 1; stroke-dasharray: 2.4 2.2;
}
.sprite.empty :deep(.cap),
.sprite.empty :deep(.ear-inner),
.sprite.empty :deep(.ear-fill),
.sprite.empty :deep(.belly-fill),
.sprite.empty :deep(.shell-fill),
.sprite.empty :deep(.fill-edge),
.sprite.empty :deep(.face),
.sprite.empty :deep(.nose),
.sprite.empty :deep(.mouth),
.sprite.empty :deep(.whisker),
.sprite.empty :deep(.blush),
.sprite.empty :deep(.beak),
.sprite.empty :deep(.foot),
.sprite.empty :deep(.toe),
.sprite.empty :deep(.stalk),
.sprite.empty :deep(.eye-dot),
.sprite.empty :deep(.spiral),
.sprite.empty :deep(.ground),
.sprite.empty :deep(.belly-line),
.sprite.empty :deep(.shell-line),
.sprite.empty :deep(.body-line),
.sprite.empty :deep(.eye-glint) { display: none; }
.sprite.empty .char { filter: none; }

/* 分层各占一个 transform：.figure 呼吸/摇摆 → .act 触发位移 → 耳摆 → 耳抽 → 眼眨。
   同一元素挂两条 transform 动画只会互相覆盖，所以一层一个 <g>。 */
.sprite.idle :deep(.figure) {
  transform-box: fill-box; transform-origin: 50% 100%;
  animation: hud-breathe 3.4s ease-in-out infinite;
}
.sprite.idle[data-kind="penguin"] :deep(.figure) { animation-name: hud-idle-waddle; animation-duration: 2.9s; }
.sprite.idle[data-kind="snail"] :deep(.figure) { animation-duration: 4.6s; }
.sprite.idle :deep(.eyes) {
  transform-box: fill-box; transform-origin: center;
  animation: hud-blink 5.6s ease-in-out infinite;
}
.sprite.idle[data-kind="penguin"] :deep(.eyes) { animation-duration: 6.7s; }
.sprite.idle[data-kind="snail"] :deep(.eyes) { animation-duration: 4.9s; }
.sprite.idle :deep(.ear-l),
.sprite.idle :deep(.ear-r) {
  transform-box: fill-box;
  animation: hud-sway 3.1s ease-in-out infinite;
}
.sprite.idle :deep(.ear-l) { transform-origin: 86% 100%; }
.sprite.idle :deep(.ear-r) { transform-origin: 14% 100%; animation-delay: -1.6s; }
.sprite.idle :deep(.ear-flick) {
  transform-box: fill-box; transform-origin: 50% 100%;
  animation: hud-twitch 7.3s ease-in-out infinite;
}
.sprite.idle :deep(.ear-r .ear-flick) { animation-delay: -3.9s; }
.sprite.idle[data-kind="snail"] :deep(.antennae) {
  transform-box: fill-box; transform-origin: 50% 100%;
  animation: hud-sway 3.8s ease-in-out infinite;
}
/* 触发式：展开那一下小跳。面板本身仍不滑入、不淡入；点角色的回应是演下一手。 */
.sprite.react.expanded :deep(.act) {
  transform-box: fill-box; transform-origin: 50% 100%;
  animation: hud-hop .62s ease-out;
}

/* ── 招牌动作的槽位 ───────────────────────────────────────────────
   每个可动分组只留一条 transform 的命：呼吸在 .figure、触发在 .act、摆耳在 .ear-l、
   抽动在 .ear-flick，动作只挂中间新加的 .mv-*，谁也不顶谁。
   时长由 --mv-dur 给，它和动作 class 在同一次补丁里落地。 */
.sprite :deep(.mv-fig),
.sprite :deep(.mv-head),
.sprite :deep(.mug),
.sprite :deep(.mv-ear-l),
.sprite :deep(.mv-ear-r),
.sprite :deep(.mv-shell),
.sprite :deep(.stalk-l),
.sprite :deep(.stalk-r),
.sprite :deep(.mv-body),
.sprite :deep(.flip-l),
.sprite :deep(.flip-r),
.sprite :deep(.paw-a),
.sprite :deep(.paw-b),
.sprite :deep(.foot-a),
.sprite :deep(.foot-b) { transform-box: fill-box; }
.sprite :deep(.mv-fig),
.sprite :deep(.mv-head),
.sprite :deep(.mug),
.sprite :deep(.mv-shell),
.sprite :deep(.stalk-l),
.sprite :deep(.stalk-r),
.sprite :deep(.paw-a),
.sprite :deep(.paw-b),
.sprite :deep(.foot-a),
.sprite :deep(.foot-b) { transform-origin: 50% 100%; }
.sprite :deep(.mv-ear-l) { transform-origin: 78% 100%; }
.sprite :deep(.mv-ear-r) { transform-origin: 22% 100%; }
/* 壳是刚体、身体绕尾根伸缩：轴钉在左下，脖子才不会被拉伸带走 */
.sprite :deep(.mv-body) { transform-origin: 0% 100%; }
.sprite :deep(.flip-l) { transform-origin: 62% 6%; }
.sprite :deep(.flip-r) { transform-origin: 38% 6%; }

.sprite.mv-bow :deep(.mv-fig) { animation: hud-bow-fig var(--mv-dur) ease-in-out; }
.sprite.mv-bow :deep(.mv-head) { animation: hud-bow-head var(--mv-dur) ease-in-out; }
.sprite.mv-bow :deep(.mug) { animation: hud-bow-mug var(--mv-dur) ease-in-out; }
.sprite.mv-bow :deep(.mv-ear-l) { animation: hud-bow-ear-l var(--mv-dur) ease-in-out; }
.sprite.mv-bow :deep(.mv-ear-r) { animation: hud-bow-ear-r var(--mv-dur) ease-in-out; }
.sprite.mv-fold :deep(.mv-fig) { animation: hud-fold-fig var(--mv-dur) ease-in-out; }
.sprite.mv-fold :deep(.mv-ear-l) { animation: hud-fold-ear-l var(--mv-dur) ease-in-out; }
.sprite.mv-fold :deep(.mv-ear-r) { animation: hud-fold-ear-r var(--mv-dur) ease-in-out; }
.sprite.mv-flap :deep(.mv-fig) { animation: hud-flap-fig var(--mv-dur) ease-in-out; }
.sprite.mv-flap :deep(.flip-l) { animation: hud-flap-l var(--mv-dur) ease-in-out; }
.sprite.mv-flap :deep(.flip-r) { animation: hud-flap-r var(--mv-dur) ease-in-out; }
.sprite.mv-stretch :deep(.mv-body) { animation: hud-stretch-body var(--mv-dur) ease-in-out; }
.sprite.mv-stretch :deep(.stalk-l) { animation: hud-stretch-l var(--mv-dur) ease-in-out; }
.sprite.mv-stretch :deep(.stalk-r) { animation: hud-stretch-r var(--mv-dur) ease-in-out; }
.sprite.mv-tangle :deep(.mv-body) { animation: hud-tangle-body var(--mv-dur) ease-in-out; }
.sprite.mv-tangle :deep(.stalk-l) { animation: hud-tangle-l var(--mv-dur) ease-in-out; }
.sprite.mv-tangle :deep(.stalk-r) { animation: hud-tangle-r var(--mv-dur) ease-in-out; }
.sprite.mv-tuck :deep(.mv-body) { animation: hud-tuck-body var(--mv-dur) ease-in-out; }
.sprite.mv-tuck :deep(.mv-shell) { animation: hud-tuck-shell var(--mv-dur) ease-in-out; }
.sprite.mv-tuck :deep(.stalk-l) { animation: hud-tuck-l var(--mv-dur) ease-in-out; }
.sprite.mv-tuck :deep(.stalk-r) { animation: hud-tuck-r var(--mv-dur) ease-in-out; }

/* 新 4 条：hop / waddle / peek / doze */
.sprite.mv-hop :deep(.mv-fig) { animation: hud-hop-fig var(--mv-dur) ease-in-out; }
.sprite.mv-hop :deep(.mv-head) { animation: hud-hop-head var(--mv-dur) ease-in-out; }
.sprite.mv-hop :deep(.mug) { animation: hud-hop-mug var(--mv-dur) ease-in-out; }
.sprite.mv-hop :deep(.mv-ear-l) { animation: hud-hop-ear-l var(--mv-dur) ease-in-out; }
.sprite.mv-hop :deep(.mv-ear-r) { animation: hud-hop-ear-r var(--mv-dur) ease-in-out; }
.sprite.mv-hop :deep(.paw-a) { animation: hud-hop-paw-a var(--mv-dur) ease-out; }
.sprite.mv-hop :deep(.paw-b) { animation: hud-hop-paw-b var(--mv-dur) ease-out; }

.sprite.mv-waddle :deep(.mv-fig) { animation: hud-waddle-fig var(--mv-dur) ease-in-out; }
.sprite.mv-waddle :deep(.foot-a) { animation: hud-waddle-foot-a var(--mv-dur) ease-in-out; }
.sprite.mv-waddle :deep(.foot-b) { animation: hud-waddle-foot-b var(--mv-dur) ease-in-out; }
.sprite.mv-waddle :deep(.flip-l) { animation: hud-waddle-flip-l var(--mv-dur) ease-in-out; }
.sprite.mv-waddle :deep(.flip-r) { animation: hud-waddle-flip-r var(--mv-dur) ease-in-out; }

.sprite.mv-peek :deep(.mv-fig) { animation: hud-peek-fig var(--mv-dur) ease-in-out; }
.sprite.idle.mv-peek :deep(.eyes) { animation: hud-peek-eyes var(--mv-dur) ease-in-out; }
.sprite.mv-peek :deep(.flip-r) { animation: hud-peek-flip var(--mv-dur) ease-in-out; }

/* 打盹要压住呼吸、眨眼与耳摆 / 触角摆：眼睛闭上停住才是「睡着」，
   留一道常驻微动就变成「闭眼但还在喘」。 */
.sprite.idle.mv-doze :deep(.figure),
.sprite.idle.mv-doze :deep(.ear-l),
.sprite.idle.mv-doze :deep(.ear-r),
.sprite.idle.mv-doze :deep(.ear-flick),
.sprite.idle.mv-doze :deep(.antennae) { animation: none; }
.sprite.idle.mv-doze :deep(.eyes) { animation: hud-doze-eyes var(--mv-dur) ease-in-out; }
.sprite.mv-doze[data-kind="bunny"] :deep(.mv-fig) { animation: hud-doze-bunny-fig var(--mv-dur) ease-in-out; }
.sprite.mv-doze[data-kind="bunny"] :deep(.mv-head) { animation: hud-doze-bunny-head var(--mv-dur) ease-in-out; }
.sprite.mv-doze[data-kind="bunny"] :deep(.mug) { animation: hud-doze-bunny-mug var(--mv-dur) ease-in-out; }
.sprite.mv-doze[data-kind="bunny"] :deep(.mv-ear-l) { animation: hud-doze-bunny-ear-l var(--mv-dur) ease-in-out; }
.sprite.mv-doze[data-kind="bunny"] :deep(.mv-ear-r) { animation: hud-doze-bunny-ear-r var(--mv-dur) ease-in-out; }
.sprite.mv-doze[data-kind="penguin"] :deep(.mv-fig) { animation: hud-doze-penguin-fig var(--mv-dur) ease-in-out; }
.sprite.mv-doze[data-kind="penguin"] :deep(.flip-l) { animation: hud-doze-penguin-flip-l var(--mv-dur) ease-in-out; }
.sprite.mv-doze[data-kind="penguin"] :deep(.flip-r) { animation: hud-doze-penguin-flip-r var(--mv-dur) ease-in-out; }
.sprite.mv-doze[data-kind="snail"] :deep(.mv-body) { animation: hud-doze-snail-body var(--mv-dur) ease-in-out; }
.sprite.mv-doze[data-kind="snail"] :deep(.stalk-l) { animation: hud-doze-snail-stalk-l var(--mv-dur) ease-in-out; }
.sprite.mv-doze[data-kind="snail"] :deep(.stalk-r) { animation: hud-doze-snail-stalk-r var(--mv-dur) ease-in-out; }
.sprite.mv-doze[data-kind="snail"] :deep(.mv-shell) { animation: hud-doze-snail-shell var(--mv-dur) ease-in-out; }

@keyframes hud-breathe {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-1.2px) scale(1.008); }
}
@keyframes hud-idle-waddle {
  0%, 100% { transform: rotate(-1.6deg); }
  50% { transform: rotate(1.6deg); }
}
@keyframes hud-sway {
  0%, 100% { transform: rotate(-2.8deg); }
  50% { transform: rotate(2.4deg); }
}
@keyframes hud-blink {
  0%, 4.5%, 7.5%, 51%, 54%, 100% { transform: scaleY(1); }
  6%, 52.5% { transform: scaleY(.06); }
}
@keyframes hud-twitch {
  0%, 62%, 74%, 100% { transform: rotate(0); }
  66% { transform: rotate(-7deg); }
  70% { transform: rotate(2.5deg); }
}
@keyframes hud-hop {
  0%, 100% { transform: translateY(0); }
  26% { transform: translateY(-3.4px); }
  54% { transform: translateY(.7px); }
  76% { transform: translateY(-1.2px); }
}
/* 鞠躬：头沉 1px 带走耳朵，五官在头里再下滑 3.4px——正视图的「低头」只有这一种画法，
   头的轮廓自己不动，人才不会散。 */
@keyframes hud-bow-fig {
  0%, 100% { transform: scaleY(1); }
  44% { transform: scaleY(.985); }
}
@keyframes hud-bow-head {
  0%, 20%, 100% { transform: translateY(0); }
  44% { transform: translateY(1px); }
  66% { transform: translateY(.9px); }
}
@keyframes hud-bow-mug {
  0%, 100% { transform: translateY(0); }
  20% { transform: translateY(1.6px); }
  44% { transform: translateY(3.4px); }
  66% { transform: translateY(3.2px); }
}
@keyframes hud-bow-ear-l {
  0%, 100% { transform: rotate(0); }
  20% { transform: rotate(-6deg); }
  44% { transform: rotate(-14deg); }
  66% { transform: rotate(-11deg); }
}
@keyframes hud-bow-ear-r {
  0%, 100% { transform: rotate(0); }
  20% { transform: rotate(6deg); }
  44% { transform: rotate(14deg); }
  66% { transform: rotate(11deg); }
}
/* 卷耳朵：右耳绕耳根折过去（转 + 压扁），折的是耳朵整组，额度条跟着一起折 */
@keyframes hud-fold-fig {
  0%, 100% { transform: rotate(0); }
  26% { transform: rotate(-1.2deg); }
  48% { transform: rotate(-1.6deg); }
  72% { transform: rotate(-.8deg); }
}
@keyframes hud-fold-ear-l {
  0%, 100% { transform: rotate(0); }
  26% { transform: rotate(-5deg); }
  48% { transform: rotate(-8deg); }
  72% { transform: rotate(-6deg); }
}
@keyframes hud-fold-ear-r {
  0%, 100% { transform: rotate(0) scaleY(1); }
  26% { transform: rotate(20deg) scaleY(.97); }
  48% { transform: rotate(56deg) scaleY(.88); }
  72% { transform: rotate(52deg) scaleY(.9); }
}
/* 摆翅膀：两鳍绕肩反相摆，鳍尖甩出身体轮廓之外才像手；身子倒过去做配平。
   两拍、每拍约 350ms，落翅停一下再收——三拍连放就成了抖。 */
@keyframes hud-flap-fig {
  0%, 100% { transform: rotate(0); }
  18% { transform: rotate(1.4deg); }
  44% { transform: rotate(-1.2deg); }
  60% { transform: rotate(.8deg); }
  76% { transform: rotate(-.7deg); }
  88% { transform: rotate(.3deg); }
}
@keyframes hud-flap-l {
  0%, 100% { transform: rotate(0); }
  18% { transform: rotate(-30deg); }
  44% { transform: rotate(24deg); }
  60% { transform: rotate(-22deg); }
  76% { transform: rotate(18deg); }
  88% { transform: rotate(-6deg); }
}
@keyframes hud-flap-r {
  0%, 100% { transform: rotate(0); }
  18% { transform: rotate(28deg); }
  44% { transform: rotate(-26deg); }
  60% { transform: rotate(20deg); }
  76% { transform: rotate(-16deg); }
  88% { transform: rotate(5deg); }
}
/* 伸脖子：壳不动，身体绕尾根右移，触角尖超前一点 */
@keyframes hud-stretch-body {
  0%, 100% { transform: translateX(0) scaleX(1); }
  34% { transform: translateX(4px) scaleX(1); }
  58% { transform: translateX(5px) scaleX(1.02); }
}
@keyframes hud-stretch-l {
  0%, 100% { transform: rotate(0); }
  34% { transform: rotate(-6deg); }
  58% { transform: rotate(-9deg); }
}
@keyframes hud-stretch-r {
  0%, 100% { transform: rotate(0); }
  34% { transform: rotate(6deg); }
  58% { transform: rotate(9deg); }
}
@keyframes hud-tangle-body {
  0%, 74%, 100% { transform: translateX(0); }
  52% { transform: translateX(-1px); }
}
@keyframes hud-tangle-l {
  0%, 100% { transform: rotate(0); }
  30% { transform: rotate(20deg); }
  52% { transform: rotate(30deg); }
  74% { transform: rotate(12deg); }
}
@keyframes hud-tangle-r {
  0%, 100% { transform: rotate(0); }
  30% { transform: rotate(-20deg); }
  52% { transform: rotate(-30deg); }
  74% { transform: rotate(-12deg); }
}
/* 缩壳：头颈连着触角整个退到壳后，壳向右下压合盖住脸，缩住停 0.9s 再探出来。
   原来只把身体横移 4.5px、壳压扁 2%，在那个尺寸上等于没动。 */
@keyframes hud-tuck-body {
  0%, 100% { transform: translateX(0) scaleX(1) scaleY(1); }
  12% { transform: translateX(-2px) scaleX(.97) scaleY(.98); }
  26%, 74% { transform: translateX(-10px) scaleX(.84) scaleY(.88); }
  86% { transform: translateX(-2px) scaleX(.97) scaleY(.985); }
}
@keyframes hud-tuck-shell {
  0%, 100% { transform: translate(0, 0) scale(1); }
  26%, 74% { transform: translate(4px, 2px) scale(1.03); }
  86% { transform: translate(1px, .5px) scale(1.005); }
}
@keyframes hud-tuck-l {
  0%, 100% { transform: rotate(0); }
  12% { transform: rotate(-22deg); }
  26%, 74% { transform: rotate(-76deg); }
  86% { transform: rotate(-14deg); }
}
@keyframes hud-tuck-r {
  0%, 100% { transform: rotate(0); }
  12% { transform: rotate(18deg); }
  26%, 74% { transform: rotate(66deg); }
  86% { transform: rotate(12deg); }
}

/* 兔子原地蹦：窗内上下各留 4px，离地 3px 是硬顶；耳尖滞后下坠，别顶到窗沿。 */
@keyframes hud-hop-fig {
  0%, 100% { transform: translateY(0) scaleY(1); }
  9% { transform: translateY(.6px) scaleY(.985); }
  17%, 21% { transform: translateY(1.5px) scaleY(.93); }
  30% { transform: translateY(-2.2px) scaleY(1.04); }
  39%, 45% { transform: translateY(-3px) scaleY(1.015); }
  56% { transform: translateY(.2px) scaleY(1); }
  63% { transform: translateY(1.5px) scaleY(.95); }
  74% { transform: translateY(-.7px) scaleY(1.012); }
  84% { transform: translateY(.25px) scaleY(.997); }
}
@keyframes hud-hop-head {
  0%, 100% { transform: translateY(0) rotate(0); }
  17%, 21% { transform: translateY(1px) rotate(1.2deg); }
  30% { transform: translateY(-.8px) rotate(-1.6deg); }
  39%, 45% { transform: translateY(-.5px) rotate(-1.2deg); }
  56% { transform: translateY(.5px) rotate(.8deg); }
  63% { transform: translateY(.8px) rotate(1deg); }
  74% { transform: translateY(-.2px) rotate(0); }
}
@keyframes hud-hop-mug {
  0%, 100% { transform: translateY(0); }
  17%, 21% { transform: translateY(.8px); }
  30% { transform: translateY(-.6px); }
  39%, 45% { transform: translateY(-.4px); }
  56% { transform: translateY(.4px); }
  63% { transform: translateY(.5px); }
  74% { transform: translateY(-.1px); }
}
@keyframes hud-hop-ear-l {
  0%, 100% { transform: translateY(0) rotate(0) scaleY(1); }
  17%, 21% { transform: translateY(-.4px) rotate(-3deg) scaleY(.97); }
  30% { transform: translateY(3px) rotate(4.5deg) scaleY(1.02); }
  39%, 45% { transform: translateY(3.4px) rotate(6deg) scaleY(1.01); }
  56% { transform: translateY(.6px) rotate(-2deg) scaleY(1); }
  63% { transform: translateY(.9px) rotate(2deg) scaleY(1); }
  74% { transform: translateY(-.3px) rotate(-1deg) scaleY(1); }
  84% { transform: translateY(.1px) rotate(0) scaleY(1); }
}
@keyframes hud-hop-ear-r {
  0%, 100% { transform: translateY(0) rotate(0) scaleY(1); }
  17%, 21% { transform: translateY(-.4px) rotate(3deg) scaleY(.97); }
  30% { transform: translateY(3px) rotate(-4.5deg) scaleY(1.02); }
  39%, 45% { transform: translateY(3.4px) rotate(-6deg) scaleY(1.01); }
  56% { transform: translateY(.6px) rotate(2deg) scaleY(1); }
  63% { transform: translateY(.9px) rotate(-2deg) scaleY(1); }
  74% { transform: translateY(-.3px) rotate(1deg) scaleY(1); }
  84% { transform: translateY(.1px) rotate(0) scaleY(1); }
}
@keyframes hud-hop-paw-a {
  0%, 100% { transform: translateY(0) rotate(0); }
  21% { transform: translateY(0) rotate(0); }
  30% { transform: translateY(-2.4px) rotate(-6deg); }
  39%, 45% { transform: translateY(-2.6px) rotate(-7deg); }
  54% { transform: translateY(-.4px) rotate(-2deg); }
  60% { transform: translateY(.5px) rotate(0); }
  72% { transform: translateY(0) rotate(0); }
}
@keyframes hud-hop-paw-b {
  0%, 100% { transform: translateY(0) rotate(0); }
  23% { transform: translateY(0) rotate(0); }
  32% { transform: translateY(-2px) rotate(5deg); }
  39%, 47% { transform: translateY(-2.3px) rotate(6deg); }
  56% { transform: translateY(-.3px) rotate(2deg); }
  62% { transform: translateY(.4px) rotate(0); }
  74% { transform: translateY(0) rotate(0); }
}

/* 企鹅原地摇摆步：重心左右倒，支撑脚不动、另一只脚离地，鳍反相配平 */
@keyframes hud-waddle-fig {
  0%, 100% { transform: rotate(0); }
  10% { transform: rotate(-3.6deg); }
  26% { transform: rotate(0); }
  40% { transform: rotate(3.6deg); }
  56% { transform: rotate(0); }
  70% { transform: rotate(-3.2deg); }
  86% { transform: rotate(2.4deg); }
}
@keyframes hud-waddle-foot-a {
  0%, 100% { transform: translateY(0) rotate(0); }
  32%, 48% { transform: translateY(-1.8px) rotate(-5deg); }
  60% { transform: translateY(0) rotate(0); }
  84% { transform: translateY(-.8px) rotate(3deg); }
}
@keyframes hud-waddle-foot-b {
  0%, 100% { transform: translateY(0) rotate(0); }
  6%, 22% { transform: translateY(-1.8px) rotate(5deg); }
  34% { transform: translateY(0) rotate(0); }
  66%, 80% { transform: translateY(-1.2px) rotate(-3deg); }
  90% { transform: translateY(0) rotate(0); }
}
@keyframes hud-waddle-flip-l {
  0%, 100% { transform: rotate(0); }
  10% { transform: rotate(10deg); }
  40% { transform: rotate(-8deg); }
  70% { transform: rotate(8deg); }
}
@keyframes hud-waddle-flip-r {
  0%, 100% { transform: rotate(0); }
  10% { transform: rotate(-8deg); }
  40% { transform: rotate(10deg); }
  70% { transform: rotate(-7deg); }
}

/* 企鹅侧身探头：没有可分离的头，好奇只能靠整个身子加眼睛先走 */
@keyframes hud-peek-fig {
  0%, 100% { transform: rotate(0) translateX(0); }
  16% { transform: rotate(-1.2deg) translateX(-.4px); }
  38%, 64% { transform: rotate(6deg) translateX(1px); }
  84% { transform: rotate(-1deg) translateX(-.2px); }
}
@keyframes hud-peek-eyes {
  0%, 100% { transform: translateX(0); }
  28%, 70% { transform: translateX(1.3px); }
}
@keyframes hud-peek-flip {
  0%, 100% { transform: rotate(0); }
  38%, 64% { transform: rotate(-14deg); }
}

/* 打盹：闭眼、头身下沉；兔耳垂、企鹅鳍落、蜗牛触角收，停 2.4s 后苏醒回弹 */
@keyframes hud-doze-eyes {
  0%, 6%, 94%, 100% { transform: scaleY(1); }
  12%, 88% { transform: scaleY(.06); }
}
@keyframes hud-doze-bunny-fig {
  0%, 100% { transform: translateY(0) scaleY(1); }
  12%, 88% { transform: translateY(1.2px) scaleY(.985); }
}
@keyframes hud-doze-bunny-head {
  0%, 100% { transform: translateY(0) rotate(0); }
  18%, 84% { transform: translateY(1.4px) rotate(-1deg); }
}
@keyframes hud-doze-bunny-mug {
  0%, 100% { transform: translateY(0); }
  18%, 84% { transform: translateY(.6px); }
}
@keyframes hud-doze-bunny-ear-l {
  0%, 100% { transform: rotate(0) scaleY(1); }
  22%, 82% { transform: rotate(-9deg) scaleY(.98); }
}
@keyframes hud-doze-bunny-ear-r {
  0%, 100% { transform: rotate(0) scaleY(1); }
  22%, 82% { transform: rotate(9deg) scaleY(.98); }
}
@keyframes hud-doze-penguin-fig {
  0%, 100% { transform: translateY(0) scaleY(1) rotate(0); }
  14%, 86% { transform: translateY(1.2px) scaleY(.985) rotate(-.6deg); }
}
@keyframes hud-doze-penguin-flip-l {
  0%, 100% { transform: rotate(0); }
  20%, 82% { transform: rotate(7deg); }
}
@keyframes hud-doze-penguin-flip-r {
  0%, 100% { transform: rotate(0); }
  20%, 82% { transform: rotate(-7deg); }
}
@keyframes hud-doze-snail-body {
  0%, 100% { transform: translateX(0) scaleY(1); }
  14%, 86% { transform: translateX(-1.2px) scaleY(.99); }
}
@keyframes hud-doze-snail-stalk-l {
  0%, 100% { transform: rotate(0); }
  20%, 82% { transform: rotate(-18deg); }
}
@keyframes hud-doze-snail-stalk-r {
  0%, 100% { transform: rotate(0); }
  20%, 82% { transform: rotate(18deg); }
}
@keyframes hud-doze-snail-shell {
  0%, 100% { transform: scaleY(1); }
  20%, 82% { transform: scaleY(.995); }
}
@media (prefers-reduced-motion: reduce) {
  .sprite.idle :deep(.figure),
  .sprite.idle :deep(.eyes),
  .sprite.idle :deep(.ear-l),
  .sprite.idle :deep(.ear-r),
  .sprite.idle :deep(.ear-flick),
  .sprite.idle :deep(.antennae),
  .sprite.react :deep(.act),
  .sprite.react :deep(.eyes) { animation: none; }
  /* 招牌动作与打盹不用管：JS 那道闸门在 reduce 下根本不会挂 mv-* 的 class。 */
}

.tag {
  position: absolute; left: 50%; top: 62px; width: 128px; height: 74px; margin-left: -64px;
  padding: 8px;
  background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px;
  box-shadow: 0 8px 16px -16px rgb(0 0 0 / 50%), 0 1px 1px -1px rgb(0 0 0 / 10%);
  white-space: nowrap; z-index: 2;
}
.sprite[data-theme="ink"] .tag {
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 4%), 0 10px 20px -16px rgb(0 0 0 / 95%);
}
.hud-row1 { display: flex; align-items: baseline; justify-content: center; gap: 4px; height: 18px; }
.prompt {
  font-family: var(--font-mono); font-size: 11px; font-weight: 700; line-height: 1; color: var(--accent);
}
.prompt.danger { color: var(--danger); }
.prompt.warn { color: var(--warning); }
.hud-row1 .k { font-size: 11px; line-height: 1; color: var(--text-secondary); }
.hud-row1 .v {
  font-family: var(--font-mono); font-size: 16px; font-weight: 600; line-height: 1;
  letter-spacing: -.02em; color: var(--text);
}
.hud-row1 .week { margin-left: 4px; }
.hud-row1 .v2 {
  font-family: var(--font-mono); font-size: 12px; font-weight: 600; line-height: 1;
  letter-spacing: -.01em; color: var(--text);
}
.hud-row1 .placeholder {
  min-width: 0; overflow: hidden; text-overflow: ellipsis;
  font-size: 12px; line-height: 1; color: var(--text-secondary);
}
.caret { align-self: center; width: 2px; height: 11px; margin-left: 1px; background: var(--accent); opacity: .85; }
.caret.danger { background: var(--danger); }
.caret.warn { background: var(--warning); }
/* 三行都是居中读数：单位与 ↗ 贴住自己的数字，不拿 margin-left:auto 撑到右缘——
   真实值（`9.76亿`）比 mock 短得多，撑开就是三行中间一片空洞。 */
.hud-row2 {
  margin-top: 6px; display: flex; align-items: baseline; justify-content: center; gap: 3px; height: 15px;
  font-size: 11px; line-height: 1; color: var(--text-secondary);
}
.hud-row2 .tok {
  min-width: 0; overflow: hidden; text-overflow: ellipsis;
  font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--text);
}
.hud-row2 .unit { font-family: var(--font-mono); font-size: 10px; color: var(--text-secondary); }
.hud-row2 .none { font-family: var(--font-mono); font-size: 13px; color: var(--text-secondary); }
.hud-row3 {
  margin-top: 4px; display: flex; align-items: baseline; justify-content: center; gap: 4px; height: 13px;
  font-size: 11px; line-height: 1; color: var(--text-secondary);
}
.hud-row3 .est {
  min-width: 0; overflow: hidden; text-overflow: ellipsis;
  font-family: var(--font-mono); font-size: 12px; font-weight: 600;
  color: var(--text);
}
.status-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 11px; }
.hud-row3 .open { font-size: 11px; line-height: 1; color: var(--accent); }
</style>
