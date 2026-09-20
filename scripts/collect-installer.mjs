#!/usr/bin/env node
/*
 * 把安装包从 src-tauri/target/release/bundle/nsis 拷到仓库根的 installer/
 *
 * cargo 的 target 目录嵌得深，但它 9.5G、挪走就要全量重编；
 * 要交付的只有一个 exe，所以留在那儿不动，构建完拷出来。
 *
 * 用法：npm run build:installer
 */
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const BUNDLE_DIR = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
const OUT_DIR = join(ROOT, 'installer')

let exes
try {
  exes = readdirSync(BUNDLE_DIR).filter((f) => f.endsWith('.exe'))
} catch {
  console.error(`构建产物目录不存在：${BUNDLE_DIR}`)
  process.exit(1)
}
if (!exes.length) {
  console.error(`目录里没有安装包：${BUNDLE_DIR}`)
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })
for (const file of exes) {
  const dest = join(OUT_DIR, file)
  copyFileSync(join(BUNDLE_DIR, file), dest)
  console.log(`installer/${file}  ${(statSync(dest).size / 1024 / 1024).toFixed(2)} MB`)
}
