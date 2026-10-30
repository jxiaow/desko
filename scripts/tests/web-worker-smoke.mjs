// Run after cargo build: node scripts/tests/web-worker-smoke.mjs [path/to/desko]
// Uses a fixture gateway; never opens a desktop window or invokes Codex CLI.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'

const secret = randomBytes(32).toString('hex')
const sessions = new Set()
let epoch = 1
const gateway = createServer(async (req, res) => {
  if (req.headers.authorization !== secret) { res.writeHead(403).end(); return }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const input = JSON.parse(Buffer.concat(chunks))
  if (req.url === '/resource') {
    const bytes = input.public ? Buffer.from('<html><head></head><body>fixture</body></html>') : Buffer.alloc(256 * 1024, 42)
    res.writeHead(200, { 'Content-Type': input.public ? 'text/html' : 'application/octet-stream', 'Content-Length': bytes.length, 'X-Desko-Download': input.public ? '0' : '1' }).end(bytes)
    return
  }
  let result = null
  switch (input.operation) {
    case 'epoch': result = epoch || null; break
    case 'hosts': result = []; break
    case 'verify':
      if (input.password !== 'fixture-password') { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: '密码错误' })); return }
      break
    case 'fork': result = randomBytes(16).toString('hex'); sessions.add(result); break
    case 'release': sessions.delete(input.session); break
    case 'invoke':
      assert(sessions.has(input.session))
      result = { command: input.command, args: input.args }
      break
    default: throw new Error(`Unexpected operation ${input.operation}`)
  }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result))
})
gateway.listen(0, '127.0.0.1')
await once(gateway, 'listening')
const address = `http://127.0.0.1:${gateway.address().port}`
const program = resolve(process.argv[2] || `src-tauri/target/debug/desko${process.platform === 'win32' ? '.exe' : ''}`)
const workers = []
async function start(port = 0) {
  const child = spawn(program, ['--desko-web-worker'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  workers.push(child)
  const line = once(createInterface({ input: child.stdout }), 'line')
  child.stdin.write(`${JSON.stringify({ address, secret, port, lan: false })}\n`)
  const [text] = await Promise.race([line, new Promise((_, reject) => child.once('error', reject)), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Worker startup timed out')), 15000); timer.unref() })])
  const status = JSON.parse(text)
  assert(!status.error, status.error)
  return { child, status, url: status.urls[0] }
}
async function stop(worker) {
  const exited = once(worker.child, 'exit')
  worker.child.stdin.end()
  const [code] = await Promise.race([exited, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Worker failed to exit on parent EOF')), 6000); timer.unref() })])
  assert.equal(code, 0)
}
const request = (worker, path, cookie, body) => fetch(`${worker.url}${path}`, { method: body ? 'POST' : 'GET', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(6000) })
async function login(worker) {
  const reply = await request(worker, '/api/login', null, { password: 'fixture-password' })
  assert.equal(reply.status, 200)
  return reply.headers.get('set-cookie').split(';')[0]
}
try {
  const app = await start()
  assert.notEqual(app.child.pid, process.pid)
  const appCookie = await login(app)
  assert(appCookie.startsWith('desko_web='))
  const html = await (await request(app, '/codex')).text()
  assert.match(html, /name="desko-runtime" content="web"/)
  assert(!html.includes('desko-service'))
  const reply = await request(app, '/api/invoke', appCookie, { command: 'list_notes', args: {} })
  assert.deepEqual(await reply.json(), { command: 'list_notes', args: {} })
  const download = await request(app, '/api/files/fixture', appCookie)
  assert.equal((await download.arrayBuffer()).byteLength, 256 * 1024)
  await stop(app)
  const restarted = await start(app.status.port)
  assert.equal((await request(restarted, '/api/session', appCookie)).status, 401)
  epoch++
  assert.equal((await request(restarted, '/api/session', appCookie)).status, 401)
  await stop(restarted)
  console.log('Headless process verified: login, streamed download, immediate restart, epoch revocation and parent EOF cleanup.')
} finally {
  for (const child of workers) if (child.exitCode === null) child.kill()
  gateway.closeAllConnections()
  gateway.close()
}
