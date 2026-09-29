<script setup lang="ts">
import BrandLogo from '../shared/BrandLogo.vue'
import AppIcon from '../shared/AppIcon.vue'
import { ref, onMounted, onUnmounted } from 'vue'
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
const currentQuote = ref(quotes[quoteIndex.value])
let quoteTimer: number | null = null

const rotateQuote = () => {
  quoteIndex.value = (quoteIndex.value + 1) % quotes.length
  currentQuote.value = quotes[quoteIndex.value]
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
    { duration: 350, easing: 'ease-out' },
  )
}

const doUnlock = async () => {
  unlockErr.value = ''
  try {
    await unlock(unlockPwd.value, onUnlockSuccess)
  } catch (e: any) {
    unlockErr.value = '主密码错误，请重试'
    shake()
  }
}

onMounted(() => {
  quoteTimer = window.setInterval(rotateQuote, 10000)
})

onUnmounted(() => {
  if (quoteTimer) clearInterval(quoteTimer)
})
</script>

<template>
  <div class="unlock-page">
    <!-- 微光画布层 -->
    <div class="unlock-bg" aria-hidden="true"></div>

    <!-- 居中无卡片内容流 -->
    <main class="unlock-canvas">
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

        <footer class="lock-motto">
          <i class="motto-dot" aria-hidden="true"></i>
          <p class="motto-text" :key="quoteIndex">{{ currentQuote }}</p>
          <i class="motto-dot" aria-hidden="true"></i>
        </footer>
      </section>
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
  background: var(--bg);
}

/* ---------- 画布：中心偏上漫反射微光 ---------- */
.unlock-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(110% 85% at 50% 40%, var(--lock-wash-b) 0%, var(--bg) 65%),
    var(--bg);
}

/* ---------- 居中内容流：无卡片，300px 黄金聚焦宽度，垂直真居中 ---------- */
.unlock-canvas {
  position: relative;
  z-index: 10;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

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
  background: var(--panel-bg);
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
  margin-bottom: 24px;
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
  left: 12px;
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
  border-radius: var(--radius-md);
  font-size: 13px;
  font-family: inherit;
  color: var(--text);
  background: var(--panel-bg);
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
  font-size: 12px;
  color: var(--danger);
  white-space: nowrap;
}

/* ---------- 座右铭：紧贴内容流，不落窗口底 ---------- */
.lock-motto {
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  max-width: 100%;
}

.motto-dot {
  flex-shrink: 0;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 30%, transparent);
}

.motto-text {
  font-size: 12px;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
  animation: motto-fade 0.4s ease both;
}

@keyframes motto-fade {
  from { opacity: 0; }
}
</style>
