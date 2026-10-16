#!/usr/bin/env node
/**
 * 假 cloudflared：吃与真二进制相同的参数，按剧本产出凭据、隧道、路由与 connector。
 *
 * 存在的理由是把「授权 → 建隧道 → 指路由 → 探测劈流」这条状态机放进自动化里跑。
 * 真账号、真浏览器、真 DNS 那一段验不了，但状态机要的只是接口形状：
 * 参数怎么摆、结果长什么样、失败时说什么话、退出码是几。这些本文件逐条照抄真二进制。
 *
 * 剧本由环境变量给：
 *   DESKO_MOCK_STATE  必填，状态目录（state.json 落这里）
 *   DESKO_MOCK_HOME   login 的兜底落点目录（当真二进制把 cert 写到 ~/.cloudflared 时用它模拟）
 *   DESKO_MOCK_LOGIN  write-origincert | write-home | never | slow
 *   DESKO_MOCK_DELAY  login 落凭据前的毫秒数，默认 300
 *   DESKO_MOCK_CONNECTORS  给 `tunnel info` 注入的 connector 数组（JSON），用来演劈流
 *
 * 两条刻意保留的真二进制怪癖：
 *   1. 未知 flag 只打 "Incorrect Usage…" 并**退 0** —— 调用方拿退出码当成功判据就会被骗过。
 *   2. cert 不在时报错自带搜索到的绝对路径 —— 那是给用户看的诊断信息，别洗成一句话。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const argv = process.argv.slice(2)
const STATE_DIR = process.env.DESKO_MOCK_STATE
const HOME_DIR = process.env.DESKO_MOCK_HOME || join(process.env.USERPROFILE || process.env.HOME || STATE_DIR || '.', '.cloudflared')
const LOGIN_MODE = process.env.DESKO_MOCK_LOGIN || 'write-origincert'
const LOGIN_DELAY = Number(process.env.DESKO_MOCK_DELAY || 300)
if (!STATE_DIR) {
  console.error('DESKO_MOCK_STATE is required')
  process.exit(2)
}
const STATE_FILE = join(STATE_DIR, 'state.json')

function load() {
  if (!existsSync(STATE_FILE)) {
    return { zone: 'example.com', tunnels: {}, routes: {}, connectors: {}, creds: {} }
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
}
function save(s) {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2))
}
function uuid(seed) {
  const hex = (n) => (n & 0xff).toString(16).padStart(2, '0')
  let h = 0x811c9dc5
  for (const c of seed) h = ((h ^ c.charCodeAt(0)) * 0x01000193) >>> 0
  const b = Array.from({ length: 16 }, (_, i) => (((h >> ((i % 4) * 8)) & 0xff) ^ (i * 7)) & 0xff)
  return `${b.slice(0, 4).map(hex).join('')}-${b.slice(4, 6).map(hex).join('')}-4${hex(b[7]).slice(0, 1)}${hex(b[8])}-${hex(b[9])}-${b.slice(10, 16).map(hex).join('')}`
}

/// 真 CLI 知道哪些是布尔开关，我们这份通用解析器不知道：漏了它，`--overwrite-dns <ID>`
/// 会把隧道 ID 当成开关的值吞掉，位置参数全体错位。
const BOOLEANS = new Set(['no-autoupdate', 'overwrite-dns', 'f', 'd', 'post-quantum', 'pq', 'fedramp', 'hello-world', 'invert-sort', 'show-recently-disconnected', 'rd'])

/** 只认 `--flag value` 与 `-o json` 两种形态，够覆盖我们用到的全部参数 */
function parse(args) {
  const flags = {}
  const rest = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a.startsWith('-')) { rest.push(a); continue }
    const key = a.replace(/^--?/, '')
    if (BOOLEANS.has(key)) { flags[key] = true; continue }
    const next = args[i + 1]
    if (next === undefined || next.startsWith('--')) { flags[key] = true; continue }
    flags[key] = next
    i++
  }
  return { flags, rest }
}

const writeAt = (p, text) => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, text)
}

// 真二进制的层级：全局 → tunnel 命令级 → 子命令 → 子命令级 → 位置参数
const head = parse(argv)
if (head.rest[0] !== 'tunnel') {
  console.error(`Incorrect Usage. unknown command "${head.rest[0] || ''}"`)
  process.exit(0)
}
const cmd = head.rest[1]
const tail = parse(head.rest.slice(2))
// 上面那次 parse 吃的是整条 argv，flag 全落在 head.flags、位置参数才留在 head.rest，
// 所以两级 flag 必须合并来读，否则子命令级参数（--credentials-file / --name / -o）会凭空消失。
const flags = { ...head.flags, ...tail.flags }
const certPath = flags.origincert || process.env.TUNNEL_ORIGIN_CERT
const known = ['list', 'login', 'create', 'token', 'route', 'info', 'run', 'ready', 'delete']
if (!known.includes(cmd)) {
  console.error(`Incorrect Usage. flag provided but not defined: -${cmd}`)
  process.exit(0)
}

