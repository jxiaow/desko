// 局域网传输网页端的令牌与图标单一来源生成器。
// 产出三份入库文件：templates/tokens.css（App 主题令牌逐字复制）、theme_values.rs（主题戳词表）、
// icons.rs（Solar 描边路径）。sidecar 编译不需要 node；改了 App 配色再跑一次即可，网页端不得手抄颜色。
// 用法：node scripts/gen-fileshare-assets.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

const TOKENS_OUT = 'src-tauri/fileshare-core/src/templates/tokens.css'
const VALUES_OUT = 'src-tauri/fileshare-core/src/theme_values.rs'
const ICONS_OUT = 'src-tauri/fileshare-core/src/icons.rs'
const WORKSPACE_CSS = 'src/styles/workspace-themes.css'
const CHECK = process.argv.includes('--check')

const norm = (s) => s.replace(/\s+/g, ' ').trim()
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/** 顶层规则扫描：返回 [{ selector, raw }]，raw 原样保留注释与缩进 */
function topLevelRules(css) {
  const rules = []
  let start = 0
  let i = 0
  while (i < css.length) {
    if (css[i] === '/' && css[i + 1] === '*') { i = css.indexOf('*/', i + 2) + 2 || css.length; continue }
    // 不带大括号的顶层语句（@import / @charset）本身不是规则，但它会被当作下一条规则的
    // 选择器文本吞进去——global.css 开头的 @import 就是靠这条把尺度层整块吃掉的。
    if (css[i] === ';') { start = i + 1; i++; continue }
    if (css[i] !== '{') { i++; continue }
    let depth = 0
    let j = i
    for (; j < css.length; j++) {
      const c = css[j]
      if (c === '"' || c === "'") { j = css.indexOf(c, j + 1); continue }
      if (c === '/' && css[j + 1] === '*') { j = css.indexOf('*/', j + 2) + 1; continue }
      if (c === '{') depth++
      else if (c === '}') { depth--; if (!depth) break }
    }
    rules.push({ selector: norm(stripComments(css.slice(start, i))), raw: css.slice(start, j + 1).trim() })
    start = j + 1
    i = j + 1
  }
  return rules
}

/** 纯令牌块 = 至少一条声明，且每条都是 --自定义属性 */
function isTokenBlock(rule) {
  const body = rule.raw.slice(rule.raw.indexOf('{') + 1, rule.raw.lastIndexOf('}'))
  const decls = stripComments(body).split(';').map(norm).filter(Boolean)
  return decls.length > 0 && decls.every((d) => /^--[\w-]+\s*:\s*\S/.test(d))
}

function pickAll(rel) {
  const rules = topLevelRules(read(rel))
  const kept = rules.filter((r) => !r.selector.startsWith('@') && isTokenBlock(r))
  if (!kept.length) throw new Error(`${rel} 没摘到任何令牌块`)
  return { rel, blocks: kept.map((r) => r.raw) }
}

function pickBySelector(rel, allowlist) {
  const rules = topLevelRules(read(rel))
  const blocks = []
  for (const sel of allowlist) {
    const hits = rules.filter((r) => r.selector === sel)
    if (!hits.length) throw new Error(`${rel} 缺少令牌块: ${sel}`)
    const bad = hits.filter((r) => !isTokenBlock(r))
    if (bad.length) throw new Error(`${rel} 的 ${sel} 不是纯令牌块，生成器拒绝复制混合规则`)
    blocks.push(...hits.map((r) => r.raw))
  }
  return { rel, blocks }
}

// 顺序照 App 的实际级联：材质角色 → 尺度与两档底色 → 工作区画布与强调色。
const SOURCES = [
  pickAll('src/styles/materials.css'),
  pickBySelector('src/styles/global.css', [
    ':root',
    ':where(:root), [data-theme="paper"]',
    '[data-theme="ink"]',
    '[data-base="light"]',
  ]),
  pickAll(WORKSPACE_CSS),
]

