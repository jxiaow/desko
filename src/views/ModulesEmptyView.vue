<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive } from 'vue'
import AppIcon from '../components/shared/AppIcon.vue'
import { usePageHeadStore } from '../stores/pageHead'
import { useToastStore } from '../stores/toast'
import { isWebRuntime } from '../services/runtime'
import { MODULES, type ModuleId } from '../modules/registry'
import { landingPath, moduleFlags } from '../modules/state'
import { holdModuleLanding, toggleModule } from '../modules/runtime'
import router, { EMPTY_PATH } from '../router'

/** 零模块态：桌面是模块选择器，浏览器保留原空态 */
usePageHeadStore().setHead('')
const webRuntime = isWebRuntime()
const toast = useToastStore()
const pending = reactive(new Set<ModuleId>())

const enabledCount = computed(() => MODULES.filter((m) => moduleFlags[m.id]).length)
const countText = computed(() =>
  enabledCount.value === 0 ? '点击模块开始启用' : `已启用 ${enabledCount.value} 个模块`)

const openModules = () => {
  window.dispatchEvent(new CustomEvent('desko:open-settings-tab', { detail: 'modules' }))
}

const toggle = async (id: ModuleId) => {
  if (pending.has(id)) return
  const on = !moduleFlags[id]
  pending.add(id)
  try {
    await toggleModule(id, on)
  } catch (e: any) {
    toast.showToast(`${on ? '开启' : '关闭'}失败: ${e?.message ?? e}`, 'error')
  } finally {
    pending.delete(id)
  }
}

const enterWorkspace = () => {
  if (enabledCount.value > 0) void router.replace(landingPath() ?? EMPTY_PATH)
}

onMounted(() => { if (!webRuntime) holdModuleLanding(true) })
onUnmounted(() => { if (!webRuntime) holdModuleLanding(false) })
</script>

<template>
  <div v-if="webRuntime" class="content-inner">
    <div class="empty-state">
      <div class="empty-icon">
        <AppIcon name="gear" :size="24" />
      </div>
      <div class="empty-title">暂无已启用的模块</div>
      <div class="empty-desc">在设置中启用所需模块</div>
      <button class="action-btn primary" type="button" @click="openModules">管理模块</button>
    </div>
  </div>

  <div v-else class="content-inner onb-page">
    <div class="onb-flow">
      <header class="onb-head">
        <h1 class="onb-title">选择要启用的模块</h1>
        <p class="onb-lead">可随时在设置中调整</p>
      </header>

      <div class="onb-grid" role="group" aria-label="模块选择">
        <button
          v-for="m in MODULES"
          :key="m.id"
          class="module-tile"
          :class="{ 'is-on': moduleFlags[m.id], 'is-busy': pending.has(m.id) }"
          type="button"
          :aria-pressed="moduleFlags[m.id]"
          @click="toggle(m.id)"
        >
          <span class="tile-top">
            <span class="tile-icon"><AppIcon :name="m.icon" :size="20" /></span>
            <span class="tile-check" aria-hidden="true">
              <AppIcon v-if="moduleFlags[m.id]" name="check" :size="12" />
            </span>
          </span>
          <span class="tile-copy">
            <span class="tile-name">{{ m.title }}</span>
            <span class="tile-brief">{{ m.brief }}</span>
          </span>
        </button>
      </div>

      <footer class="onb-footer">
        <span class="onb-count" aria-live="polite">{{ countText }}</span>
        <button class="btn-primary onb-cta" type="button" :disabled="enabledCount === 0" @click="enterWorkspace">
          进入工作台
          <AppIcon name="arrowRight" :size="13" />
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.onb-flow {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.onb-title {
  font-size: var(--text-2xl);
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.35;
  color: var(--text);
}

.onb-lead {
  margin-top: 8px;
  margin-bottom: 26px;
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--text-secondary);
}

.onb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(196px, 1fr));
  gap: 12px;
}

.module-tile {
  min-height: 126px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 18px;
  border: 1px solid var(--border-card);
  border-radius: 12px;
  background: var(--bg-surface);
  color: var(--text);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition), background-color var(--transition);
}

.module-tile:hover { border-color: var(--border-card-hover); }

.module-tile.is-on {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  background: color-mix(in srgb, var(--accent) 5%, var(--bg-surface));
}

.module-tile.is-busy { cursor: progress; }

.tile-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.tile-icon {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--sunken);
  color: var(--text-secondary);
  transition: background-color var(--transition), color var(--transition);
}

.module-tile.is-on .tile-icon {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-surface));
  color: var(--text-brand);
}

.tile-check {
  width: 17px;
  height: 17px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  color: var(--accent-on);
  transition: border-color var(--transition), background-color var(--transition);
}

.module-tile.is-on .tile-check {
  background: var(--accent);
  border-color: var(--accent);
}

.tile-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.tile-name {
  font-size: var(--text-sm);
  font-weight: 600;
  line-height: 1.4;
}

.tile-brief {
  font-size: var(--text-xs);
  line-height: 1.65;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.onb-footer {
  margin-top: auto;
  padding-top: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.onb-count {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.onb-cta { flex-shrink: 0; }

/* 600px 高的窗口只剩 552px 正文，三行模块卡按原尺寸会把底栏裁掉。 */
@media (max-height: 640px) {
  .onb-lead { margin-bottom: 12px; }
  .onb-grid { gap: 10px; }
  .module-tile { min-height: 112px; padding: 10px 12px; gap: 12px; }
  .onb-footer { padding-top: 12px; }
}

.empty-state .action-btn {
  margin-top: var(--space-5);
}
</style>
