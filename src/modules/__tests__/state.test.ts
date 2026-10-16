import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import type { ModuleId } from '../registry'

const mockInvoke = vi.mocked(invoke)

// state.ts 是模块级单例，每个用例重新加载以清掉 loaded 缓存
async function loadState() {
  vi.resetModules()
  return await import('../state')
}

function settingsCalls(): Array<[string, string]> {
  return mockInvoke.mock.calls
    .filter(([cmd]) => cmd === 'set_setting')
    .map(([, args]: any) => [args.key, args.value])
}

/** 后端按 key 答复；表里没有的键回空串，等同于"这个键从没写过" */
function answerWith(map: Record<string, string>) {
  mockInvoke.mockImplementation(async (cmd: string, args: any) => {
    if (cmd === 'get_setting') return map[args.key] ?? ''
    return undefined
  })
}

describe('module state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('默认关的模块：读不到设置也不出现入口', async () => {
    const { loadModuleFlags, moduleFlags } = await loadState()
    mockInvoke.mockRejectedValue(new Error('db down'))
    await loadModuleFlags()
    expect(moduleFlags.mfa).toBe(false)
    expect(moduleFlags.fileshare).toBe(false)
    expect(moduleFlags.tunnel).toBe(false)
    expect(moduleFlags.bypass).toBe(false)
    expect(moduleFlags.codex).toBe(false)
  })

  it('默认开的模块：老库缺键按开读，只有显式 false 才关', async () => {
    const { loadModuleFlags, moduleFlags } = await loadState()
    answerWith({})
    await loadModuleFlags()
    expect(moduleFlags.notes).toBe(true)
    expect(moduleFlags.entries).toBe(true)
    expect(moduleFlags.files).toBe(true)

    vi.resetModules()
    const reloaded = await loadState()
    answerWith({ entries_enabled: 'false' })
    await reloaded.loadModuleFlags()
    expect(reloaded.moduleFlags.entries).toBe(false)
    expect(reloaded.moduleFlags.notes).toBe(true)
  })

  it('读一次就够：第二次不再打后端', async () => {
    const { loadModuleFlags } = await loadState()
    answerWith({})
    await loadModuleFlags()
    const reads = mockInvoke.mock.calls.filter(([cmd]) => cmd === 'get_setting').length
    await loadModuleFlags()
    expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === 'get_setting').length).toBe(reads)
  })

  it('开关的键名与注册表一致，且都落在后端白名单内', async () => {
    const { MODULES } = await import('../registry')
    const { loadModuleFlags } = await loadState()
    answerWith({})
    await loadModuleFlags()
    const readKeys = mockInvoke.mock.calls
      .filter(([cmd]) => cmd === 'get_setting')
      .map(([, args]: any) => args.key)
    expect(readKeys.sort()).toEqual(MODULES.map((m) => m.settingKey).sort())
  })

  it('开启只落库开关，不自动拉起服务', async () => {
    const { setModuleEnabled, moduleFlags } = await loadState()
    answerWith({})
    await setModuleEnabled('tunnel', true)
    expect(settingsCalls()).toContainEqual(['tunnel_enabled', 'true'])
    expect(mockInvoke).not.toHaveBeenCalledWith('tunnel_start')
    expect(moduleFlags.tunnel).toBe(true)
  })

  it('关闭时写 false 并连带停服', async () => {
    const { setModuleEnabled, moduleFlags } = await loadState()
    answerWith({})
    moduleFlags.tunnel = true
    await setModuleEnabled('tunnel', false)
    expect(settingsCalls()).toContainEqual(['tunnel_enabled', 'false'])
    expect(mockInvoke).toHaveBeenCalledWith('tunnel_stop')

    moduleFlags.fileshare = true
    await setModuleEnabled('fileshare', false)
    expect(mockInvoke).toHaveBeenCalledWith('fileshare_stop')
  })

  it('停服失败不阻塞关闭：进程还有作业对象兜底', async () => {
    const { setModuleEnabled } = await loadState()
    answerWith({})
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'tunnel_stop') throw new Error('noop')
      return undefined
    })
    await setModuleEnabled('tunnel', false)
    expect(mockInvoke).toHaveBeenCalledWith('set_setting', { key: 'tunnel_enabled', value: 'false' })
  })

  it('写设置失败：开关扳回缺省值、不动进程、错误上抛', async () => {
    const { setModuleEnabled, moduleFlags } = await loadState()
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'set_setting') throw new Error('db locked')
      return ''
    })
    await expect(setModuleEnabled('tunnel', true)).rejects.toThrow('db locked')
    expect(moduleFlags.tunnel).toBe(false)
    expect(mockInvoke).not.toHaveBeenCalledWith('tunnel_stop')
  })

  it('已开启的模块落库失败：扳回的是原值，不是缺省值', async () => {
    const { setModuleEnabled, moduleFlags } = await loadState()
    answerWith({})
    moduleFlags.mfa = true
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'set_setting') throw new Error('db locked')
      return ''
    })
    await expect(setModuleEnabled('mfa', false)).rejects.toThrow('db locked')
    expect(moduleFlags.mfa).toBe(true)
  })
  it('落地页取启用模块里排最前的那个，全关时没有页面可去', async () => {
    const { landingPath, moduleFlags } = await loadState()
    expect(landingPath()).toBe('/notes')
    moduleFlags.notes = false
    expect(landingPath()).toBe('/entries')
    for (const id of Object.keys(moduleFlags)) moduleFlags[id as ModuleId] = false
    expect(landingPath()).toBeNull()
  })

  it('解锁只喂启用的模块，锁定也清理关闭过的模块', async () => {
    const { bootEnabledModules, lockEnabledModules, moduleFlags } = await loadState()
    const boot = vi.fn()
    const lock = vi.fn()
    const { moduleById } = await import('../registry')
    moduleById('entries').boot = boot
    moduleById('entries').onLock = lock
    moduleById('notes').onLock = lock

    moduleFlags.entries = true
    moduleFlags.notes = false
    moduleFlags.files = false
    moduleFlags.codex = true
    await bootEnabledModules()
    expect(boot).toHaveBeenCalledTimes(1)

    lockEnabledModules()
    // notes 关闭后留下的会话明文也必须收回。
    expect(lock).toHaveBeenCalledTimes(2)

    moduleById('entries').boot = undefined
    moduleById('entries').onLock = undefined
    moduleById('notes').onLock = undefined
  })
})

