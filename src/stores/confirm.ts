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

  const handleConfirm = () => {
    confirmDialog.value.onConfirm()
    confirmDialog.value.show = false
  }

  return { confirmDialog, showConfirm, handleConfirm }
})
