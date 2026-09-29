<script setup lang="ts">
/* 设置页的选项下拉：触发钮沿用 .select 的 28px 控制轴一档，
   菜单走 PopoverMenu，避开 WebView2 原生 select 的系统深色弹层。 */
import { ref } from 'vue'
import PopoverMenu from './PopoverMenu.vue'
import AppIcon from './AppIcon.vue'

export interface OptionItem {
  value: string | number
  label: string
}

const props = defineProps<{
  modelValue: string | number
  options: OptionItem[]
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()

const anchor = ref<HTMLElement | null>(null)
const open = ref(false)

const currentLabel = () =>
  props.options.find((o) => o.value === props.modelValue)?.label ?? ''

const toggle = (e: MouseEvent) => {
  if (open.value) {
    open.value = false
    return
  }
  anchor.value = e.currentTarget as HTMLElement
  open.value = true
}

const pick = (v: string | number) => {
  open.value = false
  if (v !== props.modelValue) emit('update:modelValue', v)
}
</script>

<template>
  <button
    type="button"
    class="select opt-trigger"
    :disabled="disabled"
    :aria-expanded="open"
    @click="toggle"
  >
    <span class="opt-value">{{ currentLabel() }}</span>
      <AppIcon class="opt-chev" :class="{ up: open }" name="chevDown" :size="11" />
  </button>
  <PopoverMenu v-if="open && anchor" :anchor="anchor" modal align="start" @close="open = false">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="menuitemradio"
      :aria-checked="o.value === modelValue"
      class="pop-item opt-item"
      :class="{ on: o.value === modelValue }"
      @click="pick(o.value)"
    >
      <span>{{ o.label }}</span>
    </button>
  </PopoverMenu>
</template>

<style scoped>
.opt-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 108px;
}
.opt-value {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
}
.opt-chev {
  flex-shrink: 0;
  opacity: 0.55;
  transition: transform var(--transition);
}
.opt-chev.up { transform: rotate(180deg); }

.opt-item { justify-content: space-between; }
.opt-item.on { color: var(--accent); background: var(--accent-soft); font-weight: 500; }
.opt-item.on::after { content: '✓'; margin-left: var(--space-3); }
</style>
