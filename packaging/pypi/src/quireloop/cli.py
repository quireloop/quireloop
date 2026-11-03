"""The `quireloop` command: starts the bundled server with the bundled Node.js."""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

from quireloop import __version__

APP_DIR = Path(__file__).resolve().parent / "app"
START_JS = APP_DIR / "server" / "src" / "start.js"


def default_data_dir() -> Path:
    """Where papers and accounts live unless QUIRELOOP_DATA_DIR says otherwise.

    Never inside the installed package: upgrading or uninstalling would delete it.
    """
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "Quireloop"
    xdg = os.environ.get("XDG_DATA_HOME")
    return (Path(xdg) if xdg else home / ".local" / "share") / "quireloop"


def node_path() -> Path:
    import nodejs_wheel

    root = Path(nodejs_wheel.__file__).resolve().parent
    return root / "node.exe" if os.name == "nt" else root / "bin" / "node"


def start(args: argparse.Namespace) -> int:
    if not START_JS.is_file():
        print("This copy of Quireloop is incomplete: the server is missing. Reinstall it.", file=sys.stderr)
        return 1
    data_dir = Path(args.data_dir or os.environ.get("QUIRELOOP_DATA_DIR") or default_data_dir()).expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)

    env = dict(os.environ)
    env["QUIRELOOP_DATA_DIR"] = str(data_dir)
    env["PORT"] = str(args.port)
    env["QUIRELOOP_HOST"] = args.host
    env.setdefault("NODE_ENV", "production")

    if shutil.which("latexmk", path=env.get("PATH")) is None:
        print("Warning: latexmk was not found, so papers will not compile. Run `quireloop doctor`.", file=sys.stderr)
    shown = "localhost" if args.host in ("127.0.0.1", "::1") else args.host
    print(f"Quireloop {__version__}: open http://{shown}:{args.port}")
    print(f"Papers and accounts are kept in {data_dir}")
    if args.host == "0.0.0.0":
        print("Other computers on the network can reach this server. Use HTTPS beyond a trusted network.")

    node = str(node_path())
    argv = [node, str(START_JS)]
    os.chdir(START_JS.parent.parent)
    if os.name == "nt":
        import subprocess

        return subprocess.call(argv, env=env)
    # Replace this process, so Ctrl+C and service managers talk to the server
    # directly. Flush first: whatever is still buffered would be lost.
    sys.stdout.flush()
    sys.stderr.flush()
    os.execve(node, argv, env)
    return 0  # not reached


def doctor(args: argparse.Namespace) -> int:
    ok = True

    def check(label: str, found: bool, advice: str) -> None:
        nonlocal ok
        print(f"  {'ok ' if found else 'NO '} {label}" + ("" if found else f"\n      {advice}"))
        ok = ok and found

    print(f"Quireloop {__version__}")
    check("server files", START_JS.is_file(), "Reinstall: pip install --force-reinstall quireloop")
    try:
        check(f"Node.js ({node_path()})", node_path().is_file(), "Reinstall nodejs-wheel-binaries.")
    except ImportError:
        check("Node.js", False, "pip install nodejs-wheel-binaries")
    for tool, advice in [
        ("latexmk", "Install LaTeX: see docs/install-personal.md (TeX Live or MacTeX)."),
        ("git", "Install git; version history needs it."),
    ]:
        check(tool, shutil.which(tool) is not None, advice)
    if sys.platform.startswith("linux"):
        found = shutil.which("bwrap") is not None
        print(f"  {'ok ' if found else '-- '} bubblewrap (optional: keeps each compile in a sandbox)")
    print(f"  data folder: {os.environ.get('QUIRELOOP_DATA_DIR') or default_data_dir()}")
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="quireloop", description="A self-hosted, collaborative LaTeX editor.")
    parser.add_argument("--version", action="version", version=f"quireloop {__version__}")
    sub = parser.add_subparsers(dest="command")

    p = sub.add_parser("start", help="start the server")
    p.add_argument("--port", type=int, default=int(os.environ.get("PORT", 4173)), help="port to listen on (default 4173)")
    p.add_argument(
        "--host",
        default=os.environ.get("QUIRELOOP_HOST", "127.0.0.1"),
        help="address to listen on: 127.0.0.1 (default) is this computer only, 0.0.0.0 lets others connect",
    )
    p.add_argument("--data-dir", help="where papers and accounts are kept")
    p.set_defaults(func=start)

    d = sub.add_parser("doctor", help="check that everything Quireloop needs is installed")
    d.set_defaults(func=doctor)

    args = parser.parse_args(argv)
    if os.name == "nt":
        print("Quireloop runs on Linux and macOS. On Windows, install it inside WSL.", file=sys.stderr)
        return 1
    if not getattr(args, "func", None):
        parser.print_help()
        return 0
    return args.func(args)
