#!/usr/bin/env python3
"""Restart an owned child on every exit; a service stop stops the loop."""
import argparse
import os
import signal
import subprocess
import threading
import time


def supervise(command, name, group=False, initial_delay=2.0, max_delay=30.0):
    stopped = threading.Event()
    child = None

    def forward(sig, _frame=None):
        stopped.set()
        if child is not None and child.poll() is None:
            try:
                if group:
                    os.killpg(child.pid, sig)
                else:
                    child.send_signal(sig)
            except ProcessLookupError:
                pass

    signal.signal(signal.SIGTERM, forward)
    signal.signal(signal.SIGINT, forward)
    delay = initial_delay
    while not stopped.is_set():
        started = time.monotonic()
        print(f"[keepalive] starting {name}", flush=True)
        child = subprocess.Popen(command, start_new_session=group)
        while child.poll() is None and not stopped.wait(0.2):
            pass
        if stopped.is_set() and child.poll() is None:
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                if group:
                    os.killpg(child.pid, signal.SIGKILL)
                else:
                    child.kill()
        status = child.wait()
        # The entrypoint can leave helpers behind after a normal child exit.
        if group:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            for _ in range(20):
                try:
                    os.killpg(child.pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.1)
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if stopped.is_set():
            break
        if time.monotonic() - started >= 60:
            delay = initial_delay
        print(f"[keepalive] {name} exited ({status}); restarting in {delay:g}s", flush=True)
        stopped.wait(delay)
        delay = min(max_delay, max(initial_delay, delay * 2))
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", required=True)
    parser.add_argument("--group", action="store_true")
    parser.add_argument("--initial-delay", type=float, default=2)
    parser.add_argument("--max-delay", type=float, default=30)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command or args.initial_delay <= 0 or args.max_delay < args.initial_delay:
        parser.error("a command and positive ordered delays are required")
    raise SystemExit(supervise(command, args.name, args.group, args.initial_delay, args.max_delay))
