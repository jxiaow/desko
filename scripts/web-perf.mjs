// Web 面传输账对拍：量一个 base 地址冷开首屏要**出网**多少字节、每条资源多久、二次访问能不能复用。
// 用法：
//   node scripts/web-perf.mjs http://127.0.0.1:8420            # 只走 HTTP 层（curl，秒级）
//   node scripts/web-perf.mjs https://你的公网域名 --browser    # 再开一次真浏览器，看它实际要什么
//   node scripts/web-perf.mjs http://127.0.0.1:1435 --browser   # 本地 vite preview 的产物
// 为什么两种模式：
//   curl 模式按 HTML 壳里 src/href 的引用逐条取，size_download 就是出网字节——浏览器和
//   Cloudflare 之间文本会被 zstd/br 压掉约 75%，字体压不动；Node 的 fetch 会先解压，量到的
//   是原文。这条链与 docs/design/web/02-tunnel-perf.md §2 那张表同源，但它看不见
//   @font-face：字体不在 HTML 里引用，只有浏览器解析到对应字形才会要。
//   所以 --browser 模式用 CDP 的 encodedDataLength 记每一条真实出网字节，并把
//   "首屏不许出现 /fonts/*" 这条判据落成硬断言。本地预览没有 Rust 注入的 runtime 标记
//   （那是 web_access/mod.rs 干的），脚本会补注同一行 meta 并在结论里写明。
// 判据（curl 模式跑 1、2；--browser 跑 1、3、4）：
//   1) 首屏出网 ≤ 200 KB（那颗 2.7 MB 中文字体进来了必炸）
//   2) 二次访问仍需重传 ≤ 3 条（静态资产得给 immutable）
//   3) 生效的 --font-ui 里不含 'HarmonyOS Sans SC'，且网络面板没有 /fonts/* 请求
//   4) 二次导航 /assets/* 重传 0 条
// 输出：stdout 摘要 + .tmp/web-perf-<host>.json（明细含每条资源的出网/原文字节与头）
// 只针对构建产物或真机服务：vite dev 不打包，HTML 里只有 /src/main.ts，curl 模式的 CSS 判据必然落空。

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'

const positional = process.argv.slice(2).filter(a => !a.startsWith('--'))
const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')))
const BASE = (positional[0] || 'http://127.0.0.1:8420').replace(/\/+$/, '')
const TIMEOUT_S = Number(positional[1] || 60)
const COLD_BUDGET_KB = 200
const WARM_MAX_REFETCH = 3
const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl'
const NULL_DEV = process.platform === 'win32' ? 'NUL' : '/dev/null'
const HOST = new URL(BASE).hostname
const TMP = `.tmp/web-perf-${HOST.replace(/[^\w.-]/g, '_')}`
const OUT = `${TMP}.json`

mkdirSync('.tmp', { recursive: true })
rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })

/** 浏览器式请求：声明能解压，size_download 才是真实出网字节 */
function grab(path, { keep = false } = {}) {
  const body = keep ? `${TMP}/${path.replace(/[^\w.-]/g, '_')}` : NULL_DEV
  const headFile = `${TMP}/head.txt`
  const stat = execFileSync(CURL, [
    '-sS', '-L', '--compressed', '--max-time', String(TIMEOUT_S),
    '-o', body, '-D', headFile,
    '-w', '%{http_code}\t%{size_download}\t%{time_total}\t%{speed_download}',
    BASE + path,
  ], { encoding: 'utf8' }).trim().split('\t')
  const raw = readFileSync(headFile, 'utf8')
  const header = name => {
    const re = new RegExp(`^${name}:\\s*(.+)$`, 'im')
    const hit = raw.split(/\r?\n\r?\n/).pop().match(re)
    return hit ? hit[1].trim() : ''
  }
  return {
    path,
    status: Number(stat[0]),
    wireBytes: Number(stat[1]),
    ms: Math.round(Number(stat[2]) * 1000),
    encoding: header('content-encoding') || 'identity',
    cache: header('cache-control') || '(缺)',
    wireKB: Number((Number(stat[1]) / 1024).toFixed(1)),
    raw: keep && body !== NULL_DEV ? readFileSync(body, 'utf8') : undefined,
  }
}

function isLongCache(cc) {
  return /max-age=\d{6,}|immutable/.test(cc)
}

function kb(n) {
  return (n / 1024).toFixed(1)
}

function finish(fail, report) {
  writeFileSync(OUT, JSON.stringify(report, null, 2))
  if (fail.length) {
    console.log('\nFAIL')
    for (const f of fail) console.log(`  - ${f}`)
  } else {
    console.log('\nPASS')
  }
  console.log(`  明细：${OUT}`)
  process.exit(fail.length ? 1 : 0)
}

