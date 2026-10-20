import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { usePageAutoRefresh } from './usePageAutoRefresh'
import { useEscapeClose } from './useEscapeClose'
import { usePageActive } from './usePageActive'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('页面隐藏期间异步创建的子组件也保持停用，切回后才响应事件', async () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const refresh = vi.fn(async () => {})
  const close = vi.fn()
  const visible = ref(true)
  const showChild = ref(false)
  const Child = defineComponent({
    setup() {
      usePageAutoRefresh(refresh, () => false)
      useEscapeClose(close)
      return () => h('div')
    },
  })
  const Page = defineComponent({
    setup() {
      usePageActive()
      return () => showChild.value ? h(Child) : h('div')
    },
  })
  const wrapper = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => visible.value ? h(Page) : h('div') }),
  }))

  try {
    visible.value = false
    await nextTick()
    showChild.value = true
    await nextTick()
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    vi.advanceTimersByTime(30_000)
    expect(refresh).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()

    visible.value = true
    await nextTick()
    expect(refresh).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(close).toHaveBeenCalledTimes(1)
  } finally {
    wrapper.unmount()
  }
})

it('缓存的隐藏页面不轮询、不处理窗口焦点和 Escape，切回后恢复，卸载后清理', async () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const refresh = vi.fn(async () => {})
  const close = vi.fn()
  const visible = ref(true)
  const busy = ref(false)
  const Page = defineComponent({
    setup() {
      usePageAutoRefresh(refresh, () => busy.value)
      useEscapeClose(close)
      return () => h('div')
    },
  })
  const wrapper = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => visible.value ? h(Page) : h('div') }),
  }))
  const focus = () => window.dispatchEvent(new Event('focus'))
  const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

  try {
    focus()
    expect(refresh).toHaveBeenCalledTimes(1)
    visible.value = false
    await nextTick()
    vi.advanceTimersByTime(30_000)
    focus()
    escape()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()

    visible.value = true
    await nextTick()
    expect(refresh).toHaveBeenCalledTimes(2)
    escape()
    expect(close).toHaveBeenCalledTimes(1)
    busy.value = true
    vi.advanceTimersByTime(30_000)
    focus()
    expect(refresh).toHaveBeenCalledTimes(2)
  } finally {
    wrapper.unmount()
  }

  busy.value = false
  vi.advanceTimersByTime(30_000)
  focus()
  escape()
  expect(refresh).toHaveBeenCalledTimes(2)
  expect(close).toHaveBeenCalledTimes(1)
})
