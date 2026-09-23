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

  it('开启只落库开关，不自动拉起服务', async () => {
    mockInvoke.mockResolvedValue('false') // get_setting
    const { saveFileshareFeature, fileshareEnabled } = await loadFeature()
    await saveFileshareFeature(true)
    expect(mockInvoke).toHaveBeenCalledWith('set_setting', { key: 'fileshare_enabled', value: 'true' })
    expect(mockInvoke).not.toHaveBeenCalledWith('fileshare_start')
    expect(fileshareEnabled.value).toBe(true)
  })

  it('关闭时写 false 并停服', async () => {
    mockInvoke.mockResolvedValue(undefined)
    const { saveFileshareFeature, fileshareEnabled } = await loadFeature()
    fileshareEnabled.value = true
    await saveFileshareFeature(false)
    expect(settingsCalls()).toContainEqual(['fileshare_enabled', 'false'])
    expect(mockInvoke).toHaveBeenCalledWith('fileshare_stop')
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
