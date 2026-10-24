// Windows -> WSL connector teardown with a synthetic CLI; never starts a model.
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const distro = process.argv[2]
if (process.platform !== 'win32' || !distro) throw new Error('Run on Windows: node scripts/codex-wsl-lifecycle-check.mjs <distro>')
const prefix = ['--distribution', distro, '--cd', '~', '--exec']
const runner = readFileSync(new URL('../src-tauri/src/services/codex_bridge/wsl_runner.py', import.meta.url), 'utf8')
const python = (source, ...args) => execFileSync('wsl.exe', [...prefix, 'python3', '-c', source, ...args], { windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim()
const root = python(String.raw`import tempfile, pathlib
root = pathlib.Path(tempfile.mkdtemp(prefix='desko-wsl-lifecycle-'))
fake = root / 'codex'
fake.write_text('#!/usr/bin/python3\nimport subprocess, os, json, time\nchild=subprocess.Popen(["sleep","120"])\nprint(json.dumps([os.getpid(),child.pid]),flush=True)\ntime.sleep(120)\n')
fake.chmod(0o700)
print(root)`)
let child
let pids = []
try {
  child = spawn('wsl.exe', [...prefix, 'bash', '-lc', 'export CODEX_BIN="$1"; exec python3 -u -c "$2" run "$3"', 'desko-test', `${root}/codex`, runner, root], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
  pids = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Fixture startup timed out')), 10000)
    const lines = createInterface({ input: child.stdout })
    lines.on('line', line => {
      try {
        const value = JSON.parse(line)
        if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isInteger)) return
        clearTimeout(timeout); lines.close(); resolve(value)
      } catch {}
    })
    child.on('error', error => { clearTimeout(timeout); reject(error) })
  })
  // Simulates forced Windows connector death, not graceful Python shutdown.
  child.kill()
  const until = Date.now() + 5000
  let running
  do {
    running = JSON.parse(python(`import pathlib,json,sys
print(json.dumps([p for p in json.loads(sys.argv[1]) if pathlib.Path(f'/proc/{p}/stat').exists() and pathlib.Path(f'/proc/{p}/stat').read_text().split()[2]!='Z']))`, JSON.stringify(pids)))
    if (!running.length) break
    await new Promise(resolve => setTimeout(resolve, 100))
  } while (Date.now() < until)
  if (running.length) throw new Error(`Linux fixture processes survived connector death: ${running.join(', ')}`)
  console.log(`${distro}: forced Windows connector exit cleaned up both Linux fixture processes; no model tasks started.`)
} finally {
  child?.kill()
  // Only the synthetic process group and temporary directory created above.
  python(`import os,signal,shutil,sys
try:
    if sys.argv[2]: os.killpg(int(sys.argv[2]),signal.SIGKILL)
except ProcessLookupError: pass
shutil.rmtree(sys.argv[1],ignore_errors=True)`, root, pids[0] ? String(pids[0]) : '')
}
