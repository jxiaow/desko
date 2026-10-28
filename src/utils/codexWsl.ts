import type { CodexWslOutcome } from '../services/api/codex'

/** 空串表示无需重试；失败摘要保留具体的发行版、用户与原因。 */
export function codexWslFailure(result: CodexWslOutcome | null | undefined): string {
  if (!result || (result.status === 'done' && !result.failures.length)) return ''
  const summary = result.status === 'skipped'
    ? '未检测到运行中的 WSL 目标，请启动对应环境后重试'
    : result.status === 'aborted'
      ? 'WSL 未切换，请手动退出 Codex 后重试'
      : `WSL ${result.written} 个目标成功、${result.failures.length} 个失败`
  const details = result.failures.map(failure => `${failure.distro}${failure.user ? `（${failure.user}）` : ''}：${failure.message}`).join('；')
  return details ? `${summary}；${details}` : summary
}
