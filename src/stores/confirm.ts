import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ConfirmDialog {
  show: boolean
  title: string
  message: string
  onConfirm: () => void
}

export const useConfirmStore = defineStore('confirm', () => {
  const confirmDialog = ref<ConfirmDialog>({ show: false, title: '', message: '', onConfirm: () => {} })

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    confirmDialog.value = { show: true, title, message, onConfirm }
  }

  const clearConfirm = () => {
    confirmDialog.value = { show: false, title: '', message: '', onConfirm: () => {} }
  }

  const handleConfirm = () => {
    const onConfirm = confirmDialog.value.onConfirm
    clearConfirm()
    onConfirm()
  }

  return { confirmDialog, showConfirm, handleConfirm, clearConfirm }
})
