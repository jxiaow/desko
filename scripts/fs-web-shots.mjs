// 局域网传输网页真机拍图：起真 sidecar + 真目录，用 Playwright 拍服务端渲染出来的页面。
// 用法: node scripts/fs-web-shots.mjs [--keep]
// 产物: .tmp/fs-web/shots/*.png   （32 帧：纸/墨 × 1280·1920·760·390 × 下载/上传弹窗各态/设置/拖入/登录/关氛围/批量折叠）
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const root = process.cwd()
const tmp = join(root, '.tmp', 'fs-web')
const out = join(tmp, 'shots')
const share = join(tmp, 'share')
const keep = process.argv.includes('--keep')
rmSync(tmp, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

/* ---------- 造两份真目录：类型覆盖 11 档，日期打散到两个月 ---------- */
const DAY = 86400
const now = Math.floor(Date.now() / 1000)

function seed(dir, list) {
  mkdirSync(dir, { recursive: true })
  for (const [name, kb, ago] of list) {
    const p = join(dir, name)
    writeFileSync(p, Buffer.alloc(kb * 1024, 0x41))
    utimesSync(p, now - ago, now - ago)
  }
}
const docs = join(share, 'docs')
const photos = join(share, 'photos')
seed(docs, [
  ['项目周报-2026W42.pdf', 2400, 2 * DAY],
  ['假期照片 093.jpg', 4800, 3 * DAY],
  ['desko-src-backup.zip', 12000, 4 * DAY],
  ['客户对账单.xlsx', 88, 5 * DAY],
  ['季度复盘.pptx', 900, 9 * DAY],
  ['sync-fileshare-server.rs', 3, 11 * DAY],
  ['README.md', 6, 13 * DAY],
  ['会议室录音.mp3', 5200, 20 * DAY],
  ['培训回放.mp4', 30000, 26 * DAY],
  ['虚拟机镜像.vhdx', 200, 40 * DAY],
  ['特殊 &\'%#名字.txt', 1, 60 * DAY],
])
seed(photos, [['婚礼-相册导出.zip', 700, 70 * DAY], ['IMG_2043.png', 1500, 80 * DAY]])

/* 批量档的原料住在共享目录之外：投进去会污染别的帧，只有收尾那两帧用得上 */
const bulk = join(tmp, 'bulk')
const BULK = Array.from({ length: 40 }, (_, i) => `交付包-part${String(i + 1).padStart(2, '0')}.zip`)
seed(bulk, BULK.map((n) => [n, 256, 0]))
const empty = join(share, 'empty')
mkdirSync(empty, { recursive: true })

const sha = (s) => createHash('sha256').update(s).digest('hex')
const configFile = join(tmp, 'fileshare.json')
const statusFile = join(tmp, 'status.json')

function writeCfg({ theme, base, accent, atmosphere, password, dirs }) {
  writeFileSync(configFile, JSON.stringify({
    port: 8123,
    localOnly: true,
    shareDirs: dirs || [docs, photos],
    passwordSha256: password ? sha(password) : null,
    public: [],
    theme,
    base,
    accent,
    atmosphere,
  }, null, 2))
}

execFileSync('cargo', ['build', '-p', 'fileshare-core', '--bin', 'desko-fileshare'], {
  cwd: join(root, 'src-tauri'),
  stdio: 'inherit',
})
const exe = join(root, 'src-tauri', 'target', 'debug', 'desko-fileshare.exe')
// 起进程前必须先有配置：main.rs 读不到文件直接 exit(2)
writeCfg({ theme: 'paper', base: 'light', accent: 'ink', atmosphere: 'on' })
const proc = spawn(exe, ['--config', configFile, '--status', statusFile], { stdio: ['ignore', 'ignore', 'pipe'] })
proc.stderr.on('data', (d) => console.log(`  ! sidecar: ${d.toString().trim()}`))
const stopAll = () => proc.kill()

async function apply(opts) {
  writeCfg(opts)
  // 服务进程 400ms 轮询一次签名；等过一轮再拍，否则拍到的是上一戳
  await new Promise((r) => setTimeout(r, 900))
  for (let i = 0; i < 40; i++) {
    try {
      const s = JSON.parse(readFileSync(statusFile, 'utf8'))
      if (s.boundPort) return `http://127.0.0.1:${s.boundPort}`
    } catch {
      /* 状态文件还没落盘 */
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error('sidecar 没在 9 秒内写出 boundPort')
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })

async function shot(name, url, w, h, prep) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => console.log(`  ! pageerror ${name}: ${e.message}`))
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForTimeout(250)
  if (prep) await prep(page)
  await page.mouse.move(w - 8, h - 8)
  await page.waitForTimeout(120)
  await page.screenshot({ path: join(out, `${name}.png`) })
  console.log(`${name}.png`)
  await page.close()
}

