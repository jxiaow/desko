<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { profilesApi } from '../../services/api/profiles'
import type { Profile } from '../../services/api/profiles'
import { errText } from '../../services/api/backup'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'
import { useNotesStore } from '../../stores/notes'
import { htmlHasContent } from '../../utils/format'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'

const toastStore = useToastStore()
const confirmStore = useConfirmStore()

const profiles = ref<Profile[]>([])
const busy = ref(false)
/** 切换已下发：进程即将重启换根，UI 自持遮罩（promise 不会 resolve） */
const switching = ref('')

async function refresh() {
  try {
    const list = await profilesApi.list()
    profiles.value = list.profiles
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
}

onMounted(refresh)

/* ---------- 新建 / 重命名（同一个弹窗，靠 mode 分档） ---------- */
const dlg = ref<{ show: boolean; mode: 'create' | 'rename'; id: string; name: string; ns: string }>({
  show: false, mode: 'create', id: '', name: '', ns: '',
})
const dlgErr = ref('')
const closeDlg = () => { dlg.value.show = false; dlgErr.value = '' }
useEscapeClose(closeDlg, () => dlg.value.show)

const openCreate = () => {
  dlg.value = { show: true, mode: 'create', id: '', name: '', ns: '' }
  dlgErr.value = ''
}
const openRename = (p: Profile) => {
  dlg.value = { show: true, mode: 'rename', id: p.id, name: p.name, ns: p.cloudNs }
  dlgErr.value = ''
}

const submitDlg = async () => {
  dlgErr.value = ''
  const name = dlg.value.name.trim()
  if (!name) { dlgErr.value = '请输入档案名'; return }
  busy.value = true
  try {
    if (dlg.value.mode === 'create') {
      await profilesApi.create(name, dlg.value.ns.trim() || undefined)
      toastStore.showToast('档案已创建')
    } else {
      await profilesApi.rename(dlg.value.id, name)
      toastStore.showToast('已重命名')
    }
    closeDlg()
    await refresh()
  } catch (e) {
    dlgErr.value = errText(e)
  } finally {
    busy.value = false
  }
}

/* ---------- 删除（当前档 / 唯一档不可删） ---------- */
const doDelete = (p: Profile) => {
  confirmStore.showConfirm(
    '删除档案',
    `永久删除「${p.name}」的全部本机数据，无法撤销。云端备份会保留。`,
    async () => {
      busy.value = true
      try {
        await profilesApi.delete(p.id)
        toastStore.showToast('档案已删除')
        await refresh()
      } catch (e) {
        toastStore.showToast(errText(e), 'error')
      } finally {
        busy.value = false
      }
    },
  )
}

/* ---------- 切换（写 active 后重启换根） ---------- */
const doSwitch = (p: Profile) => {
  confirmStore.showConfirm(
    '切换档案',
    `重启应用并切换到「${p.name}」？当前档案的数据会保留。`,
    async () => {
      switching.value = p.name
      try {
        const notesStore = useNotesStore()
        if (htmlHasContent(notesStore.noteDraftHtml)) {
          throw new Error('请先保存或放弃未保存的小记，再切换档案')
        }
        await notesStore.flushNoteSave()
        await profilesApi.switchTo(p.id)
      } catch (e) {
        switching.value = ''
        toastStore.showToast('切换已取消：' + errText(e), 'error')
      }
      // 成功即分叉重启，这里不恢复遮罩，让它一路到进程消失
    },
  )
}
</script>

<template>
  <div class="profiles-pane">
    <p class="pane-hint">档案之间的数据与云同步相互独立，切换时会重启应用。</p>

    <div class="plist">
      <div v-for="p in profiles" :key="p.id" class="prow">
        <div class="pinfo">
          <div class="pname-line">
            <span class="pname">{{ p.name }}</span>
            <span v-if="p.isActive" class="badge own">使用中</span>
          </div>
          <div class="pns">云目录 <code>{{ p.cloudBase }}</code></div>
        </div>
        <div class="pacts">
          <template v-if="p.isActive">
            <button class="action-btn" :disabled="busy" @click="openRename(p)">
              <AppIcon name="edit" :size="14" />
              重命名
            </button>
            <!-- 当前档不可删（后端同样拒）：先切走才能删，所以这颗永远灰着 -->
            <button class="action-btn danger" disabled>
              <AppIcon name="trash" :size="14" />
              删除
            </button>
          </template>
          <template v-else>
            <button class="action-btn primary" :disabled="busy || !!switching" @click="doSwitch(p)">
              <AppIcon name="arrowRight" :size="14" />
              切换
            </button>
            <button class="action-btn icon-btn" title="重命名" :disabled="busy" @click="openRename(p)">
              <AppIcon name="edit" :size="15" />
            </button>
            <button class="action-btn icon-btn danger" title="删除" :disabled="busy" @click="doDelete(p)">
              <AppIcon name="trash" :size="15" />
            </button>
          </template>
        </div>
      </div>

      <button class="add-row" :disabled="busy || !!switching" @click="openCreate">
        <AppIcon name="plus" :size="14" />
        新建档案
      </button>
    </div>

    <!-- 新建 / 重命名弹窗 -->
    <Transition name="dialog">
      <div v-if="dlg.show" class="dialog-overlay pane-overlay">
        <div class="dialog dialog-sm" role="dialog" aria-modal="true" :aria-label="dlg.mode === 'create' ? '新建档案' : '重命名档案'">
          <div class="dialog-header">
            <h3>{{ dlg.mode === 'create' ? '新建档案' : '重命名档案' }}</h3>
            <button class="dialog-close" title="关闭" @click="closeDlg">
              <AppIcon name="x" :size="16" />
            </button>
          </div>
          <div class="dialog-body">
            <div class="form-group">
              <label>档案名</label>
              <input v-model="dlg.name" type="text" placeholder="如：工作" maxlength="32" @keyup.enter="submitDlg" />
            </div>
            <div v-if="dlg.mode === 'create'" class="form-group">
              <label>云端目录标识<span class="field-opt">选填</span></label>
              <input v-model="dlg.ns" type="text" placeholder="留空则自动生成" maxlength="32" @keyup.enter="submitDlg" />
              <p class="lead">创建后不可修改，仅限小写字母、数字和连字符。</p>
            </div>
            <p v-if="dlgErr" class="dialog-err">{{ dlgErr }}</p>
          </div>
          <div class="dialog-footer">
            <button class="btn-secondary" @click="closeDlg">取消</button>
            <button class="btn-primary" :disabled="busy" @click="submitDlg">
              {{ dlg.mode === 'create' ? '创建' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 切换中遮罩：进程重启换根，promise 不 resolve，UI 自持 -->
    <div v-if="switching" class="switch-guard">
      <div class="switch-note">
        <AppIcon name="refresh" :size="16" />
        正在切换到「{{ switching }}」，应用即将重启…
      </div>
    </div>
  </div>
</template>

<style scoped>
.profiles-pane {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* 档案行与设置行统一：44px 行高，靠间距区分条目。 */
.prow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: 44px;
  padding: 8px var(--space-2);
  margin: 0 calc(var(--space-2) * -1);
}
.pinfo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.pname-line { display: flex; align-items: center; gap: var(--space-2); }
.pname {
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pns {
  font-size: var(--text-xs);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pns code {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  color: var(--text-secondary);
  background: var(--fill);
  padding: 1px 5px;
  border-radius: var(--radius-xs);
}
.pacts { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

/* 底部通栏新建行：与行同宽同负边距，hover 填充才对得上上面的发丝线 */
.add-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: calc(100% + var(--space-4));
  min-height: 44px;
  padding: 10px;
  margin: 0 calc(var(--space-2) * -1);
  border: none;
  border-radius: var(--radius-tag);
  background: transparent;
  font-family: inherit;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}
.add-row:hover:not(:disabled) { color: var(--accent); background: var(--accent-soft); }
.add-row svg { opacity: 0.8; }
.add-row:disabled { color: var(--text-faint); cursor: default; }

.field-opt { font-size: var(--text-2xs); color: var(--text-muted); font-weight: 400; margin-left: 6px; }

/* 叠在设置弹窗之上：同为 fixed z-1000，靠 z-index 抬一层压上主壳 */
.pane-overlay { z-index: 1100; }

/* 切换遮罩：盖住整块面板，随进程消失 */
.switch-guard {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: var(--overlay);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.switch-note {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-sm);
  color: var(--text);
}
</style>
