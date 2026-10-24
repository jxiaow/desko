"""Read existing WSL Codex identities; stop clients and write OAuth only on request.

Fixed actions only. Credentials enter on stdin and never appear in output.
"""
import base64
from contextlib import ExitStack
import json
import os
from pathlib import Path
import pwd
import signal
import subprocess
import sys
import tempfile
import time

MAX_AUTH = 4 * 1024 * 1024
# Reset the modes that an abruptly terminated TUI cannot unwind. Do not clear
# scrollback or reset the whole terminal: the shell and its history stay open.
TERMINAL_RESET = (
    b"\x1b[?2026l"  # synchronized output
    b"\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l"
    b"\x1b[?1004l\x1b[?2004l"  # focus reporting / bracketed paste
    b"\x1b[<u\x1b[>4;0m"  # Kitty keyboard / modifyOtherKeys
    b"\x1b[?1049l\x1b[0m\x1b[?25h"  # main screen, attributes, cursor
)
NON_INTERACTIVE = {
    "app-server", "exec-server", "exec", "e", "review", "login", "logout",
    "mcp", "mcp-server", "completion", "completions", "debug", "sandbox",
    "apply", "a", "cloud", "features", "help", "pid-update-loop",
}


def token_claims(token):
    try:
        part = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    except (ValueError, IndexError, TypeError):
        return {}


def identity(payload):
    tokens = payload.get("tokens") or {}
    access = token_claims(tokens.get("access_token", ""))
    info = token_claims(tokens.get("id_token", ""))
    auth = access.get("https://api.openai.com/auth") or {}
    id_auth = info.get("https://api.openai.com/auth") or {}
    account_id = (tokens.get("account_id") or auth.get("chatgpt_account_id")
                  or auth.get("account_id") or id_auth.get("chatgpt_account_id")
                  or id_auth.get("account_id"))
    email = info.get("email") or access.get("email") or (access.get(
        "https://api.openai.com/profile") or {}).get("email")
    account_id = account_id.strip() if isinstance(account_id, str) else None
    email = email.strip() if isinstance(email, str) else ""
    if not account_id and not email:
        return None
    return {"accountId": account_id or None, "email": email}


def validate_home(home):
    expected = Path(pwd.getpwuid(os.getuid()).pw_dir) / ".codex"
    if (home != expected or home.is_symlink() or not home.is_dir()
            or home.stat().st_uid != os.getuid()):
        raise ValueError("invalid home")
    return home


def file_identity(home):
    try:
        path = home / "auth.json"
        if path.is_symlink() or path.stat().st_size > MAX_AUTH:
            return None
        return identity(json.loads(path.read_text()))
    except (OSError, ValueError, TypeError, AttributeError):
        return None


def process_info(pid, proc=Path("/proc")):
    path = proc / str(pid)
    fields = (path / "stat").read_text().rsplit(")", 1)[1].split()
    args = [value.decode(errors="replace") for value in (path / "cmdline").read_bytes().split(b"\0") if value]
    return {"pid": pid, "uid": path.stat().st_uid, "ticks": int(fields[19]),
            "ppid": int(fields[1]), "tty": int(fields[4]), "state": fields[0],
            "pgid": int(fields[2]), "sid": int(fields[3]),
            "foreground": int(fields[5]),
            "exe": os.readlink(path / "exe"), "args": args}


def process_kind(info, managed=None):
    if Path(info["exe"]).name != "codex" or info["state"] in ("Z", "X"):
        return None
    args = info["args"][1:]
    if managed and (info["pid"], info["ticks"]) == managed:
        return "daemon" if "app-server" in args and "--managed-daemon" in args else None
    tty_major = (info["tty"] >> 8) & 0xfff
    if 136 <= tty_major <= 143 and not NON_INTERACTIVE.intersection(args):
        return "cli"
    return None


