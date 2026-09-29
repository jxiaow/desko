// 小记全屏层密度验收：真应用里打开同一篇样张（含二级标题/列表/引用/代码块），
// 只读纸面与书写态各拍一张，并量「一屏放得下整篇的百分之几」——密度改没改到位看这个数字。
// 用法：先起 vite --mode e2e --port 1430，再 node scripts/fs-density.mjs [combo ...]
// 默认 paper-celadon 与 ink-celadon；输出 design/fs-density/<combo>-{view,edit}.png
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const COMBOS = process.argv.slice(2).length ? process.argv.slice(2) : ['paper-celadon', 'ink-celadon']
const OUT = 'design/fs-density'
mkdirSync(OUT, { recursive: true })

const LONG = `<h2>周会纪要</h2>
<p>尺度层不动，主题层只管颜色。这一版把 inset 骨架收口：灰底画布 + 白面板列表 + 居中阅读列，行轨统一 60px。</p>
<p>下一步三件事：吸顶件与画布同源、图标笔画并轨、全屏书写面的密度。</p>
<h3>待办</h3>
<ul><li>把 page-bar 的平铺底换成画布配方</li><li>侧栏五枚 glyph 重做，实心焦点担语义</li><li>全屏正文行距收一档，一屏多放十行</li></ul>
<blockquote>近黑底要留一档高光边，浅色底靠发丝描边分层。</blockquote>
<h2>代码片段</h2>
<p>头像色由分类哈希决定：</p>
<pre><code>const hash = (s) =&gt; 31 * h + s.charCodeAt(i)</code></pre>
<p>正文链接走品牌色，长链要能断行而不撑破卡片。全屏书写是这张桌子上最大的一块面积，密度直接决定一屏能读多少。</p>`

const seed = (theme, accent) => ({
  settings: { theme, accent, mfa_enabled: 'true', fileshare_enabled: 'true' },
  notes: [{ title: '密度对拍样张', content_html: LONG, category: '工作' }],
  entries: [], fileShortcuts: [], mfaTokens: [],
})

const tip = (scope, text) => scope.locator(`button[title="${text}"], button[data-tip="${text}"]`)

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })

for (const combo of COMBOS) {
  const [theme, accent] = [combo.slice(0, combo.indexOf('-')), combo.slice(combo.indexOf('-') + 1)]
  const ctx = await browser.newContext({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 1.5 })
  await ctx.addInitScript((cfg) => { window.__E2E_CONFIG__ = cfg }, seed(theme, accent))
  const page = await ctx.newPage()
  await page.goto(`${BASE}/notes`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.unlock-input')
  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await page.waitForSelector('.memo')

  const openView = async () => {
    const m = page.locator('.memo').first()
    await m.hover()
    await tip(m, '全屏查看').first().click()
    await page.waitForSelector('.fs .fs-view')
    await page.waitForTimeout(350)
  }

  const measure = async (label, sel) => {
    const m = await page.evaluate((s) => {
      const col = document.querySelector(s)
      const cs = col?.querySelector('p') && getComputedStyle(col.querySelector('p'))
      const scroll = document.querySelector('.fs-scroll')
      const pad = col ? parseFloat(getComputedStyle(col).paddingTop) + parseFloat(getComputedStyle(col).paddingBottom) : 0
      return {
        type: cs ? `${cs.fontSize} / 行距 ${Math.round(parseFloat(cs.lineHeight))}px` : 'n/a',
        docH: Math.round((col?.scrollHeight ?? 0) + pad),
        viewH: Math.round(scroll?.clientHeight ?? 0),
      }
    }, sel)
    console.log(`${combo} ${label} ${m.type} · 整篇≈${m.docH}px · 可视 ${m.viewH}px · 一屏放得下 ${Math.round((m.viewH / m.docH) * 100)}%`)
  }

  await openView()
  await page.screenshot({ path: `${OUT}/${combo}-view.png` })
  await measure('只读纸面', '.fs .fs-view')

  await page.locator('.fs-foot button.eb.primary').first().click()
  await page.waitForSelector('.fs .note-editor.v-full .ProseMirror')
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/${combo}-edit.png` })
  await measure('书写态  ', '.fs .note-editor.v-full .ProseMirror')

  await page.close()
}

await browser.close()
