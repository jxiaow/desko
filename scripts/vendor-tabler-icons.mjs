// 一次性把 src/utils/icons.ts 的字形骨架换成 Tabler Icons（MIT, v3.48.0）。
// 数据来源：npm pack @tabler/icons 后解出的 tabler-nodes-outline.json / tabler-nodes-filled.json，
// 落在仓库外（默认 ~/.cache/desko-iconset/package/）。本脚本只跑一次，跑完 icons.ts 恢复手工可编辑，
// 之后单枚微调直接改 icons.ts，不再回跑本脚本。
// 用法：node scripts/vendor-tabler-icons.mjs [tabler包目录]
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const PKG = process.argv[2] || 'C:/Users/jxiaow/.cache/desko-iconset/package'
const outline = require(`${PKG}/tabler-nodes-outline.json`)
const filled = require(`${PKG}/tabler-nodes-filled.json`)

// 键名一律不动，只换 path 数据。右侧是 tabler 图标名（kebab）。
const MAP = {
  search: 'search',
  searchEmpty: 'search-off',
  x: 'x',
  star: 'star',
  pin: 'pin',
  unpin: 'pinned-off',
  dots: 'dots',
  trash: 'trash',
  upload: 'upload',
  check: 'check',
  checkall: 'square-check',
  image: 'photo',
  max: 'arrows-maximize',
  min: 'arrows-minimize',
  tag: 'tag',
  all: 'category',
  doc: 'file-text',
  clip: 'paperclip',
  edit: 'pencil',
  filter: 'filter',
  clock: 'clock',
  panel: 'layout-sidebar-right',
  bulletlist: 'list',
  orderedlist: 'list-numbers',
  quote: 'blockquote',
  code: 'code',
  divider: 'separator',
  link: 'link',
  external: 'external-link',
  copy: 'copy',
  eye: 'eye',
  eyeOff: 'eye-off',
  lock: 'lock',
  unlock: 'lock-open',
  lockOff: 'lock-off',
  folder: 'folder',
  terminal: 'terminal',
  plus: 'plus',
  user: 'user',
  mapPin: 'map-pin',
  alert: 'alert-triangle',
  chevDown: 'chevron-down',
  shield: 'shield',
  globe: 'world',
  gear: 'settings',
  navEntries: 'bookmark',
  navNotes: 'note',
  navFiles: 'folder',
  navMfa: 'key',
  navLan: 'network',
  // 本轮从内联 SVG 收编进来的新键
  arrowRight: 'arrow-right',
  clipboard: 'clipboard',
  file: 'file',
  folderOpen: 'folder-open',
  cloud: 'cloud',
  download: 'download',
  adjustments: 'adjustments',
  palette: 'palette',
  info: 'info-circle',
  chevRight: 'chevron-right',
  database: 'database',
}

const ser = (list) =>
  list.map(([t, a]) => `<${t} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('')

const body = {}
for (const [k, name] of Object.entries(MAP)) {
  if (!outline[name]) throw new Error(`tabler 里没有 ${name}（键 ${k}）`)
  body[k] = ser(outline[name])
}
body.starFilled = ser(filled['star'])

const HEADER = `/**
 * 描边图标的路径内容，配合 AppIcon 使用（viewBox 0 0 24 24）。
 *
 * 2026-09-29 风格轮：骨架整体换成 Tabler Icons（MIT，v3.48.0），路径数据 vendored 在此，
 * 运行时零依赖。换骨架的原因是自绘那套"方框+直线"在 14px 下缺细节锚点（眼睛没瞳孔、
 * 铅笔没笔尖、纸篓没盖），小尺寸认图标靠的就是这些锚点。Tabler 与 Lucide 两方式对拍后取
 * Tabler，见 docs/design/distinctive/02-icon-style-tabler.md。
 *
 * 三条不动的轨：
 *   1) 键名与调用点不动，只换 path 数据；
 *   2) 笔画不写死 —— AppIcon 按尺寸反算 stroke-width，12px 到 22px 实笔恒 1.05px；
 *   3) 主体仍落在 24 网格内，越界由 scripts/icon-board.mjs 的描边守护拦。
 *
 * 例外两枚：标题栏四颗窗口控件不住在这里（TitleBar.vue 自带 12 viewBox 实笔 1px，
 * 刻意比方框更硬）；\`max\`/\`min\` 是小记的全屏/还原钮，不是窗控。
 * 单枚微调直接改下面的字符串，别再回跑 scripts/vendor-tabler-icons.mjs（那是一次性脚本）。
 */`

const src = readFileSync('src/utils/icons.ts', 'utf8')
const order = [...src.matchAll(/^  (\w+): /gm)].map((m) => m[1]).filter((k) => k !== 'starFilled')
const missing = order.filter((k) => !body[k])
if (missing.length) throw new Error(`这些旧键没有映射：${missing.join(', ')}`)
const added = Object.keys(MAP).filter((k) => !order.includes(k))

const lines = [...order, ...added].map((k) => `  ${k}: '${body[k]}',`)
lines.push(`  starFilled: '${body.starFilled}',`)
writeFileSync('src/utils/icons.ts', `${HEADER}
export const icons = {
${lines.join('\n')}
} as const

export type IconName = keyof typeof icons
`)
console.log(`写入 ${lines.length} 枚（含 starFilled），其中新收编 ${added.length} 枚：${added.join(' ')}`)
