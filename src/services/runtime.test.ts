import { afterEach, describe, expect, it } from 'vitest'
import { isWebRuntime } from './runtime'

afterEach(() => document.querySelectorAll('meta[name="desko-runtime"]').forEach(meta => meta.remove()))

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
})