/* 类型档体检：图标色压在不透明卡面上的实际对比度（--ft-* 只随纸/墨换档，强调色不动） */
async function probeTypes(label, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } })
  await page.goto(url, { waitUntil: 'load' })
  const out2 = await page.evaluate(() => {
    const rgba = (s) => {
      const n = (s.match(/[\d.]+/g) || []).map(Number)
      return n.length >= 3 ? { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 } : null
    }
    const over = (f, b) => ({
      r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a),
      b: f.b * f.a + b.b * (1 - f.a), a: 1,
    })
    function back(el) {
      let acc = null
      for (let n = el; n; n = n.parentElement) {
        const c = rgba(getComputedStyle(n).backgroundColor)
        if (!c || c.a === 0) continue
        acc = acc === null ? { ...c } : over(acc, c)
        if (acc.a >= 1) break
      }
      return acc
    }
    const lum = (c) => {
      const f = (v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
      return (x + 0.05) / (y + 0.05)
    }
    const seen = new Map()
    for (const el of document.querySelectorAll('.tile')) {
      const bucket = [...el.classList].find((c) => c !== 'tile') || 'unk'
      if (seen.has(bucket)) continue
      const bg = back(el)
      const fg = rgba(getComputedStyle(el).color)
      if (bg && fg) seen.set(bucket, +ratio(fg, bg).toFixed(2))
    }
    return [...seen]
  })
  await page.close()
  /* 类型档是装饰位（文件名与扩展名才是正文），判据不是绝对 4.5 而是家族水位：
     新加的一档只要落在同一族里就不算跑偏。unk 是中性档，天生比彩档低，不入水位。 */
  const chroma = out2.filter(([b]) => b !== 'unk').map(([, r]) => r).sort((a, b) => a - b)
  const mid = chroma[Math.floor(chroma.length / 2)]
  const at = (b) => out2.find(([k]) => k === b)?.[1] ?? '-'
  console.log(`  类型档 ${label}: 水位 ${chroma[0]}~${chroma[chroma.length - 1]} 中位 ${mid} │ ` +
    out2.map(([b, r]) => `${b} ${r}`).join(' ') +
    ` │ 新档 vid ${at('vid')} audio ${at('audio')}`)
}
const openUp = (page) => page.evaluate(() => document.getElementById('btn-upload').click())
const openText = (page) => page.evaluate(() => document.querySelector('#up-bg .seg [data-pane=text]').click())
async function throttle(page, kbps) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: Math.round(kbps * 1024),
  })
}
const sendFiles = (paths, ms, kbps) => async (p) => {
  if (kbps) await throttle(p, kbps)
  await openUp(p)
  await p.locator('#well-input').setInputFiles(paths)
  await p.waitForTimeout(ms)
}

const files2 = ['desko-src-backup.zip', '假期照片 093.jpg'].map((n) => join(docs, n))
/* 「在投」那几帧必须限速才拍得到：loopback 上 16 MB 在 600ms 内就投完了，
   不限速拍到的是投完态（和 07 重复）。2 MB/s 让它在镜头里还在走。 */
const LIVE_KBPS = 2000

