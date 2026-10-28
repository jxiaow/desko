import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { codexApi, type CodexAccount, type CodexSwitchOutcome, type CodexWslOutcome } from '../../services/api/codex'
import { assignToWsl, switchTo } from '../../services/codexState'
import CodexSwitchDialog from './CodexSwitchDialog.vue'
import CodexWslAssignDialog from './CodexWslAssignDialog.vue'

vi.mock('../../services/api/codex', () => ({ codexApi: {
  previewCodexSwitch: vi.fn(), previewCodexWslAssignment: vi.fn(), relaunchCodexClients: vi.fn(),
} }))
vi.mock('../../services/codexState', async () => {
  const { ref } = await import('vue')
  return { assignToWsl: vi.fn(), switchTo: vi.fn(), loadSwitchRestart: vi.fn(), switchRestartWindows: ref(false), switchStep: ref('') }
})

const account = { id: 'a', email: 'fixture@example.invalid', auth_mode: 'oauth' } as CodexAccount
const windows = { closedApp: 0, closedCli: 0, reopenedApp: 0, reopenedCli: 0, reopenFailures: 0 }
const done: CodexWslOutcome = { status: 'done', targets: 2, written: 2, daemonsStopped: 0, clisStopped: 0, failures: [] }
const partial: CodexWslOutcome = { ...done, status: 'partial', written: 1, failures: [{ distro: 'Debian', user: 'bob', message: 'fixture write failed' }] }
const preview = { targets: [{ distro: 'Ubuntu', user: 'alice' }, { distro: 'Debian', user: 'bob' }], current: null, consistent: false, daemonCount: 0, cliCount: 0, alreadyAssigned: false, canApply: true }
let wrapper: VueWrapper
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(codexApi.previewCodexSwitch).mockResolvedValue({ windows: { appCount: 0, cliCount: 0 }, wsl: preview })
  vi.mocked(codexApi.previewCodexWslAssignment).mockResolvedValue(preview)
  vi.mocked(assignToWsl).mockResolvedValue(done)
})
afterEach(() => { wrapper?.unmount() })
function open(component: typeof CodexSwitchDialog | typeof CodexWslAssignDialog) {
  wrapper = mount(component, { props: { account }, global: { stubs: { Teleport: true } } })
  return flushPromises()
}

it('独立 WSL 应用部分失败时保留错误与重试入口，重试成功后才关闭', async () => {
  vi.mocked(assignToWsl).mockResolvedValueOnce(partial)
  await open(CodexWslAssignDialog)
  await wrapper.get('.btn-danger').trigger('click')
  await flushPromises()
  expect(wrapper.emitted('close')).toBeUndefined()
  expect(wrapper.get('[role="alert"]').text()).toContain('Debian（bob）')
  await wrapper.get('.dialog-body .action-btn').trigger('click')
  await flushPromises()
  await wrapper.get('.btn-danger').trigger('click')
  await flushPromises()
  expect(assignToWsl).toHaveBeenCalledTimes(2)
  expect(wrapper.emitted('close')).toHaveLength(1)
})

for (const wsl of [partial, { ...done, status: 'aborted' as const, written: 0, failures: partial.failures }, { ...done, status: 'skipped' as const, targets: 0, written: 0 }]) {
  it(`Windows 成功、WSL ${wsl.status} 时只重试 WSL，不重复切号`, async () => {
    vi.mocked(switchTo).mockResolvedValue({ account, windows, wsl })
    await open(CodexSwitchDialog)
    await wrapper.get('input').setValue(true)
    await wrapper.get('.btn-danger').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.get('.btn-danger').text()).toBe('重试 WSL')
    await wrapper.get('.btn-danger').trigger('click')
    await flushPromises()
    expect(switchTo).toHaveBeenCalledTimes(1)
    expect(assignToWsl).toHaveBeenCalledOnce()
    expect(codexApi.relaunchCodexClients).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
}

it('Windows 重开和 WSL 都失败时逐项重试，已成功的操作不再执行', async () => {
  const outcome: CodexSwitchOutcome = { account, windows: { ...windows, reopenFailures: 1, reopenPlanId: 'fixture-plan' }, wsl: partial }
  vi.mocked(switchTo).mockResolvedValue(outcome)
  vi.mocked(codexApi.relaunchCodexClients).mockResolvedValue(windows)
  await open(CodexSwitchDialog)
  await wrapper.get('input').setValue(true)
  await wrapper.get('.btn-danger').trigger('click')
  await flushPromises()
  expect(wrapper.get('.btn-danger').text()).toBe('重新打开 Codex')
  await wrapper.get('.btn-danger').trigger('click')
  await flushPromises()
  expect(wrapper.emitted('close')).toBeUndefined()
  expect(wrapper.get('.btn-danger').text()).toBe('重试 WSL')
  await wrapper.get('.btn-danger').trigger('click')
  await flushPromises()
  expect(switchTo).toHaveBeenCalledTimes(1)
  expect(codexApi.relaunchCodexClients).toHaveBeenCalledTimes(1)
  expect(assignToWsl).toHaveBeenCalledTimes(1)
  expect(wrapper.emitted('close')).toHaveLength(1)
})

it('WSL 重试遇到登录态过期时，仍提供 WSL 重试而非提示 Windows 重开计划过期', async () => {
  vi.mocked(switchTo).mockResolvedValue({ account, windows, wsl: partial })
  vi.mocked(assignToWsl).mockRejectedValueOnce(new Error('登录态已过期，请先重新应用账号'))
  await open(CodexSwitchDialog)
  await wrapper.get('input').setValue(true)
  await wrapper.get('.btn-danger').trigger('click')
  await flushPromises()
  await wrapper.get('.btn-danger').trigger('click')
  await flushPromises()
  expect(wrapper.get('.btn-danger').text()).toBe('重试 WSL')
  expect(wrapper.get('.btn-danger').attributes('disabled')).toBeUndefined()
  expect(wrapper.get('[role="alert"]').text()).toContain('登录态已过期')
})

it('Windows 重开计划过期仍可单独重试 WSL，完成后保留 Windows 手动打开提示', async () => {
  vi.mocked(switchTo).mockResolvedValue({ account, windows: { ...windows, reopenFailures: 1, reopenPlanId: 'expired-plan' }, wsl: partial })
  vi.mocked(codexApi.relaunchCodexClients).mockRejectedValue(new Error('重开计划已过期，请手动打开 Codex'))
  await open(CodexSwitchDialog)
  await wrapper.get('input').setValue(true)
  await wrapper.get('.btn-danger').trigger('click')
  await flushPromises()
  await wrapper.get('.btn-danger').trigger('click')
  await flushPromises()
  expect(wrapper.get('.btn-danger').text()).toBe('重试 WSL')
  expect(wrapper.get('.btn-danger').attributes('disabled')).toBeUndefined()
  await wrapper.get('.btn-danger').trigger('click')
  await flushPromises()
  expect(assignToWsl).toHaveBeenCalledOnce()
  expect(wrapper.get('[role="alert"]').text()).toContain('请手动打开')
  expect(wrapper.get('.btn-danger').text()).toBe('请手动打开 Codex')
  expect(wrapper.get('.btn-danger').attributes('disabled')).toBeDefined()
})
