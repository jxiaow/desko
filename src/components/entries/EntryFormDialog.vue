<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Entry } from '../../types'
import EntryFields from './EntryFields.vue'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{ categories: string[]; entry: Entry | null }>()

const emit = defineEmits<{
  close: []
  saved: [id: string]
}>()

const title = computed(() => (props.entry ? '编辑网址收藏' : '新增网址收藏'))
const fields = ref<InstanceType<typeof EntryFields> | null>(null)

const onSaved = (id: string) => {
  emit('saved', id)
  emit('close')
}

const save = () => fields.value?.save()

/* ⌘/Ctrl+Enter 触发保存校验；徽标只是提示，不绑定额外行为 */
const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    save()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

useEscapeClose(() => emit('close'))
</script>

<template>
  <Transition name="dialog">
    <div v-if="true" class="dialog-overlay form-overlay">
      <div class="dialog entry-form-dialog" role="dialog" aria-modal="true" :aria-label="title">
        <div class="dialog-header">
          <h3>{{ title }}</h3>
          <button class="dialog-close" type="button" title="关闭" @click="emit('close')">
            <AppIcon name="x" :size="18" />
          </button>
        </div>
        <div class="dialog-body">
          <EntryFields ref="fields" :entry="entry" :categories="categories" @saved="onSaved" />
        </div>
        <div class="dialog-footer">
          <div class="footer-hints">
            <span class="kbd">Ctrl</span><span class="kbd">Enter</span><span>保存</span>
            <span class="hints-dot">·</span>
            <span class="kbd">Esc</span><span>取消</span>
          </div>
          <div class="footer-actions">
            <button class="btn-secondary" type="button" @click="emit('close')">取消</button>
            <button class="btn-primary" type="button" @click="save()">保存条目</button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* 居中偏上悬浮：遮罩与其余弹窗同配方（--overlay），弥散稍重一档 */
.form-overlay {
  align-items: flex-start;
  padding-top: 7vh;
  background: var(--overlay);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.entry-form-dialog {
  width: 520px;
  /* 顶 7vh + 底部留 2vh：内容自然高在此内，绝不触发外层滚动 */
  max-height: 91vh;
  border: 1px solid var(--border);
  box-shadow: var(--shadow-pop);
}

/* 严禁弹窗外层滚动条：唯一滚动区收进子路径视窗 */
.entry-form-dialog .dialog-body { overflow: hidden; padding: 16px 20px 12px; }
.entry-form-dialog .dialog-header { height: 42px; padding: 0 20px; }
.entry-form-dialog .dialog-header h3 { font-size: 14px; }

/* 46px 底栏浅底色 + 28px 按钮档已上抬为全局 .dialog-footer；
   这里只留本弹窗的布局差量：左侧快捷键徽标把按钮推到右边 */
.entry-form-dialog .dialog-footer { justify-content: space-between; }
.footer-hints { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--text-muted); }
.footer-hints .kbd {
  padding: 1px 4px; border: 1px solid var(--border); border-radius: 4px;
  background: var(--panel-bg); font-family: var(--font-mono);
  font-size: 10px; line-height: 13px; color: var(--text-muted);
}
.hints-dot { margin: 0 4px; }
.footer-actions { display: flex; align-items: center; gap: 8px; }
</style>
