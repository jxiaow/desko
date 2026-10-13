// 全配色体检：底色 × accent 全组合 × 全页面，量三件事——
// 1) 真实合成后的文字对比度（含 opacity 参与的）
// 2) 画面上实际涂出来的面族（背景色 + 面积 + L*），看层级台阶
// 3) 游离色：computed 出来的颜色不在当前主题的令牌集合里
// 用法：先起 vite --mode e2e --port 1430，再
//   PW_CHANNEL=msedge node scripts/color-sweep.mjs > .design-qa/reports/color-sweep.txt
// 判据：可读文字 ≥4.5（装饰位除外）；--fill/--sunken 上的 muted 3.97~4.49 属既定豁免
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { themeCombos } from './lib/theme-tokens.mjs'

const BASE = 'http://127.0.0.1:1430'
const CSS = readFileSync('src/styles/global.css', 'utf8')
// 令牌名全集（含别名槽），只取 --xxx: 声明的键名
const TOKEN_NAMES = [...new Set([...CSS.matchAll(/(--[a-z0-9][a-z0-9-]*)\s*:/g)].map((m) => m[1]))]

const SEED = {
  settings: { theme: 'paper', accent: 'ink', mfa_enabled: 'true', fileshare_enabled: 'true' },
  entries: [
    { name: 'GitHub', url: 'https://github.com', username: 'dev@example.com', password: 'Gh!tHub2024', notes: '代码托管平台，需要每月轮换口令', category: '开发' },
    { name: 'Gmail', url: 'https://mail.google.com', username: 'user@gmail.com', password: 'Gm@il#Secure', notes: '个人邮箱', category: '邮箱' },
    { name: '钉钉', url: 'https://www.dingtalk.com', username: 'user@company.com', password: 'Ding!Talk88', category: '办公' },
    { name: '招商银行', url: 'https://cmbchina.com', username: '62148801', password: 'Bank@Pass123', category: '金融' },
    { name: '路由器', url: 'http://192.168.1.1', username: 'admin', password: 'admin123', notes: '光猫后台', category: '设备' },
    { name: '临时站点', url: 'https://example.com', username: 'temp', password: 'Temp#123456' },
  ],
  urlPaths: [{ entry_index: 0, path: '/settings/tokens', label: '访问令牌', notes: '每月轮换' }],
  notes: [
    { title: '走查样本', content_html: '<h2>标题</h2><p>正文与<strong>加粗</strong>与<span>次级</span>。</p><ul data-type="taskList"><li><label><input type="checkbox" checked><span>已完成项</span></label></li></ul><blockquote>引用行。</blockquote>', category: '工作', pinned: true },
    { title: '代码', content_html: '<pre><code class="language-ts"><span class="hljs-keyword">const</span> x = <span class="hljs-number">1</span> <span class="hljs-comment">// 注释</span></code></pre>', category: '开发' },
  ],
  fileShortcuts: [
    { name: '项目资料', path: 'C:/e2e/project', shortcut_type: 'folder' },
    { name: '月度报告', path: 'C:/e2e/report.pdf', shortcut_type: 'file' },
    { name: '预算表', path: 'C:/e2e/budget.xlsx', shortcut_type: 'file' },
    { name: '主程序', path: 'C:/e2e/main.ts', shortcut_type: 'file' },
  ],
  mfaTokens: [
    { name: '示例令牌', issuer: 'Example', algorithm: 'SHA1', digits: 6, period: 30, secret: 'JBSWY3DPEHPK3PXP' },
    { name: 'GitHub', issuer: 'GitHub', algorithm: 'SHA256', digits: 6, period: 30, secret: 'JBSWY3DPEHPK3PXP' },
  ],
}

// 全窗走查跑满可见组合（底色 × accent，读 theme.ts）
const COMBOS = themeCombos().map(({ theme, accent }) => ({ theme, accent }))

