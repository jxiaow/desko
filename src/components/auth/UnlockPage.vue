<script setup lang="ts">
import BrandLogo from '../shared/BrandLogo.vue'
import AmbientBackground from '../shared/AmbientBackground.vue'
import AppIcon from '../shared/AppIcon.vue'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { isWebRuntime } from '../../services/runtime'
import { useAuthStore } from '../../stores/auth'

const emit = defineEmits<{ unlockComplete: [] }>()
const { unlock } = useAuthStore()
const webRuntime = isWebRuntime()

const unlockPwd = ref('')
const unlockErr = ref('')
const unlocking = ref(false)
const stackEl = ref<HTMLElement | null>(null)
const revealed = ref(false)

const onUnlockSuccess = () => {
  emit('unlockComplete')
}

// ---------- 实时时钟与日期 ----------
const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
const currentTime = ref('')
const currentDate = ref('')
let clockTimer: number | null = null

const updateClock = () => {
  const now = new Date()
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const month = now.getMonth() + 1
  const date = now.getDate()
  const day = weekDays[now.getDay()]
  currentTime.value = `${hours}:${minutes}`
  currentDate.value = `${month}月${date}日 ${day}`
}

// ---------- 题词库与逐字错峰补间 ----------
const quotes = [
  '博观而约取，厚积而薄发。',
  '山重水复疑无路，柳暗花明又一村。',
  '流水不争先，争的是滔滔不绝。',
  '静以修身，俭以养德，非淡泊无以明志，非宁静无以致远。',
  '星光不问赶路人，时光不负有心人。',
  '日日行，不怕千万里；常常做，不怕千万事。',
  '行远自迩，登高自卑。',
  '不弛于空想，不骛于虚声。',
  '慢品人间烟火气，闲观万事岁月长。',
  '知不足而奋进，望远山而力行。',
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

/** 报错时解锁中枢 X 轴轻晃（0.35s）；WAAPI 直接驱动，不重建 DOM，输入焦点不丢 */
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
  if (unlocking.value) return
  unlocking.value = true
  unlockErr.value = ''
  try {
    await unlock(unlockPwd.value, onUnlockSuccess)
  } catch (e: any) {
    const message = String(e?.message ?? e)
    unlockErr.value = message === '密码错误' ? '主密码错误，请重试' : message
    shake()
  } finally {
    unlocking.value = false
  }
}

onMounted(() => {
  updateClock()
  clockTimer = window.setInterval(updateClock, 1000)
  enterQuote()
  quoteTimer = window.setInterval(rotateQuote, 10000)
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
  if (quoteTimer) clearInterval(quoteTimer)
  if (quoteSwap) clearTimeout(quoteSwap)
})
</script>

<template>
  <div class="unlock-page">
    <AmbientBackground />

    <!-- 方案 A：Win11 纯粹无界流 (Cardless Flow) -->
    <main class="unlock-canvas">
      <div class="cardless-stack">
        <!-- 1. 顶部纯粹时间与日期 -->
        <header class="cl-clock-group">
          <div class="cl-time" aria-label="当前时间">{{ currentTime }}</div>
          <div class="cl-date">{{ currentDate }}</div>
        </header>

        <!-- 2. 中部解锁中枢（无卡片包裹，直接浮于底板） -->
        <section class="cl-auth-group" ref="stackEl">
          <div class="lock-tile">
            <BrandLogo />
          </div>

          <h1 class="lock-title">{{ webRuntime ? 'Desko 登录' : 'Desko 工作台' }}</h1>
          <p class="lock-sub">{{ webRuntime ? '输入桌面主密码以继续' : '输入主密码解锁' }}</p>

          <form class="lock-form" :aria-busy="unlocking" @submit.prevent="doUnlock">
            <div class="unlock-field">
              <AppIcon class="unlock-field-icon" name="lock" :size="16" />
              <input
                class="unlock-input"
                :type="revealed ? 'text' : 'password'"
                v-model="unlockPwd"
                :placeholder="webRuntime ? '输入桌面主密码' : '输入主密码解锁'"
                aria-label="主密码"
                autocomplete="current-password"
                @input="unlockErr = ''"
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
              <button
                class="unlock-btn"
                type="submit"
                :title="webRuntime ? '登录' : '解锁'"
                :aria-label="webRuntime ? '登录' : '解锁'"
                :disabled="unlocking"
              >
                <AppIcon name="arrowRight" :size="13" />
              </button>
            </div>

            <!-- 防跳动错误槽：20px 定高，只切透明度 -->
            <div class="unlock-error-slot" :class="{ 'is-active': !!unlockErr }" aria-live="polite">
              <span class="unlock-error">{{ unlockErr }}</span>
            </div>
          </form>
        </section>

        <!-- 3. 底部静雅题词（逐字错峰换句） -->
        <footer class="cl-quote-box">
          <p class="masthead-line" aria-hidden="true">
            <span
              v-for="(ch, i) in quoteChars"
              :key="`${quoteIndex}-${i}`"
              class="quote-ch"
              :class="quotePhase"
              :style="{ transitionDelay: `${quotePhase === 'out' ? i * 12 : i * 24}ms` }"
            >{{ ch }}</span>
          </p>
        </footer>
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
  background: var(--bg-lock, var(--bg));
}