const TOKENS = `/* 生成物，勿手改：node scripts/gen-fileshare-assets.mjs
 * 由以下 App 样式逐字复制（不改选择器、不重命名槽位）：
${SOURCES.map((s) => ` *   ${s.rel}`).join('\n')}
 *
 * 页面须在 <html> 上挂 data-layout="workspace" 以及 data-theme / data-base / data-accent /
 * data-atmosphere，级联才会替网页算出 --accent-soft、--text-brand、--bg-workspace。
 * 画布吃 var(--bg-workspace)，浮层吃 var(--bg-dialog)：氛围光随 data-atmosphere 自动跟上。
 */

${SOURCES.map((s) => s.blocks.join('\n\n')).join('\n\n')}
`

/* 网页端的 <style> 只写 var()，不重复定义尺度：圆角/间距/字号/动效必须和 App 同源。
   少一槽就是页面当场拿不到值（var 失效→回落继承），而截图对拍最容易把它读成"颜色不对"，
   所以在这里按页面真正引用的槽位逐个卡死。 */
const REQUIRED_SLOTS = [
  '--space-2', '--space-3', '--space-4', '--radius-xs', '--radius-sm', '--radius-ib', '--radius',
  '--radius-md', '--radius-xl', '--radius-pill', '--text-2xs', '--text-xs', '--text-sm',
  '--text-base', '--text-md', '--transition', '--font-ui', '--font-mono', '--content-max',
  // 11 档文件类型色：网页按 `--ft-<档>` 拼变量名，缺哪一档那一档的文件就静默失色，
  // 而 App 与网页的分法刚统一过，只有这里能把它卡住。
  '--ft-pdf', '--ft-doc', '--ft-sheet', '--ft-deck', '--ft-arch', '--ft-code', '--ft-mark',
  '--ft-img', '--ft-vid', '--ft-audio', '--ft-unk',
]
for (const slot of REQUIRED_SLOTS) {
  if (!new RegExp(`^\\s*${slot}\\s*:`, 'm').test(TOKENS)) {
    throw new Error(`tokens.css 缺尺度槽 ${slot}：App 侧改了名或删除，网页端会静默丢样式，生成器拒绝产出`)
  }
}
if (/@import\s/.test(TOKENS)) throw new Error('tokens.css 里混进了 @import，浏览器会去请求一个不存在的路径')

/* ---------- 主题戳词表 ---------- */

/** 从选择器文本里收集 [name="value"] 的值：去重 + 排序，保证重复生成逐字一致 */
function attrValues(text, name) {
  const found = new Set()
  for (const m of text.matchAll(new RegExp(`\\[${name}="([^"]*)"\\]`, 'g'))) found.add(m[1])
  return [...found].sort()
}

// 只认工作区那一档：tokens.css 的画布对与强调色全出自 workspace-themes.css，
// 词表跟着它走 = 「主题戳能接受的值」严格等价于「复制过来的令牌里真有这一块」。
const workspaceText = SOURCES.find((s) => s.rel === WORKSPACE_CSS).blocks.join('\n')
const VOCAB = {
  WORKSPACE_THEMES: attrValues(workspaceText, 'data-theme'),
  WORKSPACE_BASES: attrValues(workspaceText, 'data-base'),
  WORKSPACE_ACCENTS: attrValues(workspaceText, 'data-accent'),
}
for (const [name, list] of Object.entries(VOCAB)) {
  if (!list.length) throw new Error(`${WORKSPACE_CSS} 里找不到 ${name} 词表，生成器拒绝产出空词表`)
}

const VALUES_RS = `// 生成物，勿手改：node scripts/gen-fileshare-assets.mjs
// 词表取自 ${WORKSPACE_CSS} 的选择器，与 templates/tokens.css 同源。
// 主题戳只认这里列出的值——App 新增一档底色或强调色后重跑本脚本，网页端才敢跟着换。

${Object.entries(VOCAB)
  .map(([name, list]) => `pub const ${name}: &[&str] = &[${list.map((v) => JSON.stringify(v)).join(', ')}];`)
  .join('\n')}
`

/* ---------- 图标 ---------- */