function needCert() {
  if (!certPath || !existsSync(certPath)) {
    const p = certPath || '(未指定)'
    console.log(JSON.stringify({ level: 'error', message: `Cannot find a valid certificate for your origin at the path:\n\n    ${p}\n`, originCertPath: p, time: new Date().toISOString() }))
    console.error(`Error locating origin cert: cannot find a valid certificate at the path ${p}`)
    process.exit(1)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const s = load()

  if (cmd === 'login') {
    // 真二进制这一段会先拉浏览器再打印，这里只把 URL 交给调用方去开
    console.log('A browser window should have opened for you to complete the login.')
    console.log('If you can\'t see above window, make sure to go visit this URL')
    console.log('')
    console.log(' https://login.cloudflareaccess.org/MOCK-AUTH-TOKEN')
    console.log('')
    if (LOGIN_MODE === 'never') { await sleep(10 * 60 * 1000); return }
    await sleep(LOGIN_DELAY)
    const pem = '-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----\n'
    if (LOGIN_MODE === 'write-home') {
      writeAt(join(HOME_DIR, 'cert.pem'), pem)
    } else if (LOGIN_MODE === 'slow') {
      await sleep(10 * 60 * 1000)
    } else {
      writeAt(certPath, pem)
    }
    console.log(`You have successfully logged to the domain: ${s.zone}`)
    return
  }

  if (cmd === 'list') {
    needCert()
    let rows = Object.values(s.tunnels)
    if (typeof flags.name === 'string') rows = rows.filter((t) => t.name === flags.name)
    console.log(JSON.stringify(rows.length ? rows.map((t) => ({ created_at: t.createdAt, id: t.id, name: t.name, connections: null })) : null, null, 2))
    return
  }

  if (cmd === 'create') {
    needCert()
    const name = tail.rest[0]
    if (!name) { console.error('Error: missing tunnel NAME'); process.exit(1) }
    if (Object.values(s.tunnels).some((t) => t.name === name)) {
      console.error(`Error creating tunnel: a tunnel with the name "${name}" already exists`)
      process.exit(1)
    }
    const id = uuid(name)
    s.tunnels[id] = { id, name, createdAt: new Date().toISOString(), connections: 0 }
    const creds = typeof flags['credentials-file'] === 'string' ? flags['credentials-file'] : null
    if (creds) {
      writeAt(creds, JSON.stringify({ AccountID: 'mock-account', TunnelID: id, TunnelSecret: 'bW9jaw==' }))
    }
    console.log(JSON.stringify({ id, name, created_at: s.tunnels[id].createdAt, connections: null }, null, 2))
    save(s)
    return
  }

  if (cmd === 'token') {
    needCert()
    const ref = tail.rest[0]
    const t = s.tunnels[ref] || Object.values(s.tunnels).find((x) => x.name === ref)
    if (!t) { console.error(`Error fetching tunnel credentials: tunnel ${ref} not found`); process.exit(1) }
    const creds = flags['cred-file'] || flags['credentials-file']
    if (typeof creds === 'string') {
      writeFileSync(creds, JSON.stringify({ AccountID: 'mock-account', TunnelID: t.id, TunnelSecret: 'bW9jaw==' }))
    }
    console.log(`eyJ0dW5uZWw6I${t.id}`)
    return
  }

  if (cmd === 'route') {
    needCert()
    const [kind, ref, host] = tail.rest
    if (kind !== 'dns') { console.error(`Unsupported route kind ${kind}`); process.exit(1) }
    const t = s.tunnels[ref] || Object.values(s.tunnels).find((x) => x.name === ref)
    if (!t) { console.error(`Error looking up tunnel ${ref}: tunnel not found`); process.exit(1) }
    if (!host.endsWith(`.${s.zone}`)) {
      console.error(`error validating remote DNS: hostname ${host} is not within the zone ${s.zone} registered for this account`)
      process.exit(1)
    }
    s.routes[host] = t.id
    save(s)
    console.log(`Successfully assigned ${host} to ${t.name}`)
    return
  }

  if (cmd === 'info') {
    needCert()
    const ref = tail.rest[0]
    const t = s.tunnels[ref] || Object.values(s.tunnels).find((x) => x.name === ref)
    if (!t) { console.error(`Error looking up tunnel ${ref}: tunnel not found`); process.exit(1) }
    const injected = process.env.DESKO_MOCK_CONNECTORS
      ? JSON.parse(process.env.DESKO_MOCK_CONNECTORS)
      : s.connectors[t.id] || []
    console.log(JSON.stringify({ id: t.id, name: t.name, createdAt: t.createdAt, conns: injected }, null, 2))
    return
  }

  if (cmd === 'ready') {
    const ok = existsSync(flags.pidfile || '')
    process.exit(ok ? 0 : 1)
  }

  if (cmd === 'run') {
    needCert()
    const pidfile = flags.pidfile
    const logfile = flags.logfile
    await sleep(200)
    if (typeof pidfile === 'string') writeFileSync(pidfile, String(process.pid))
    if (typeof logfile === 'string') appendFileSync(logfile, `registered connector for ${tail.rest[0]}\n`)
    // 起来就不退：真 connector 是常驻的，测试靠杀进程收尾
    await sleep(10 * 60 * 1000)
    return
  }
}

await main()
