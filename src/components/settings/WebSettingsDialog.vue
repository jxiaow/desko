<script setup lang="ts">
import { ref } from 'vue'
import { THEME_GROUPS, isPlainTheme, ACCENTS, appearance, chooseTheme, chooseAccent, chooseBackgroundAtmosphere, polarityOf } from '../../services/theme'
import { useToastStore } from '../../stores/toast'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'

const emit = defineEmits<{ close: []; lock: [] }>()
const toast = useToastStore()
const saving = ref(false)
useEscapeClose(() => emit('close'))

async function save(action: () => Promise<boolean>) {
  if (saving.value) return
  saving.value = true
  try {
    const saved = await action()
    if (!saved) toast.showToast('外观已切换，但未能保存', 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <section class="dialog web-settings" role="dialog" aria-modal="true" aria-label="浏览器设置">
      <header class="dialog-header">
        <h3>浏览器设置</h3>
        <button class="dialog-close" type="button" aria-label="关闭" @click="emit('close')"><AppIcon name="x" :size="16" /></button>
      </header>
      <div class="dialog-body">
        <div v-for="group in THEME_GROUPS" :key="group.label" class="web-theme-group">
        <h4>{{ group.label }}</h4>
        <div class="web-choices" role="group" :aria-label="group.label">
          <button v-for="theme in group.themes" :key="theme.id" type="button" class="web-theme theme-scope" :data-theme="theme.id" :data-palette="isPlainTheme(theme.id) ? 'plain' : 'atmosphere'" :data-base="polarityOf(theme.id)" :data-accent="appearance.accent" :aria-pressed="appearance.theme === theme.id" :disabled="saving" @click="save(() => chooseTheme(theme.id))">{{ theme.name }}</button>
        </div>
        </div>
        <h4>强调色</h4>
        <div class="web-choices" role="group" aria-label="强调色">
          <button v-for="accent in ACCENTS" :key="accent.id" type="button" class="btn-secondary web-accent" :aria-pressed="appearance.accent === accent.id" :disabled="saving" @click="save(() => chooseAccent(accent.id))"><i :data-base="polarityOf(appearance.theme)" :data-accent="accent.id" />{{ accent.name }}</button>
        </div>
        <label class="web-atmosphere"><input type="checkbox" :checked="appearance.backgroundAtmosphere" :disabled="saving || isPlainTheme(appearance.theme)" @change="save(() => chooseBackgroundAtmosphere(($event.target as HTMLInputElement).checked))" />背景氛围{{ isPlainTheme(appearance.theme) ? '（素色主题保持纯色）' : '' }}</label>
        <p class="web-access-note">退出仅结束当前浏览器的访问，不影响电脑上 Desko 的锁定状态。访问密码请在桌面版设置。</p>
      </div>
      <footer class="dialog-footer">
        <button class="btn-secondary" type="button" @click="emit('lock')">退出浏览器访问</button>
        <button class="btn-primary" type="button" @click="emit('close')">完成</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.web-settings { width: min(480px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); display: flex; flex-direction: column; }
.dialog-body { overflow: auto; }
h4 { margin: 0 0 10px; color: var(--text-secondary); font-size: var(--text-sm); }
h4:not(:first-child) { margin-top: 20px; }
.web-theme-group + .web-theme-group { margin-top: 20px; }
.web-choices { display: flex; flex-wrap: wrap; gap: 8px; }
.web-theme { min-width: 44px; min-height: 36px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); color: var(--text); cursor: pointer; }
.web-choices button[aria-pressed='true'] { outline: 2px solid var(--accent); outline-offset: 2px; }
.web-accent { display: inline-flex; align-items: center; gap: 6px; }
.web-accent i { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
.web-atmosphere { display: flex; align-items: center; gap: 8px; margin-top: 20px; font-size: var(--text-sm); }
.web-access-note { margin: 20px 0 0; color: var(--text-muted); font-size: var(--text-xs); line-height: 1.6; }
</style>
