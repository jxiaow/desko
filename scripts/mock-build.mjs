// 把 global.css 的真 token 块 + utils/icons.ts 的真图标路径注进 mock，产出可直接截图的 html。
// 用法：node scripts/mock-build.mjs design/xxx/mock-src.html design/xxx/mock.html
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readPolarity, readStyleSource } from './lib/theme-tokens.mjs'

const POLARITY = readPolarity()

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

const SRC = process.argv[2]
const OUT = process.argv[3]
if (!SRC || !OUT) {
  console.error('用法: node scripts/mock-build.mjs <mock-src.html> <out.html>')
  process.exit(2)
}

const CSS_SELECTORS = new Set([
  ':root',
  ':root, .theme-scope',
  '.theme-scope',
  ':root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]',
  ':root[data-atmosphere="off"], .theme-scope[data-atmosphere="off"]',
  ':root, [data-theme="paper"]',
  '[data-theme="snow"]',
  '[data-theme="ink"]',
  '[data-theme="slate"]',
  '[data-base="light"][data-accent="ink"]',
  '[data-base="dark"][data-accent="ink"]',
  // 侧栏激活行按侧栏底现切，写在别名块之后；漏摘这一条，mock 上的激活行还是旧的卡面洗底
  '[data-base="light"]',
])

/** 扫顶层规则，摘出选择器命中的整块（跳过注释，避免注释里出现的 ":root" 被当选择器） */
function pickTokenBlocks(css) {
  const out = []
  let i = 0
  let pending = ''
  while (i < css.length) {
    const c = css[i]
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      i = (end < 0 ? css.length : end + 2)
      continue
    }
    if (c === '{') {
      const selector = pending.trim().replace(/\s+/g, ' ')
      let depth = 0
      let j = i
      for (; j < css.length; j++) {
        if (css[j] === '{') depth++
        else if (css[j] === '}') { depth--; if (depth === 0) break }
      }
      if (CSS_SELECTORS.has(selector)) out.push(`${selector} {${css.slice(i + 1, j)}\n}`)
      pending = ''
      i = j + 1
      continue
    }
    pending += c
    i++
  }
  return out.join('\n')
}

function iconPaths() {
  const ts = readFileSync(path.join(root, 'src/utils/icons.ts'), 'utf8')
  const map = {}
  const re = /^\s{2}([A-Za-z][A-Za-z0-9]*):\s*'(.*?)',\s*$/gm
  let m
  while ((m = re.exec(ts))) map[m[1]] = m[2]
  return map
}

const STROKE_PX = 1.05
function svg(name, size, icons) {
  const d = icons[name]
  if (!d) throw new Error(`未知图标: ${name}`)
  const sw = (STROKE_PX * 24 / Number(size)).toFixed(2)
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
}

const globalCss = readStyleSource(path.join(root, 'src/styles/global.css'))
const tokens = pickTokenBlocks(globalCss)
const missing = ['[data-theme="ink"]', '[data-base="light"][data-accent="ink"]'].filter(
  (s) => !tokens.includes(s),
)
if (missing.length) throw new Error(`token 块未命中: ${missing.join(', ')}`)

const icons = iconPaths()
let html = readFileSync(path.resolve(SRC), 'utf8')
// accent 块与侧栏洗底都挂在极性轴上；老 mock 只挂 data-theme，这里按 theme.ts 的 POLARITY 当场补一个 data-base
html = html.replace(/data-theme="([\w-]+)"(?![^>]*\bdata-base=)/g, (all, t) =>
  POLARITY[t] ? `${all} data-base="${POLARITY[t]}"` : all,
)
html = html.replace(/<!--TOKENS-->/, tokens)
html = html.replace(/\{\{i:([A-Za-z0-9]+):(\d+)\}\}/g, (_, n, s) => svg(n, s, icons))
writeFileSync(path.resolve(OUT), html, 'utf8')

const left = html.match(/\{\{i:[^}]*\}\}/g)
if (left) throw new Error(`未展开的占位: ${left.join(' ')}`)
console.log(`✓ ${OUT}（token ${tokens.split('\n').length} 行 / ${Object.keys(icons).length} 枚图标可用）`)
