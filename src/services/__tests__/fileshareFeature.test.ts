import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'

const mockInvoke = vi.mocked(invoke)

// fileshareFeature 是模块级单例，每个用例重新加载模块清掉 loaded 缓存
async function loadFeature() {
  vi.resetModules()
  return await import('../fileshareFeature')
}

function settingsCalls(): Array<[string, string]> {
  return mockInvoke.mock.calls
    .filter(([cmd]) => cmd === 'set_setting')
    .map(([, args]: any) => [args.key, args.value])
}

describe('fileshareFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('读取失败时保持关闭', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('db down'))
    const { readFileshareFeature, fileshareEnabled } = await loadFeature()
    expect(await readFileshareFeature()).toBe(false)
    expect(fileshareEnabled.value).toBe(false)
  })

  it('开启时按顺序写开关再拉起服务', async () => {
    mockInvoke.mockResolvedValue('false') // get_setting
    const { saveFileshareFeature } = await loadFeature()
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'fileshare_start') return { running: true }
      return undefined
    })
    await saveFileshareFeature(true)
    expect(mockInvoke).toHaveBeenCalledWith('set_setting', { key: 'fileshare_enabled', value: 'true' })
    expect(mockInvoke).toHaveBeenCalledWith('fileshare_start')
    const seq = mockInvoke.mock.calls.map(([c]) => c)
    expect(seq.indexOf('set_setting')).toBeLessThan(seq.indexOf('fileshare_start'))
  })

  it('关闭时写 false 并停服', async () => {
    mockInvoke.mockResolvedValue(undefined)
    const { saveFileshareFeature, fileshareEnabled } = await loadFeature()
    fileshareEnabled.value = true
    await saveFileshareFeature(false)
    expect(settingsCalls()).toContainEqual(['fileshare_enabled', 'false'])
    expect(mockInvoke).toHaveBeenCalledWith('fileshare_stop')
  })

  it('start 失败回滚开关与持久值并把错误抛出', async () => {
    mockInvoke.mockResolvedValue(undefined)
    const { saveFileshareFeature, fileshareEnabled } = await loadFeature()
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'fileshare_start') throw new Error('端口都被占用')
      return undefined
    })
    await expect(saveFileshareFeature(true)).rejects.toThrow('端口都被占用')
    expect(fileshareEnabled.value).toBe(false)
    // 回滚写了第二次 false
    const writes = settingsCalls().filter(([k]) => k === 'fileshare_enabled')
    expect(writes).toEqual([['fileshare_enabled', 'true'], ['fileshare_enabled', 'false']])
  })

  it('stop 失败不阻塞关闭', async () => {
    mockInvoke.mockResolvedValue(undefined)
    const { saveFileshareFeature } = await loadFeature()
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'fileshare_stop') throw new Error('noop')
      return undefined
    })
    await saveFileshareFeature(false)
    expect(mockInvoke).toHaveBeenCalledWith('set_setting', { key: 'fileshare_enabled', value: 'false' })
  })

  it('写设置本身失败：开关回滚、不动服务、错误上抛', async () => {
    mockInvoke.mockResolvedValue(undefined)
    const { saveFileshareFeature, fileshareEnabled } = await loadFeature()
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'set_setting') throw new Error('db locked')
      return undefined
    })
    await expect(saveFileshareFeature(true)).rejects.toThrow('db locked')
    expect(fileshareEnabled.value).toBe(false)
    expect(mockInvoke).not.toHaveBeenCalledWith('fileshare_start')
  })
})
