// 把 global.css 的真 token 块 + utils/icons.ts 的真图标路径注进 mock，产出可直接截图的 html。
// 用法：node scripts/mock-build.mjs design/xxx/mock-src.html design/xxx/mock.html
//   --tokens=<仓库相对路径>  改抽生成好的令牌文件（如局域网传输网页端的 tokens.css），
//                            并给每个 .win 挂上 data-layout="workspace"，让选择器按真页面的样子命中。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readPolarity, readStyleSource } from './lib/theme-tokens.mjs'

const POLARITY = readPolarity()

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

const args = process.argv.slice(2)
const flag = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}
const [SRC, OUT] = args.filter((a) => !a.startsWith('--'))
const TOKENS_FILE = flag('tokens')
if (!SRC || !OUT) {
  console.error('用法: node scripts/mock-build.mjs <mock-src.html> <out.html> [--tokens=<path>]')
  process.exit(2)
}

// 令牌块 = 选择器每一段都只是 :root / .theme-scope / 带 data-theme|base|accent|atmosphere 的属性选择器。
// 早先这里是手写的白名单，只列了 ink 一档 accent 和四套底色：新增的 linen/mist/midnight/moss
// 与另外九档 accent（含 materials.css 的氛围 tint、深底强度档）全被漏摘，
// mock 于是永远按浅底 + 群青出图，对拍稿里的"现状"根本不是真实现状。
const TOKEN_PART = /^(?:(?::root|:where\(:root\))\s*,\s*)?(?:\.theme-scope|:root|:where\(:root\))?(?:\[data-(?:theme|base|accent|atmosphere)="[\w-]+"\])*$/
const isTokenSelector = (sel) => sel.split(',').every((part) => TOKEN_PART.test(part.trim()))

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
      if (isTokenSelector(selector)) out.push(`${selector} {${css.slice(i + 1, j)}\n}`)
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

let tokens
if (TOKENS_FILE) {
  // 生成物按 `:root[...]` 写死；mock 一台设备一个 .win，所以把根选择器换成 .win，
  // 其余选择器与级联顺序保持原样 —— 对拍时颜色算的就是真页面那一份。
  tokens = readFileSync(path.join(root, TOKENS_FILE), 'utf8').replace(/:root\b/g, '.win')
} else {
  const globalCss = readStyleSource(path.join(root, 'src/styles/global.css'))
  tokens = pickTokenBlocks(globalCss)
  const missing = [':where(:root), [data-theme="paper"]', '[data-theme="ink"]', '[data-base="light"][data-accent="ink"]'].filter(
    (s) => !tokens.includes(s),
  )
  if (missing.length) throw new Error(`token 块未命中: ${missing.join(', ')}`)
}

const icons = iconPaths()
let html = readFileSync(path.resolve(SRC), 'utf8')
// accent 块与侧栏洗底都挂在极性轴上；老 mock 只挂 data-theme，这里按 theme.ts 的 POLARITY 当场补一个 data-base
html = html.replace(/data-theme="([\w-]+)"(?![^>]*\bdata-base=)/g, (all, t) =>
  POLARITY[t] ? `${all} data-base="${POLARITY[t]}"` : all,
)
// 工作区块挂在 data-layout 上：桌面端 main.ts 就是这么挂的，mock 不挂就等于抽错令牌
if (TOKENS_FILE) {
  html = html.replace(/<div class="win(?=[" ])/g, '<div data-layout="workspace" data-atmosphere="off" class="win')
}
html = html.replace(/<!--TOKENS-->/, tokens)
html = html.replace(/\{\{i:([A-Za-z0-9]+):(\d+)\}\}/g, (_, n, s) => svg(n, s, icons))
writeFileSync(path.resolve(OUT), html, 'utf8')

const left = html.match(/\{\{i:[^}]*\}\}/g)
if (left) throw new Error(`未展开的占位: ${left.join(' ')}`)
console.log(`✓ ${OUT}（token ${tokens.split('\n').length} 行 / ${Object.keys(icons).length} 枚图标可用）`)
