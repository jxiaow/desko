"""Synthetic snapshots and isolated PTYs; no real account or user session touched."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import pty
import re
import select
import shlex
import signal
import sys
import tempfile
import termios
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('helper', Path(__file__).parent.parent / 'resources/codex_wsl_daemon.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

def jwt(claims):
    return 'e30.' + base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=') + '.fake'

def auth(expiry=None):
    return {'tokens': {'id_token': jwt({'email': 'fake@example.invalid'}), 'access_token': jwt({'exp': expiry or time.time() + 3600, 'https://api.openai.com/auth': {'chatgpt_account_id': 'workspace'}})}}

def process(**values):
    return {'pid': 99123, 'uid': os.getuid(), 'ticks': 100, 'ppid': 1, 'tty': 34816, 'state': 'S', 'exe': '/fake/codex', 'args': ['/fake/codex'], **values}

class WslHelperTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='desko-wsl-fixture-')
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)

    def fake_proc(self, pid=99123, parent=1, tty=34816, args=None, env=None, ticks=100):
        proc = self.home / 'proc'; proc.mkdir(exist_ok=True)
        path = proc / str(pid); path.mkdir(exist_ok=True)
        fields = ['0'] * 20; fields[0] = 'S'; fields[1] = str(parent); fields[4] = str(tty); fields[19] = str(ticks)
        (path / 'stat').write_text(f'{pid} (fixture codex) ' + ' '.join(fields))
        (path / 'exe').symlink_to('/fake/codex')
        (path / 'cmdline').write_bytes(b'\0'.join(a.encode() for a in (args or ['codex'])))
        (path / 'environ').write_bytes((env or '').encode())
        return proc

    def test_owned_managed_daemon_with_stale_identity_blocks_writes(self):
        proc = self.fake_proc(tty=0, args=['codex', 'app-server', '--managed-daemon'])
        with self.assertRaises(ValueError): helper.clients(self.home, proc)
        record = self.home / 'app-server-daemon'; record.mkdir()
        (record / 'daemon.pid').write_text(json.dumps({'pid': 99123, 'processIdentity': {'startTicks': 99}}))
        with self.assertRaises(ValueError): helper.clients(self.home, proc)
        (record / 'daemon.pid').write_text(json.dumps({'pid': 99123, 'processIdentity': {'startTicks': 100}}))
        self.assertEqual(helper.clients(self.home, proc)[0]['kind'], 'daemon')

    def test_custom_codex_home_is_never_counted_or_stopped(self):
        proc = self.fake_proc(tty=0, args=['codex', 'app-server', '--managed-daemon'], env='CODEX_HOME=/fixture/other')
        self.assertEqual(helper.clients(self.home, proc), [])

    def test_helper_and_ancestors_are_excluded_from_client_scope(self):
        proc = self.fake_proc()
        self.fake_proc(pid=os.getpid(), parent=99123)
        self.assertEqual(helper.clients(self.home, proc), [])

    def test_probe_is_read_only_without_start_or_write(self):
        path = self.home / 'auth.json'; path.write_text(json.dumps(auth()))
        before = path.read_bytes()
        with patch.object(helper, 'clients', return_value=[process(kind='cli')]), patch.object(helper.os, 'kill') as kill:
            self.assertEqual(helper.probe(self.home), {'identity': {'accountId': 'workspace', 'email': 'fake@example.invalid'}, 'daemonCount': 0, 'cliCount': 1})
            kill.assert_not_called()
        self.assertEqual(path.read_bytes(), before)

    def test_strong_identity_without_email_and_corrupt_file(self):
        payload = {'tokens': {'account_id': 'only-id', 'access_token': 'opaque'}}
        self.assertEqual(helper.identity(payload), {'accountId': 'only-id', 'email': ''})
        (self.home / 'auth.json').write_text('broken')
        self.assertIsNone(helper.file_identity(self.home))

    def test_classification_excludes_noninteractive_and_requires_valid_daemon_record(self):
        for command in helper.NON_INTERACTIVE:
            self.assertIsNone(helper.process_kind(process(args=['codex', command])))
        self.assertIsNone(helper.process_kind(process(tty=0)))
        self.assertIsNone(helper.process_kind(process(tty=1025)))
        self.assertEqual(helper.process_kind(process()), 'cli')
        info = process(tty=0, args=['codex', 'app-server', '--managed-daemon'])
        self.assertEqual(helper.process_kind(info, (99123, 100)), 'daemon')
        self.assertIsNone(helper.process_kind(info, (99123, 99)))

    def test_pid_reuse_uid_and_exec_changes_reject_before_signal(self):
        expected = process()
        for changes in [{'ticks': 101}, {'uid': os.getuid()+1}, {'exe': '/fake/other'}, {'args': ['other']}]:
            with patch.object(helper, 'process_info', return_value=process(**changes)), patch.object(helper.os, 'kill') as kill:
                with self.assertRaises(ValueError): helper.stop_group([expected])
                kill.assert_not_called()

    def test_disappeared_and_zombie_processes_are_not_signalled(self):
        for info in [None, process(state='Z')]:
            with patch.object(helper, 'process_info', **({'side_effect': FileNotFoundError()} if info is None else {'return_value': info})), patch.object(helper.os, 'kill') as kill:
                helper.stop_group([process()]); kill.assert_not_called()

    def test_signal_revalidates_before_term_and_kill(self):
        clock = iter([0, 2, 2, 4])
        with patch.object(helper, 'same_process', side_effect=[True, True, False]), patch.object(helper.time, 'monotonic', side_effect=lambda: next(clock)), patch.object(helper.os, 'kill') as kill:
            helper.stop_group([process()])
            self.assertEqual(kill.call_args_list[0].args, (99123, signal.SIGTERM))
            self.assertEqual(kill.call_args_list[1].args, (99123, signal.SIGKILL))

    def test_stop_cli_before_rescan_daemon_without_restart(self):
        with patch.object(helper, 'clients', side_effect=[[process(kind='cli')], [process(kind='daemon')], []]), patch.object(helper, 'stop_group', return_value=1) as stop:
            self.assertEqual(helper.stop(self.home), {'daemonsStopped': 1, 'clisStopped': 1})
            self.assertEqual([call.args[0][0]['kind'] for call in stop.call_args_list], ['cli', 'daemon'])

    def test_background_cli_does_not_reset_another_foreground_application(self):
        read_fd, write_fd = pty.openpty()
        self.addCleanup(os.close, read_fd)
        self.addCleanup(os.close, write_fd)
        info = process(kind='cli', tty=os.fstat(write_fd).st_rdev, pgid=10, sid=10, foreground=20)
        with patch.object(helper.os, 'open', return_value=os.dup(write_fd)):
            self.assertIsNone(helper.capture_terminal(info))

    def test_new_foreground_job_is_not_reset_and_shell_termios_is_preserved(self):
        terminal = {'fd': 123, 'pgid': 10, 'groups': {10, 20}}
        with patch.object(helper, 'terminal_foreground', return_value=30), patch.object(helper.os, 'write') as write, patch.object(helper.subprocess, 'run') as sane:
            helper.restore_terminal(terminal)
            write.assert_not_called()
            sane.assert_not_called()
        with patch.object(helper, 'terminal_foreground', return_value=20), patch.object(helper.os, 'write', return_value=len(helper.TERMINAL_RESET)) as write, patch.object(helper.subprocess, 'run') as sane:
            helper.restore_terminal(terminal)
            sane.assert_not_called()
            write.assert_called_once_with(123, helper.TERMINAL_RESET)

    def test_terminal_is_held_before_signal_and_reset_only_after_process_exit(self):
        terminal = {'fd': 123, 'tty': 34816}
        expected = process(kind='cli')
        events = []
        with patch.object(helper, 'same_process', side_effect=[True, False]), patch.object(helper, 'capture_terminal', side_effect=lambda _: events.append('capture') or terminal), patch.object(helper, 'terminate_group', side_effect=lambda _: events.append('stop') or 1), patch.object(helper, 'restore_terminal', side_effect=lambda _: events.append('restore')), patch.object(helper.os, 'close', side_effect=lambda _: events.append('close')):
            self.assertEqual(helper.stop_group([expected]), 1)
        self.assertEqual(events, ['capture', 'stop', 'restore', 'close'])

    def test_live_client_after_failed_shutdown_keeps_its_terminal_modes(self):
        terminal = {'fd': 123, 'tty': 34816}
        with patch.object(helper, 'same_process', return_value=True), patch.object(helper, 'capture_terminal', return_value=terminal), patch.object(helper, 'terminate_group', side_effect=ValueError('clients remain')), patch.object(helper, 'restore_terminal') as restore, patch.object(helper.os, 'close') as close:
            with self.assertRaisesRegex(ValueError, 'clients remain'):
                helper.stop_group([process(kind='cli')])
            restore.assert_not_called()
            close.assert_called_once_with(123)

    def test_foreground_lookup_uses_tty_and_session_without_controlling_terminal(self):
        proc = self.fake_proc()
        stat = proc / '99123/stat'
        fields = stat.read_text().rsplit(')', 1)[1].split()
        fields[3] = '10'; fields[5] = '20'
        stat.write_text('99123 (fixture codex) ' + ' '.join(fields))
        self.assertEqual(helper.terminal_foreground({'tty': 34816, 'sid': 10}, proc), 20)
        self.assertIsNone(helper.terminal_foreground({'tty': 34816, 'sid': 11}, proc))
        self.assertEqual(helper.terminal_foreground({'tty': 34817, 'sid': 10}, proc), 0)

    def test_terminal_protocols_are_reset_even_if_stty_fails(self):
        terminal = {'fd': 123, 'pgid': 10, 'groups': {10}}
        with patch.object(helper, 'terminal_foreground', return_value=0), patch.object(helper.subprocess, 'run', side_effect=OSError('stty unavailable')), patch.object(helper.os, 'write', return_value=len(helper.TERMINAL_RESET)) as write:
            with self.assertRaises(OSError):
                helper.restore_terminal(terminal)
            write.assert_called_once_with(123, helper.TERMINAL_RESET)

    def test_one_broken_terminal_does_not_skip_other_terminal_cleanup(self):
        first = {'fd': 123, 'tty': 34816}
        second = {'fd': 124, 'tty': 34817}
        with patch.object(helper, 'same_process', side_effect=[True, True, False, False]), patch.object(helper, 'capture_terminal', side_effect=[first, second]), patch.object(helper, 'terminate_group', return_value=2), patch.object(helper, 'restore_terminal', side_effect=[OSError('closed PTY'), None]) as restore, patch.object(helper.os, 'close') as close:
            with self.assertRaisesRegex(ValueError, 'cannot restore'):
                helper.stop_group([process(kind='cli'), process(pid=99124, tty=34817, kind='cli')])
            self.assertEqual([call.args[0] for call in restore.call_args_list], [first, second])
            self.assertEqual(close.call_count, 2)

    def test_atomic_auth_only_0600_and_identity_readback(self):
        config = self.home / 'config.toml'; config.write_text('keep = true')
        with patch.object(helper, 'clients', return_value=[]):
            result = helper.write_auth(self.home, auth())
        self.assertEqual(result['identity']['accountId'], 'workspace')
        self.assertEqual((self.home / 'auth.json').stat().st_mode & 0o777, 0o600)
        self.assertEqual(config.read_text(), 'keep = true')
        self.assertEqual(sorted(p.name for p in self.home.iterdir()), ['auth.json', 'config.toml'])

    def test_expired_or_running_clients_never_write(self):
        for payload, found in [(auth(1), []), (auth(), [process()]), ({'auth_mode': 'apikey'}, [])]:
            with patch.object(helper, 'clients', return_value=found), self.assertRaises(ValueError): helper.write_auth(self.home, payload)
            self.assertFalse((self.home / 'auth.json').exists())

    def test_home_must_be_existing_owned_default_directory(self):
        with self.assertRaises(ValueError): helper.validate_home(self.home)
        class User: pw_dir = str(self.home)
        home = self.home / '.codex'
        with patch.object(helper.pwd, 'getpwuid', return_value=User()):
            with self.assertRaises(ValueError): helper.validate_home(home)
            home.mkdir(); self.assertEqual(helper.validate_home(home), home)
            home.rmdir(); home.symlink_to(self.home, target_is_directory=True)
            with self.assertRaises(ValueError): helper.validate_home(home)

    def test_symlink_auth_is_rejected(self):
        target = self.home / 'outside'; target.write_text('unchanged')
        (self.home / 'auth.json').symlink_to(target)
        with patch.object(helper, 'clients', return_value=[]), self.assertRaises(ValueError): helper.write_auth(self.home, auth())
        self.assertEqual(target.read_text(), 'unchanged')

class WslTerminalTests(unittest.TestCase):
    def close_child(self, pid, master):
        try:
            if os.waitpid(pid, os.WNOHANG)[0] == 0:
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
        except (ChildProcessError, ProcessLookupError):
            pass
        os.close(master)

    def read_until(self, master, marker, timeout=3):
        data = b''
        deadline = time.monotonic() + timeout
        matches = lambda: marker in data if isinstance(marker, bytes) else marker.search(data)
        while not matches() and time.monotonic() < deadline:
            if select.select([master], [], [], .05)[0]:
                try:
                    data += os.read(master, 65536)
                except OSError:
                    break
        self.assertTrue(matches(), repr(data))
        return data

    def start_raw_cli(self, ignore_term=False):
        pid, master = pty.fork()
        if pid == 0:
            try:
                if ignore_term:
                    signal.signal(signal.SIGTERM, signal.SIG_IGN)
                import tty
                tty.setraw(0)
                os.write(1, b'\x1b[?1003h\x1b[?1006h\x1b[?1004h\x1b[?2004h\x1b[>1u\x1b[?25lREADY')
                while True:
                    signal.pause()
            finally:
                os._exit(0)
        self.addCleanup(self.close_child, pid, master)
        self.read_until(master, b'READY')
        return pid, master

    def check_terminal_recovery(self, ignore_term):
        pid, master = self.start_raw_cli(ignore_term)
        self.assertFalse(termios.tcgetattr(master)[3] & termios.ISIG)
        self.assertEqual(helper.stop_group([{**helper.process_info(pid), 'kind': 'cli'}]), 1)
        self.assertEqual(os.waitpid(pid, 0)[1], signal.SIGKILL if ignore_term else signal.SIGTERM)
        flags = termios.tcgetattr(master)[3]
        for flag in (termios.ISIG, termios.ICANON, termios.ECHO):
            self.assertTrue(flags & flag)
        output = self.read_until(master, b'\x1b[?25h')
        for reset in (b'\x1b[?1003l', b'\x1b[?1006l', b'\x1b[?1004l', b'\x1b[?2004l', b'\x1b[<u', b'\x1b[?1049l'):
            self.assertIn(reset, output)

    def test_sigterm_restores_raw_mode_and_terminal_protocols(self):
        self.check_terminal_recovery(False)

    def test_sigkill_fallback_also_restores_the_terminal(self):
        self.check_terminal_recovery(True)

    def test_parent_shell_accepts_commands_and_ctrl_c_after_cli_exit(self):
        with tempfile.TemporaryDirectory(prefix='desko-terminal-shell-') as home:
            pid, master = pty.fork()
            if pid == 0:
                os.execve('/bin/bash', ['bash', '--noprofile', '--norc', '-i'],
                          {**os.environ, 'HOME': home, 'HISTFILE': '/dev/null', 'PS1': 'DESKO_TEST> ', 'TERM': 'xterm-256color'})
            self.addCleanup(self.close_child, pid, master)
            self.read_until(master, b'DESKO_TEST> ')
            code = 'import os,signal,tty; tty.setraw(0); os.write(1, ("\\r\\nRAW_PID:%d\\r\\n" % os.getpid()).encode()); signal.pause()'
            os.write(master, (shlex.quote(sys.executable) + ' -c ' + shlex.quote(code) + '\n').encode())
            ready = re.compile(rb'\r\nRAW_PID:(\d+)\r\n')
            output = self.read_until(master, ready)
            cli = int(ready.search(output).group(1))
            helper.stop_group([{**helper.process_info(cli), 'kind': 'cli'}])
            self.read_until(master, b'DESKO_TEST> ')
            os.write(master, b'printf "\\nTERMINAL_OK\\n"\n')
            self.assertIn(b'\r\nTERMINAL_OK\r\n', self.read_until(master, b'DESKO_TEST> '))
            os.write(master, b'sleep 30\n')
            time.sleep(.1)
            os.write(master, b'\x03')
            self.read_until(master, b'DESKO_TEST> ')
            os.write(master, b'printf "\\nCTRL_C_OK\\n"\n')
            self.assertIn(b'\r\nCTRL_C_OK\r\n', self.read_until(master, b'DESKO_TEST> '))
            os.write(master, b'exit\n')
            os.waitpid(pid, 0)


if __name__ == '__main__': unittest.main()
