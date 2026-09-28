<script setup lang="ts">
import { computed } from 'vue'
import type { Entry } from '../../types'
import { avatarClass } from '../../utils/avatar'
import { formatAbsTime } from '../../utils/format'
import { joinEntryUrl } from '../../utils/urlPath'
import AppIcon from '../shared/AppIcon.vue'
import { useEscapeClose } from '../../composables/useEscapeClose'

const props = defineProps<{
  entry: Entry
  visiblePasswords: Record<string, boolean>
  passwordCache: Record<string, { value: string; ts: number }>
}>()

const emit = defineEmits<{
  close: []
  edit: [entry: Entry]
  delete: [entry: Entry]
  togglePassword: [id: string]
  copyPassword: [id: string]
  copyText: [text: string, label: string]
  openUrl: [url: string]
}>()

/** 详情只管浏览；编辑统一弹新增/编辑同一个表单弹窗 */
const revealed = computed(() => !!props.visiblePasswords[props.entry.id])
const cachedPassword = computed(() => props.passwordCache[props.entry.id]?.value || '')
const hasCredential = computed(() => !!(props.entry.username || cachedPassword.value))
const subtitle = computed(() =>
  `${props.entry.category || '未分类'} · ${formatAbsTime(props.entry.created_at)}添加`)

const pathHref = (path: string) => joinEntryUrl(props.entry.url, path)

useEscapeClose(() => emit('close'))
</script>

<template>
  <Transition name="dialog">
    <div v-if="true" class="dialog-overlay">
      <div class="dialog detail-dialog" role="dialog" aria-modal="true" :aria-label="`条目详情：${entry.name}`">
        <div class="dialog-header detail-head">
          <div class="card-avatar" :class="avatarClass(entry.category)">{{ entry.name.charAt(0) }}</div>
          <div class="detail-head-id">
            <h3>{{ entry.name }}</h3>
            <span class="detail-sub">{{ subtitle }}</span>
          </div>
          <button class="dialog-close" type="button" title="关闭 (Esc)" @click="emit('close')">
            <AppIcon name="x" :size="16" />
          </button>
        </div>

        <div class="dialog-body detail-body">
          <div class="detail-section">
            <div class="detail-label">网址</div>
            <div class="detail-field">
              <a v-if="entry.url" class="detail-value detail-link" :title="entry.url" @click.prevent="emit('openUrl', entry.url!)">{{ entry.url }}</a>
              <span v-else class="detail-value detail-empty">未填写</span>
              <button v-if="entry.url" class="mini" type="button" title="复制网址" @click="emit('copyText', entry.url!, '网址')">
                <AppIcon name="copy" :size="12" />复制
              </button>
            </div>
          </div>

          <div v-if="hasCredential" class="detail-section">
            <div class="detail-label">凭证</div>
            <div v-if="entry.username" class="detail-field">
              <span class="detail-value detail-username">{{ entry.username }}</span>
              <button class="mini" type="button" title="复制用户名" @click="emit('copyText', entry.username!, '用户名')">
                <AppIcon name="copy" :size="12" />复制
              </button>
            </div>
            <div v-if="cachedPassword" class="detail-field">
              <span class="detail-value detail-pwd">{{ revealed ? cachedPassword : '••••••••••' }}</span>
              <button class="mini" type="button" :title="revealed ? '隐藏密码' : '显示密码'" @click="emit('togglePassword', entry.id)">
                <AppIcon :name="revealed ? 'eyeOff' : 'eye'" :size="12" />{{ revealed ? '隐藏' : '显示' }}
              </button>
              <button class="mini" type="button" title="复制密码" @click="emit('copyPassword', entry.id)">
                <AppIcon name="copy" :size="12" />
              </button>
            </div>
          </div>

          <div v-if="entry.notes" class="detail-section">
            <div class="detail-label">备注</div>
            <div class="detail-value detail-notes">{{ entry.notes }}</div>
          </div>

          <div v-if="entry.paths && entry.paths.length" class="detail-section">
            <div class="detail-label">路径 · {{ entry.paths.length }}</div>
            <div class="detail-paths">
              <a
                v-for="path in entry.paths"
                :key="path.id"
                class="detail-path"
                :title="path.path"
                @click.prevent="emit('openUrl', pathHref(path.path))"
              >{{ path.label || path.path }}</a>
            </div>
          </div>
        </div>

        <div class="dialog-footer">
          <button class="btn-secondary danger" type="button" @click="emit('delete', entry)">
            <AppIcon name="trash" :size="13" />删除
          </button>
          <span class="spacer"></span>
          <button class="btn-secondary" type="button" @click="emit('edit', entry)">
            <AppIcon name="edit" :size="13" />编辑
          </button>
          <button v-if="entry.url" class="btn-primary" type="button" @click="emit('openUrl', entry.url!)">在浏览器打开</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.detail-dialog { width: 480px; }

.detail-head { gap: var(--space-3); }
.detail-head .card-avatar { width: 34px; height: 34px; font-size: 14px; }
.detail-head-id { flex: 1; min-width: 0; }
.detail-head-id h3 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail-sub { display: block; margin-top: 1px; font-size: 11.5px; color: var(--text-muted); }

.detail-body { padding: var(--space-3) var(--space-4) var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
/* 分组名值对内嵌盒：底色吃 --sunken，与弹窗外壳拉开一层深度 */
.detail-section { padding: var(--space-2) var(--space-3) var(--space-3); background: var(--sunken); border: 1px solid var(--border); border-radius: var(--radius); }
.detail-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: var(--space-2);
}
.detail-field { display: flex; align-items: center; gap: var(--space-2); }
.detail-field + .detail-field { margin-top: var(--space-2); }
.detail-value { flex: 1; min-width: 0; font-size: var(--text-sm); color: var(--text); word-break: break-all; }
/* 密码是"读一个值"的场景：常显等宽 + 抬一档到 15px，跟验证码的 30px 同一条排印思路 */
.detail-pwd { font-family: var(--font-mono); font-size: var(--text-md); letter-spacing: 0.06em; font-variant-numeric: tabular-nums; }
.detail-empty { color: var(--text-muted); }
.detail-link { color: var(--accent); cursor: pointer; text-decoration: none; font-family: var(--font-mono); font-size: var(--text-sm); word-break: break-all; }
.detail-link:hover { text-decoration: underline; }
.detail-username { font-family: var(--font-mono); font-size: var(--text-sm); }
.detail-notes { color: var(--text-secondary); line-height: 1.5; white-space: pre-wrap; }

.detail-paths { display: flex; flex-wrap: wrap; gap: 6px; }
.detail-path {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--accent);
  background: var(--accent-soft);
  cursor: pointer;
  text-decoration: none;
  transition: all var(--transition);
}
.detail-path:hover { background: var(--accent); color: var(--accent-on); }

/* 删除是破坏性动作，只在 hover 时才铺红底 */
.btn-secondary.danger { color: var(--danger); }
.btn-secondary.danger:hover { background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger); }
</style>
