import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
export function checkVersion() {
  const version = JSON.parse(read('package.json')).version
  const lock = JSON.parse(read('package-lock.json'))
  const values = [lock.version, lock.packages?.['']?.version,
    JSON.parse(read('src-tauri/tauri.conf.json')).version,
    read('src-tauri/Cargo.toml').match(/\[package\][\s\S]*?\nversion = "([^"]+)"/)?.[1],
    read('src-tauri/Cargo.lock').match(/\[\[package\]\]\r?\nname = "desko"\r?\nversion = "([^"]+)"/)?.[1]]
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('安装包版本请使用三段数字，例如 1.0.1')
  if (values.some(v => v !== version)) throw new Error('版本不一致，请运行 npm run version:set -- sync')
  return version
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const [arg, ...extra] = process.argv.slice(2)
    if (extra.length || !arg) throw new Error('用法：npm run version:set -- patch|minor|major|1.2.3|sync')
    if (arg === '--check') {
      const version = checkVersion()
      if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) throw new Error('Git 标签与应用版本不一致')
      console.log(`版本检查通过：${version}`)
    } else {
      const current = JSON.parse(read('package.json')).version
      let next = arg === 'sync' ? current : arg
      if (['patch', 'minor', 'major'].includes(arg)) {
        const parts = current.split('.').map(Number)
        const index = { major: 0, minor: 1, patch: 2 }[arg]
        parts[index]++
        for (let i = index + 1; i < 3; i++) parts[i] = 0
        next = parts.join('.')
      }
      if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(next)) throw new Error('版本必须是三段数字，例如 1.0.1')
      const updates = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json'].map(path => {
        let text = read(path).replace(/("version"\s*:\s*")[^"]+"/, `$1${next}"`)
        if (path === 'package-lock.json') text = text.replace(/(""\s*:\s*\{[\s\S]*?"version"\s*:\s*")[^"]+"/, `$1${next}"`)
        return [path, text]
      })
      updates.push(['src-tauri/Cargo.toml', read('src-tauri/Cargo.toml').replace(/(\[package\][\s\S]*?\nversion = ")[^"]+"/, `$1${next}"`)])
      updates.push(['src-tauri/Cargo.lock', read('src-tauri/Cargo.lock').replace(/(\[\[package\]\]\r?\nname = "desko"\r?\nversion = ")[^"]+"/, `$1${next}"`)])
      for (const [path, text] of updates) writeFileSync(new URL(path, root), text)
      checkVersion()
      console.log(`应用版本：${current} → ${next}。版本文件已同步。`)
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
