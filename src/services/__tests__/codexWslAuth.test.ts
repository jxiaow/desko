import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { useToastStore } from '../../stores/toast'
import type { CodexAccount, CodexSwitchOutcome, CodexWslAssignment } from '../api/codex'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const call = vi.mocked(invoke)
const account = { id: 'a', email: 'new@example.invalid', auth_mode: 'oauth' } as CodexAccount
const assignment: CodexWslAssignment = { targets: [{ distro: 'Ubuntu', user: 'fake' }], current: { id: 'a', email: account.email }, consistent: true }
const windows = { closedApp: 0, closedCli: 0, reopenedApp: 0, reopenedCli: 0, reopenFailures: 0 }
async function state() { vi.resetModules(); return import('../codexState') }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => { setActivePinia(createPinia()); vi.resetAllMocks() })
describe('WSL 显式账号分配', () => {
  it('只读探测只发一个新命令，不写设置或凭据', async () => {
    call.mockResolvedValue(assignment)
    const s = await state(); await s.loadWslAssignment()
    expect(s.wslAssignment.value).toEqual(assignment)
    expect(call.mock.calls.map(([cmd]) => cmd)).toEqual(['get_codex_wsl_assignment'])
  })
  it('较早的回包和锁屏前回包都不能覆盖新探测', async () => {
    const old = deferred<CodexWslAssignment>(), latest = deferred<CodexWslAssignment>()
    call.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
    const s = await state(), first = s.loadWslAssignment(), second = s.loadWslAssignment()
    latest.resolve(assignment); await second
    old.resolve({ targets: [], current: null, consistent: false }); await first
    expect(s.wslAssignment.value).toEqual(assignment)
    const pending = deferred<CodexWslAssignment>(); call.mockReturnValueOnce(pending.promise)
    const request = s.loadWslAssignment(); s.clearCodexSession(); pending.resolve(assignment); await request
    expect(s.wslAssignment.value).toBeNull()
  })
  it('探测失败清掉旧徽标，保持静默', async () => {
    const s = await state(); s.wslAssignment.value = assignment
    call.mockRejectedValue(new Error('probe failed')); await s.loadWslAssignment()
    expect(s.wslAssignment.value).toBeNull(); expect(useToastStore().toast.show).toBe(false)
  })
  it('单独分配只发账号 id，不改变 Windows 当前账号', async () => {
    const s = await state(); s.currentId.value = 'windows-old'
    const outcome = { status: 'done' as const, targets: 1, written: 1, daemonsStopped: 1, clisStopped: 2, failures: [] }
    call.mockImplementation(async cmd => cmd === 'assign_codex_account_to_wsl' ? outcome : assignment)
    await s.assignToWsl(account)
    expect(call).toHaveBeenCalledWith('assign_codex_account_to_wsl', { accountId: 'a' })
    expect(call.mock.calls.map(([cmd]) => cmd)).toEqual(['assign_codex_account_to_wsl', 'get_codex_wsl_assignment'])
    expect(s.currentId.value).toBe('windows-old'); expect(s.busyId.value).toBe('')
  })
  it('WSL 分配在途使用同一忙碌门，不排队执行 Windows 切号', async () => {
    const s = await state(); const pending = deferred<any>(); call.mockReturnValue(pending.promise)
    const work = s.assignToWsl(account)
    await expect(s.switchTo('b', { restartWindows: true, applyToWsl: true })).rejects.toThrow('正在处理')
    pending.resolve({ status: 'aborted', failures: [{ message: 'cannot stop' }] }); await work
    expect(call.mock.calls.some(([cmd]) => cmd === 'switch_codex_account')).toBe(false)
  })
})
describe('Windows 重启设置与结果摘要', () => {
  it('缺省关闭，保存失败保留原值，切号时拒绝改值', async () => {
    const s = await state(); call.mockResolvedValue(''); await s.loadSwitchRestart()
    expect(s.switchRestartWindows.value).toBe(false)
    call.mockRejectedValue(new Error('save failed')); await expect(s.saveSwitchRestart(true)).rejects.toThrow('save failed')
    expect(s.switchRestartWindows.value).toBe(false); expect(s.switchRestartSaving.value).toBe(false)
    s.switchingId.value = 'a'; await expect(s.saveSwitchRestart(true)).rejects.toThrow('正在切换')
  })
  it('只写新设置键，成功摘要不包含零数量或未执行的 WSL', async () => {
    const s = await state(); call.mockResolvedValue(undefined); await s.saveSwitchRestart(true)
    expect(call).toHaveBeenCalledWith('set_setting', { key: 'codex_switch_restart_codex', value: 'true' })
    const result: CodexSwitchOutcome = { account, windows, wsl: null, warnings: [] }
    expect(s.switchOutcomeText(result)).toBe(`已切换到 ${account.email}`)
    result.wsl = { status: 'aborted', targets: 2, written: 0, daemonsStopped: 0, clisStopped: 0, failures: [{ distro: 'Ubuntu', user: 'fake', message: 'cannot stop' }] }
    expect(s.switchOutcomeText(result)).toContain('WSL 未跟随')
  })
})
