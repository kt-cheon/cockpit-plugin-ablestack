"""Contract and task tests. Commands, VM operations and credentials are fixture-only."""
import importlib.util
import json
import os
import signal
from pathlib import Path
import subprocess
import io
from contextlib import redirect_stdout
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python/react_bridge'))
import operations
import tasks
import workflows
import mold
import progress


def adapter():
    a = Mock()
    a.ROOT = ROOT
    a.cluster.return_value = {'type': 'ablestack-hci', 'hosts': [
        {'hostname': 'cube1', 'index': '1', 'ablecube': '10.0.0.1', 'scvmMngt': '10.0.0.11',
         'scvm': '100.100.0.11', 'scvmCn': '100.200.0.11'}], 'ccvm': {'ip': '10.0.0.10'}}
    a.tool.return_value = {'code': 200, 'val': 'done'}
    a.success.side_effect = lambda value: value
    return a


def request(path, body=None, method='POST'):
    return {'path': '/api/v1/cube/' + path, 'body': body or {}, 'method': method}


class OperationTests(unittest.TestCase):
    def test_gfs_stripe_settings_are_synchronous_and_do_not_run_cluster_commands(self):
        a = adapter()
        for action in ('get-gfs-settings', 'set-gfs-settings'):
            body = {'action': action, 'stripe_size_kib': 256}
            req = request('gfs/manage', body)
            self.assertFalse(operations.should_queue(req))
            operations.dispatch(a, req)
            args = a.tool.call_args.args[1]
            self.assertEqual(args, ['--get-gfs-settings'] if action.startswith('get') else
                             ['--set-gfs-settings', '--stripe-size-kib', '256'])

    def test_gfs_creation_forwards_selected_stripe_size_and_rejects_other_sizes(self):
        a = adapter()
        for size in (64, 128, 256, 512):
            operations.dispatch(a, request('gfs/manage', {'action': 'create-gfs',
                'disks': ['/dev/sdb', '/dev/sdc'], 'stripe_size_kib': size}))
            args = a.tool.call_args.args[1]
            self.assertEqual(args[args.index('--stripe-size-kib') + 1], str(size))
            self.assertEqual(args[args.index('--disks') + 1], '/dev/sdb,/dev/sdc')
        for value in (0, 129, True, 128.5, '128;echo bad'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                operations.dispatch(a, request('gfs/manage', {'action': 'create-gfs', 'stripe_size_kib': value}))

    def test_nic_and_disk_inventory_reuse_current_collectors(self):
        a = adapter()
        operations.dispatch(a, request('nics?action=detail', method='GET'))
        operations.dispatch(a, request('disk?action=list', method='GET'))
        operations.dispatch(a, request('disk?action=gfs', method='GET'))
        self.assertEqual([call.args for call in a.tool.call_args_list],
                         [('nic/network_action.py', ['list']), ('disk/disk_action.py', ['list']), ('disk/disk_action.py', ['gfs-list'])])

    def test_get_cannot_execute_a_vm_mutation(self):
        a = adapter()
        with self.assertRaises(ValueError):
            operations.dispatch(a, request('scvm/lifecycle', {'action': 'delete'}, 'GET'))
        a.tool.assert_not_called()

    def test_vm_resources_keep_the_existing_cli_contract(self):
        a = adapter()
        operations.dispatch(a, request('scvm/lifecycle', {'action': 'resource', 'cpu': 8, 'memory': 32}))
        self.assertEqual(a.tool.call_args.args[:2], ('scvm_status/scvm_status_update.py', ['resource', '--cpu', '8', '--memory', '32']))

    def test_migration_uses_target_option_instead_of_nonexistent_node_option(self):
        a = adapter()
        a.pcs_target.return_value = 'cube1'
        operations.dispatch(a, request('pcs/control', {'action': 'move', 'target': 'cube2'}))
        self.assertEqual(a.tool.call_args.args[1], ['move', '--resource', 'cloudcenter_res', '--target', 'cube2'])

    def test_fencing_payload_matches_current_semicolon_cli(self):
        a = adapter()
        operations.dispatch(a, request('gfs/manage', {'action': 'configure-stonith',
            'stonith': [{'ipaddr': '10.1.0.1', 'login': 'admin', 'passwd': 'fixture', 'ipport': '623'}]}))
        args = a.tool.call_args.args[1]
        self.assertEqual(args, ['--configure-stonith', '10.1.0.1,623,admin,fixture', '--list-ip', 'cube1'])

    def test_gfs_delete_translates_singular_vg_and_lv_fields(self):
        a = adapter()
        operations.dispatch(a, request('gfs/manage', {'action': 'delete-gfs', 'vg_name': 'vg_glue', 'lv_name': 'lv_glue', 'disks': ['/dev/sdb']}))
        args = a.tool.call_args.args[1]
        self.assertIn('--vg-names', args)
        self.assertIn('--lv-names', args)
        self.assertNotIn('--vg-name', args)

    def test_version_update_accepts_existing_mold_mode(self):
        a = adapter()
        operations.dispatch(a, request('version/update', {'action': 'info', 'mount_path': '/mnt/iso', 'update_type': 'mold'}))
        self.assertEqual(a.tool.call_args.args[1], ['info', '--mount-path', '/mnt/iso', '--update-type', 'mold'])

    def test_version_update_log_is_read_only_and_does_not_queue_a_job(self):
        a = adapter()
        req = request('version/update', {'action': 'log', 'update_type': 'all'})
        self.assertFalse(operations.should_queue(req))
        operations.dispatch(a, req)
        self.assertEqual(a.tool.call_args.args[1], ['log', '--mount-path', '/', '--update-type', 'all'])

    def test_version_update_accepts_tools_kernel_check_and_install(self):
        for action in ('info', 'run'):
            with self.subTest(action=action):
                a = adapter()
                operations.dispatch(a, request('version/update', {'action': action, 'mount_path': '/mnt/iso', 'update_type': 'tools'}))
                self.assertEqual(a.tool.call_args.args[1], [action, '--mount-path', '/mnt/iso', '--update-type', 'tools'])

    def test_backup_and_restore_call_the_existing_backup_implementation(self):
        a = adapter()
        operations.dispatch(a, request('backup/manage', {'action': 'restore', 'target_file': '/mnt/backup/file.qcow2'}))
        self.assertEqual(a.tool.call_args.args[:2], ('backup/ccvm_backup.py', ['restore', '--target-file', '/mnt/backup/file.qcow2']))

    def test_ipmi_check_uses_the_existing_delimited_cli(self):
        a = adapter()
        operations.dispatch(a, request('gfs/manage', {'action': 'check-ipmi',
            'stonith': [{'ipaddr': '10.1.0.1', 'login': 'admin', 'passwd': 'fixture'}]}))
        self.assertIn('10.1.0.1,623,admin,fixture', a.tool.call_args.args[1])

    def test_fencing_is_restored_when_security_update_fails(self):
        a = adapter()
        def run(name, args, **_):
            if name.startswith('security_patch/'):
                raise RuntimeError('패치 실패')
            return {'code': 200}
        a.tool.side_effect = run
        with self.assertRaisesRegex(RuntimeError, '패치 실패'):
            operations.dispatch(a, request('security/patch', {'new_port': 2222}))
        self.assertEqual(a.tool.call_args.args[:2], ('gfs/gfs_manage.py', ['--check-stonith', '--control', 'security-enable']))

    def test_get_cannot_replace_ssh_keys(self):
        a = adapter()
        with self.assertRaises(ValueError):
            operations.dispatch(a, request('ssh/key', {'action': 'generate'}, 'GET'))
        a.command.assert_not_called()

    def test_generating_ssh_keys_registers_the_public_key_and_repairs_existing_hosts(self):
        a = adapter()
        a.command.side_effect = lambda argv: subprocess.run(
            argv, check=True, capture_output=True, text=True, stdin=subprocess.DEVNULL).stdout
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / '.ssh'
            with patch.object(operations, 'SSH_KEY_DIR', root):
                operations.dispatch(a, request('ssh/key', {'action': 'generate'}))
                key = ' '.join((root / 'id_rsa.pub').read_text().split()[:2])
                authorized = root / 'authorized_keys'
                self.assertEqual(authorized.read_text(), key + '\n')

                private = (root / 'id_rsa').read_bytes()
                old_entry = 'ssh-ed25519 fixture-key existing administrator'
                authorized.write_text(old_entry)
                for _ in range(2):
                    operations.dispatch(a, request('ssh/key', {'action': 'generate'}))
                self.assertEqual((root / 'id_rsa').read_bytes(), private)
                self.assertEqual(authorized.read_text().splitlines(), [old_entry, key])
                self.assertEqual(authorized.stat().st_mode & 0o777, 0o600)

                restricted = 'from="192.0.2.1" ' + key + ' administrator policy\n'
                authorized.write_text(restricted)
                operations.dispatch(a, request('ssh/key', {'action': 'generate'}))
                self.assertEqual(authorized.read_text(), restricted)

    def test_importing_a_shared_ssh_bundle_only_authorizes_the_validated_key(self):
        try:
            import cryptography.hazmat.primitives.ciphers.aead  # noqa: F401
        except ImportError:
            self.skipTest('cryptography is required for the SSH bundle format')

        a = adapter()
        a.command.side_effect = lambda argv: subprocess.run(
            argv, check=True, capture_output=True, text=True, stdin=subprocess.DEVNULL).stdout
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / 'first'
            peer = Path(directory) / 'peer'
            with patch.object(operations, 'SSH_KEY_DIR', first):
                operations.dispatch(a, request('ssh/key', {'action': 'generate'}))
                bundle = operations.dispatch(a, request('ssh/key', {'action': 'download'}))
                public = first / 'id_rsa.pub'
                public.write_text(public.read_text() + 'ssh-ed25519 unexpected-key\n')
                invalid_bundle = operations.dispatch(a, request('ssh/key', {'action': 'download'}))

            with patch.object(operations, 'SSH_KEY_DIR', peer):
                for _ in range(2):
                    operations.dispatch(a, request('ssh/key', {'action': 'upload', 'content': bundle['content']}))
                self.assertEqual((peer / 'id_rsa').read_bytes(), (first / 'id_rsa').read_bytes())
                self.assertEqual((peer / 'authorized_keys').read_text(), (first / 'authorized_keys').read_text())
                with self.assertRaisesRegex(ValueError, 'SSH KEY 내용'):
                    operations.dispatch(a, request('ssh/key', {'action': 'upload', 'content': invalid_bundle['content']}))
                self.assertEqual((peer / 'authorized_keys').read_text(), (first / 'authorized_keys').read_text())

    def test_shared_storage_redeployment_preserves_gfs(self):
        a = adapter()
        a.cluster.return_value['type'] = 'ablestack-vm'
        a.command.return_value = ''
        workflows.ccvm_lifecycle(a, 'initialize')
        called = [call.args[0] for call in a.tool.call_args_list]
        self.assertNotIn('vm/reset_cloud_center.py', called)
        self.assertNotIn('gfs/gfs_manage.py', called)

    def test_existing_gfs_cluster_without_ccvm_resource_creates_the_right_resource(self):
        a = adapter()
        a.cluster.return_value['type'] = 'ablestack-vm'
        a.pcs_status.return_value = {'code': 200, 'val': {'resource_started': False}}
        a.command.return_value = '<crm_mon><resources><clone id="glue-gfs-clone"/></resources></crm_mon>'
        workflows.ccvm_lifecycle(a, 'start')
        args = a.tool.call_args.args[1]
        self.assertIn('--create-ccvm-cluster', args)
        self.assertEqual(args[args.index('--cluster-name') + 1], 'cloudcenter_res')

    def test_hci_filesystem_ccvm_uses_its_existing_disk_preparation_workflow(self):
        a = adapter()
        a.cluster.return_value['type'] = 'ablestack-hci-filesystem'
        workflows.ccvm_lifecycle(a, 'setup')
        self.assertEqual(a.tool.call_args.args[0], 'vm/setup_pcs_cluster.py')

    def test_internal_time_servers_never_point_to_the_current_host(self):
        result = workflows.chrony_settings('server old.pool iburst\nrtcsync\n', ['10.0.0.1', '10.0.0.2', '10.0.0.2'], ['10.0.0.1'], 'master')
        self.assertNotIn('server 10.0.0.1', result)
        self.assertEqual(result.count('server 10.0.0.2'), 1)
        self.assertIn('local stratum 10', result)
        self.assertIn('rtcsync', result)

    def test_shared_image_inventory_preserves_the_stable_device_path(self):
        a = adapter()
        a.tool.return_value = {'code': 200, 'val': {'blockdevices': [{'name': 'rbd0', 'path': '/dev/rbd0', 'rbd_path': '/dev/rbd/rbd/gfs01'}]}}
        reporter = Mock()
        reporter.step.side_effect = lambda _name, _message, function: function()
        with patch.object(workflows, 'storage_action', return_value={'code': 200}) as storage:
            workflows.deploy(a, {'only': ['storage_prepare'], 'gfs': {}}, reporter)
        initialize = storage.call_args_list[0].args[2]
        self.assertEqual(initialize['disks'], ['/dev/rbd/rbd/gfs01'])
        self.assertEqual(initialize['vg_name'], 'vg_glue')
        self.assertEqual(storage.call_args_list[-1].args[2]['action'], 'set-alert')

    def test_host_removal_stops_before_mutation_if_a_vm_is_running(self):
        a = adapter()
        a.command.return_value = 'scvm\n'
        reporter = Mock()
        reporter.step.side_effect = lambda _name, _message, function: function()
        with self.assertRaisesRegex(ValueError, '가상머신'):
            workflows.remove_host(a, 'cube1', reporter)
        a.tool.assert_not_called()

    def test_names_and_device_arguments_cannot_contain_shell_commands(self):
        for value in ('cube1; reboot', '$(id)', '/dev/sdb\nreboot', '--help', ''):
            with self.subTest(value=value), self.assertRaises(ValueError):
                operations.atom(value)

    def test_all_in_one_rejects_unknown_or_repeated_steps(self):
        a = adapter()
        for steps in (['unknown'], ['scvm_prepare', 'scvm_prepare'], []):
            with self.assertRaises(ValueError):
                workflows.deploy(a, {'only': steps}, Mock())
        a.tool.assert_not_called()

    def test_final_verification_does_not_mark_an_incomplete_cluster_as_completed(self):
        a = adapter()
        a.deployment_status.return_value = {'code': 200, 'data': {'stage': 'cloud_center_configure'}}
        reporter = Mock()
        reporter.step.side_effect = lambda _name, _message, function: function()
        with self.assertRaisesRegex(ValueError, '완료되지 않았습니다'):
            workflows.deploy(a, {'only': ['system_profile']}, reporter)

    def test_vm_disk_passthrough_still_uses_current_xml_generator(self):
        a = adapter()
        definition = {'cpu': 8, 'memory': 16, 'disk_type': 'disk_passthrough',
                      'disk_passthrough_list': ['/dev/disk/by-id/wwn-fixture'],
                      'management_network_bridge': 'bridge0', 'storage_traffic_network_type': 'bridge',
                      'server_network_bridge': 'storage0', 'replication_network_bridge': 'replica0'}
        with patch.object(workflows, 'cloudinit'):
            workflows.scvm_prepare(a, {'cube1': definition})
        args = a.tool.call_args_list[1].args
        self.assertEqual(args[0], 'vm/create_scvm_xml.py')
        self.assertIn('disk_passthrough', args[1])
        self.assertIn('--disk-passthrough-list', args[1])

    def test_bootstrap_reuses_jumbo_gate_and_korean_progress_script(self):
        a = adapter()
        a.tool.return_value = {'code': 200, 'val': {'status': 'active', 'oem': None}}
        with patch.object(workflows, 'wait_ready') as ready:
            workflows.bootstrap(a, 'scvm')
        ready.assert_called_once_with(a, 'scvm-mngt')
        self.assertEqual(a.command.call_args.args[0][-3:], [str(ROOT / 'python/bootstrap/center_bootstrap.py'), 'scvm', 'ablestack'])

    def test_cloud_init_terminal_errors_do_not_retry_for_twenty_minutes(self):
        for status in ('error', 'degraded', 'disabled', 'done'):
            a = adapter()
            a.tool.return_value = {'code': 500, 'val': ['status: ' + status]}
            with self.subTest(status=status), patch.object(workflows.time, 'sleep') as sleep:
                with self.assertRaisesRegex(ValueError, 'cloud-init-output.log'):
                    workflows.wait_ready(a, 'scvm-mngt')
                sleep.assert_not_called()
                self.assertEqual(a.tool.call_count, 1)

    def test_cloud_init_running_is_retried_until_done_and_transient_failure_has_a_deadline(self):
        a = adapter()
        a.tool.side_effect = [{'code': 200, 'val': ['status: running']}, {'code': 200, 'val': ['status: done']}]
        with patch.object(workflows.time, 'sleep'):
            self.assertEqual(workflows.wait_ready(a, 'scvm-mngt'), {'code': 200})
        a.tool.side_effect = OSError('connection unavailable')
        with patch.object(workflows.time, 'monotonic', side_effect=range(100)), patch.object(workflows.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, '초과'):
                workflows.wait_ready(a, 'scvm-mngt', timeout=10)


class ProgressTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.log = Path(self.temp.name) / 'execution.log'
        self.a = adapter()
        self.a.TASK_LOG = self.log

    def logs(self):
        return self.log.read_text() if self.log.exists() else ''

    def test_checked_operation_logs_progress_before_execution_without_private_arguments(self):
        secret = 'private-ipmi-password'
        def execute(*_args, **_options):
            self.assertIn('호스트 장애 격리 장치 구성 작업을 시작합니다.', self.logs())
            self.assertNotIn('작업이 완료되었습니다.', self.logs())
            return {'code': 200, 'val': 'private-command-output'}
        self.a.tool.side_effect = execute
        operations.dispatch(self.a, request('gfs/manage', {'action': 'configure-stonith',
            'stonith': [{'ipaddr': '10.1.0.1', 'login': 'admin', 'passwd': secret}]}))
        self.assertIn('호스트 장애 격리 장치 구성 작업이 완료되었습니다.', self.logs())
        for private in (secret, '10.1.0.1', 'private-command-output', '--configure-stonith'):
            self.assertNotIn(private, self.logs())
        self.assertEqual(self.log.stat().st_mode & 0o777, 0o600)

    def test_cluster_preparation_reports_actual_phases_and_keeps_registration_private(self):
        chrony = Path(self.temp.name) / 'chrony.conf'
        chrony.write_text('pool previous.example iburst\n')
        payload = {'cluster': {'type': 'ablestack-hci', 'hosts': self.a.cluster()['hosts']},
                   'enrollment': {'source': 'existing', 'registration': {'private_key': 'private-enrollment-key'}},
                   'time_servers': ['time.example'], 'time_role': 'master'}
        with patch.object(workflows, 'Path', return_value=chrony):
            self.assertEqual(workflows.cluster_apply(self.a, payload)['code'], 200)
        labels = ['클러스터 종류와 호스트 구성 정보를 확인합니다.', '호스트 통신 등록 및 연결 설정 적용 작업을 시작합니다.',
                  '클러스터 프로파일 및 호스트 정보 적용 작업을 시작합니다.',
                  '시간 동기화 설정 적용 및 서비스 재시작 작업을 시작합니다.', '클러스터 구성 준비가 완료되었습니다.']
        positions = [self.logs().index(label) for label in labels]
        self.assertEqual(positions, sorted(positions))
        self.assertGreaterEqual(len(self.logs().splitlines()), 9)
        self.assertIn('server time.example iburst', chrony.read_text())
        self.a.command.assert_called_with(['systemctl', 'restart', 'chronyd.service'])
        self.assertNotIn('private-enrollment-key', self.logs())

    def test_monitoring_reports_services_settings_and_optional_email_in_order(self):
        for email in (False, True):
            with self.subTest(email=email):
                self.log.unlink(missing_ok=True)
                a = adapter()
                a.TASK_LOG = self.log
                a.parse_output.return_value = {'code': 200}
                workflows.monitoring(a, {'smtp': {'enabled': email, 'host': 'smtp.example', 'port': 25,
                                                  'user': 'private-mail-user', 'password': 'private-mail-password'}})
                service_script = '/usr/share/ablestack/ablestack-wall/python/start_services.py'
                services = ['blackbox-exporter', 'node-exporter', 'grafana-server', 'process-exporter',
                            'prometheus', 'netdive-analyzer']
                for action in ('stop', 'start'):
                    a.command.assert_any_call(['python3', service_script, action, '--service', *services],
                                              target='ccvm-mngt', timeout=900)
                labels = ['기존 모니터링 서비스 중지', '모니터링 대상 및 지표 수집 설정 적용', '모니터링 서비스 시작',
                          *(['모니터링 알림 메일 설정 적용'] if email else []), '클러스터 호스트의 구성 상태 저장']
                positions = [self.logs().index(label + ' 작업을 시작합니다.') for label in labels]
                self.assertEqual(positions, sorted(positions))
                for label in labels:
                    self.assertIn(label + ' 작업이 완료되었습니다.', self.logs())
                if not email:
                    self.assertNotIn('메일 설정', self.logs())
                for private in ('private-mail-user', 'private-mail-password', 'smtp.example', '--password'):
                    self.assertNotIn(private, self.logs())

    def test_failed_monitoring_phase_is_not_reported_complete_and_later_steps_do_not_run(self):
        self.a.parse_output.side_effect = [{'code': 200}, RuntimeError('private-command-error')]
        with self.assertRaisesRegex(RuntimeError, 'private-command-error'):
            workflows.monitoring(self.a, {})
        self.assertIn('모니터링 대상 및 지표 수집 설정 적용 작업에 실패했습니다.', self.logs())
        self.assertNotIn('모니터링 대상 및 지표 수집 설정 적용 작업이 완료되었습니다.', self.logs())
        self.assertNotIn('모니터링 서비스 시작 작업', self.logs())
        self.assertNotIn('private-command-error', self.logs())
        self.a.tool.assert_not_called()

    def test_synchronous_operations_do_not_pollute_json_stdout_with_progress(self):
        self.a.TASK_LOG = None
        output = io.StringIO()
        with redirect_stdout(output):
            operations.checked(self.a, 'local/local_manage.py', ['--create-local-disk'])
        self.assertEqual(output.getvalue(), '')
        self.assertFalse(self.log.exists())


class TaskTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name) / 'tasks'
        self.patch = patch.object(tasks, 'DIRECTORY', self.directory)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def start(self, value=None):
        with patch.object(tasks.subprocess, 'Popen', return_value=Mock(pid=os.getpid())) as process:
            state = tasks.start(value or request('scvm/lifecycle', {'action': 'stop', 'secret': 'fixture'}))
        return state, process

    def test_payload_is_private_and_never_put_in_worker_arguments(self):
        state, process = self.start()
        folder = self.directory / state['job_id']
        self.assertEqual((folder / 'request.json').stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.directory.stat().st_mode & 0o777, 0o700)
        self.assertNotIn('fixture', ' '.join(process.call_args.args[0]))
        self.assertNotIn('secret', json.dumps(tasks.snapshot(state['job_id'])))

    def test_failed_command_is_persisted_and_private_input_is_removed(self):
        state, _ = self.start()
        a = adapter()
        with patch.object(operations, 'dispatch', side_effect=RuntimeError('배포 실패')):
            tasks.worker(state['job_id'], a)
        snapshot = tasks.snapshot(state['job_id'])
        self.assertEqual(snapshot['status'], 'failed')
        self.assertEqual(snapshot['steps'][0]['status'], 'failed')
        self.assertFalse((self.directory / state['job_id'] / 'request.json').exists())

    def test_progress_is_readable_while_running_and_completion_is_recorded(self):
        state, _ = self.start()
        a = adapter()
        def execute(*_args):
            progress.emit(a, '중간 설정을 적용합니다.')
            running = tasks.snapshot(state['job_id'])
            self.assertEqual(running['status'], 'running')
            self.assertIn('중간 설정을 적용합니다.', running['logs'])
            self.assertNotIn('요청한 작업이 모두 완료되었습니다.', running['logs'])
            return {'code': 200}
        with patch.object(operations, 'dispatch', side_effect=execute):
            tasks.worker(state['job_id'], a)
        completed = tasks.snapshot(state['job_id'])
        self.assertEqual(completed['status'], 'succeeded')
        self.assertEqual(completed['logs'][-1], '요청한 작업이 모두 완료되었습니다.')

    def test_task_ids_cannot_escape_the_private_directory(self):
        for value in ('../state', '/etc/passwd', 'x' * 32):
            with self.subTest(value=value), self.assertRaises(ValueError):
                tasks.snapshot(value)

    def test_only_explicit_progress_messages_are_displayed(self):
        state, _ = self.start()
        (self.directory / state['job_id'] / 'execution.log').write_text(
            'password=fixture\n[ABLESTACK-PROGRESS] 스토리지센터를 구성합니다.\nraw daemon message\n')
        self.assertEqual(tasks.snapshot(state['job_id'])['logs'], ['스토리지센터를 구성합니다.'])

    def test_interrupted_task_is_failed_and_its_private_input_is_removed(self):
        state, _ = self.start()
        with patch.object(tasks.os, 'kill', side_effect=ProcessLookupError):
            result = tasks.snapshot(state['job_id'])
        self.assertEqual(result['status'], 'failed')
        self.assertFalse((self.directory / state['job_id'] / 'request.json').exists())

    def test_worker_start_failure_does_not_leave_a_queued_task_or_private_input(self):
        with patch.object(tasks.subprocess, 'Popen', side_effect=OSError('spawn failed')), self.assertRaises(OSError):
            tasks.start(request('scvm/bootstrap'))
        folder = next(self.directory.iterdir())
        self.assertEqual(json.loads((folder / 'state.json').read_text())['status'], 'failed')
        self.assertFalse((folder / 'request.json').exists())

    def test_zombie_or_reused_pid_is_terminal_and_running_steps_are_failed(self):
        for info in ({'state': 'Z', 'start_time': 'old'}, {'state': 'S', 'start_time': 'different'}):
            with self.subTest(info=info):
                state, _ = self.start()
                folder = self.directory / state['job_id']
                tasks.save(folder / 'worker.json', {'pid': os.getpid(), 'boot_id': tasks.boot_id(), 'start_time': 'old'})
                tasks.save(folder / 'state.json', dict(state, steps=[{'name': 'execute', 'status': 'running'}]))
                with patch.object(tasks, 'process_info', return_value=info):
                    result = tasks.snapshot(state['job_id'])
                self.assertEqual(result['status'], 'failed')
                self.assertEqual(result['steps'][0]['status'], 'failed')

    def test_missing_worker_metadata_recovers_only_after_startup_grace_period(self):
        state, _ = self.start()
        folder = self.directory / state['job_id']
        (folder / 'worker.json').unlink()
        self.assertEqual(tasks.snapshot(state['job_id'])['status'], 'queued')
        tasks.save(folder / 'state.json', dict(state, created_at='2000-01-01T00:00:00+00:00'))
        self.assertEqual(tasks.snapshot(state['job_id'])['status'], 'failed')

    def test_cancel_verifies_process_and_does_not_unlock_an_active_worker(self):
        state, _ = self.start()
        folder = self.directory / state['job_id']
        tasks.save(folder / 'state.json', dict(state, status='running', worker_version=2))
        command = b'python3\0' + str(ROOT / 'python/react_bridge/bridge.py').encode() + b'\0--worker\0' + state['job_id'].encode() + b'\0'
        with patch.object(Path, 'read_bytes', return_value=command), patch.object(tasks.os, 'kill') as kill:
            result = tasks.cancel(state['job_id'])
        self.assertEqual(result['status'], 'cancelling')
        kill.assert_any_call(os.getpid(), signal.SIGTERM)
        self.assertTrue((folder / 'request.json').exists())
        with patch.object(tasks.os, 'kill', side_effect=ProcessLookupError):
            self.assertEqual(tasks.snapshot(state['job_id'])['status'], 'cancelled')
        self.assertFalse((folder / 'request.json').exists())

    def test_cancel_never_signals_an_unrelated_command_or_running_disk_initialization(self):
        state, _ = self.start()
        with patch.object(Path, 'read_bytes', return_value=b'python3\0unrelated.py\0'), patch.object(tasks.os, 'kill') as kill:
            with self.assertRaisesRegex(RuntimeError, '신원'):
                tasks.cancel(state['job_id'])
        self.assertTrue(all(call.args[1] == 0 for call in kill.call_args_list))
        disk, _ = self.start(request('disk/initialize'))
        with patch.object(tasks.os, 'kill') as kill, self.assertRaisesRegex(ValueError, '초기화'):
            tasks.cancel(disk['job_id'])
        self.assertTrue(all(call.args[1] == 0 for call in kill.call_args_list))

    def test_cancellation_is_terminal_and_operation_lock_is_reusable(self):
        state, _ = self.start()
        folder = self.directory / state['job_id']
        def cancel_during_execution(*_args):
            tasks.save(folder / 'cancel.json', {'requested_at': tasks.now()})
            raise tasks.TaskCancelled()
        with patch.object(operations, 'dispatch', side_effect=cancel_during_execution):
            tasks.worker(state['job_id'], adapter())
        result = tasks.snapshot(state['job_id'])
        self.assertEqual(result['status'], 'cancelled')
        self.assertEqual(result['steps'][0]['status'], 'cancelled')
        self.assertFalse((folder / 'request.json').exists())
        next_state, _ = self.start()
        with patch.object(operations, 'dispatch', return_value={'code': 200}):
            tasks.worker(next_state['job_id'], adapter())
        self.assertEqual(tasks.snapshot(next_state['job_id'])['status'], 'succeeded')

    def test_cancel_endpoint_requires_post_and_runs_outside_mutation_queue(self):
        state = {'status': 'cancelling'}
        req = request('_tasks/' + 'a' * 32 + '/cancel')
        self.assertFalse(operations.should_queue(req))
        with patch.object(tasks, 'cancel', return_value=state) as cancel:
            self.assertEqual(operations.dispatch(adapter(), req)['job'], state)
            cancel.assert_called_once_with('a' * 32)
            req['method'] = 'GET'
            with self.assertRaises(ValueError):
                operations.dispatch(adapter(), req)

    def test_failure_response_marks_the_step_failed_before_releasing_lock(self):
        state, _ = self.start()
        a = adapter()
        a.success.side_effect = RuntimeError('설정 실패')
        with patch.object(operations, 'dispatch', return_value={'code': 500}):
            tasks.worker(state['job_id'], a)
        result = tasks.snapshot(state['job_id'])
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['steps'][0]['status'], 'failed')


