<script setup lang="ts">
import BrandLogo from '../shared/BrandLogo.vue'
import AmbientBackground from '../shared/AmbientBackground.vue'
import AppIcon from '../shared/AppIcon.vue'
import { ref } from 'vue'
import { useAuthStore } from '../../stores/auth'

const emit = defineEmits<{ setupComplete: [] }>()
const { setupMasterPassword } = useAuthStore()

const setupPwd = ref('')
const setupPwd2 = ref('')
const setupErr = ref('')
const setupBusy = ref(false)
const revealPwd = ref(false)
const revealPwd2 = ref(false)

const doSetup = async () => {
  if (setupBusy.value) return
  setupErr.value = ''
  if (setupPwd.value.length < 6) {
    setupErr.value = '主密码至少需要 6 位'
    return
  }
  if (setupPwd.value !== setupPwd2.value) {
    setupErr.value = '两次输入的主密码不一致'
    return
  }
  setupBusy.value = true
  try {
    await setupMasterPassword(setupPwd.value)
    emit('setupComplete')
  } catch (e: any) {
    setupErr.value = e.message || '设置失败'
  } finally {
    setupBusy.value = false
  }
}
</script>

<template>
  <div class="setup-page">
    <AmbientBackground />

    <main class="setup-canvas">
      <div class="setup-stage">
        <header class="setup-masthead">
          <p class="masthead-line" aria-hidden="true">慢慢来，比较快</p>
        </header>

        <section class="setup-stack">
          <div class="setup-tile"><BrandLogo /></div>
          <h1 class="setup-title">欢迎使用 Desko</h1>

          <form class="setup-form" :aria-busy="setupBusy" @submit.prevent="doSetup">
            <div class="setup-field">
              <AppIcon class="setup-field-icon" name="lock" :size="16" />
              <input
                class="setup-input"
                :type="revealPwd ? 'text' : 'password'"
                v-model="setupPwd"
                placeholder="主密码（至少 6 位）"
                aria-label="主密码"
                autocomplete="new-password"
                @input="setupErr = ''"
                autofocus
              />
              <button
                class="reveal-btn"
                type="button"
                :title="revealPwd ? '隐藏密码' : '显示密码'"
                :aria-label="revealPwd ? '隐藏密码' : '显示密码'"
                @click="revealPwd = !revealPwd"
              >
                <AppIcon :name="revealPwd ? 'eyeOff' : 'eye'" :size="15" />
              </button>
            </div>

            <div class="setup-field">
              <AppIcon class="setup-field-icon" name="lock" :size="16" />
              <input
                class="setup-input"
                :type="revealPwd2 ? 'text' : 'password'"
                v-model="setupPwd2"
                placeholder="再次输入主密码"
                aria-label="再次输入主密码"
                autocomplete="new-password"
                @input="setupErr = ''"
                @keyup.enter="doSetup"
              />
              <button
                class="reveal-btn"
                type="button"
                :title="revealPwd2 ? '隐藏密码' : '显示密码'"
                :aria-label="revealPwd2 ? '隐藏密码' : '显示密码'"
                @click="revealPwd2 = !revealPwd2"
              >
                <AppIcon :name="revealPwd2 ? 'eyeOff' : 'eye'" :size="15" />
              </button>
              <button
                class="setup-submit"
                type="submit"
                title="设置主密码"
                aria-label="设置主密码"
                :disabled="setupBusy"
              >
                <AppIcon name="arrowRight" :size="13" />
              </button>
            </div>

            <div class="setup-error-slot" :class="{ 'is-active': !!setupErr }" aria-live="polite">
              <span class="setup-error">{{ setupErr }}</span>
            </div>
          </form>

          <p class="setup-note">加密保存全部数据，遗忘后无法找回。</p>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.setup-page {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-lock);
}

.setup-canvas {
  position: relative;
  z-index: 10;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.setup-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 34px;
}

.setup-masthead {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 90vw;
  text-align: center;
}

.masthead-line {
  font-family: 'Songti SC', 'Source Han Serif SC', 'Noto Serif CJK SC', SimSun, serif;
  font-size: clamp(22px, 3vw, 32px);
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.22em;
  white-space: nowrap;
  color: var(--text);
}

.setup-stack {
  width: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.setup-tile {
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

.setup-tile svg { width: 38px; height: 38px; }

.setup-title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
  margin-bottom: 22px;
}

.setup-form { width: 100%; }

.setup-field {
  position: relative;
  width: 100%;
  height: 40px;
  display: flex;
  align-items: center;
}

.setup-field + .setup-field { margin-top: 10px; }

.setup-field-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--text-faint);
  pointer-events: none;
}

.setup-input {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 0 62px 0 36px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: var(--text-sm);
  font-family: inherit;
  color: var(--text);
  background: var(--bg-surface);
  outline: none;
  transition: border-color var(--transition), box-shadow var(--transition);
}

.setup-input::placeholder { color: var(--text-muted); }

.setup-input::-ms-reveal,
.setup-input::-ms-clear {
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

.setup-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 8%, transparent);
}

.setup-field:focus-within .setup-field-icon {
  color: var(--accent);
}

.setup-submit {
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

.setup-submit svg { width: 13px; height: 13px; }

.setup-submit:hover:not(:disabled) { background: var(--accent-hover); }

.setup-submit:active:not(:disabled) { background: var(--accent-active); }

.setup-error-slot {
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

.setup-error-slot.is-active {
  opacity: 1;
  pointer-events: auto;
}

.setup-error {
  font-size: var(--text-xs);
  color: var(--danger);
  white-space: nowrap;
}

.setup-note {
  width: 300px;
  margin-top: 10px;
  text-align: center;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}
</style>
