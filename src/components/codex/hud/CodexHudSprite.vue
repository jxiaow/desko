<script lang="ts">
/** clipPath id 必须跨实例唯一：设置页三张预览会同时挂载 */
let hudSpriteSeq = 0
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { formatTokenCount } from '../../../utils/codexUsage'
import { formatHudCost, type CodexHudState } from '../../../utils/codexHud'

const props = defineProps<{
  state: CodexHudState
  expanded?: boolean
  /** 常驻微动（呼吸 / 摆耳 / 眨眼）：桌面窗口和设置页预览都传 */
  idle?: boolean
  /** 交互触发（展开小跳 / 点击眨眼）：只有桌面窗口传，预览不伪装成可交互 */
  react?: boolean
  poke?: boolean
  /** 巡游中该抬起的那只前爪；只有桌面窗口传 */
  lift?: '' | 'a' | 'b'
  /** 张望拍：耳朵朝行进方向前倾 */
  looking?: boolean
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
  return `
<g class="figure"><g class="act">
<g class="ear-l"><g class="ear-look"><g class="ear-flick">
<path class="ear" d="M 49,31 C 42,25 34,11 38,4.6 C 40.6,1.4 46,3.8 49.6,10.8 C 52.2,16 53,24.6 53.4,31 Z"/>
<path class="ear-inner" d="${innerL}"/>
<clipPath id="${id}a"><path d="${innerL}"/></clipPath>
<g clip-path="url(#${id}a)">
  <rect class="ear-fill primary" x="36" y="${lt}" width="18" height="${f(30 - Number(lt))}"/>
  <path class="fill-edge" d="M 38,${lt} L 52,${lt}"/>
</g>
</g></g></g>
<g class="ear-r"><g class="ear-look"><g class="ear-flick">
<path class="ear" d="M 63,31 C 70,25 78,11 74,4.6 C 71.4,1.4 66,3.8 62.4,10.8 C 59.8,16 59,24.6 58.6,31 Z"/>
<path class="ear-inner" d="${innerR}"/>
<clipPath id="${id}b"><path d="${innerR}"/></clipPath>
${w === null ? '' : `<g clip-path="url(#${id}b)">
  <rect class="ear-fill week" x="58" y="${rt}" width="18" height="${f(30 - Number(rt))}"/>
  <path class="fill-edge week" d="M 60,${rt} L 74,${rt}"/>
</g>`}
</g></g></g>
<path class="body" d="M 41,66 C 41,58.6 47.6,54.5 56,54.5 C 64.4,54.5 71,58.6 71,66 Z"/>
<path class="head" d="M 56,26 C 45,26 36,33.5 36,43 C 36,52.5 45,59.5 56,59.5 C 67,59.5 76,52.5 76,43 C 76,33.5 67,26 56,26 Z"/>
<g class="eyes">
<path class="face" d="M 44.5,41.5 Q 47.5,37.8 50.5,41.5"/>
<path class="face" d="M 61.5,41.5 Q 64.5,37.8 67.5,41.5"/>
</g>
<path class="nose" d="M 54.6,45.6 Q 56,45.1 57.4,45.6 Q 57.2,47.4 56,48.2 Q 54.8,47.4 54.6,45.6 Z"/>
<path class="mouth" d="M 53.4,49.6 Q 56,51.8 58.6,49.6"/>
<ellipse class="blush" cx="41.5" cy="46.8" rx="3.4" ry="2"/>
<ellipse class="blush" cx="70.5" cy="46.8" rx="3.4" ry="2"/>
<path class="whisker" d="M 29.5,43.6 L 37.6,43"/>
<path class="whisker" d="M 29.5,47.4 L 37.6,47.8"/>
<path class="whisker" d="M 82.5,43.6 L 74.4,43"/>
<path class="whisker" d="M 82.5,47.4 L 74.4,47.8"/>
<ellipse class="paw paw-a" cx="47.5" cy="64" rx="4.6" ry="3.1"/>
<ellipse class="paw paw-b" cx="64.5" cy="64" rx="4.6" ry="3.1"/>
</g></g>`
}

function penguin(p: number): string {
  const id = `hud-p${hudSpriteSeq++}`
  const body = 'M 56,5 C 38,5 27,20 27,38 C 27,54 39,63 56,63 C 73,63 85,54 85,38 C 85,20 74,5 56,5 Z'
  const t1 = f(60 - 24 * p)
  const t2 = f(60 - 24 * p - 0.7)
  return `
<g class="figure"><g class="act">
<path class="flipper" d="M 30,34 C 24,38 22.5,46 25.5,52.5 C 26.6,54.8 29.4,54.5 30.4,51.6 C 31.8,47.5 31.4,41.5 32.6,38 Z"/>
<path class="flipper" d="M 82,34 C 88,38 89.5,46 86.5,52.5 C 85.4,54.8 82.6,54.5 81.6,51.6 C 80.2,47.5 80.6,41.5 79.4,38 Z"/>
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
</g></g>`
}

