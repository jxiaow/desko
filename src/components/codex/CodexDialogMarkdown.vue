<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { openExternal } from '../../utils/openExternal'
const props = defineProps<{ text: string }>()
const html = computed(() => DOMPurify.sanitize(marked.parse(props.text, { async: false, breaks: true, gfm: true }), {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
  ALLOWED_ATTR: ['href', 'title', 'start'], ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
}))
function follow(event: MouseEvent) {
  const link = (event.target as Element).closest('a')
  if (!link) return
  event.preventDefault()
  const href = link.getAttribute('href') || ''
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) void openExternal(href).catch(() => {})
}
</script>
<template><div class="dialog-markdown" @click="follow" v-html="html"></div></template>
<style scoped>
.dialog-markdown { font-size: var(--text-base); line-height: 1.85; overflow-wrap: anywhere; color: var(--text); }
.dialog-markdown :deep(:is(p,ul,ol,blockquote,h1,h2,h3,h4,h5,h6)) { max-width: 800px; }
.dialog-markdown :deep(p) { margin: 0 0 10px; }
.dialog-markdown :deep(pre) { overflow: auto; padding: 16px; background: var(--hover); border-radius: 8px; font: 13px/1.7 var(--font-mono); }
.dialog-markdown :deep(code) { font-family: var(--font-mono); font-size: .88em; }
.dialog-markdown :deep(:not(pre) > code) { background: var(--hover); padding: 2px 5px; border-radius: 4px; }
.dialog-markdown :deep(a) { color: var(--accent); text-decoration: underline; }
.dialog-markdown :deep(table) { border-collapse: collapse; display: block; max-width: 100%; overflow: auto; }
.dialog-markdown :deep(th), .dialog-markdown :deep(td) { border: 1px solid var(--border); padding: 5px 10px; }
.dialog-markdown :deep(blockquote) { margin: 8px 0; border-left: 2px solid var(--border); padding-left: 12px; color: var(--text-secondary); }
.dialog-markdown :deep(h1), .dialog-markdown :deep(h2), .dialog-markdown :deep(h3), .dialog-markdown :deep(h4), .dialog-markdown :deep(h5), .dialog-markdown :deep(h6) { font-size: var(--text-lg); line-height: 1.5; margin: 24px 0 10px; font-weight: 600; }
.dialog-markdown :deep(ul), .dialog-markdown :deep(ol) { padding-left: 24px; margin: 12px 0 16px; }
.dialog-markdown :deep(li) { padding-left: 2px; margin-block: 6px; }
.dialog-markdown :deep(hr) { border: 0; border-top: 1px solid var(--border); margin: 24px 0; }
</style>