const SWEEP = (TOKEN_NAMES) => {
  // 冻结动画，避免拍到淡入中途的假低对比
  for (const a of document.getAnimations()) { try { a.finish() } catch { try { a.pause() } catch {} } }
  const probe = document.createElement('span')
  probe.style.display = 'none'
  document.body.appendChild(probe)
  const srgb = (n) => Math.round(Math.max(0, Math.min(1, n)) * 255)
  // 统一成 [r,g,b,a]：Chromium 把 color-mix 序列化成 color(srgb r g b / a)，
  // 直接抠数字会得到 0~1 的小量，必须分支处理
  const parse = (raw) => {
    if (!raw) return null
    const str = String(raw).trim()
    probe.style.color = '#000'
    probe.style.color = str
    const cs = getComputedStyle(probe).color
    if (!cs) return null
    if (cs.startsWith('transparent')) return [0, 0, 0, 0]
    let m = cs.match(/^color\(srgb\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)(?:\s*\/\s*([-\d.]+))?\)$/)
    if (m) return [srgb(+m[1]), srgb(+m[2]), srgb(+m[3]), m[4] === undefined ? 1 : +m[4]]
    m = cs.match(/^rgba?\(\s*([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)(?:[,\s/]+([-\d.]+))?\)/)
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
    m = cs.match(/^color\(display-p3\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/)
    if (m) return [srgb(+m[1]), srgb(+m[2]), srgb(+m[3]), 1]
    return null
  }
  const norm = (str) => {
    const v = parse(str)
    return v ? v.slice(0, 3).join(',') : null
  }
  const trip = (arr) => arr.slice(0, 3).map((v) => Math.round(v)).join(',')
  // 当前主题解析后的令牌色集合
  const rs = getComputedStyle(document.documentElement)
  const resolved = {}
  const valueOf = (name, depth = 0) => {
    if (depth > 4 || resolved[name]) return resolved[name]
    let raw = rs.getPropertyValue(name).trim()
    let guard = 0
    while (raw.startsWith('var(') && guard++ < 4) {
      const inner = raw.slice(4, raw.indexOf(')')).trim()
      raw = (rs.getPropertyValue(inner).trim() || 'transparent')
    }
    const n = raw ? norm(raw) : null
    resolved[name] = n
    return n
  }
  // 只比"三元组"：半透明令牌（accent-soft 等）合成后的实际色不在集合里，
  // 拿声明色比才不会把每一处水洗底都误报成游离色
  const allowed = new Set()
  for (const n of TOKEN_NAMES) {
    const v = valueOf(n)
    if (v) allowed.add(v)
  }
  const lum = (r, g, b) => {
    const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const lstar = (rgb) => {
    const y = lum(...rgb.slice(0, 3))
    return +(116 * Math.cbrt(y) - 16).toFixed(1)
  }
  const bgOf = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const b = parse(getComputedStyle(n).backgroundColor)
      if (b && (b[3] === undefined || b[3] > 0.02)) {
        // 半透明底要一路合成到最近的实色祖先
        if (b.length > 3 && b[3] < 0.999) {
          const under = bgOf(n.parentElement || document.documentElement)
          return b.slice(0, 3).map((v, i) => v * b[3] + under[i] * (1 - b[3]))
        }
        return b.slice(0, 3)
      }
    }
    const top = parse(getComputedStyle(document.body).backgroundColor)
    return top ? top.slice(0, 3) : [255, 255, 255]
  }
  const sel = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : '')
  const texts = [], faces = new Map(), stray = new Map()

  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    // —— 面族：自身背景（含渐变起点）涂到的面积
    const own = parse(cs.backgroundColor)
    if (own && (own[3] === undefined || own[3] > 0.02)) {
      const eff = own.length > 3 && own[3] < 0.999 ? own.slice(0, 3).map((v, i) => v * own[3] + bgOf(el.parentElement)[i] * (1 - own[3])) : own.slice(0, 3)
      const key = eff.map((v) => Math.round(v)).join(',')
      const area = Math.round(r.width * r.height)
      const cur = faces.get(key)
      if (!cur || area > cur.area) faces.set(key, { area, sel: sel(el), l: lstar(eff) })
      const declared = parse(cs.backgroundColor)
      if (declared && !allowed.has(trip(declared))) {
        const k = trip(declared) + '|bg'
        if (!stray.has(k)) stray.set(k, { kind: 'bg', color: `rgb(${trip(declared).split(',').join(', ')})`, sel: sel(el), n: 1 })
        else stray.get(k).n++
      }
    }
    // —— 文字：只有直接持有文本节点的元素参与
    const own3 = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!own3) continue
    const t = el.textContent.trim()
    const op = Number(cs.opacity)
    if (!t || op < 0.05) continue
    const fg = parse(cs.color)
    if (!fg) continue
    const bg = bgOf(el)
    const a = (fg[3] === undefined ? 1 : fg[3]) * op
    const mix = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a))
    const [hi, lo] = [lum(...mix), lum(...bg)].sort((x, y) => y - x)
    const ratio = (hi + 0.05) / (lo + 0.05)
    const px = parseFloat(cs.fontSize)
    const bold = parseInt(cs.fontWeight) >= 700
    const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5
    const colKey = mix.map(Math.round).join(',')
    const fgKey = trip(fg)
    if (!allowed.has(fgKey)) {
      const k = fgKey + '|fg'
      if (!stray.has(k)) stray.set(k, { kind: 'fg', color: `rgb(${fgKey.split(',').join(', ')})`, sel: sel(el), n: 1 })
      else stray.get(k).n++
    }
    texts.push({ sel: sel(el), t: t.slice(0, 14), ratio: +ratio.toFixed(2), need, px, op: +op.toFixed(2), pass: ratio >= need })
  }
  const fails = {}
  for (const x of texts) if (!x.pass) fails[x.sel + '@' + x.px] = Math.min(fails[x.sel + '@' + x.px] ?? 99, x.ratio)
  return {
    textCount: texts.length,
    fails,
    faces: [...faces.entries()].sort((a, b) => a[1].l - b[1].l).map(([c, v]) => ({ c, ...v, area: v.area })),
    stray: [...stray.values()],
  }
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' })
const report = {}

