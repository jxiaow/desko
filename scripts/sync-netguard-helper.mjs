// 构建 desko-netguard 提权 helper 并放到主程序找得到它的地方：
//   dev     → cargo build 到 target/debug（与 tauri dev 的 desko.exe 同目录）
//   release → 另拷一份到 src-tauri/binaries/desko-netguard-<triple>.exe 供 externalBin 打包
// 用法: node scripts/sync-netguard-helper.mjs [--release]
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tauriDir = join(root, 'src-tauri')
const release = process.argv.includes('--release')
const profile = release ? 'release' : 'debug'
const triple = `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`
const exe = `desko-netguard${process.platform === 'win32' ? '.exe' : ''}`

execFileSync('cargo', ['build', '-p', 'netguard-core', '--bin', 'desko-netguard', ...(release ? ['--release'] : [])], {
  cwd: tauriDir,
  stdio: 'inherit',
})

const built = join(tauriDir, 'target', profile, exe)
if (release) {
  const binDir = join(tauriDir, 'binaries')
  mkdirSync(binDir, { recursive: true })
  const dest = join(binDir, `desko-netguard-${triple}.exe`)
  rmSync(dest, { force: true })
  // 先写临时名再改名：主程序运行时也会拿着这个文件，直接 copy 会撞 EBUSY 留半成品
  const tmp = dest + '.new'
  copyFileSync(built, tmp)
  renameSync(tmp, dest)
}
console.log(`[sync-netguard-helper] ${profile} 就绪: ${built}`)
