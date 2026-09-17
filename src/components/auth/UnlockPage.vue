<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '../../stores/auth'

const emit = defineEmits<{ unlockComplete: [] }>()
const { unlock } = useAuthStore()

const unlockPwd = ref('')
const unlockErr = ref('')

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

const doUnlock = async () => {
  unlockErr.value = ''
  try {
    await unlock(unlockPwd.value, onUnlockSuccess)
  } catch (e: any) {
    unlockErr.value = '主密码错误，请重试'
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
    <div class="unlock-bg-orbs">
      <div class="unlock-orb unlock-orb-1"></div>
      <div class="unlock-orb unlock-orb-2"></div>
    </div>
    <div class="unlock-content">
      <div class="unlock-logo">
        <svg viewBox="0 0 124 124" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="deskoGradientUnlock" x1="32" y1="24" x2="95" y2="108" gradientUnits="userSpaceOnUse">
              <stop offset="0" stop-color="#6366f1"/>
              <stop offset="0.48" stop-color="#4f46e5"/>
              <stop offset="1" stop-color="#4338ca"/>
            </linearGradient>
          </defs>
          <path d="M94 35 L51 49 C47.8 50.1 46 52.4 46 56 L46 98 C33.7 91.0 26 77.9 26 63 C26 40.9 43.9 23 66 23 C73.5 23 80.2 24.8 85.9 28.1 L94 35 Z" fill="url(#deskoGradientUnlock)"/>
          <path d="M97 40 L65 51.8 C63 52.5 62 54.0 62 56.2 L62 105.5 C62 107.8 63.8 109.2 66 108.4 L95 98 C97.0 97.3 98 95.8 98 93.6 L98 42.5 C98 41.2 97.7 40.5 97 40 Z" fill="url(#deskoGradientUnlock)"/>
          <circle cx="75" cy="79" r="5" fill="#FFFFFF"/>
        </svg>
      </div>
      <h1 class="unlock-title">Desko</h1>
      <div class="unlock-quote-area">
        <p class="unlock-quote-text" :key="quoteIndex">{{ currentQuote }}</p>
      </div>
      <div class="unlock-input-area">
        <div class="unlock-field">
          <svg class="unlock-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2.5"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <input
            class="unlock-input"
            type="password"
            v-model="unlockPwd"
            placeholder="输入密码解锁"
            @keyup.enter="doUnlock"
            autofocus
          />
        </div>
        <p v-if="unlockErr" class="unlock-error">{{ unlockErr }}</p>
        <button class="unlock-btn" @click="doUnlock">解锁</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.unlock-page {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 0;
  background: transparent;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.unlock-bg-orbs {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.unlock-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  will-change: transform;
}

.unlock-orb-1 {
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.08) 0%, transparent 70%);
  top: -20%;
  right: -15%;
  animation: unlock-drift-1 20s ease-in-out infinite;
}

.unlock-orb-2 {
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, rgba(139, 92, 246, 0.06) 0%, transparent 70%);
  bottom: -20%;
  left: -15%;
  animation: unlock-drift-2 25s ease-in-out infinite;
}

@keyframes unlock-drift-1 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(-30px, 20px) scale(1.05); }
}

@keyframes unlock-drift-2 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(20px, -15px) scale(1.03); }
}

.unlock-content {
  position: relative;
  z-index: 1;
  width: 320px;
  animation: unlock-content-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes unlock-content-in {
  from { opacity: 0; transform: translateY(20px); }
}

.unlock-logo {
  width: 64px;
  height: 64px;
  margin: 0 auto var(--space-4);
}

.unlock-logo svg {
  width: 100%;
  height: 100%;
}

.unlock-title {
  text-align: center;
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.02em;
  margin-bottom: var(--space-4);
}

.unlock-quote-area {
  margin-bottom: var(--space-6);
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.unlock-quote-text {
  font-size: 14px;
  font-weight: 400;
  line-height: 1.6;
  color: var(--text-secondary);
  margin: 0;
  text-align: center;
  animation: quote-fade-in 0.5s ease both;
}

@keyframes quote-fade-in {
  from { opacity: 0; transform: translateY(6px); }
}

.unlock-input-area {
  animation: unlock-stagger 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.15s both;
}

.unlock-field {
  position: relative;
  width: 100%;
  margin-bottom: var(--space-3);
}

.unlock-field-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  pointer-events: none;
  transition: color var(--transition);
}

.unlock-field:focus-within .unlock-field-icon {
  color: var(--accent);
}

.unlock-input {
  width: 100%;
  padding: 12px 14px 12px 40px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 400;
  outline: none;
  transition: all var(--transition);
  background: var(--panel-bg);
  color: var(--text);
  font-family: inherit;
}

.unlock-input::placeholder {
  color: var(--text-muted);
  font-weight: 400;
}

.unlock-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.unlock-btn {
  width: 100%;
  padding: 12px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition);
  font-family: inherit;
}

.unlock-btn:hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.unlock-btn:active {
  transform: translateY(0);
  box-shadow: var(--shadow-sm);
}

.unlock-error {
  color: var(--danger);
  font-size: 13px;
  font-weight: 500;
  margin-bottom: var(--space-3);
  animation: unlock-shake 0.4s ease;
}

@keyframes unlock-stagger {
  from { opacity: 0; transform: translateY(10px); }
}

@keyframes unlock-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-5px); }
  40% { transform: translateX(5px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(3px); }
}
</style>
