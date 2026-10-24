import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fileshareApi, type FileShareStatus } from './api/fileshare'
import { clearFileshareSession, fsBusy, fsConfig, fsLoaded, fsRefresh, fsSaveConfig, fsStatus } from './fileshareSettings'

vi.mock('./api/fileshare', () => ({ fileshareApi: { status: vi.fn(), getConfig: vi.fn(), saveConfig: vi.fn(), setPassword: vi.fn(), setTheme: vi.fn(async () => {}) } }))
const status: FileShareStatus = { running: true, configuredPort: 8000, boundPort: 8000, localUrl: 'http://127.0.0.1:8000', lanUrl: 'http://192.168.1.2:8000', shareCount: 1, localOnly: false }
const config = { port: 8000, shareDirs: ['C:/fixture'], localOnly: false, hasPassword: true }
beforeEach(() => { setActivePinia(createPinia()); vi.resetAllMocks(); clearFileshareSession() })

it('logout discards a pending refresh instead of restoring old shared directories', async () => {
  let finish!: (value: FileShareStatus) => void
  vi.mocked(fileshareApi.status).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  vi.mocked(fileshareApi.getConfig).mockResolvedValue(config)
  const refresh = fsRefresh()
  clearFileshareSession()
  finish(status)
  await refresh
  expect(fsStatus.value).toBeNull()
  expect(fsConfig.value).toBeNull()
  expect(fsLoaded.value).toBe(false)
})

it('an old save cannot clear a replacement sessions busy state or trigger a refresh', async () => {
  let finishOld!: (value: FileShareStatus) => void
  let finishNew!: (value: FileShareStatus) => void
  vi.mocked(fileshareApi.saveConfig)
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve }))
  const old = fsSaveConfig(['C:/old'], 8000, false)
  clearFileshareSession()
  const current = fsSaveConfig(['C:/current'], 8000, false)
  finishOld(status)
  await old
  expect(fsBusy.value).toBe(true)
  expect(fsStatus.value).toBeNull()
  expect(fileshareApi.status).not.toHaveBeenCalled()
  vi.mocked(fileshareApi.status).mockResolvedValue(status)
  vi.mocked(fileshareApi.getConfig).mockResolvedValue({ ...config, shareDirs: ['C:/current'] })
  finishNew(status)
  await current
  expect(fsBusy.value).toBe(false)
  expect(fsConfig.value?.shareDirs).toEqual(['C:/current'])
})
