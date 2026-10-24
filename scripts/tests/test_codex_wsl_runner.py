"""Run under WSL/Linux: python3 -m unittest discover -s scripts/tests -p test_codex_wsl_runner.py."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

RUNNER = Path(__file__).resolve().parents[2] / 'src-tauri/src/services/codex_bridge/wsl_runner.py'
spec = importlib.util.spec_from_file_location('wsl_runner', RUNNER)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class WslRunnerTests(unittest.TestCase):
    def test_paths_with_unicode_spaces_and_shell_characters_are_literal(self):
        with tempfile.TemporaryDirectory(prefix='desko 空格 $(literal) ') as cwd:
            self.assertEqual(runner.directory(cwd), os.path.realpath(cwd))
            with patch.dict(os.environ, {'WSL_DISTRO_NAME': 'Ubuntu'}):
                self.assertEqual(runner.directory('\\\\wsl.localhost\\Ubuntu' + cwd.replace('/', '\\')), os.path.realpath(cwd))
                self.assertEqual(runner.directory('\\\\wsl.localhost\\Ubuntu'), '/')
                self.assertEqual(runner.directory('\\\\wsl$\\Ubuntu\\'), '/')
                with self.assertRaisesRegex(ValueError, '其他 WSL'):
                    runner.directory('\\\\wsl.localhost\\Debian\\tmp')
            with self.assertRaises(ValueError):
                runner.directory('relative/path')

    def check_shutdown(self, terminate):
        with tempfile.TemporaryDirectory(prefix='desko-wsl-process-') as cwd:
            fake = Path(cwd) / 'codex'
            fake.write_text(f'#!{sys.executable}\nimport subprocess, os, json, time\nchild = subprocess.Popen(["sleep", "120"])\nprint(json.dumps([os.getpid(), child.pid]), flush=True)\ntime.sleep(120)\n')
            fake.chmod(0o700)
            process = subprocess.Popen([sys.executable, '-u', str(RUNNER), 'run', cwd], env={**os.environ, 'CODEX_BIN': str(fake)}, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            try:
                pids = json.loads(process.stdout.readline())
                if terminate:
                    process.send_signal(signal.SIGTERM)
                else:
                    process.stdin.close()
                process.wait(timeout=4)
                self.assertEqual(process.returncode, 0)
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    running = [pid for pid in pids if Path(f'/proc/{pid}/stat').exists() and Path(f'/proc/{pid}/stat').read_text().split()[2] != 'Z']
                    if not running:
                        break
                    time.sleep(0.05)
                self.assertFalse(running, f'Linux children survived: {running}')
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=4)
                process.stdin.close()
                process.stdout.close()

    def test_stdin_eof_stops_linux_process_group(self):
        self.check_shutdown(False)

    def test_termination_stops_linux_process_group(self):
        self.check_shutdown(True)


if __name__ == '__main__':
    unittest.main()
