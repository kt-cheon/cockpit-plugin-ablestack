"""Temporary files and sleeper/fixture processes only; no real images, RBD or PCS commands."""
import ast
from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python/common'))
import deployment_progress as transfer


class TransferTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.log = io.StringIO()
        redirected = redirect_stderr(self.log)
        redirected.__enter__()
        self.addCleanup(redirected.__exit__, None, None, None)

    def test_cr_delimited_progress_is_streamed_and_100_requires_success(self):
        reporter = transfer.TransferProgress('이미지 변환')
        script = ('import sys,time; sys.stderr.write("(0.00/100%)\\r(42."); sys.stderr.flush(); time.sleep(.05); '
                  'sys.stderr.write("00/100%)\\r(100.00/100%)\\r"); sys.stderr.flush()')
        transfer.stream_transfer([sys.executable, '-c', script], reporter)
        self.assertIn('42%', self.log.getvalue())
        self.assertIn('99%', self.log.getvalue())
        self.assertNotIn('100%', self.log.getvalue())
        reporter.report(force=True, complete=True)
        self.assertIn('100%', self.log.getvalue())

    def test_failed_command_never_reports_completion_even_after_a_100_output(self):
        reporter = transfer.TransferProgress('이미지 변환')
        with self.assertRaisesRegex(RuntimeError, 'permission denied'):
            transfer.stream_transfer([sys.executable, '-c',
                'import sys; print("(100.00/100%)\\rpermission denied",file=sys.stderr); sys.exit(1)'], reporter)
        self.assertNotIn('100%', self.log.getvalue())

    def test_elapsed_eta_and_heartbeat_keep_real_percent_unchanged(self):
        reporter = transfer.TransferProgress('이미지 변환')
        reporter.started = time.monotonic() - 20
        reporter.consume('(50.00/100%)')
        self.assertIn('예상 남은 시간 약', self.log.getvalue())
        reporter.last_report = time.monotonic() - 11
        reporter.heartbeat()
        self.assertEqual(reporter.percent, 50)
        self.assertGreaterEqual(self.log.getvalue().count('50%'), 2)

    def test_conversion_uses_qemu_progress_and_keeps_stdout_json_clean(self):
        output = io.StringIO()
        with patch.object(transfer, 'stream_transfer') as execute, redirect_stdout(output):
            transfer.convert_to_rbd('/fixture/source.qcow2', 'rbd:rbd/ccvm')
        self.assertEqual(execute.call_args.args[0],
            ['qemu-img', 'convert', '-p', '-f', 'qcow2', '-O', 'rbd', '/fixture/source.qcow2', 'rbd:rbd/ccvm'])
        self.assertEqual(output.getvalue(), '')
        self.assertIn('100%', self.log.getvalue())

    def fake_dd(self):
        # A local fixture executable performs real file IO, never invoking platform dd.
        executable = self.root / 'dd'
        executable.write_text('#!' + sys.executable + '\n' + '''
import os,sys
args=dict(arg.split('=',1) for arg in sys.argv[1:])
assert args['conv']=='sparse,fsync' and args['status']=='progress'
data=open(args['if'],'rb').read()
with open(args['of'],'wb') as output:
    half=len(data)//2
    output.write(data[:half]); output.flush()
    print(str(half)+' bytes copied',end='\\r',file=sys.stderr,flush=True)
    if os.environ.get('FIXTURE_COPY_FAIL'):
        print('fixture disk full',file=sys.stderr); sys.exit(1)
    if not os.environ.get('FIXTURE_COPY_TRUNCATE'): output.write(data[half:])
    output.flush(); os.fsync(output.fileno())
print(str(len(data))+' bytes copied',file=sys.stderr,flush=True)
''')
        executable.chmod(0o700)
        patched = patch.dict(os.environ, {'PATH': str(self.root) + os.pathsep + os.environ.get('PATH', '')})
        patched.start()
        self.addCleanup(patched.stop)

    def test_file_copy_preserves_content_and_mode_and_reports_actual_bytes(self):
        self.fake_dd()
        source, target = self.root / 'source.qcow2', self.root / 'ccvm.qcow2'
        source.write_bytes(b'header' + b'\0' * 4096 + b'guest-data')
        source.chmod(0o640)
        transfer.copy_image(source, target, 'CCVM 이미지 GFS2 복사')
        self.assertEqual(target.read_bytes(), source.read_bytes())
        self.assertEqual(target.stat().st_mode & 0o777, 0o640)
        self.assertIn('50%', self.log.getvalue())
        self.assertIn('100%', self.log.getvalue())
        self.assertEqual(list(self.root.glob('.ccvm.qcow2.copy-*')), [])

    def test_failed_or_short_copy_keeps_old_image_and_cleans_partial_data(self):
        self.fake_dd()
        source, target = self.root / 'source.qcow2', self.root / 'ccvm.qcow2'
        source.write_bytes(b'new-image-data' * 1024)
        target.write_bytes(b'existing-complete-image')
        for flag in ('FIXTURE_COPY_FAIL', 'FIXTURE_COPY_TRUNCATE'):
            self.log.seek(0); self.log.truncate()
            with self.subTest(flag=flag), patch.dict(os.environ, {flag: '1'}), self.assertRaises(RuntimeError):
                transfer.copy_image(source, target)
            self.assertEqual(target.read_bytes(), b'existing-complete-image')
            self.assertNotIn('100%', self.log.getvalue())
            self.assertEqual(list(self.root.glob('.ccvm.qcow2.copy-*')), [])

    def test_timeout_terminates_the_transfer_process(self):
        reporter = transfer.TransferProgress('이미지 변환')
        with self.assertRaisesRegex(RuntimeError, '제한 시간'):
            transfer.stream_transfer([sys.executable, '-c', 'import time; time.sleep(30)'], reporter, timeout=.1)
        self.assertNotIn('100%', self.log.getvalue())


class GfsImageTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse((ROOT / 'python/gfs/gfs_manage.py').read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'create_ccvm_cluster')
        self.copy = Mock()
        self.step = Mock()
        self.mounted = Mock(return_value=subprocess.CompletedProcess([], 0, 'gfs2\n', ''))
        self.existing = Mock(return_value=False)
        self.namespace = {'copy_image': self.copy, 'run_step': self.step, 'progress': Mock(),
            'subprocess': SimpleNamespace(run=self.mounted, PIPE=subprocess.PIPE),
            'os': SimpleNamespace(path=SimpleNamespace(isfile=self.existing)), 'time': Mock(),
            'pluginpath': '/fixture/plugin', 'json': json, 'createReturn': lambda **value: json.dumps(value)}
        exec(compile(ast.Module(body=[function], type_ignores=[]), 'gfs_manage.py', 'exec'), self.namespace)

    def run_gfs(self):
        output = io.StringIO()
        with redirect_stdout(output):
            self.namespace['create_ccvm_cluster']('glue-gfs', '/mnt/glue-gfs', 'cloudcenter_res', [])
        return json.loads(output.getvalue())

    def test_gfs_copy_finishes_before_resize_and_resource_creation(self):
        self.assertEqual(self.run_gfs()['code'], 200)
        self.copy.assert_called_once_with('/var/lib/libvirt/images/ablestack-template.qcow2',
                                         '/mnt/glue-gfs/ccvm.qcow2', 'CCVM 이미지 GFS2 복사')
        self.assertEqual([call.args[1][0] for call in self.step.call_args_list], ['cp', 'qemu-img', 'pcs', 'pcs'])

    def test_copy_failure_cannot_resize_or_create_a_vm_resource(self):
        self.copy.side_effect = RuntimeError('fixture disk full')
        result = self.run_gfs()
        self.assertEqual(result['code'], 500)
        self.assertIn('disk full', result['val'])
        self.assertEqual([call.args[1][0] for call in self.step.call_args_list], ['cp'])

    def test_unmounted_destination_never_copies_into_the_host_root_filesystem(self):
        self.mounted.return_value = subprocess.CompletedProcess([], 0, 'xfs\n', '')
        self.assertEqual(self.run_gfs()['code'], 500)
        self.copy.assert_not_called()
        self.step.assert_not_called()

    def test_existing_image_is_reused_without_reporting_a_fake_copy(self):
        self.existing.return_value = True
        self.assertEqual(self.run_gfs()['code'], 200)
        self.copy.assert_not_called()
        self.assertFalse(any(call.args[1][0] == 'qemu-img' for call in self.step.call_args_list))


if __name__ == '__main__':
    unittest.main()