/* ── 纸·浅·群青（氛围开）── */
let url = await apply({ theme: 'paper', base: 'light', accent: 'ink', atmosphere: 'on' })
await shot('01-dl-paper-1280', url, 1280, 820)
await shot('02-dl-hover', url, 1280, 820, (p) => p.locator('.frow').first().hover())
await shot('03-dl-search', url, 1280, 820, async (p) => {
  await p.locator('#file-search').fill('周报')
  await p.waitForTimeout(700)
})
await shot('04-dl-miss', url, 1280, 820, async (p) => {
  await p.locator('#file-search').fill('绝对没有的词')
  await p.waitForTimeout(700)
})
await shot('05-up-empty', url, 1280, 820, openUp)
await shot('06-up-live', url, 1280, 820, sendFiles(files2, 900, LIVE_KBPS))
await shot('07-up-done', url, 1280, 820, sendFiles(files2, 2600))
await shot('08-up-text', url, 1280, 820, async (p) => {
  await openUp(p)
  await openText(p)
})
await shot('09-dl-1920', url, 1920, 1080)
await shot('10-up-1920', url, 1920, 1080, sendFiles(files2, 900, LIVE_KBPS))
await shot('11-dl-760', url, 760, 820)
await shot('12-settings', url, 1280, 820, (p) => p.locator('#btn-settings').click())
/* 拖入中：造一次真 DataTransfer，让药丸报出真的文件数（Playwright 的 drag API 不落 drop，这里只拍状态） */
await shot('13-dl-veil', url, 1280, 820, (p) => p.evaluate(() => {
  const dt = new DataTransfer()
  for (const n of ['a.txt', 'b.txt', 'c.txt']) dt.items.add(new File(['x'], n, { type: 'text/plain' }))
  document.body.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }))
}))
await probeTypes('纸·群青', url)

/* ── 0 文件 + 单目录（底栏那句提示的说法随目录数变）── */
url = await apply({ theme: 'paper', base: 'light', accent: 'ink', atmosphere: 'on', dirs: [empty] })
await shot('14-dl-empty', url, 1280, 820)
await shot('15-up-empty-1dir', url, 1280, 820, openUp)

/* ── 墨·深·青 ── */
url = await apply({ theme: 'ink', base: 'dark', accent: 'teal', atmosphere: 'on' })
await shot('16-dl-ink', url, 1280, 820)
await shot('17-dl-ink-1920', url, 1920, 1080)
await shot('18-up-ink-live', url, 1280, 820, sendFiles(files2, 900, LIVE_KBPS))
await shot('19-settings-ink', url, 1280, 820, (p) => p.locator('#btn-settings').click())
await shot('20-dl-ink-scrolled', url, 1280, 430, (p) => p.evaluate(() => window.scrollTo(0, 300)))
await probeTypes('墨·青', url)

/* ── 手机 390 ── */
await shot('21-phone-dl', url, 390, 844)
await shot('22-phone-up-live', url, 390, 844, sendFiles(files2, 900, LIVE_KBPS))
await shot('23-phone-up-text', url, 390, 844, async (p) => {
  await openUp(p)
  await openText(p)
})
await shot('24-phone-settings', url, 390, 844, (p) => p.locator('#btn-settings').click())

/* ── 口令页（另起一枚带口令的戳）── */
url = await apply({ theme: 'ink', base: 'dark', accent: 'ink', atmosphere: 'on', password: 'sesame' })
await shot('25-login-ink', `${url}/login`, 1280, 720)
await shot('26-login-revealed', `${url}/login`, 1280, 720, (p) => p.locator('#reveal').click())
await shot('27-login-bad', `${url}/login`, 1280, 720, async (p) => {
  await p.locator('input[name=password]').fill('nope')
  await p.locator('.go').click()
  await p.waitForTimeout(400)
})
await shot('28-login-phone', `${url}/login`, 390, 844)

/* ── 氛围关：画布该是纯色，页条与正文不留光斑 ── */
url = await apply({ theme: 'paper', base: 'light', accent: 'clay', atmosphere: 'off' })
await shot('29-dl-atmos-off', url, 1280, 820)
await shot('30-up-atmos-off', url, 1280, 820, openUp)

/* ── 批量档放最后：投进去的 40 个文件会留在 docs 里，别脏前面的帧。
   loopback 太快，不限速的话队列在快门按下前就空了。 ── */
const bulkPaths = BULK.map((n) => join(bulk, n))
url = await apply({ theme: 'paper', base: 'light', accent: 'ink', atmosphere: 'on' })
await shot('31-up-bulk', url, 1280, 820, sendFiles(bulkPaths, 1500, 200))
await shot('32-up-bulk-open', url, 1280, 820, async (p) => {
  await throttle(p, 200)
  await openUp(p)
  await p.locator('#well-input').setInputFiles(bulkPaths)
  await p.waitForTimeout(900)
  await p.locator('#q-rows .fold .act').first().click()
  await p.waitForTimeout(300)
})
await browser.close()
stopAll()
if (!keep) rmSync(share, { recursive: true, force: true })
console.log(`产物在 ${out}`)
