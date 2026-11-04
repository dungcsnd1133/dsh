#!/usr/bin/env python3
"""Apply persistent media and tunnel supervision before the existing launcher."""
import argparse
import json
import pathlib
import shutil


def apply(root, launcher):
    entrypoint = root / "usr/local/bin/entrypoint.sh"
    source = root / "data/plugins/dsh-media"
    package = json.loads((source / "package.json").read_text())
    if not package.get("dsh", {}).get("client"):
        raise RuntimeError("media package must include its browser client")
    text = entrypoint.read_text()
    original = '  cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN"'
    wrapped = f'  python3 {launcher}/keepalive.py --name cloudflare -- cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN"'
    if original in text:
        if text.count(original) != 1:
            raise RuntimeError("unexpected tunnel launch count")
        text = text.replace(original, wrapped)
    elif wrapped not in text:
        raise RuntimeError("entrypoint tunnel command changed; refusing an unsafe patch")
    old_wait = 'wait -n "$DSH_PID" "$CADDY_PID" "$STREAM_PID"'
    new_wait = 'wait -n "$DSH_PID" "$AUTH_PID" "$CADDY_PID" "$STREAM_PID"'
    if old_wait in text:
        text = text.replace(old_wait, new_wait)
    elif new_wait not in text:
        raise RuntimeError("entrypoint supervision changed")
    for target in [root / "opt/dsh-plugins/dsh-media", root / "data/.dsh/vendor/dsh-media"]:
        target.mkdir(parents=True, exist_ok=True)
        for name in ["index.js", "client.js", "package.json", "cordis.patch.yml", "README.md"]:
            shutil.copy2(source / name, target / name)
    if text != entrypoint.read_text():
        backup = entrypoint.with_name("entrypoint.pre-reliability.sh")
        if not backup.exists():
            shutil.copy2(entrypoint, backup)
        temporary = entrypoint.with_suffix(".reliability.tmp")
        temporary.write_text(text)
        temporary.chmod(entrypoint.stat().st_mode)
        temporary.replace(entrypoint)
    print(f"[reliability] media {package['version']} and tunnel supervision ready", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default="/")
    parser.add_argument("--launcher", default="/data/plugins/dsh-reliability-20261104")
    args = parser.parse_args()
    apply(pathlib.Path(args.root), args.launcher)
