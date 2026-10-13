<script setup lang="ts">
import BrandLogo from '../shared/BrandLogo.vue'
import AmbientBackground from '../shared/AmbientBackground.vue'
import AppIcon from '../shared/AppIcon.vue'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useAuthStore } from '../../stores/auth'

const emit = defineEmits<{ unlockComplete: [] }>()
const { unlock } = useAuthStore()

const unlockPwd = ref('')
const unlockErr = ref('')
const stackEl = ref<HTMLElement | null>(null)
const revealed = ref(false)

const onUnlockSuccess = () => {
  emit('unlockComplete')
}

const quotes = [
  '生活不止眼前的苟且，还有诗和远方',
  '愿你出走半生，归来仍是少年',
  '人生没有白走的路，每一步都算数',
  '做你害怕做的事，恐惧就会消失',
  '慢慢来，比较快',
  '星光不问赶路人，时光不负有心人',
  '所有的努力，都是为了遇见更好的自己',
  '你若盛开，蝴蝶自来',
  '不积跬步，无以至千里',
  '心若向阳，无畏悲伤',
]

const quoteIndex = ref(Math.floor(Math.random() * quotes.length))
/** pending = 新一句还没上台（字符停在隐态），in/out 决定往哪个方向补间 */
const quotePhase = ref<'pending' | 'in' | 'out'>('pending')
const currentQuote = ref(quotes[quoteIndex.value])
/** inline-block 会把纯空格折掉，占位符得用不换行空格 */
const quoteChars = computed(() =>
  [...currentQuote.value].map((c) => (c === ' ' ? '\u00A0' : c)))
let quoteTimer: number | null = null
let quoteSwap: number | null = null

const enterQuote = () => {
  nextTick(() => requestAnimationFrame(() => requestAnimationFrame(() => { quotePhase.value = 'in' })))
}

/** 逐字错峰换句：旧句 12ms/字离场，新句重挂后 24ms/字进场 */
const rotateQuote = () => {
  if (quotePhase.value !== 'in') return
  quotePhase.value = 'out'
  quoteSwap = window.setTimeout(() => {
    quoteIndex.value = (quoteIndex.value + 1) % quotes.length
    currentQuote.value = quotes[quoteIndex.value]
    quotePhase.value = 'pending'
    enterQuote()
  }, 340)
}

/** 报错时整条内容流 X 轴轻晃（0.35s）；WAAPI 直接驱动，不重建 DOM，输入焦点不丢 */
const shake = () => {
  stackEl.value?.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-5px)' },
      { transform: 'translateX(4px)' },
      { transform: 'translateX(-3px)' },
      { transform: 'translateX(2px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 350, easing: 'cubic-bezier(0.36, 0.07, 0.19, 0.97)' },
  )
}

const doUnlock = async () => {
  unlockErr.value = ''
  try {
    await unlock(unlockPwd.value, onUnlockSuccess)
  } catch (e: any) {
    const message = String(e?.message ?? e)
    unlockErr.value = message === '密码错误' ? '主密码错误，请重试' : message
    shake()
  }
}

onMounted(() => {
  enterQuote()
  quoteTimer = window.setInterval(rotateQuote, 10000)
})

onUnmounted(() => {
  if (quoteTimer) clearInterval(quoteTimer)
  if (quoteSwap) clearTimeout(quoteSwap)
})
</script>

<template>
  <div class="unlock-page">
    <AmbientBackground />

    <main class="unlock-canvas">
      <!-- 题词海报在上、300px 锁块在下，两层合成后整体视口居中 -->
      <div class="lock-stage">
        <header class="lock-masthead">
          <p class="masthead-line" aria-hidden="true">
            <span
              v-for="(ch, i) in quoteChars"
              :key="`${quoteIndex}-${i}`"
              class="quote-ch"
              :class="quotePhase"
              :style="{ transitionDelay: `${quotePhase === 'out' ? i * 12 : i * 24}ms` }"
            >{{ ch }}</span>
          </p>
        </header>

        <section class="lock-stack" ref="stackEl">
        <div class="lock-tile"><BrandLogo /></div>
        <h1 class="lock-title">Desko</h1>

        <form class="lock-form" @submit.prevent="doUnlock">
          <div class="unlock-field">
            <AppIcon class="unlock-field-icon" name="lock" :size="16" />
            <input
              class="unlock-input"
              :type="revealed ? 'text' : 'password'"
              v-model="unlockPwd"
              placeholder="输入主密码解锁"
              @input="unlockErr = ''"
              @keyup.enter="doUnlock"
              autofocus
            />
            <button
              class="reveal-btn"
              type="button"
              :title="revealed ? '隐藏密码' : '显示密码'"
              :aria-label="revealed ? '隐藏密码' : '显示密码'"
              @click="revealed = !revealed"
            >
              <AppIcon :name="revealed ? 'eyeOff' : 'eye'" :size="15" />
            </button>
            <button class="unlock-btn" type="submit" title="解锁" aria-label="解锁">
              <AppIcon name="arrowRight" :size="13" />
            </button>
          </div>

          <!-- 防跳动错误槽：20px 定高，只切透明度 -->
          <div class="unlock-error-slot" :class="{ 'is-active': !!unlockErr }" aria-live="polite">
            <span class="unlock-error">{{ unlockErr }}</span>
          </div>
        </form>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.unlock-page {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-lock);
}

