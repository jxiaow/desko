<script setup lang="ts">
import BrandLogo from '../shared/BrandLogo.vue'
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
    setupErr.value = '两次输入的主密码不一致'
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
        <BrandLogo />
      </div>
      <h2 class="auth-title">欢迎使用 Desko</h2>
      <p class="auth-subtitle">首次使用，请设置主密码</p>
      <input
        class="auth-input"
        type="password"
        v-model="setupPwd"
        placeholder="主密码（至少 6 位）"
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
      <button class="auth-btn" @click="doSetup">确定</button>
      <p class="auth-tip">主密码加密本机保存的全部数据，遗失后无法恢复。</p>
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
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: -0.02em;
  margin-bottom: var(--space-2);
  color: var(--text);
}

.auth-subtitle {
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin-bottom: var(--space-6);
}

.auth-input {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: var(--text-sm);
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
  color: var(--accent-on);
  border: none;
  border-radius: var(--radius);
  font-size: var(--text-base);
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
  font-size: var(--text-xs);
  margin-top: var(--space-3);
  text-align: center;
}

.auth-tip {
  font-size: var(--text-2xs);
  color: var(--text-muted);
  margin-top: var(--space-3);
  text-align: center;
  line-height: 1.5;
}
</style>
