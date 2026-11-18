"""
Kordexa Python CLI wrapper.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def get_node_bin() -> Path:
    root = Path(__file__).resolve().parent.parent.parent
    bin_js = root / "bin" / "kordexa.js"
    return bin_js


def run_command(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    bin_js = get_node_bin()
    if bin_js.exists():
        cmd = ["node", str(bin_js)] + argv
    else:
        cmd = ["npx", "kordexa"] + argv
    return subprocess.call(cmd)


def main() -> None:
    sys.exit(run_command())


if __name__ == "__main__":
    main()