for (const combo of COMBOS) {
  const id = `${combo.theme}-${combo.accent}`
  const page = await browser.newPage({ viewport: { width: 1040, height: 670 } })
  page.on('pageerror', () => {})
  await page.addInitScript((cfg) => { window.__E2E_CONFIG__ = cfg }, { ...SEED, settings: { ...SEED.settings, theme: combo.theme, accent: combo.accent } })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.unlock-input')
  const screens = {}
  screens['unlock'] = await page.evaluate(SWEEP, TOKEN_NAMES)
  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await page.waitForSelector('.app-layout')
  await page.waitForTimeout(400)
  const go = async (route, wait) => {
    await page.locator(`a.nav-item[href="${route}"]`).click().catch(() => page.goto(`${BASE}${route}`))
    await page.waitForTimeout(wait || 500)
    screens[route.slice(1)] = await page.evaluate(SWEEP, TOKEN_NAMES)
  }
  await go('/entries')
  await page.locator('.page-bar button.btn-primary').click()
  await page.waitForSelector('.dialog')
  await page.waitForTimeout(300)
  screens['form-dialog'] = await page.evaluate(SWEEP, TOKEN_NAMES)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await go('/notes')
  await go('/files')
  await go('/mfa', 700)
  await go('/fileshare', 700)
  await page.locator('button[title="设置"], button[data-tip="设置"]').first().click()
  await page.waitForSelector('.settings-dialog')
  await page.waitForTimeout(400)
  screens['settings'] = await page.evaluate(SWEEP, TOKEN_NAMES)
  await page.close()
  report[id] = screens
  const all = Object.values(screens)
  const fails = {}
  for (const s of all) for (const [k, v] of Object.entries(s.fails)) fails[k] = Math.min(fails[k] ?? 99, v)
  const strays = new Map()
  for (const s of all) for (const x of s.stray) {
    const k = `${x.kind}:${x.color}`
    if (!strays.has(k)) strays.set(k, { ...x, n: 0, where: new Set() })
    strays.get(k).n += x.n
  }
  console.log(`\n########## ${id} ##########`)
  console.log('-- 对比度不达标（class@px → 最低比值）--')
  const fl = Object.entries(fails).sort((a, b) => a[1] - b[1])
  if (!fl.length) console.log('  (none)')
  for (const [k, v] of fl) console.log(`  ${String(v).padStart(5)}  ${k}`)
  console.log('-- 游离色（不属于当前主题任何令牌槽）--')
  const st = [...strays.values()].sort((a, b) => b.n - a.n)
  if (!st.length) console.log('  (none)')
  for (const x of st) console.log(`  ${x.kind} ${x.color.padEnd(22)} ×${String(x.n).padStart(3)}  ${x.sel}`)
  // 面族台阶只在基准档（墨蓝 accent）下打印——每套底色一份，换 accent 不动面族
  if (combo.accent === 'ink') {
    console.log('-- 面族台阶（L* 升序，取该色最大涂覆块）--')
    const seen = new Map()
    for (const s of all) for (const f of s.faces) if (!seen.has(f.c) || seen.get(f.c).area < f.area) seen.set(f.c, f)
    for (const f of [...seen.values()].sort((a, b) => a.l - b.l)) console.log(`  L*${String(f.l).padStart(5)}  rgb(${f.c.split(',').join(', ')})  ${f.sel}`)
  }
}
await browser.close()