const STROKE_PX = 1.15
const WHITELIST = [
  'navLan', 'search', 'searchEmpty', 'upload', 'download', 'gear', 'folder', 'doc', 'image',
  'archive', 'code', 'bulletlist', 'file', 'info', 'clip', 'check', 'alert', 'clock', 'x',
  'lock', 'eye', 'eyeOff', 'arrowRight', 'video', 'audio',
]

function iconPaths() {
  const ts = read('src/utils/icons.ts')
  const map = new Map()
  for (const m of ts.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):\s*'(.*?)',\s*$/gm)) map.set(m[1], m[2])
  const missing = WHITELIST.filter((n) => !map.has(n))
  if (missing.length) throw new Error(`src/utils/icons.ts 缺少图标: ${missing.join(', ')}`)
  return map
}

/** Rust 原始字符串：按内容挑定界符，避免路径里的引号撞车 */
function rustStr(s) {
  let hashes = 1
  while (s.includes(`${'#'.repeat(hashes)}`) || s.includes(`"${'#'.repeat(hashes)}`)) hashes++
  const h = '#'.repeat(hashes)
  return `r${h}"${s}"${h}`
}

const icons = iconPaths()
const ICONS_RS = `// 生成物，勿手改：node scripts/gen-fileshare-assets.mjs
// 路径数据逐字取自 src/utils/icons.ts（Solar Round Linear，CC-BY-4.0，见 public/icons/NOTICE.md）。
// 外壳与 AppIcon.vue 同款：实笔恒定 ${STROKE_PX}px，按尺寸在 24 网格上反算 stroke-width。

use std::collections::HashMap;
use std::sync::OnceLock;

const PATHS: &[(&str, &str)] = &[
${WHITELIST.map((n) => `    (${rustStr(n)}, ${rustStr(icons.get(n))}),`).join('\n')}
];

fn table() -> &'static HashMap<&'static str, &'static str> {
    static TABLE: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();
    TABLE.get_or_init(|| PATHS.iter().copied().collect())
}

/// 描边图标；名字不认识就回退 file，绝不 panic——网页端不能因为少一枚图标开白屏。
pub fn icon(name: &str, size: u16) -> String {
    let path = table().get(name).copied().unwrap_or_else(|| table()["file"]);
    let size = match size {
        0 => 14,
        n if n > 96 => 96,
        n => n,
    };
    let stroke = format!("{:.2}", ${STROKE_PX}_f32 * 24.0 / size as f32);
    format!(
        r#"<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{path}</svg>"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icon_falls_back_to_file() {
        assert_eq!(icon("no-such-icon", 14), icon("file", 14));
    }

    #[test]
    fn icon_stroke_is_size_compensated() {
        assert!(icon("search", 14).contains(r#"stroke-width="1.97""#));
        assert!(icon("search", 18).contains(r#"stroke-width="1.53""#));
    }

    #[test]
    fn every_whitelisted_icon_renders() {
        for (name, _) in PATHS {
            let svg = icon(name, 16);
            assert!(svg.starts_with("<svg") && svg.ends_with("</svg>"), "{name}");
        }
    }
}
`

function writeIfChanged(rel, text) {
  const abs = path.join(ROOT, rel)
  let current = null
  try { current = readFileSync(abs, 'utf8') } catch { /* 首次生成 */ }
  if (current === text) { console.log(`= ${rel} 无变化`); return }
  if (CHECK) { console.error(`✗ ${rel} 与 App 源不同步，请重跑 node scripts/gen-fileshare-assets.mjs`); process.exitCode = 1; return }
  writeFileSync(abs, text, 'utf8')
  console.log(`✓ ${rel}`)
}

writeIfChanged(TOKENS_OUT, TOKENS)
writeIfChanged(VALUES_OUT, VALUES_RS)
writeIfChanged(ICONS_OUT, ICONS_RS)
if (process.exitCode) console.error('--check：生成物过期')
else console.log(`令牌 ${TOKENS.split('\n').filter((l) => l.trim().startsWith('--')).length} 槽 / 图标 ${WHITELIST.length} 枚 / 词表 ${Object.values(VOCAB).map((v) => v.length).join('×')}`)
