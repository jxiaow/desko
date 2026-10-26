import { afterEach, describe, expect, it } from 'vitest'
import { isWebRuntime, markWebRuntimeRoot } from './runtime'

afterEach(() => {
  document.querySelectorAll('meta[name="desko-runtime"]').forEach(meta => meta.remove())
  document.documentElement.classList.remove('desko-web')
})

describe('显式 Web 运行时', () => {
  it('没有服务端标记时维持桌面版，包括现有 E2E 页面', () => {
    expect(isWebRuntime()).toBe(false)
  })
  it('仅 web 标记启用浏览器路径', () => {
    const meta = document.createElement('meta')
    meta.name = 'desko-runtime'
    meta.content = 'desktop'
    document.head.append(meta)
    expect(isWebRuntime()).toBe(false)
    meta.content = 'web'
    expect(isWebRuntime()).toBe(true)
  })
  it('Web 标记落在 <html>，桌面与 E2E 页面一律不落地', () => {
    // 桌面：内置的 2.7 MB 中文字体照常，视觉不变
    expect(markWebRuntimeRoot()).toBe(false)
    expect(document.documentElement.classList.contains('desko-web')).toBe(false)
    const meta = document.createElement('meta')
    meta.name = 'desko-runtime'
    meta.content = 'web'
    document.head.append(meta)
    expect(markWebRuntimeRoot()).toBe(true)
    expect(document.documentElement.classList.contains('desko-web')).toBe(true)
    // 重复调用（热重启/测试重挂）不得叠出第二个类
    markWebRuntimeRoot()
    expect(document.documentElement.className.trim()).toBe('desko-web')
  })
})