describe('Web 模块白名单', () => {
  it('Web 登录前不开放模块，登录后读取七个共用开关，网络直连仍限桌面', async () => {
    const meta = document.createElement('meta')
    meta.name = 'desko-runtime'
    meta.content = 'web'
    document.head.append(meta)
    try {
      const s = await loadState()
      const { settingsApi } = await import('../../services/api/settings')
      const read = vi.spyOn(settingsApi, 'getSetting').mockResolvedValue('true')
      const write = vi.spyOn(settingsApi, 'setSetting').mockResolvedValue(undefined)
      await s.loadModuleFlags()
      expect(s.enabledModules.value).toEqual([])
      expect(read).not.toHaveBeenCalled()
      await s.refreshWebModuleFlags()
      expect(s.enabledModules.value.map(module => module.id)).toEqual(['notes', 'entries', 'files', 'mfa', 'fileshare', 'tunnel', 'codex'])
      expect(s.isModuleEnabled('codex')).toBe(true)
      expect(read).toHaveBeenCalledTimes(7)
      await s.setModuleEnabled('tunnel', true)
      expect(write).toHaveBeenCalledWith('tunnel_enabled', 'true')
      await expect(s.setModuleEnabled('bypass', true)).rejects.toThrow('此模块仅在桌面版可用')
      read.mockRestore()
      write.mockRestore()
    } finally { meta.remove() }
  })

  it('Web 核心模块关闭时不强制开启，旧库缺键与桌面缺省一致', async () => {
    const meta = document.createElement('meta')
    meta.name = 'desko-runtime'; meta.content = 'web'; document.head.append(meta)
    try {
      const state = await loadState()
      const { settingsApi } = await import('../../services/api/settings')
      const read = vi.spyOn(settingsApi, 'getSetting').mockResolvedValue('false')
      await state.refreshWebModuleFlags()
      expect(state.enabledModules.value).toEqual([])
      expect(state.landingPath()).toBeNull()
      read.mockResolvedValue('')
      await state.refreshWebModuleFlags()
      expect(state.enabledModules.value.map(module => module.id)).toEqual(['notes', 'entries', 'files'])
      read.mockRestore()
    } finally { meta.remove() }
  })
})