def clients(home, proc=Path("/proc")):
    excluded = set()
    pid = os.getpid()
    while pid and pid not in excluded:
        excluded.add(pid)
        try:
            pid = process_info(pid, proc)["ppid"]
        except (OSError, ValueError, IndexError):
            break
    managed = None
    try:
        record = json.loads((home / "app-server-daemon/daemon.pid").read_text())
        managed = int(record["pid"]), int(record["processIdentity"]["startTicks"])
    except (OSError, ValueError, KeyError, TypeError):
        pass
    found = []
    for path in proc.iterdir():
        if not path.name.isdigit() or int(path.name) in excluded:
            continue
        try:
            if path.stat().st_uid != os.getuid():
                continue
            info = process_info(int(path.name), proc)
            if Path(info["exe"]).name != "codex":
                continue
            # A custom CODEX_HOME belongs to a different profile.
            env = (path / "environ").read_bytes().split(b"\0")
            configured = next((item[11:].decode() for item in env if item.startswith(b"CODEX_HOME=")), "")
            if configured and Path(configured) != home:
                continue
            kind = process_kind(info, managed)
            if not kind and {"app-server", "--managed-daemon"}.issubset(info["args"]):
                raise ValueError("managed daemon identity unavailable")
            if kind:
                found.append({**info, "kind": kind})
        except FileNotFoundError:
            continue
        except PermissionError:
            # Do not claim a Codex process is absent when it cannot be inspected.
            try:
                if (path / "comm").read_text().strip() == "codex":
                    raise ValueError("cannot inspect Codex")
            except FileNotFoundError:
                pass
    return found


def probe(home):
    found = clients(home)
    return {"identity": file_identity(home),
            "daemonCount": sum(item["kind"] == "daemon" for item in found),
            "cliCount": sum(item["kind"] == "cli" for item in found)}


def same_process(expected):
    try:
        current = process_info(expected["pid"])
    except FileNotFoundError:
        return False
    if current["uid"] != os.getuid() or current["uid"] != expected["uid"] or current["ticks"] != expected["ticks"]:
        raise ValueError("process identity changed")
    if current["state"] in ("Z", "X"):
        return False
    if current["exe"] != expected["exe"] or current["args"] != expected["args"]:
        raise ValueError("process changed")
    return True


def capture_terminal(item):
    """Hold the actual PTY before its owner disappears from /proc."""
    for stream in (0, 1, 2):
        try:
            fd = os.open(f'/proc/{item["pid"]}/fd/{stream}',
                         os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK | os.O_CLOEXEC)
        except OSError:
            continue
        try:
            if not os.isatty(fd) or os.fstat(fd).st_rdev != item["tty"]:
                continue
            foreground = item["foreground"]
            # A background Codex must never reset another foreground TUI.
            if foreground != item["pgid"]:
                return None
            groups = {foreground}
            parent = item["ppid"]
            while parent:
                try:
                    info = process_info(parent)
                except (OSError, ValueError, IndexError):
                    break
                if info["tty"] != item["tty"] or info["sid"] != item["sid"]:
                    break
                groups.add(info["pgid"])
                parent = info["ppid"]
            result = {"fd": fd, "tty": item["tty"], "sid": item["sid"],
                      "pgid": foreground, "groups": groups}
            fd = None
            return result
        finally:
            if fd is not None:
                os.close(fd)
    if same_process(item):
        raise ValueError("cannot restore Codex terminal")
    return None


def terminal_foreground(terminal, proc=Path("/proc")):
    # The WSL helper has no controlling terminal, so TIOCGPGRP on another
    # session's slave PTY returns ENOTTY. /proc exposes the same foreground ID.
    for path in proc.iterdir():
        if not path.name.isdigit():
            continue
        try:
            fields = (path / "stat").read_text().rsplit(")", 1)[1].split()
            if int(fields[4]) != terminal["tty"] or fields[0] in ("Z", "X"):
                continue
            if path.stat().st_uid != os.getuid() or int(fields[3]) != terminal["sid"]:
                return None
            return int(fields[5])
        except (OSError, ValueError, IndexError):
            continue
    return 0


