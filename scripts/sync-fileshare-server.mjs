// 构建 desko-fileshare 服务进程二进制并放到主程序能找到它的地方：
//   dev     → 直接 cargo build 到 target/debug（与 tauri dev 的 desko.exe 同目录）
//   release → 另拷一份到 src-tauri/binaries/desko-fileshare-<triple>.exe 供 externalBin 打包
// 用法: node scripts/sync-fileshare-server.mjs [--release]
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tauriDir = join(root, 'src-tauri')
const release = process.argv.includes('--release')
const profile = release ? 'release' : 'debug'
const triple = `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`
const exe = `desko-fileshare${process.platform === 'win32' ? '.exe' : ''}`

execFileSync('cargo', ['build', '-p', 'fileshare-core', '--bin', 'desko-fileshare', ...(release ? ['--release'] : [])], {
  cwd: tauriDir,
  stdio: 'inherit',
})

const built = join(tauriDir, 'target', profile, exe)
if (release) {
  const binDir = join(tauriDir, 'binaries')
  mkdirSync(binDir, { recursive: true })
  const dest = join(binDir, `desko-fileshare-${triple}.exe`)
  rmSync(dest, { force: true })
  // 先写临时名再改名，避免服务进程正在运行旧文件时 copy 报 EBUSY 留下半成品
  const tmp = dest + '.new'
  copyFileSync(built, tmp)
  renameSync(tmp, dest)
}
console.log(`[sync-fileshare-server] ${profile} 就绪: ${built}`)