/* 视口全景居中画布 */
.unlock-canvas {
  position: relative;
  z-index: 10;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

/* 纯粹无界纵向流：各层紧凑排列 */
.cardless-stack {
  width: 100%;
  max-width: min(520px, 92vw);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

/* 1. 时钟组 */
.cl-clock-group {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.cl-time {
  font-family: var(--font-display, inherit);
  font-size: clamp(56px, 6vw, 68px);
  font-weight: 280;
  letter-spacing: -0.03em;
  line-height: 1;
  color: var(--text);
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
}

.cl-date {
  font-size: 14px;
  font-weight: 450;
  color: var(--text-secondary, var(--text-muted));
  margin-top: 6px;
  letter-spacing: 0.02em;
}

/* 2. 解锁中枢：距上方时钟仅 28px，收束在 290px 黄金聚焦宽 */
.cl-auth-group {
  margin-top: 28px;
  width: 100%;
  max-width: 290px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.lock-tile {
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  border-radius: 15px;
  background: var(--bg-surface, var(--panel-bg, #ffffff));
  border: 1px solid var(--border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
}

.lock-tile svg {
  width: 36px;
  height: 36px;
}

.lock-title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
  margin-bottom: 2px;
}

.lock-sub {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 18px;
}

.lock-form {
  width: 100%;
}

/* 输入控件组 */
.unlock-field {
  position: relative;
  width: 100%;
  height: 38px;
  display: flex;
  align-items: center;
}

.unlock-field-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--text-faint, var(--text-muted));
  pointer-events: none;
}

.unlock-input {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 0 68px 0 36px;
  border: 1px solid var(--border);
  border-radius: var(--radius, 8px);
  font-size: var(--text-sm, 13px);
  font-family: inherit;
  color: var(--text);
  background: var(--bg-surface, #ffffff);
  outline: none;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
  transition: border-color var(--transition, 0.15s), box-shadow var(--transition, 0.15s), background-color var(--transition, 0.15s);
}

.unlock-input::placeholder {
  color: var(--text-muted);
}

.unlock-input::-ms-reveal,
.unlock-input::-ms-clear {
  display: none;
}

.unlock-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
}

.unlock-field:focus-within .unlock-field-icon {
  color: var(--accent);
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
  border-radius: var(--radius-ib, 4px);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--transition, 0.15s), background-color var(--transition, 0.15s);
}

.reveal-btn:hover {
  color: var(--text);
  background: var(--hover, rgba(0, 0, 0, 0.04));
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
  border-radius: var(--radius-sm, 6px);
  background: var(--accent);
  color: var(--accent-on, #ffffff);
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  transition: background-color var(--transition, 0.15s), transform 0.1s;
}

.unlock-btn svg {
  width: 13px;
  height: 13px;
}

.unlock-btn:hover {
  background: var(--accent-hover);
  transform: translateY(-50%) scale(1.04);
}

.unlock-btn:active {
  background: var(--accent-active);
  transform: translateY(-50%) scale(0.96);
}

/* 报错占位槽：定高零跳动 */
.unlock-error-slot {
  width: 100%;
  height: 20px;
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--transition, 0.15s);
}

.unlock-error-slot.is-active {
  opacity: 1;
  pointer-events: auto;
}

.unlock-error {
  font-size: var(--text-xs, 12px);
  color: var(--danger, #ef4444);
  white-space: nowrap;
}

/* 3. 底部题词：贴在输入框下方 22px，支持长句优雅折行，杜绝截断 */
.cl-quote-box {
  margin-top: 22px;
  width: 100%;
  max-width: min(480px, 88vw);
  display: flex;
  justify-content: center;
  padding: 0 12px;
  box-sizing: border-box;
}

.masthead-line {
  position: relative;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 13.5px;
  font-weight: 400;
  line-height: 1.7;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  text-align: center;
  text-wrap: balance;
  word-break: break-word;
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
}

/* 逐字错峰动画 */
.quote-ch {
  display: inline-block;
  opacity: 0;
  transform: translateY(5px);
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
  transform: translateY(-5px);
  filter: blur(2px);
}
</style>
