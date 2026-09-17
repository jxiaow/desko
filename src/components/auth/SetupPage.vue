<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '../../stores/auth'

const emit = defineEmits<{ setupComplete: [] }>()
const { setupMasterPassword } = useAuthStore()

const setupPwd = ref('')
const setupPwd2 = ref('')
const setupErr = ref('')

const doSetup = async () => {
  setupErr.value = ''
  if (setupPwd.value.length < 6) {
    setupErr.value = '主密码至少需要 6 位'
    return
  }
  if (setupPwd.value !== setupPwd2.value) {
    setupErr.value = '两次输入的密码不一致'
    return
  }
  try {
    await setupMasterPassword(setupPwd.value)
    emit('setupComplete')
  } catch (e: any) {
    setupErr.value = e.message || '设置失败'
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-logo">
        <svg viewBox="0 0 124 124" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="deskoGradientSetup" x1="32" y1="24" x2="95" y2="108" gradientUnits="userSpaceOnUse">
              <stop offset="0" stop-color="#6366f1"/>
              <stop offset="0.48" stop-color="#4f46e5"/>
              <stop offset="1" stop-color="#4338ca"/>
            </linearGradient>
          </defs>
          <path d="M94 35 L51 49 C47.8 50.1 46 52.4 46 56 L46 98 C33.7 91.0 26 77.9 26 63 C26 40.9 43.9 23 66 23 C73.5 23 80.2 24.8 85.9 28.1 L94 35 Z" fill="url(#deskoGradientSetup)"/>
          <path d="M97 40 L65 51.8 C63 52.5 62 54.0 62 56.2 L62 105.5 C62 107.8 63.8 109.2 66 108.4 L95 98 C97.0 97.3 98 95.8 98 93.6 L98 42.5 C98 41.2 97.7 40.5 97 40 Z" fill="url(#deskoGradientSetup)"/>
          <circle cx="75" cy="79" r="5" fill="#FFFFFF"/>
        </svg>
      </div>
      <h2 class="auth-title">欢迎使用 Desko</h2>
      <p class="auth-subtitle">首次使用，请设置主密码</p>
      <input
        class="auth-input"
        type="password"
        v-model="setupPwd"
        placeholder="主密码（至少6位）"
        autofocus
      />
      <input
        class="auth-input"
        type="password"
        v-model="setupPwd2"
        placeholder="确认主密码"
        style="margin-top: var(--space-3)"
        @keyup.enter="doSetup"
      />
      <p v-if="setupErr" class="auth-error">{{ setupErr }}</p>
      <button class="auth-btn" @click="doSetup">确 定</button>
      <p class="auth-tip">主密码用于加密所有保存的密码，请牢记！忘记密码将无法恢复数据。</p>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 0;
  background: var(--bg);
}

.auth-card {
  background: var(--panel-bg);
  border-radius: var(--radius-lg);
  padding: var(--space-8) var(--space-8);
  width: 400px;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border);
}

.auth-logo {
  width: 56px;
  height: 56px;
  margin: 0 auto var(--space-4);
}

.auth-logo svg {
  width: 100%;
  height: 100%;
}

.auth-title {
  text-align: center;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin-bottom: var(--space-2);
  color: var(--text);
}

.auth-subtitle {
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: var(--space-6);
}

.auth-input {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 13px;
  outline: none;
  transition: all var(--transition);
  background: var(--bg);
  font-family: inherit;
}

.auth-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
  background: var(--panel-bg);
}

.auth-btn {
  width: 100%;
  padding: 12px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  margin-top: var(--space-4);
  transition: all var(--transition);
  font-family: inherit;
}

.auth-btn:hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.auth-btn:active {
  transform: translateY(0);
}

.auth-error {
  color: var(--danger);
  font-size: 12px;
  margin-top: var(--space-3);
  text-align: center;
}

.auth-tip {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: var(--space-3);
  text-align: center;
  line-height: 1.5;
}
</style>
