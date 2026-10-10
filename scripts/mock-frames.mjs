// 把 mock-build 产出的对拍稿逐帧截图。帧容器约定为 .win（含 .win.plain 那种无窗框的状态板）。
// 用法：node scripts/mock-build.mjs <src.html> <built.html>
//       node scripts/mock-frames.mjs <built.html> <outDir> <prefix> [slug1 slug2 …]
// 命名：<prefix>-<A|B|C…>-<slug>.png，slug 缺省时只用序号。
import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [htmlArg, outArg, prefixArg, ...slugs] = process.argv.slice(2)
if (!htmlArg || !outArg || !prefixArg) {
  console.error('用法: node scripts/mock-frames.mjs <built.html> <outDir> <prefix> [slug…]')
  process.exit(2)
}

const html = path.resolve(root, htmlArg)
const outDir = path.resolve(root, outArg)
if (!existsSync(html)) {
  console.error(`找不到对拍稿：${html}`)
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })
const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 })
await page.goto('file:///' + html.replace(/\\/g, '/'))
await page.waitForTimeout(300)

const frames = await page.locator('.win').all()
const written = []
for (let i = 0; i < frames.length; i++) {
  const letter = String.fromCharCode(65 + i)
  const slug = slugs[i] ? `-${slugs[i]}` : ''
  const name = `${prefixArg}-${letter}${slug}.png`
  const file = path.join(outDir, name)
  // 缺帧对账：同名旧图先删，避免"看着新其实是上一轮"
  if (existsSync(file)) rmSync(file)
  await frames[i].screenshot({ path: file })
  written.push(name)
  console.log(`wrote ${name}`)
}
await browser.close()

const stale = written.filter((n) => !existsSync(path.join(outDir, n)))
if (stale.length) {
  console.error(`缺帧：${stale.join(', ')}`)
  process.exit(1)
}
console.log(`${written.length} 帧全部为本次新拍`)