def restore_terminal(terminal):
    fd = terminal["fd"]
    foreground = terminal_foreground(terminal)
    if foreground != 0 and foreground not in terminal["groups"]:
        return
    # A shell that already reclaimed the PTY has restored its own termios and
    # may now be running readline in raw mode. Do not overwrite that mode.
    try:
        if foreground in (0, terminal["pgid"]):
            subprocess.run(["stty", "sane"], stdin=fd, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=.5, check=True)
    finally:
        if os.write(fd, TERMINAL_RESET) != len(TERMINAL_RESET):
            raise ValueError("incomplete terminal reset")


def stop_group(found):
    with ExitStack() as cleanup:
        terminals = {}
        for item in found:
            if item.get("kind") != "cli" or not same_process(item):
                continue
            if item["tty"] not in terminals:
                terminal = capture_terminal(item)
                if terminal:
                    cleanup.callback(os.close, terminal["fd"])
                    terminals[item["tty"]] = terminal
        try:
            return terminate_group(found)
        finally:
            errors = []
            for tty, terminal in terminals.items():
                try:
                    if not any(same_process(item) for item in found if item["tty"] == tty):
                        restore_terminal(terminal)
                except (OSError, ValueError, subprocess.SubprocessError) as error:
                    errors.append(error)
            if errors:
                raise ValueError("cannot restore Codex terminal") from errors[0]


def terminate_group(found):
    for item in found:
        if same_process(item):
            try:
                os.kill(item["pid"], signal.SIGTERM)
            except ProcessLookupError:
                pass
    deadline = time.monotonic() + 1.5
    while time.monotonic() < deadline and any(same_process(item) for item in found):
        time.sleep(.03)
    for item in found:
        if same_process(item):
            try:
                os.kill(item["pid"], signal.SIGKILL)
            except ProcessLookupError:
                pass
    deadline = time.monotonic() + 1
    while time.monotonic() < deadline and any(same_process(item) for item in found):
        time.sleep(.03)
    if any(same_process(item) for item in found):
        raise ValueError("clients remain")
    return len(found)


def stop(home):
    # Stop terminal clients before rescanning the daemon they could respawn.
    cli_count = stop_group([item for item in clients(home) if item["kind"] == "cli"])
    daemon_count = stop_group([item for item in clients(home) if item["kind"] == "daemon"])
    if clients(home):
        raise ValueError("new clients appeared")
    return {"daemonsStopped": daemon_count, "clisStopped": cli_count}


def write_auth(home, payload):
    if payload.get("auth_mode", "chatgpt") != "chatgpt" or not identity(payload):
        raise ValueError("OAuth required")
    tokens = payload.get("tokens") or {}
    expiry = token_claims(tokens.get("access_token", "")).get("exp")
    if not tokens.get("access_token") or (isinstance(expiry, (int, float)) and expiry <= time.time()):
        raise ValueError("expired OAuth")
    if clients(home):
        raise ValueError("stop Codex before writing")
    target = home / "auth.json"
    if target.is_symlink():
        raise ValueError("invalid auth target")
    fd, name = tempfile.mkstemp(prefix=".desko-auth-", dir=home)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as file:
            json.dump(payload, file)
            file.flush()
            os.fsync(file.fileno())
        os.replace(name, target)
    finally:
        try:
            os.unlink(name)
        except FileNotFoundError:
            pass
    return {"identity": file_identity(home)}


def main():
    try:
        signal.alarm(8)
        if len(sys.argv) != 3 or sys.argv[2] not in ("probe", "stop", "write-auth"):
            raise ValueError("invalid action")
        home = validate_home(Path(sys.argv[1]))
        action = sys.argv[2]
        if action == "probe":
            result = probe(home)
        elif action == "stop":
            result = stop(home)
        else:
            raw = sys.stdin.buffer.read(MAX_AUTH + 1)
            if len(raw) > MAX_AUTH:
                raise ValueError("auth too large")
            result = write_auth(home, json.loads(raw))
    except Exception:
        result = {"error": "无法完成 WSL Codex 操作，请确认目录权限并手动退出 Codex 后重试"}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
