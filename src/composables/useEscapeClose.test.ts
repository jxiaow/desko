import { describe, it, expect, vi } from 'vitest'
import { defineComponent, h, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useEscapeClose } from './useEscapeClose'

const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

/** visible 为 null 时按"挂载即可见"处理，对应 v-if 渲染的弹窗；否则对应常驻组件里的内层弹窗 */
const mountDialog = (close: () => void, visible?: Ref<boolean>) =>
  mount(
    defineComponent({
      setup() {
        useEscapeClose(close, visible ? () => visible.value : undefined)
        return () => h('div')
      },
    }),
  )

describe('useEscapeClose', () => {
  it('组合输入中的 Escape 留给输入法，不关闭弹窗', () => {
    const close = vi.fn()
    const wrapper = mountDialog(close)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }))
    expect(close).not.toHaveBeenCalled()
    esc()
    expect(close).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('书写面先让编辑器处理 Escape，命令菜单处理后不关闭书写面或下层目录', () => {
    const under = vi.fn(), over = vi.fn()
    const a = mountDialog(under)
    const b = mount(defineComponent({
      setup() {
        useEscapeClose(over, undefined, { afterTarget: true })
        return () => h('input')
      },
    }), { attachTo: document.body })
    const input = b.element
    input.addEventListener('keydown', (e: Event) => e.preventDefault(), { once: true })
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(over).not.toHaveBeenCalled()
    expect(under).not.toHaveBeenCalled()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(over).toHaveBeenCalledTimes(1)
    expect(under).not.toHaveBeenCalled()
    b.unmount()
    esc()
    expect(under).toHaveBeenCalledTimes(1)
    a.unmount()
  })

  it('Esc 触发关闭', () => {
    const close = vi.fn()
    const wrapper = mountDialog(close)
    esc()
    expect(close).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    esc()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('只关最上面那层，一次按键不该带走叠着的两个弹窗', () => {
    const under = vi.fn()
    const over = vi.fn()
    const a = mountDialog(under)
    const b = mountDialog(over)

    esc()
    expect(over).toHaveBeenCalledTimes(1)
    expect(under).not.toHaveBeenCalled()

    b.unmount()
    esc()
    expect(under).toHaveBeenCalledTimes(1)

    a.unmount()
  })

  it('常驻弹窗按可见性注册：藏着时不抢按键，重新打开又能响应', () => {
    const visible = ref(false)
    const close = vi.fn()
    const wrapper = mountDialog(close, visible)

    esc()
    expect(close).not.toHaveBeenCalled()

    visible.value = true
    esc()
    expect(close).toHaveBeenCalledTimes(1)

    // 关掉再打开：注册表里不该留下重复条目，否则一次按键会连发两次
    visible.value = false
    visible.value = true
    esc()
    expect(close).toHaveBeenCalledTimes(2)

    wrapper.unmount()
  })

  it('后打开的常驻弹窗排在先打开的之上', () => {
    const settings = vi.fn()
    const confirm = vi.fn()
    const settingsVisible = ref(true)
    const confirmVisible = ref(false)
    const a = mountDialog(settings, settingsVisible)
    const b = mountDialog(confirm, confirmVisible)

    confirmVisible.value = true
    esc()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(settings).not.toHaveBeenCalled()

    confirmVisible.value = false
    esc()
    expect(settings).toHaveBeenCalledTimes(1)

    a.unmount()
    b.unmount()
  })
})
