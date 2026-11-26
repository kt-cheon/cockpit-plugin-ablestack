"""Only temporary sleeper processes are launched; no host/VM tools are called."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python/react_bridge'))
from processes import run
import tasks


class ProcessTests(unittest.TestCase):
    def test_tool_preserves_stdin_and_exit_status(self):
        result = run([sys.executable, '-c', 'import sys; print(sys.stdin.read()); sys.exit(7)'],
                     stdin=b'fixture', stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
        self.assertEqual((result.returncode, result.stdout), (7, b'fixture\n'))

    def test_timeout_kills_grandchildren_and_does_not_expose_command_arguments(self):
        with tempfile.TemporaryDirectory() as folder:
            marker = Path(folder) / 'must-not-exist'
            child = 'import time; from pathlib import Path; time.sleep(1); Path(' + repr(str(marker)) + ').touch()'
            parent = 'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",sys.argv[1]]); time.sleep(20)'
            with self.assertRaisesRegex(RuntimeError, '제한 시간') as caught:
                run([sys.executable, '-c', parent, child, 'private-password'],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=0.2)
            self.assertNotIn('private-password', str(caught.exception))
            time.sleep(1.2)
            self.assertFalse(marker.exists())

    def test_term_cancels_real_worker_and_releases_its_lock(self):
        with tempfile.TemporaryDirectory() as folder:
            task_id = 'a' * 32
            task_folder = Path(folder) / task_id
            task_folder.mkdir()
            tasks.save(task_folder / 'state.json', {'job_id': task_id, 'status': 'queued', 'steps': [],
                                                  'created_at': tasks.now()})
            tasks.save(task_folder / 'request.json', {'path': '/api/v1/cube/scvm/bootstrap'})
            marker = Path(folder) / 'started'
            script = '''
import sys,time
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, sys.argv[1])
import tasks,operations
from processes import run
tasks.DIRECTORY = Path(sys.argv[2])
def dispatch(*args):
    return run([sys.executable, '-c', 'from pathlib import Path; import time; Path(' + repr(sys.argv[4]) + ').touch(); time.sleep(30)'], timeout=60)
operations.dispatch = dispatch
tasks.worker(sys.argv[3], SimpleNamespace(success=lambda value: value))
'''
            with subprocess.Popen([sys.executable, '-c', script, str(ROOT / 'python/react_bridge'), folder, task_id, str(marker)],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE) as worker:
                try:
                    deadline = time.monotonic() + 5
                    while not marker.exists() and time.monotonic() < deadline:
                        time.sleep(0.02)
                    self.assertTrue(marker.exists())
                    tasks.save(task_folder / 'cancel.json', {'requested_at': tasks.now()})
                    os.kill(worker.pid, signal.SIGTERM)
                    output, errors = worker.communicate(timeout=5)
                    self.assertEqual(worker.returncode, 0, (output, errors))
                    state = __import__('json').loads((task_folder / 'state.json').read_text())
                    self.assertEqual(state['status'], 'cancelled')
                    self.assertFalse((task_folder / 'request.json').exists())
                    with (Path(folder) / 'operation.lock').open('a') as lock:
                        tasks.fcntl.flock(lock, tasks.fcntl.LOCK_EX | tasks.fcntl.LOCK_NB)
                finally:
                    if worker.poll() is None:
                        worker.kill()
                        worker.wait()

    def test_failed_local_helper_does_not_leave_its_grandchildren_running(self):
        with tempfile.TemporaryDirectory() as folder:
            marker = Path(folder) / 'failed-helper-must-not-finish'
            child = 'import time; from pathlib import Path; time.sleep(1); Path(' + repr(str(marker)) + ').touch()'
            parent = ('import subprocess,sys; subprocess.Popen([sys.executable,"-c",sys.argv[1]], '
                      'stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); sys.exit(9)')
            result = run([sys.executable, '-c', parent, child], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
            self.assertEqual(result.returncode, 9)
            time.sleep(1.2)
            self.assertFalse(marker.exists())


if __name__ == '__main__':
    unittest.main()
