"""Contract and task tests. Commands, VM operations and credentials are fixture-only."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import io
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