function snail(p: number): string {
  const id = `hud-s${hudSpriteSeq++}`
  const t1 = f(46.4 - 42.8 * p)
  const t2 = f(46.4 - 42.8 * p - 0.8)
  const spiral = spiralPath(53, 26, 1.2, 17.5, 2.35, -0.9)
  return `
<g class="figure"><g class="act"><g transform="translate(0,10)">
<path class="body" d="M 14,47.6 C 14,44.8 18.4,43 23.6,43 L 75.6,43 C 77.2,38.6 80.4,34.8 84.4,32.2 C 87.8,29.8 92,29.6 95,31.6 C 98.4,33.8 99.6,37.8 98.6,42 C 97.4,46.8 92.8,50.6 86,51 L 24.4,51.2 C 18,51.2 14,50.2 14,47.6 Z"/>
<circle class="shell" cx="51" cy="25" r="21.5"/>
<clipPath id="${id}a"><circle cx="51" cy="25" r="21.5"/></clipPath>
<g clip-path="url(#${id}a)">
  <path class="shell-fill" d="M 28,${t1} Q 32,${t2} 36,${t1} T 44,${t1} T 52,${t1} T 60,${t1} T 68,${t1} T 76,${t1} L 76,48 L 28,48 Z"/>
  <path class="fill-edge" d="M 28,${t1} Q 32,${t2} 36,${t1} T 44,${t1} T 52,${t1} T 60,${t1} T 68,${t1} T 76,${t1}"/>
</g>
<path class="spiral" d="${spiral}"/>
<circle class="shell-line" cx="51" cy="25" r="21.5"/>
<g class="antennae">
<path class="stalk" d="M 87.6,32.8 C 85.8,28.2 84.6,23.8 84,21.2"/>
<path class="stalk" d="M 94,31.8 C 95.8,27.8 97.2,24.8 98,22.9"/>
<g class="eyes">
  <circle class="eye-dot" cx="83.7" cy="20.2" r="1.9"/>
  <circle class="eye-dot" cx="98.3" cy="21.9" r="1.9"/>
  <circle class="eye-glint" cx="84.1" cy="19.6" r=".55"/>
  <circle class="eye-glint" cx="98.7" cy="21.3" r=".55"/>
</g>
</g>
<path class="mouth" d="M 88.4,40.8 Q 90.4,42.8 92.4,40.8"/>
<ellipse class="blush" cx="96.4" cy="39.2" rx="2.6" ry="1.5"/>
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
    :class="{ empty, low, expanded, idle, react, poke, 'lift-a': lift === 'a', 'lift-b': lift === 'b', look: looking }"
    :data-theme="state.theme.base === 'dark' ? 'ink' : 'paper'"
    :data-kind="state.skin"
    aria-hidden="true"
  >
    <div class="tag" v-if="expanded">
      <div class="hud-row1">
        <span v-if="promptTone" class="prompt" :class="promptTone">!</span>
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
        <span class="est">{{ costValue }}</span>
        <span class="open" aria-hidden="true">↗</span>
      </div>
    </div>
    <div class="char" v-html="charMarkup" />
  </div>
</template>

<style scoped>
.sprite { position: relative; width: 128px; height: 66px; color: var(--text); }
.sprite.expanded { height: 136px; }
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
.sprite.idle[data-kind="penguin"] :deep(.figure) { animation-name: hud-waddle; animation-duration: 2.9s; }
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
/* 巡游：落脚与张望。两者都挂自己那一层、用 transition 跟着节拍走——
   做成 CSS 动画就得和 JS 的跨步对表，一旦漂拍就变成腿在动、身子不动。 */
.sprite :deep(.paw-a),
.sprite :deep(.paw-b),
.sprite :deep(.foot-a),
.sprite :deep(.foot-b) {
  transform-box: fill-box; transform-origin: 50% 100%;
  transition: transform 170ms ease-out;
}
.sprite.lift-a :deep(.paw-a),
.sprite.lift-a :deep(.foot-a),
.sprite.lift-b :deep(.paw-b),
.sprite.lift-b :deep(.foot-b) { transform: translateY(-1.2px) rotate(3deg); }
.sprite :deep(.ear-look) {
  transform-box: fill-box; transform-origin: 50% 100%;
  transition: transform 220ms ease-out;
}
/* 耳朵一律往「右」前倾：掉头时外层整只被 scaleX(-1) 翻过去，倾角自动跟上行进方向。 */
.sprite.look :deep(.ear-look) { transform: rotate(5deg); }
/* 触发式：展开那一下小跳、点角色那一下眨眼。面板本身仍不滑入、不淡入。 */
.sprite.react.expanded :deep(.act) {
  transform-box: fill-box; transform-origin: 50% 100%;
  animation: hud-hop .62s ease-out;
}
.sprite.react.poke :deep(.eyes) { animation: hud-wink .48s ease-in-out; }

@keyframes hud-breathe {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-1.2px) scale(1.008); }
}
@keyframes hud-waddle {
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
@keyframes hud-wink {
  0%, 100% { transform: scaleY(1); }
  42% { transform: scaleY(.06); }
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
.hud-row3 .open { font-size: 11px; line-height: 1; color: var(--accent); }
</style>
