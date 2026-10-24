import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// Generates schemas only: never starts a task, logs in, or calls a model.
const methods = {
  'ClientRequest.json': ['initialize', 'account/read', 'model/list', 'thread/list', 'thread/start', 'thread/resume', 'thread/turns/list', 'turn/start', 'turn/interrupt'],
  'ClientNotification.json': ['initialized'],
  'ServerRequest.json': ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput'],
  'ServerNotification.json': ['turn/started', 'turn/completed', 'item/started', 'item/completed', 'item/agentMessage/delta', 'item/commandExecution/outputDelta', 'serverRequest/resolved', 'error'],
}
function findCodex() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN
  if (process.platform === 'win32') {
    const arm = process.arch === 'arm64'
    const native = path.join(process.env.APPDATA || '', `npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-${arm ? 'arm64' : 'x64'}/vendor/${arm ? 'aarch64' : 'x86_64'}-pc-windows-msvc/bin/codex.exe`)
    if (existsSync(native)) return native
  }
  return process.platform === 'win32' ? 'codex.exe' : 'codex'
}
function methodNames(value, result = new Set()) {
  if (!value || typeof value !== 'object') return result
  for (const method of value.properties?.method?.enum || []) result.add(method)
  for (const child of Object.values(value)) if (child && typeof child === 'object') methodNames(child, result)
  return result
}
let temporary
try {
  const index = process.argv.indexOf('--schema-dir')
  const root = index < 0 ? (temporary = mkdtempSync(path.join(tmpdir(), 'desko-codex-schema-'))) : process.argv[index + 1]
  if (!root) throw new Error('--schema-dir requires a directory')
  if (temporary) {
    const cli = findCodex()
    console.log(execFileSync(cli, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim())
    execFileSync(cli, ['app-server', 'generate-json-schema', '--out', root, '--experimental'], { windowsHide: true, timeout: 30000, stdio: 'pipe' })
  }
  for (const [file, required] of Object.entries(methods)) {
    const available = methodNames(JSON.parse(readFileSync(path.join(root, file), 'utf8')))
    const missing = required.filter(name => !available.has(name))
    if (missing.length) throw new Error(`${file}: missing ${missing.join(', ')}`)
    console.log(`${file}: ${required.length} methods verified`)
  }
  for (const [file, fields] of Object.entries({
    'v2/ThreadListParams.json': ['cursor', 'limit', 'sourceKinds', 'sortKey'],
    'v2/ThreadStartParams.json': ['cwd', 'sandbox', 'approvalPolicy', 'approvalsReviewer', 'serviceName', 'model'],
    'v2/ThreadResumeParams.json': ['threadId', 'cwd', 'sandbox', 'excludeTurns'],
    'v2/TurnStartParams.json': ['threadId', 'cwd', 'input'],
    'v2/ThreadTurnsListParams.json': ['threadId', 'limit', 'itemsView', 'sortDirection', 'cursor'],
  })) {
    const schema = JSON.parse(readFileSync(path.join(root, file), 'utf8'))
    const missing = fields.filter(field => !schema.properties?.[field])
    if (missing.length) throw new Error(`${file}: missing fields ${missing.join(', ')}`)
  }
  console.log('Desko Codex dialog protocol verified.')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true })
}