/* ---------- 内容流：题词 + 锁块合成一体，视口真居中 ---------- */
.unlock-canvas {
  position: relative;
  z-index: 10;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lock-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 34px;
}

/* ---------- 题词海报：古典衬线、字距拉开、逐字错峰 ---------- */
.lock-masthead {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 90vw;
  text-align: center;
}

.masthead-line {
  position: relative;
  font-family: 'Songti SC', 'Source Han Serif SC', 'Noto Serif CJK SC', SimSun, serif;
  font-size: clamp(22px, 3vw, 32px);
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.22em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
  min-height: 1.4em;
}

/* 逐字错峰：字符停在隐态，等 .in 上台；错峰时长由内联 transitionDelay 给 */
.quote-ch {
  display: inline-block;
  opacity: 0;
  transform: translateY(6px);
  filter: blur(2px);
  transition:
    opacity 0.45s cubic-bezier(0.2, 0.9, 0.3, 1),
    transform 0.45s cubic-bezier(0.2, 0.9, 0.3, 1),
    filter 0.45s ease;
}
.quote-ch.in {
  opacity: 1;
  transform: translateY(0);
  filter: blur(0);
}
.quote-ch.out {
  opacity: 0;
  transform: translateY(-6px);
  filter: blur(2px);
}

/* ---------- 锁块：300px 黄金聚焦宽度 ---------- */
.lock-stack {
  width: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* ---------- Logo 徽标底座 ---------- */
.lock-tile {
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  border-radius: 14px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

/* BrandLogo viewBox 自带 ~40% 留白，38px 才能让可见图形达 26px 档 */
.lock-tile svg { width: 38px; height: 38px; }

/* ---------- 应用标题 ---------- */
.lock-title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
  margin-bottom: 22px;
}

.lock-form { width: 100%; }

/* ---------- 输入控件组 ---------- */
.unlock-field {
  position: relative;
  width: 100%;
  height: 40px;
  display: flex;
  align-items: center;
}

.unlock-field-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--text-faint);
  pointer-events: none;
}

.unlock-input {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 0 62px 0 36px;
  border: 1px solid var(--border);
  /* 输入框走 --radius(10px)，与首启建码页同源；--radius-md 是 12px 的卡片档 */
  border-radius: var(--radius);
  font-size: var(--text-sm);
  font-family: inherit;
  color: var(--text);
  background: var(--bg-surface);
  outline: none;
  transition: border-color var(--transition), box-shadow var(--transition);
}

.unlock-input::placeholder { color: var(--text-muted); }

/* WebView2 注入的原生显隐/清除按钮：暗黑下几乎不可见，藏掉换自绘 */
.unlock-input::-ms-reveal,
.unlock-input::-ms-clear {
  display: none;
}

.reveal-btn {
  position: absolute;
  right: 33px;
  top: 50%;
  transform: translateY(-50%);
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-ib);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--transition), background-color var(--transition);
}

.reveal-btn:hover {
  color: var(--text);
  background: var(--hover);
}

/* 激活态：边框恒 1px 仅换色，外叠 8% 弥散光晕，禁止实心 ring 加粗 */
.unlock-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 8%, transparent);
}

/* 图标排在 input 之前，点亮只能从容器往下够 */
.unlock-field:focus-within .unlock-field-icon {
  color: var(--accent);
}

.unlock-btn {
  position: absolute;
  right: 5px;
  top: 50%;
  transform: translateY(-50%);
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--accent-on);
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: background-color var(--transition);
}

.unlock-btn svg { width: 13px; height: 13px; }

.unlock-btn:hover { background: var(--accent-hover); }

.unlock-btn:active { background: var(--accent-active); }

/* ---------- 报错占位槽：定高零跳动 ---------- */
.unlock-error-slot {
  width: 100%;
  height: 20px;
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--transition);
}

.unlock-error-slot.is-active {
  opacity: 1;
  pointer-events: auto;
}

.unlock-error {
  font-size: var(--text-xs);
  color: var(--danger);
  white-space: nowrap;
}
</style>
