// 一次性把 src/utils/icons.ts 的字形骨架换成 Solar Round（CC-BY-4.0，经 @iconify-json/solar v1.2.13 取数）。
// 数据来源：npm pack @iconify-json/solar 后解出的 icons.json，默认落在仓库的未跟踪暂存目录。
// 本脚本只跑一次，跑完 icons.ts 恢复手工可编辑，之后单枚微调直接改 icons.ts，不再回跑本脚本。
// 用法：node scripts/vendor-solar-icons.mjs [solar包目录]
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = path.resolve(process.argv[2] || path.join(root, 'tmp/iconsets/sets/iconify-json-solar-1.2.13/package'))
const solar = JSON.parse(readFileSync(path.join(PKG, 'icons.json'), 'utf8'))
if (solar.prefix !== 'solar') throw new Error(`${PKG}/icons.json 不是 solar 集（prefix=${solar.prefix}）`)

// 键名一律不动，只换 path 数据。右侧是 Solar 图标名（kebab），描边族去后缀补 `-linear`；
// 以 "!" 开头 = 整名照用（这些枚不带 -linear 后缀）。
const MAP = {
  search: 'magnifier',
  searchEmpty: 'magnifier-slash',
  x: 'close',
  star: 'star',
  pin: 'pin',
  unpin: '!pin-broken',
  dots: 'menu-dots',
  trash: 'trash-bin-minimalistic',
  upload: 'upload-minimalistic',
  check: 'check',
  checkall: 'check-square',
  image: 'gallery',
  max: 'maximize',
  min: 'minimize',
  tag: 'tag',
  all: 'grid-2x2',
  doc: 'document',
  clip: 'paperclip',
  edit: 'pen',
  filter: 'filter',
  clock: 'clock-circle',
  panel: 'panel-right',
  bulletlist: 'list',
  orderedlist: 'list-ordered',
  quote: 'quote',
  code: 'code',
  divider: 'minus',
  link: 'link',
  external: '!square-alt-arrow-up-linear',
  copy: 'copy',
  eye: 'eye',
  eyeOff: 'eye-closed',
  lock: 'lock',
  unlock: 'lock-unlocked',
  lockOff: '!lock-broken',
  folder: 'folder',
  terminal: 'command',
  plus: 'add',
  user: 'user',
  mapPin: 'map-point',
  alert: 'danger-triangle',
  chevDown: 'alt-arrow-down',
  shield: 'shield',
  globe: 'globe',
  gear: 'settings',
  navEntries: 'bookmark',
  navNotes: 'document-text',
  navFiles: 'folder',
  navMfa: 'key',
  navLan: 'server',
  arrowRight: 'arrow-right',
  chevRight: 'alt-arrow-right',
  clipboard: 'clipboard',
  file: 'file-text',
  folderOpen: 'folder-open',
  refresh: 'refresh',
  download: 'download-minimalistic',
  adjustments: 'settings-minimalistic',
  palette: 'palette',
  info: 'info-circle',
  database: 'database',
}

// 状态位实心：只给"剪影本身即语义"的件，取 Round Bold（带内腔的件不做实心，见设计文档第 3 节）。
// 侧栏五枚 nav*Filled 曾在此，真窗口走查后删除，别再加回。
const FILLED_MAP = {
  starFilled: 'star',
}

// Solar 的 body 自带 fill/stroke/stroke-width/线帽线角，会盖掉 AppIcon 根 svg 的按尺寸反算轨宽。
// 一律剥掉，交回根 svg 继承；fill-rule/clip-rule 保留（实心件的挖空轮廓靠它）。
const STRIP = /\s(?:fill|stroke|stroke-width|stroke-linecap|stroke-linejoin)="[^"]*"/g
const name = (base, suffix) => (base.startsWith('!') ? base.slice(1) : base + suffix)

function pick(key, base, suffix) {
  const ic = solar.icons[name(base, suffix)] || solar.aliases?.[name(base, suffix)]
  if (!ic) throw new Error(`solar 里没有 ${name(base, suffix)}（键 ${key}）`)
  const body = ic.body.replace(STRIP, '')
  if (/fill=|stroke=/.test(body)) throw new Error(`键 ${key} 剥完仍残留 fill/stroke 属性：${body}`)
  return body
}

const body = {}
for (const [k, v] of Object.entries(MAP)) body[k] = pick(k, v, '-linear')
for (const [k, v] of Object.entries(FILLED_MAP)) body[k] = pick(k, v, '-bold')

const HEADER = `/**
 * 描边图标的路径内容，配合 AppIcon 使用（viewBox 0 0 24 24）。
 *
 * 2026-10-08 风格轮：骨架整体换成 Solar Round Linear（CC-BY-4.0，经 @iconify-json/solar v1.2.13
 * 取数后 vendored 在此，运行时零依赖）。换骨架的原因是 Tabler 那套直角切角和 desko 的圆角容器
 * （--radius / --radius-ib / 34px 浮岛）不在一个气质上。候选对拍与拍板依据见
 * docs/design/distinctive/03-icon-style-solar.md，署名条目见 public/icons/NOTICE.md。
 *
 * 三条不动的轨：
 *   1) 键名与调用点不动，只换 path 数据；
 *   2) 笔画不写死 —— AppIcon 按尺寸反算 stroke-width，12px 到 22px 实笔恒 1.15px；
 *   3) 主体仍落在 24 网格内，越界由 scripts/icon-board.mjs 的描边守护拦。
 *
 * 状态位实心（\`Filled\` 结尾）取 Solar Round Bold，只给"剪影本身即语义"的稳定状态，当前一枚：已收藏星标。
 * 侧栏当前模块曾用实心母版，22px 下与白块糊成一块色斑，已退回描边、状态交给容器。带内腔的件不做实心。
 *
 * 例外两枚：标题栏四颗窗口控件不住在这里（TitleBar.vue 自带 12 viewBox 实笔 1px，
 * 刻意比方框更硬）；\`max\`/\`min\` 是小记的全屏/还原钮，不是窗控。
 * 单枚微调直接改下面的字符串，别再回跑 scripts/vendor-solar-icons.mjs（那是一次性脚本）。
 */`

const src = readFileSync(path.join(root, 'src/utils/icons.ts'), 'utf8')
const order = [...src.matchAll(/^  (\w+): /gm)]
  .map((m) => m[1])
  .filter((k) => !k.endsWith('Filled'))
const missing = order.filter((k) => !MAP[k])
if (missing.length) throw new Error(`这些旧键没有映射：${missing.join(', ')}`)
const added = Object.keys(MAP).filter((k) => !order.includes(k))

const lines = [...order, ...added].map((k) => `  ${k}: '${body[k]}',`)
lines.push('')
lines.push(...Object.keys(FILLED_MAP).map((k) => `  ${k}: '${body[k]}',`))

writeFileSync(
  path.join(root, 'src/utils/icons.ts'),
  `${HEADER}\nexport const icons = {\n${lines.join('\n')}\n} as const\n\nexport type IconName = keyof typeof icons\n`,
)
console.log(
  `写入 ${Object.keys(MAP).length} 描边 + ${Object.keys(FILLED_MAP).length} 实心，其中新收编 ${added.length} 枚：${added.join(' ') || '无'}`,
)
