import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 标题栏面包屑的唯一来源：页面内不再铺身份行，页名与条数由当前模块上报。
 * 当前可见模块上报；缓存中的模块暂停上报，重新激活时补写。
 */
export const usePageHeadStore = defineStore('pageHead', () => {
  const label = ref('')
  const count = ref('')

  const setHead = (nextLabel: string, nextCount = '') => {
    label.value = nextLabel
    count.value = nextCount
  }

  return { label, count, setHead }
})
