"""Run the real jumbo probe with a stub ping, and verify bootstrap gates without any host/VM changes."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'python/bootstrap'))
import center_bootstrap as bootstrap
import jumbo_precheck as jumbo

HOSTS = '''127.0.0.1 localhost
# 192.0.2.99 pn-comment
192.0.2.11 cube1 ablecube
192.0.2.21 scvm1-mngt scvm-mngt
192.0.2.22 scvm2-mngt
198.51.100.1 pn-ablecube1 pn-ablecube
198.51.100.11 scvm1 scvm
198.51.100.12\tscvm2 # other SCVM
203.0.113.11 cn-scvm1 cn-scvm
203.0.113.12 cn-scvm2
203.0.113.12 cn-scvm2 # duplicate address
'''


class FakeClient:
    def __init__(self, environment, bootstrap_code=0):
        self.environment = environment
        self.bootstrap_code = bootstrap_code
        self.events = []

    def upload(self, target, source, destination):
        self.events.append(('upload', target, Path(source).name, destination))

    def execute(self, target, argv, **options):
        if '-c' in argv and argv[0] == 'python3':
            self.events.append(('probe', target, argv, options['timeout']))
            result = subprocess.run([sys.executable, *argv[1:]], input=options['stdin'],
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.environment, timeout=15)
        elif '/root/bootstrap.sh' in argv:
            self.events.append(('bootstrap', target, argv))
            result = subprocess.CompletedProcess(argv, self.bootstrap_code,
                b'private command output: password=must-not-reach-the-browser\n' +
                (jumbo.PREFIX + '데이터베이스 구성 단계\n').encode(), b'private diagnostic\n')
        else:
            self.events.append(('status', target, argv))
            result = subprocess.CompletedProcess(argv, 0, b'{"code":200}', b'')
        for channel in ('stdout', 'stderr'):
            sink = options.get(channel)
            if sink:
                data = getattr(result, channel)
                for index in range(0, len(data), 7):
                    sink.write(data[index:index + 7])
                    sink.flush()
        return result


class CenterBootstrapTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='center-bootstrap-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.hosts_file = self.root / 'hosts'
        self.hosts_file.write_text(HOSTS)
        self.plugin = self.root / 'plugin'
        (self.plugin / 'tools/properties').mkdir(parents=True)
        self.profile = {'clusterConfig': {'type': 'ablestack-hci', 'hosts': [{'hostname': 'cube1'}, {'hostname': 'cube2'}]}}
        self.save_profile()
        self.pings = self.root / 'pings.json'
        self.pings.write_text('[]')
        ping = self.root / 'ping'
        ping.write_text('#!' + sys.executable + '\n' + '''
import json, os, sys
from pathlib import Path
path = Path(os.environ['TEST_JUMBO_PINGS'])
calls = json.loads(path.read_text())
args = sys.argv[1:]
calls.append(args)
path.write_text(json.dumps(calls))
address = args[-1]
attempt = sum(call[-1] == address for call in calls)
sys.exit(1 if address == os.environ.get('TEST_JUMBO_FAIL_IP') and attempt == 2 else 0)
''')
        ping.chmod(0o755)
        self.environment = dict(os.environ, PATH=str(self.root) + ':' + os.environ.get('PATH', ''),
                                TEST_JUMBO_PINGS=str(self.pings))

    def save_profile(self):
        (self.plugin / 'tools/properties/cluster.json').write_text(json.dumps(self.profile))

    def configure(self, client, kind='scvm'):
        output, logfile = io.StringIO(), io.BytesIO()
        with contextlib.redirect_stdout(output):
            bootstrap.configure_center(kind, 'hv', client, self.plugin, logfile, self.hosts_file)
        return output.getvalue(), logfile.getvalue()

    def test_target_selection_ignores_comments_management_aliases_and_duplicate_ips(self):
        targets = jumbo.storage_targets(HOSTS + '''
192.0.2.31 ccvm ccvm-mngt
198.51.100.31 pn-ccvm
203.0.113.31 cn-scvm-cloud ccvm
198.51.100.32 pn-cloud
198.51.100.32 CCVM-STANDBY
''')
        self.assertEqual(list(targets), ['198.51.100.1', '198.51.100.11', '198.51.100.12', '203.0.113.11', '203.0.113.12'])
        self.assertEqual(targets['198.51.100.11'], ['scvm1', 'scvm'])
        self.assertEqual(targets['203.0.113.12'], ['cn-scvm2'])

    def test_every_address_receives_three_non_fragmenting_probes_from_only_the_local_scvm(self):
        self.hosts_file.write_text(HOSTS + '198.51.100.31 pn-ccvm\n')
        client = FakeClient(self.environment)
        output, logfile = self.configure(client)
        self.assertEqual([event[0] for event in client.events], ['probe', 'upload', 'bootstrap', 'status', 'status'])
        self.assertEqual(client.events[0][1], 'scvm')
        calls = json.loads(self.pings.read_text())
        self.assertEqual(len(calls), 15)
        for address in jumbo.storage_targets(HOSTS):
            self.assertEqual(sum(call[-1] == address for call in calls), 3)
        self.assertTrue(all(call[:-1] == ['-n', '-M', 'do', '-s', '8972', '-c', '1', '-W', '2'] for call in calls))
        self.assertIn('스토리지 네트워크 통신을 확인합니다.', output)
        self.assertIn('스토리지 네트워크 통신 검사가 정상적으로 완료되었습니다.', output)
        for address in jumbo.storage_targets(HOSTS):
            self.assertNotIn(address, output)
        self.assertNotIn('응답', output)
        self.assertIn('구성이 완료되었습니다', output)
        self.assertNotIn('password=', output)
        self.assertIn(b'password=must-not-reach-the-browser', logfile)

    def test_a_single_lost_reply_blocks_bootstrap_and_completion_flags(self):
        self.environment['TEST_JUMBO_FAIL_IP'] = '203.0.113.12'
        client = FakeClient(self.environment)
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaisesRegex(RuntimeError, '구성은 실행하지 않았습니다'):
            bootstrap.configure_center('scvm', 'hv', client, self.plugin, io.BytesIO(), self.hosts_file)
        self.assertEqual([event[0] for event in client.events], ['probe'])
        self.assertIn('cn-scvm2 (203.0.113.12)', output.getvalue())
        self.assertNotIn('응답', output.getvalue())
        self.assertNotIn('통신 검사가 정상적으로 완료되었습니다', output.getvalue())
        self.assertIn('1. 스토리지 네트워크', output.getvalue())
        self.assertIn('2. 일부 스토리지센터 가상머신이 아직 배포 중', output.getvalue())
        self.assertIn('3. 케이블 연결이나 스위치 포트 설정', output.getvalue())
        self.assertIn('잠시 후 스토리지센터 구성하기를 다시 실행', output.getvalue())
        self.assertIn('같은 증상이 계속 반복되면', output.getvalue())
        self.assertNotIn('구성이 완료되었습니다', output.getvalue())

    def test_empty_or_incomplete_hosts_never_skip_the_jumbo_gate(self):
        for content in ('', '192.0.2.21 scvm1-mngt', '198.51.100.11 scvm1'):
            with self.subTest(content=content):
                self.hosts_file.write_text(content)
                client = FakeClient(self.environment)
                with self.assertRaises(ValueError):
                    self.configure(client)
                self.assertEqual(client.events, [])

    def test_bootstrap_failure_does_not_mark_configuration_complete(self):
        client = FakeClient(self.environment, bootstrap_code=1)
        with self.assertRaisesRegex(RuntimeError, '구성 스크립트가 실패'):
            self.configure(client)
        self.assertEqual([event[0] for event in client.events], ['probe', 'upload', 'bootstrap'])

    def test_cloud_bootstrap_streams_progress_without_running_storage_pings(self):
        client = FakeClient(self.environment)
        output, _ = self.configure(client, 'ccvm')
        self.assertEqual(json.loads(self.pings.read_text()), [])
        self.assertEqual(client.events[0], ('upload', 'ccvm', 'ccvm_bootstrap.sh', '/root/bootstrap.sh'))
        self.assertEqual(client.events[1][2][-1], 'hv')
        self.assertIn('데이터베이스 구성 단계', output)
        self.assertEqual([event[1] for event in client.events if event[0] == 'status'], ['cube1', 'cube2'])

    def test_jumbo_probe_transport_failure_never_uploads_or_runs_the_bootstrap(self):
        class UnreachableClient(FakeClient):
            def execute(self, target, argv, **options):
                self.events.append(('probe', target))
                raise RuntimeError('SCVM agent unavailable')
        client = UnreachableClient(self.environment)
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaisesRegex(RuntimeError, 'SCVM agent unavailable'):
            bootstrap.configure_center('scvm', 'hv', client, self.plugin, io.BytesIO(), self.hosts_file)
        self.assertEqual(client.events, [('probe', 'scvm')])
        self.assertIn('아직 배포 중', output.getvalue())
        self.assertIn('잠시 후', output.getvalue())

    def test_an_existing_bootstrap_lock_reports_running_instead_of_marking_complete(self):
        client = FakeClient(self.environment, bootstrap_code=75)
        with self.assertRaisesRegex(RuntimeError, '이미 스토리지센터를 구성'):
            self.configure(client)
        self.assertFalse(any(event[0] == 'status' for event in client.events))

    def test_powerflex_keeps_its_own_bootstrap_script(self):
        self.profile['clusterConfig']['type'] = 'powerflex'
        self.save_profile()
        client = FakeClient(self.environment)
        self.configure(client)
        self.assertEqual(client.events[1][2], 'scvm_pf_bootstrap.sh')

    def test_progress_filter_handles_split_utf8_and_unterminated_lines_without_exposing_raw_output(self):
        logfile, output = io.BytesIO(), io.StringIO()
        stream = bootstrap.ProgressStream(logfile)
        data = ('private password\n' + jumbo.PREFIX + '점보 프레임 검사\n' + jumbo.PREFIX + '완료').encode()
        with contextlib.redirect_stdout(output):
            for byte in data:
                stream.write(bytes([byte]))
            stream.finish()
        self.assertEqual(logfile.getvalue(), data)
        self.assertEqual(output.getvalue(), jumbo.PREFIX + '점보 프레임 검사\n' + jumbo.PREFIX + '완료\n')

    def test_shell_scripts_stop_and_report_the_stage_on_an_error(self):
        for kind, marker in (('scvm', "progress 'Glue"), ('ccvm', 'os_type=')):
            with self.subTest(kind=kind):
                source = (REPO / 'shell/host' / (kind + '_bootstrap.sh')).read_text()
                header = source[:source.index(marker)]
                program = header + "\nprogress '검증 단계'\nfalse\nprogress '잘못된 완료 메시지'\n"
                result = subprocess.run(['bash', '-c', program], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('오류: 검증 단계', result.stdout)
                self.assertNotIn('잘못된 완료 메시지', result.stdout)

    def test_bootstrap_host_lists_ignore_hosts_comments_and_repeated_addresses(self):
        for kind in ('scvm', 'ccvm'):
            with self.subTest(kind=kind):
                source = (REPO / 'shell/host' / (kind + '_bootstrap.sh')).read_text()
                function = source[source.index('cluster_host_lines() {'):]
                function = function[:function.index('\n}') + 2]
                function = function.replace('/etc/hosts', str(self.hosts_file))
                assignments = '\n'.join(line for line in source.splitlines()
                                        if line.startswith(('hosts=$(', 'scvms=', 'allhosts=$(')))
                program = function + '\n' + assignments + '\nprintf "%s\\n" "$hosts"\n'
                if kind == 'scvm':
                    program += 'printf "%s\\n" "$allhosts"\n'
                result = subprocess.run(['bash', '-c', program], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn('#', result.stdout)
                self.assertNotIn('192.0.2.99', result.stdout)
                self.assertNotIn('203.0.113.', result.stdout)
                self.assertNotIn('192.0.2.21', result.stdout)
                if kind == 'scvm':
                    self.assertIn('198.51.100.12', result.stdout)
                else:
                    self.assertEqual(result.stdout.strip(), '192.0.2.11')


if __name__ == '__main__':
    unittest.main()
