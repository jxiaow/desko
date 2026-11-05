import { checkVersion } from './version.mjs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../', import.meta.url))
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

try {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--dry-run')) throw new Error('用法：npm run release [-- --dry-run]')
  const current = checkVersion()
  const parts = current.split('.').map(Number)
  parts[2]++
  const version = parts.join('.')
  if (git('status', '--porcelain')) throw new Error('还有未提交的修改。请先提交代码，再运行 npm run release。')
  const branch = git('symbolic-ref', '--short', 'HEAD')
  if (branch !== 'master') throw new Error('请在 master 分支运行发布命令。')
  git('cat-file', '-e', 'HEAD:.github/workflows/release.yml')
  const tag = `v${version}`
  if (git('tag', '--list', tag)) throw new Error(`本地标签 ${tag} 已存在，请勿重复发布。`)
  if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`)) throw new Error(`远端标签 ${tag} 已存在，请更新版本号后发布。`)
  console.log(`发布版本：${tag}\n目标：${git('remote', 'get-url', 'origin')}\n提交：${git('rev-parse', 'HEAD')}`)
  if (args.includes('--dry-run')) {
    console.log('检查通过；未创建标签或推送。')
  } else {
    // Only version files are committed; user changes must already be committed.
    execFileSync(process.execPath, ['scripts/version.mjs', 'patch'], { cwd, stdio: 'inherit' })
    git('add', '--', 'package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock')
    git('commit', '-m', `chore: release ${tag}`)
    git('tag', '-a', tag, '-m', `Desko ${tag}`)
    try {
      // Branch and tag arrive together; no release for an unpushed branch tip.
      git('push', '--atomic', 'origin', 'HEAD:refs/heads/master', `refs/tags/${tag}`)
    } catch (error) {
      throw new Error(`推送失败，本地标签 ${tag} 已保留。请检查远端状态后重试：git push --atomic origin HEAD:refs/heads/master refs/tags/${tag}\n${error.stderr || error.message}`)
    }
    console.log('已推送，GitHub Actions 将开始打包。全部成功后自动发布 Release 并上传安装包。')
  }
} catch (error) {
  console.error(`发布未完成：${error.stderr?.toString().trim() || error.message}`)
  process.exitCode = 1
}
