import importlib.util
import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import time
import unittest

HERE = pathlib.Path(__file__).resolve().parent


class ReliabilityTests(unittest.TestCase):
    def test_restart_after_normal_and_failed_exit_and_stop_on_term(self):
        for exit_code in [0, 7]:
            with self.subTest(exit_code=exit_code), tempfile.TemporaryDirectory() as temporary:
                counter = pathlib.Path(temporary) / 'starts'
                child = 'import pathlib,sys,time;p=pathlib.Path(sys.argv[1]);p.write_text(p.read_text()+"x" if p.exists() else "x");time.sleep(.1);sys.exit(int(sys.argv[2]))'
                supervisor = subprocess.Popen([sys.executable, str(HERE / 'keepalive.py'), '--name', 'fixture', '--group',
                    '--initial-delay', '.1', '--max-delay', '.2', '--', sys.executable, '-c', child, str(counter), str(exit_code)],
                    stdout=subprocess.DEVNULL)
                try:
                    deadline = time.monotonic() + 5
                    while time.monotonic() < deadline:
                        if counter.exists() and len(counter.read_text()) >= 3:
                            break
                        time.sleep(.05)
                    self.assertGreaterEqual(len(counter.read_text()), 3)
                    supervisor.terminate()
                    self.assertEqual(supervisor.wait(timeout=12), 0)
                    count = len(counter.read_text())
                    time.sleep(.4)
                    self.assertEqual(len(counter.read_text()), count)
                finally:
                    if supervisor.poll() is None:
                        supervisor.kill()
                        supervisor.wait()

    def test_killed_child_is_restarted(self):
        with tempfile.TemporaryDirectory() as temporary:
            child_pid = pathlib.Path(temporary) / 'pid'
            child = 'import os,pathlib,sys,time;pathlib.Path(sys.argv[1]).write_text(str(os.getpid()));time.sleep(30)'
            supervisor = subprocess.Popen([sys.executable, str(HERE / 'keepalive.py'), '--name', 'fixture', '--group',
                '--initial-delay', '.1', '--max-delay', '.2', '--', sys.executable, '-c', child, str(child_pid)], stdout=subprocess.DEVNULL)
            try:
                deadline = time.monotonic() + 5
                while not child_pid.exists() and time.monotonic() < deadline:
                    time.sleep(.05)
                first = int(child_pid.read_text())
                os.kill(first, signal.SIGKILL)
                while int(child_pid.read_text()) == first and time.monotonic() < deadline:
                    time.sleep(.05)
                self.assertNotEqual(int(child_pid.read_text()), first)
            finally:
                supervisor.terminate()
                supervisor.wait(timeout=12)

    def test_boot_patch_is_idempotent_and_syncs_client_manifest(self):
        spec = importlib.util.spec_from_file_location('reliability_apply', HERE / 'apply.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            entry = root / 'usr/local/bin/entrypoint.sh'
            entry.parent.mkdir(parents=True)
            entry.write_text('  cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN" >/tmp/cloudflared.log 2>&1 &\nwait -n "$DSH_PID" "$CADDY_PID" "$STREAM_PID"\n')
            source = root / 'data/plugins/dsh-media'
            source.mkdir(parents=True)
            for name in ['index.js', 'client.js', 'cordis.patch.yml', 'README.md']:
                (source / name).write_text('fixture')
            (source / 'package.json').write_text(json.dumps({'version': '1.3.0', 'dsh': {'client': {'platform': 'web'}}}))
            module.apply(root, '/data/plugins/dsh-reliability-20261104')
            first = entry.read_text()
            module.apply(root, '/data/plugins/dsh-reliability-20261104')
            self.assertEqual(entry.read_text(), first)
            self.assertEqual(first.count('keepalive.py --name cloudflare'), 1)
            self.assertIn('"$DSH_PID" "$AUTH_PID"', first)
            self.assertTrue((root / 'opt/dsh-plugins/dsh-media/client.js').exists())


if __name__ == '__main__':
    unittest.main()
