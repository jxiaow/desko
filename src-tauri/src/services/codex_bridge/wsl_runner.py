"""WSL-only process adapter. Arguments are data, never shell source."""
import json
import os
import pathlib
import pwd
import signal
import subprocess
import sys
import threading


def directory(value):
    normalized = value.replace('\\', '/')
    if normalized.lower().startswith(('//wsl.localhost/', '//wsl$/')):
        parts = normalized.split('/', 4)
        if len(parts) < 4 or parts[3].lower() != os.environ.get('WSL_DISTRO_NAME', '').lower():
            raise ValueError('工作目录属于其他 WSL 发行版')
        value = '/' + (parts[4] if len(parts) > 4 else '')
    elif len(value) > 2 and value[1] == ':':
        value = subprocess.check_output(['wslpath', '-u', value], text=True, timeout=5).strip()
    value = os.path.expanduser(value)
    if not os.path.isabs(value) or not os.path.isdir(value):
        raise ValueError('请输入有效的 WSL 绝对目录，例如 /home/用户名/项目 或 /mnt/c/Code/项目')
    return os.path.realpath(value)


def codex():
    explicit = os.environ.get('CODEX_BIN')
    candidates = [explicit] if explicit else [
        str(pathlib.Path.home() / '.local/bin/codex'),
        *[str(pathlib.Path(p) / 'codex') for p in os.environ.get('PATH', '').split(':') if p and not p.startswith('/mnt/')],
        *[str(p / 'bin/codex') for p in sorted((pathlib.Path.home() / '.nvm/versions/node').glob('*'), key=lambda p: p.stat().st_mtime, reverse=True)],
    ]
    for candidate in candidates:
        if candidate and not candidate.endswith(('.exe', '.cmd')) and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            # npm/nvm launchers need the matching Linux node on PATH.
            os.environ['PATH'] = os.path.dirname(candidate) + ':' + os.environ.get('PATH', '')
            return candidate
    raise ValueError('此 WSL 用户未找到 Linux Codex CLI，请先在该发行版中安装并登录 Codex')


def run(cwd):
    stopped = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(sig, lambda *_: stopped.set())
    child = subprocess.Popen([codex(), 'app-server', '--listen', 'stdio://'], cwd=cwd,
                             stdin=subprocess.PIPE, start_new_session=True)

    def forward():
        try:
            while chunk := os.read(sys.stdin.fileno(), 8192):
                while chunk:
                    chunk = chunk[os.write(child.stdin.fileno(), chunk):]
        except (BrokenPipeError, OSError):
            pass
        finally:
            stopped.set()

    threading.Thread(target=forward, daemon=True).start()
    try:
        while child.poll() is None and not stopped.wait(0.05):
            pass
    finally:
        # The Windows Job owns wsl.exe; Linux descendants need their own group.
        # EOF or HUP from the connector also follows this cleanup path.
        try:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=1)
            except subprocess.TimeoutExpired:
                pass
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()


if __name__ == "__main__":
    try:
        mode, path = sys.argv[1:3]
        if mode == 'resolve':
            cwd = directory(path)
            codex()
            print(json.dumps({'cwd': cwd, 'user': pwd.getpwuid(os.getuid()).pw_name, 'distro': os.environ['WSL_DISTRO_NAME']}))
        elif mode == 'run':
            run(path)
        elif mode == 'git':
            os.environ['GIT_OPTIONAL_LOCKS'] = '0'
            result = subprocess.run(['git', '-C', path, *sys.argv[3:]], timeout=10)
            sys.exit(result.returncode)
        else:
            raise ValueError('未知的 WSL 操作')
    except Exception as error:
        if sys.argv[1:2] == ['resolve']:
            print(json.dumps({'error': str(error)}))
        sys.exit(1)
