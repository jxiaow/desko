<script setup lang="ts">
import { ref } from 'vue'
import { authApi as api } from '../../services/api/auth'
import { useToastStore } from '../../stores/toast'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'

const toastStore = useToastStore()

const emit = defineEmits<{
  close: []
}>()

const show = ref(true)
const form = ref({ oldPassword: '', newPassword: '', confirmPassword: '' })
const err = ref('')

const doChangePassword = async () => {
  err.value = ''
  
  if (!form.value.oldPassword) {
    err.value = '请输入当前密码'
    return
  }
  if (form.value.newPassword.length < 6) {
    err.value = '新密码至少需要 6 位'
    return
  }
  if (form.value.newPassword !== form.value.confirmPassword) {
    err.value = '两次输入的新密码不一致'
    return
  }
  
  try {
    await api.changeMasterPassword(form.value.oldPassword, form.value.newPassword)
    show.value = false
    toastStore.showToast('密码修改成功')
    emit('close')
  } catch (e: any) {
    err.value = e.message || '修改失败'
  }
}

const close = () => {
  show.value = false
  emit('close')
}

useEscapeClose(close)
</script>

<template>
  <Transition name="dialog">
    <div v-if="show" class="dialog-overlay">
    <div class="dialog masterpw-dialog" role="dialog" aria-modal="true" aria-label="修改主密码">
      <div class="dialog-header">
        <h3>修改主密码</h3>
        <button  class="dialog-close" @click="close" title="关闭">
          <AppIcon name="x" :size="16" />
        </button>
      </div>
      <div class="dialog-body">
        <div class="form-group">
          <label>当前密码</label>
          <input v-model="form.oldPassword" type="password" placeholder="请输入当前密码" />
        </div>
        <div class="form-group">
          <label>新密码</label>
          <input v-model="form.newPassword" type="password" placeholder="至少 6 位" />
        </div>
        <div class="form-group">
          <label>确认新密码</label>
          <input v-model="form.confirmPassword" type="password" placeholder="再次输入新密码" @keyup.enter="doChangePassword" />
        </div>
        <p v-if="err" class="dialog-err">{{ err }}</p>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" @click="close">取消</button>
        <button class="btn-primary" @click="doChangePassword">修改</button>
      </div>
    </div>
    </div>
  </Transition>
</template>

<style scoped>
/* 三格密码栈不需要 500px：与小记口令弹窗同宽，字段宽度也就跟着统一 */
.masterpw-dialog { width: 380px; }
</style>