async function curlMode() {
  const html = grab('/', { keep: true })
  const refs = [...new Set(
    [...html.raw.matchAll(/(?:src|href)="(\/[^"]+)"/g)]
      .map(m => m[1])
      .filter(p => !p.startsWith('data:')),
  )]
  const resources = [html, ...refs.map(ref => grab(ref, { keep: ref.endsWith('.css') }))]
  const refetch = resources.filter(r => !isLongCache(r.cache))
  const wireTotal = resources.reduce((n, r) => n + r.wireBytes, 0)
  const msTotal = resources.reduce((n, r) => n + r.ms, 0)
  const css = resources.filter(r => r.path.endsWith('.css')).map(r => r.raw || '').join('\n')
  const flat = css.replace(/\s+/g, ' ')
  const overrideBlock = /html\.desko-web[^{]*\{[^}]*--font-ui[^}]*\}/.test(flat)
  const overrideClean = overrideBlock && !/html\.desko-web[^{]*\{[^}]*HarmonyOS Sans SC/.test(flat)
  const fontRefs = [...new Set([...css.matchAll(/url\((['"]?)(\/fonts\/[^)'"]+)\1/g)].map(m => m[2]))]

  console.log(`\n== ${BASE} 冷开首屏 ${resources.length} 条 / 出网 ${kb(wireTotal)} KB / 串测 ${msTotal} ms`)
  for (const r of resources) {
    console.log(`  ${r.status} ${String(r.wireKB).padStart(8)} KB ${String(r.ms).padStart(6)} ms  ${r.encoding.padEnd(8)} ${r.cache.padEnd(40)} ${r.path}`)
  }
  console.log('\n== 字体判据')
  console.log(`  --font-ui 声明 ${css.split('--font-ui').length - 1} 处；Web 覆盖块 ${overrideBlock ? '在' : '不在'}，覆盖内不带内嵌字体 ${overrideClean ? '是' : '否'}`)
  console.log(`  CSS 引用到的字体文件 ${fontRefs.length ? fontRefs.join(', ') : '（无）'}`)
  console.log(`  注意：字体由 @font-face 触发，本模式按 HTML 引用清单取，字体是否真被要请看 --browser`)
  console.log('\n== 二次访问')
  console.log(`  可复用 ${resources.length - refetch.length} 条；仍需重传 ${refetch.length} 条 / ${kb(refetch.reduce((n, r) => n + r.wireBytes, 0))} KB`)

  const fail = []
  if (wireTotal / 1024 > COLD_BUDGET_KB) fail.push(`冷开出网 ${kb(wireTotal)} KB > 预算 ${COLD_BUDGET_KB} KB`)
  if (refetch.length > WARM_MAX_REFETCH) fail.push(`二次访问仍重传 ${refetch.length} 条 > ${WARM_MAX_REFETCH}`)
  if (!overrideClean) fail.push('出网 CSS 没有生效的 Web 字体覆盖（内嵌中文字体仍会进首屏）')
  finish(fail, {
    base: BASE, at: new Date().toISOString(), mode: 'curl',
    cold: { requests: resources.length, wireBytes: wireTotal, msTotal, rows: resources.map(({ raw, ...row }) => row) },
    warm: { refetchRequests: refetch.length, refetchBytes: refetch.reduce((n, r) => n + r.wireBytes, 0) },
    fonts: { overrideBlock, overrideClean, fontUrls: fontRefs },
  })
}

async function browserMode() {
  const { chromium } = await import('playwright')
  // 本机挂 VPN/TUN 时系统代理会把直连 IP 打进 fake-IP 段而超时；这里一律按裸连处理，
  // 只有直连可达（curl 模式能取到）的 base 才谈得上测性能。
  const browser = await chromium.launch({
    channel: process.env.PW_CHANNEL || 'chrome',
    headless: true,
    args: ['--no-proxy-server'],
  })
  const context = await browser.newContext()
  // web_access/mod.rs 会在 <head> 注入 runtime meta；本地 vite preview 没有这一步。
  // 服务端自带标记时完全不拦请求，免得把浏览器变成走 Node 的代理（隧道会被本机 fake-IP 卡死）；
  // 缺标记时才补注同一行，让前端标记链（main.ts → html.desko-web → styles/web.css）在产物上成立。
  const servesMarker = /name="desko-runtime"/.test(grab('/', { keep: true }).raw || '')
  let injectedMarker = !servesMarker
  if (!servesMarker) {
    await context.route(`${BASE}/**`, async route => {
      const request = route.request()
      if (request.resourceType() !== 'document' || !request.url().startsWith(BASE)) return route.continue()
      const response = await route.fetch()
      let body = await response.text()
      if (!/name="desko-runtime"/.test(body)) body = body.replace('<head>', '<head><meta name="desko-runtime" content="web">')
      else injectedMarker = false
      route.fulfill({ response, body })
    })
  }
  const page = await context.newPage()
  const client = await context.newCDPSession(page)
  const pending = new Map()
  const rows = { cold: [], warm: [] }
  let phase = 'cold'
  await client.send('Network.enable')
  client.on('Network.responseReceived', ({ requestId, type, response }) => {
    const headers = Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), v]))
    pending.set(requestId, {
      url: response.url,
      status: response.status,
      type: type || response.type || 'Other',
      cache: headers['cache-control'] || '(缺)',
      encoding: headers['content-encoding'] || 'identity',
    })
  })
  client.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const row = pending.get(requestId)
    pending.delete(requestId)
    if (!row || !row.url.startsWith(BASE)) return
    rows[phase].push({ ...row, wireBytes: encodedDataLength, path: new URL(row.url).pathname })
  })

  // 出网字节之外还要一条时间账：§2.2 那张改前表里有"公网面单请求往返地板约 0.7 s"，
  // 改后能不能兑现"首屏时间降一个量级"，只能从同一把尺子上读。取 load 事件墙钟，
  // 不含后面为字体判定留的静置，免得把 settle 算进首屏。
  const gotoStart = Date.now()
  await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: TIMEOUT_S * 1000 })
  const coldLoadMs = Date.now() - gotoStart
  await page.waitForTimeout(2000)
  // 字体只在解析到对应字形时才要：塞一句中文，保证两轮都真的走一遍字体判定。
  await page.evaluate(() => { document.body.insertAdjacentText('beforeend', '局域网工作台性能对拍中文样本') })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1500)
  const state = await page.evaluate(() => ({
    marker: document.querySelector('meta[name="desko-runtime"]')?.getAttribute('content') || '(缺)',
    htmlClass: document.documentElement.className || '(空)',
    fontUi: getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim(),
    usesEmbedded: getComputedStyle(document.body).fontFamily.includes('HarmonyOS'),
  }))
  const servedMarker = !injectedMarker
  phase = 'warm'
  const reloadStart = Date.now()
  await page.reload({ waitUntil: 'load' })
  const warmLoadMs = Date.now() - reloadStart
  await page.waitForTimeout(2500)
  await browser.close()

  const sum = list => list.reduce((n, r) => n + r.wireBytes, 0)
  const fontRows = rows.cold.filter(r => /\/fonts\//.test(r.path))
  const assetRows = rows.cold.filter(r => r.path.startsWith('/assets/'))
  const refetchedAssets = rows.warm.filter(r => r.path.startsWith('/assets/'))
  console.log(`\n== ${BASE} 浏览器冷开（--browser${injectedMarker ? '，脚本补注 runtime 标记' : ''}）`)
  for (const r of rows.cold) {
    console.log(`  ${r.status} ${String(kb(r.wireBytes)).padStart(8)} KB ${r.encoding.padEnd(8)} ${r.cache.padEnd(40)} ${r.type.padEnd(10)} ${r.path}`)
  }
  console.log(`  合计 ${rows.cold.length} 条 / 出网 ${kb(sum(rows.cold))} KB / load 墙钟 ${coldLoadMs} ms`)
  console.log('\n== 字体判据')
  console.log(`  runtime 标记 ${state.marker}（服务端自带 ${servedMarker ? '是' : '否'}）；<html> class "${state.htmlClass}"`)
  console.log(`  生效 --font-ui：${state.fontUi.slice(0, 120)}`)
  console.log(`  实际请求到的字体 ${fontRows.length ? fontRows.map(r => `${r.path} ${kb(r.wireBytes)} KB`).join(', ') : '（无）'}`)
  console.log(`  body 计算字体是否含内嵌族：${state.usesEmbedded ? '是' : '否'}`)
  console.log('\n== 二次访问')
  console.log(`  总请求 ${rows.warm.length} 条 / 出网 ${kb(sum(rows.warm))} KB / load 墙钟 ${warmLoadMs} ms；其中 /assets/* 重传 ${refetchedAssets.length} 条`)
  console.log(`  冷开 /assets/* ${assetRows.length} 条缓存头：${[...new Set(assetRows.map(r => r.cache))].join(' | ') || '（无）'}`)

  const fail = []
  if (sum(rows.cold) / 1024 > COLD_BUDGET_KB) fail.push(`冷开出网 ${kb(sum(rows.cold))} KB > 预算 ${COLD_BUDGET_KB} KB`)
  if (fontRows.length) fail.push(`首屏仍请求内嵌字体：${fontRows.map(r => `${r.path} ${kb(r.wireBytes)} KB`).join(', ')}`)
  if (!state.htmlClass.includes('desko-web')) fail.push('<html> 没有 desko-web 标记，Web 字体覆盖不会生效')
  if (state.fontUi.includes('HarmonyOS')) fail.push('生效的 --font-ui 仍把内嵌中文字体排在前面')
  if (refetchedAssets.length) fail.push(`二次导航仍重传 ${refetchedAssets.length} 条 /assets/*`)
  finish(fail, {
    base: BASE, at: new Date().toISOString(), mode: 'browser', injectedMarker,
    cold: { requests: rows.cold.length, wireBytes: sum(rows.cold), loadMs: coldLoadMs, rows: rows.cold },
    warm: { requests: rows.warm.length, wireBytes: sum(rows.warm), loadMs: warmLoadMs, refetchedAssets: refetchedAssets.length, rows: rows.warm },
    fonts: { requested: fontRows.map(r => r.path), state },
  })
}

if (flags.has('--browser')) await browserMode()
else await curlMode()
