/** Account-switch UI fixtures. No OS process or credential file is accessed. */
export interface SwitchUxConfig {
  windows?: { appCount?: number; cliCount?: number; previewError?: string; closeError?: string; reopenFailures?: number; planExpired?: boolean }
  wsl?: { probeError?: string; stopError?: string; targets: { distro: string; user: string; email?: string; accountId?: string; daemonCount?: number; cliCount?: number; writeFails?: boolean; identityMismatch?: boolean }[] }
  credentialsError?: string
  previewDelayMs?: number
}
export interface SwitchUxState { config: SwitchUxConfig; operations: string[]; plans: Record<string, number> }
interface Account { id: string; email: string; auth_mode: string; account_id?: string | null }
interface Context { accounts: Account[]; currentId: string; switchUx: SwitchUxState }
export const switchUxState = (config: SwitchUxConfig = {}): SwitchUxState => ({ config: structuredClone(config), operations: [], plans: {} })
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
export function assignment(ctx: Context) {
  const wsl = ctx.switchUx.config.wsl
  if (wsl?.probeError) return { targets: [], current: null, consistent: false, error: wsl.probeError }
  const targets = wsl?.targets ?? []
  const first = targets.find(t => t.accountId) ?? targets[0]
  const consistent = !!first && !!(first.accountId || first.email) && targets.every(t => first.accountId && t.accountId ? first.accountId === t.accountId : !!t.email && t.email.toLowerCase() === first.email?.toLowerCase())
  const account = consistent ? ctx.accounts.find(a => a.auth_mode !== 'apikey' && (a.account_id && first.accountId ? a.account_id === first.accountId : a.email.toLowerCase() === first.email?.toLowerCase())) : undefined
  return { targets: targets.map(({ distro, user }) => ({ distro, user })), current: consistent ? { id: account?.id ?? null, email: first.email ?? '' } : null, consistent }
}
export async function wslPreview(ctx: Context, account: Account) {
  await delay(ctx.switchUx.config.previewDelayMs ?? 0)
  const result = assignment(ctx)
  if ('error' in result) throw result.error
  const targets = ctx.switchUx.config.wsl?.targets ?? []
  return { ...result, daemonCount: targets.reduce((sum,t) => sum + (t.daemonCount ?? 0), 0), cliCount: targets.reduce((sum,t) => sum + (t.cliCount ?? 0), 0), alreadyAssigned: result.current?.id === account.id, canApply: account.auth_mode !== 'apikey' }
}
export async function switchPreview(ctx: Context, account: Account, restart: boolean) {
  const windows = ctx.switchUx.config.windows
  try {
    const wsl = await wslPreview(ctx, account)
    return { windows: { appCount: restart ? windows?.appCount ?? 0 : 0, cliCount: restart ? windows?.cliCount ?? 0 : 0 }, windowsError: restart ? windows?.previewError : undefined, wsl: wsl.targets.length ? wsl : null }
  } catch (error) {
    return { windows: { appCount: restart ? windows?.appCount ?? 0 : 0, cliCount: restart ? windows?.cliCount ?? 0 : 0 }, windowsError: restart ? windows?.previewError : undefined, wsl: null, wslError: String(error) }
  }
}
export function applyWsl(ctx: Context, account: Account) {
  const { config, operations } = ctx.switchUx
  const targets = config.wsl?.targets ?? []
  const result = { status: targets.length ? 'done' : 'skipped', targets: targets.length, written: 0, daemonsStopped: 0, clisStopped: 0, failures: [] as { distro: string; user: string; message: string }[] }
  if (config.wsl?.probeError || config.wsl?.stopError) {
    operations.push('stopWsl:failed'); result.status = 'aborted'
    result.failures.push({ distro: 'WSL', user: '', message: config.wsl.probeError || config.wsl.stopError || '' }); return result
  }
  for (const target of targets) {
    operations.push(`stopWsl:${target.user}`)
    result.daemonsStopped += target.daemonCount ?? 0; result.clisStopped += target.cliCount ?? 0
    target.daemonCount = 0; target.cliCount = 0
  }
  for (const target of targets) {
    operations.push(`writeWsl:${target.user}`)
    if (target.writeFails || target.identityMismatch) {
      result.status = 'partial'; result.failures.push({ distro: target.distro, user: target.user, message: target.identityMismatch ? 'WSL 写入后账号身份不一致' : 'WSL 写入失败' }); continue
    }
    target.email = account.email; target.accountId = account.account_id ?? undefined; result.written++
  }
  return result
}
export function relaunch(ctx: Context, id: string) {
  if (ctx.switchUx.config.windows?.planExpired || !ctx.switchUx.plans[id]) throw '重开计划已过期，请手动打开 Codex'
  ctx.switchUx.operations.push('relaunchWindows')
  const count = ctx.switchUx.plans[id]!
  delete ctx.switchUx.plans[id]
  return { closedApp: 0, closedCli: 0, reopenedApp: 0, reopenedCli: count, reopenFailures: 0 }
}
