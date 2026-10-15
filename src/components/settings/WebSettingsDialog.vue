<script setup lang="ts">
import { defineAsyncComponent, ref, watch } from 'vue'
import { THEME_GROUPS, isPlainTheme, ACCENTS, appearance, chooseTheme, chooseAccent, chooseBackgroundAtmosphere, polarityOf } from '../../services/theme'
import { useToastStore } from '../../stores/toast'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'
import { useNotesStore } from '../../stores/notes'
import { WEB_EXTRA_MODULES, moduleFlags } from '../../modules/state'
import { moduleById, type SettingsTabId } from '../../modules/registry'
import { toggleModule } from '../../modules/runtime'
import { fsRefresh } from '../../services/fileshareSettings'
const FileshareSettings = defineAsyncComponent(() => import('../../modules/settings/FileshareSettings.vue'))
const CodexSettings = defineAsyncComponent(() => import('../../modules/settings/CodexSettings.vue'))

const props = defineProps<{ initialTab?: SettingsTabId }>()
const emit = defineEmits<{ close: []; lock: []; openChangeNoteKey: [mode: 'unlock' | 'change'] }>()
const toast = useToastStore()
const notes = useNotesStore()
const tab = ref(props.initialTab ?? 'appearance')
watch(() => props.initialTab, value => { tab.value = value ?? 'appearance' })
watch(tab, value => { if (value === 'fileshare' && moduleFlags.fileshare) void fsRefresh() }, { immediate: true })
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
async function changeModule(id: typeof WEB_EXTRA_MODULES[number], event: Event) {
  if (saving.value) return
  saving.value = true
  try { await toggleModule(id, (event.target as HTMLInputElement).checked) }
  catch (e) { toast.showToast(String(e), 'error') }
  finally { saving.value = false }
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
        <nav class="web-setting-tabs" aria-label="浏览器设置分类">
          <button v-for="item in [{id:'appearance',label:'外观'},{id:'notes',label:'小记'},{id:'modules',label:'模块'},{id:'fileshare',label:'局域网传输'},{id:'codex',label:'Codex'}]" :key="item.id" class="btn-secondary" type="button" :aria-pressed="tab === item.id" @click="tab = item.id as SettingsTabId">{{ item.label }}</button>
        </nav>
        <template v-if="tab === 'notes'">
          <p class="web-access-note">与桌面端共用小记口令，加密小记中的“忘了口令”可通过已登录的主密码找回。</p>
          <button v-if="notes.noteKey.is_set" class="btn-secondary" type="button" @click="emit('openChangeNoteKey', notes.noteKey.is_open ? 'change' : 'unlock')">修改小记口令</button>
          <p v-else class="web-access-note">首次加密小记时设置口令。</p>
        </template>
        <template v-else-if="tab === 'modules'">
          <p class="web-access-note">以下模块与桌面共用开关和数据。</p>
          <label v-for="id in WEB_EXTRA_MODULES" :key="id" class="web-module-option"><span>{{ moduleById(id).title }}</span><input type="checkbox" role="switch" :aria-label="moduleById(id).title" :checked="moduleFlags[id]" :disabled="saving" @change="changeModule(id, $event)" /></label>
        </template>
        <template v-else-if="tab === 'fileshare'"><FileshareSettings v-if="moduleFlags.fileshare" /><p v-else class="web-access-note">请先在模块页开启局域网传输。</p></template>
        <template v-else-if="tab === 'codex'"><CodexSettings v-if="moduleFlags.codex" /><p v-else class="web-access-note">请先在模块页开启 Codex。</p></template>
        <template v-else>
        <div v-for="group in THEME_GROUPS" :key="group.label" class="web-theme-group">
        <h4>{{ group.label }}</h4>
        <div class="web-choices" role="group" :aria-label="group.label">
          <button v-for="theme in group.themes" :key="theme.id" type="button" class="web-theme theme-scope" :data-theme="theme.id" :data-palette="isPlainTheme(theme.id) ? 'plain' : 'atmosphere'" :data-base="polarityOf(theme.id)" :data-accent="appearance.accent" :data-atmosphere="appearance.backgroundAtmosphere ? 'on' : 'off'" :aria-pressed="appearance.theme === theme.id" :disabled="saving" @click="save(() => chooseTheme(theme.id))">{{ theme.name }}</button>
        </div>
        </div>
        <h4>强调色</h4>
        <div class="web-choices" role="group" aria-label="强调色">
          <button v-for="accent in ACCENTS" :key="accent.id" type="button" class="btn-secondary web-accent" :aria-pressed="appearance.accent === accent.id" :disabled="saving" @click="save(() => chooseAccent(accent.id))"><i :data-base="polarityOf(appearance.theme)" :data-accent="accent.id" />{{ accent.name }}</button>
        </div>
        <label class="web-atmosphere"><input type="checkbox" role="switch" :checked="appearance.backgroundAtmosphere" :disabled="saving" @change="save(() => chooseBackgroundAtmosphere(($event.target as HTMLInputElement).checked))" />背景氛围</label>
        </template>
        <p class="web-access-note">登录密码与当前档案的桌面主密码一致。退出仅结束当前浏览器的访问，不影响电脑上 Desko 的锁定状态。</p>
      </div>
      <footer class="dialog-footer">
        <button class="btn-secondary" type="button" @click="emit('lock')">退出浏览器访问</button>
        <button class="btn-primary" type="button" @click="emit('close')">完成</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.web-setting-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 18px; }
.web-setting-tabs [aria-pressed='true'] { color: var(--accent); border-color: var(--accent); }
.web-module-option { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; font-size: var(--text-sm); }
.web-settings { width: min(480px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); display: flex; flex-direction: column; }
.dialog-body { overflow: auto; }
h4 { margin: 0 0 10px; color: var(--text-secondary); font-size: var(--text-sm); }
h4:not(:first-child) { margin-top: 20px; }
.web-theme-group + .web-theme-group { margin-top: 20px; }
.web-choices { display: flex; flex-wrap: wrap; gap: 8px; }
.web-theme { min-width: 44px; min-height: 36px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text); cursor: pointer; }
.web-choices button[aria-pressed='true'] { outline: 2px solid var(--accent); outline-offset: 2px; }
.web-accent { display: inline-flex; align-items: center; gap: 6px; }
.web-accent i { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
.web-atmosphere { display: flex; align-items: center; gap: 8px; margin-top: 20px; font-size: var(--text-sm); }
.web-access-note { margin: 20px 0 0; color: var(--text-muted); font-size: var(--text-xs); line-height: 1.6; }
</style>
