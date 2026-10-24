<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import OptionSelect from '../../components/shared/OptionSelect.vue'
import { TERMINALS, readTerminal, saveTerminal } from '../../services/terminal'
import type { TerminalId } from '../../services/terminal'
import { useToastStore } from '../../stores/toast'

const toastStore = useToastStore()
const terminal = ref<TerminalId>('auto')

const terminalDesc = computed(
  () => TERMINALS.find((t) => t.id === terminal.value)?.desc ?? ''
)
const terminalOptions = TERMINALS.map((t) => ({ value: t.id, label: t.name }))

const saveTerminalPref = async (id: TerminalId) => {
  if (id === terminal.value) return
  terminal.value = id
  const saved = await saveTerminal(id)
  toastStore.showToast(saved ? '已保存终端偏好' : '保存失败，重启后将恢复原设置', saved ? 'success' : 'error')
}

onMounted(async () => {
  terminal.value = await readTerminal()
})
</script>

<template>
  <div class="group-content">
    <div class="setting-item">
      <div class="setting-info">
        <span class="setting-name">在终端中打开</span>
        <span class="setting-desc">{{ terminalDesc }}</span>
      </div>
      <div class="setting-control">
        <OptionSelect
          :model-value="terminal"
          :options="terminalOptions"
          @update:model-value="saveTerminalPref($event as TerminalId)"
        />
      </div>
    </div>
  </div>
</template>
