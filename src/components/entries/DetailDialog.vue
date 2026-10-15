<script setup lang="ts">
import { computed } from 'vue'
import type { Entry } from '../../types'
import { avatarLetter } from '../../utils/avatar'
import { faviconSrcFor } from '../../services/favicon'
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
/** 头部身份档与列表卡同一张脸：favicon 到货则显示图标，否则同一套分类字母 */
const fav = computed(() => faviconSrcFor(props.entry.url))

const pathHref = (path: string) => joinEntryUrl(props.entry.url, path)

useEscapeClose(() => emit('close'))
</script>

<template>
  <Transition name="dialog">
    <div v-if="true" class="dialog-overlay">
      <div class="dialog detail-dialog" role="dialog" aria-modal="true" :aria-label="`条目详情：${entry.name}`">
        <div class="dialog-header">
          <h3>网址详情</h3>
          <button class="dialog-close" type="button" title="关闭 (Esc)" @click="emit('close')">
            <AppIcon name="x" :size="16" />
          </button>
        </div>

        <div class="dialog-body detail-body">
          <div class="detail-identity">
            <span class="grid-slot" :class="{ 'grid-slot--icon': !!fav }" aria-hidden="true">
              <img v-if="fav" :src="fav" alt="" />
              <template v-else>{{ avatarLetter(entry.category) }}</template>
            </span>
            <div class="detail-identity-text">
              <h4>{{ entry.name }}</h4>
              <div class="detail-meta">
                <span>{{ entry.category || '未分类' }}</span>
                <span aria-hidden="true">·</span>
                <span>{{ formatAbsTime(entry.created_at) }}添加</span>
              </div>
            </div>
          </div>
          <div class="detail-row">
            <span class="detail-key">网址</span>
            <a v-if="entry.url" class="detail-val detail-link" :title="entry.url" @click.prevent="emit('openUrl', entry.url!)">{{ entry.url }}</a>
            <span v-else class="detail-val detail-empty">未填写</span>
            <button v-if="entry.url" class="mini" type="button" title="复制网址" @click="emit('copyText', entry.url!, '网址')">
              <AppIcon name="copy" :size="12" />复制
            </button>
          </div>

          <div v-if="entry.username" class="detail-row">
            <span class="detail-key">用户名</span>
            <span class="detail-val detail-mono">{{ entry.username }}</span>
            <button class="mini" type="button" title="复制用户名" @click="emit('copyText', entry.username!, '用户名')">
              <AppIcon name="copy" :size="12" />复制
            </button>
          </div>

          <div v-if="cachedPassword" class="detail-row">
            <span class="detail-key">密码</span>
            <span class="detail-val detail-pwd">{{ revealed ? cachedPassword : '••••••••••' }}</span>
            <button class="mini" type="button" :title="revealed ? '隐藏密码' : '显示密码'" @click="emit('togglePassword', entry.id)">
              <AppIcon :name="revealed ? 'eyeOff' : 'eye'" :size="12" />{{ revealed ? '隐藏' : '显示' }}
            </button>
            <button class="mini" type="button" title="复制密码" @click="emit('copyPassword', entry.id)">
              <AppIcon name="copy" :size="12" />
            </button>
          </div>

          <div v-if="entry.notes" class="detail-row detail-row-top">
            <span class="detail-key">备注</span>
            <span class="detail-notes">{{ entry.notes }}</span>
          </div>

          <div v-if="entry.paths && entry.paths.length" class="detail-row">
            <span class="detail-key">路径</span>
            <span class="detail-paths">
              <a
                v-for="path in entry.paths"
                :key="path.id"
                class="detail-path"
                :title="path.path"
                @click.prevent="emit('openUrl', pathHref(path.path))"
              >{{ path.label || path.path }}</a>
            </span>
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
.detail-dialog { width: 480px; max-width: calc(100vw - 32px); }

/* 弹窗头沿用全站单行标题；条目身份放正文首行，长名称可以完整换行。 */
.detail-identity { display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-3) 0 var(--space-4); border-bottom: 1px solid var(--border); }
.detail-identity .grid-slot { margin-top: 1px; }
.detail-identity-text { flex: 1; min-width: 0; }
.detail-identity h4 { margin: 0; font-size: var(--text-md); font-weight: 600; line-height: 1.4; letter-spacing: -0.01em; color: var(--text); overflow-wrap: anywhere; }
.detail-meta { display: flex; flex-wrap: wrap; column-gap: 6px; margin-top: 4px; font-size: var(--text-xs); line-height: 1.5; color: var(--text-muted); }

/* 一层平铺 + 行间发丝线：原先四块 --sunken 内嵌盒是弹窗里的卡中卡，读值靠缩进而非靠底色。
   分行线用 --border 不用 --border-subtle：后者在墨底面板上只差 ΔL1.5，等于没画 */
.detail-body { padding: 4px var(--space-5) 8px; display: flex; flex-direction: column; }
.detail-row {
  display: flex; align-items: center; gap: 10px;
  min-height: 38px; padding: 7px 0;
  border-bottom: 1px solid var(--border);
}
.detail-row:last-child { border-bottom: none; }
.detail-row-top { align-items: flex-start; }
.detail-row-top .detail-key { padding-top: 8px; }
.detail-key { flex: none; width: 40px; font-size: var(--text-xs); color: var(--text-muted); }
.detail-val { flex: 1; min-width: 0; font-size: var(--text-sm); color: var(--text); word-break: break-all; line-height: 18px; }
.detail-mono { font-family: var(--font-mono); }
/* 密码是"读一个值"的场景：常显等宽 + 抬一档到 15px，跟验证码的 30px 同一条排印思路 */
.detail-pwd { font-family: var(--font-mono); font-size: var(--text-md); letter-spacing: 0.06em; }
.detail-empty { color: var(--text-muted); }
.detail-link { color: var(--accent); cursor: pointer; text-decoration: none; font-family: var(--font-mono); font-size: var(--text-sm); }
.detail-link:hover { text-decoration: underline; }
.detail-notes { flex: 1; min-width: 0; font-size: var(--text-sm); color: var(--text-secondary); line-height: 19px; white-space: pre-wrap; }

.detail-paths { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; min-width: 0; }
.detail-path {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  font-weight: 500;
  color: var(--accent);
  background: var(--accent-soft);
  cursor: pointer;
  text-decoration: none;
  transition: all var(--transition);
}
.detail-path:hover { background: var(--accent); color: var(--accent-on); }

.detail-dialog .dialog-footer > button { flex-shrink: 0; white-space: nowrap; }
@media (max-width: 360px) {
  .detail-body { padding-right: var(--space-4); padding-left: var(--space-4); }
  .detail-row { gap: 8px; }
  .detail-dialog .dialog-footer { padding-right: var(--space-3); padding-left: var(--space-3); }
}

/* 删除是破坏性动作，只在 hover 时才铺红底 */
.btn-secondary.danger { color: var(--danger); }
.btn-secondary.danger:hover { background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger); }
</style>