class MoldTests(unittest.TestCase):
    def test_plan_validation_never_executes_any_remote_command(self):
        a = adapter()
        value = mold.handle(a, {'path': '/api/v1/mold/bootstrap/plan', 'method': 'POST', 'body': {}})
        self.assertFalse(value['val']['ready'])
        self.assertIn('auth.password', value['val']['missing_inputs'])
        a.command.assert_not_called()

    def test_existing_resource_is_reused_without_creating_a_duplicate(self):
        client = mold.NativeClient.__new__(mold.NativeClient)
        client.call = Mock(return_value={'zone': [{'name': 'Zone', 'id': 'zone-1'}]})
        self.assertEqual(client.resource('listZones', 'zone', 'Zone', 'createZone', {}), {'name': 'Zone', 'id': 'zone-1'})
        client.call.assert_called_once_with('listZones')

    def test_failed_async_mold_job_is_reported_as_failure(self):
        client = mold.NativeClient.__new__(mold.NativeClient)
        client.session = 'fixture'
        responses = [io.BytesIO(b'{"createzoneresponse":{"jobid":"job-1"}}'),
                     io.BytesIO(b'{"queryasyncjobresultresponse":{"jobstatus":2,"jobresult":{"errortext":"zone failed"}}}')]
        client.opener = Mock()
        client.opener.open.side_effect = responses
        with self.assertRaisesRegex(RuntimeError, 'zone failed'):
            client.call('createZone', name='Zone')
        for call in client.opener.open.call_args_list:
            self.assertEqual(call.args[0], 'http://127.0.0.1:8080/client/api')


if __name__ == '__main__':
    unittest.main()
