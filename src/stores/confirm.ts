import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ConfirmDialog {
  show: boolean
  title: string
  message: string
  actionLabel: string
  onConfirm: () => void
}

export const useConfirmStore = defineStore('confirm', () => {
  const confirmDialog = ref<ConfirmDialog>({ show: false, title: '', message: '', actionLabel: '确定', onConfirm: () => {} })

  const showConfirm = (title: string, message: string, onConfirm: () => void, actionLabel = '确定') => {
    confirmDialog.value = { show: true, title, message, actionLabel, onConfirm }
  }

  const clearConfirm = () => {
    confirmDialog.value = { show: false, title: '', message: '', actionLabel: '确定', onConfirm: () => {} }
  }

  const handleConfirm = () => {
    const onConfirm = confirmDialog.value.onConfirm
    clearConfirm()
    onConfirm()
  }

  return { confirmDialog, showConfirm, handleConfirm, clearConfirm }
})
