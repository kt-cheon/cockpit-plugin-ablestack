"""Exercise the React adapter with fixture collectors; no VM or license files are modified."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('react_bridge', REPO / 'python/react_bridge/bridge.py')
bridge = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bridge
spec.loader.exec_module(bridge)


class ReactBridgeTests(unittest.TestCase):
    def request(self, path, body=None, method='GET'):
        return bridge.route({'path': path, 'method': method, 'body': body or {}})

    def test_vm_reads_use_existing_collector(self):
        with patch.object(bridge, 'tool', return_value={'code': 200, 'val': {'scvm_status': 'running'}}) as tool:
            response = self.request('/api/v1/cube/scvm/status')
        self.assertEqual(response['data']['scvm_status'], 'running')
        tool.assert_called_once_with('scvm_status/scvm_status_detail.py', ['detail'])

    def test_license_status_preserves_active_license_with_empty_oem(self):
        response = {'code': '200', 'val': {'status': 'active', 'oem': None, 'expired': '9999-12-31'}}
        with patch.object(bridge, 'tool', return_value=response) as tool:
            self.assertEqual(self.request('/api/v1/cube/license', {'action': 'status'}, 'POST'), response)
        tool.assert_called_once_with('license/register_license.py', ['--status'])

    def test_license_flags_use_validated_status_and_default_oem(self):
        with patch.object(bridge, 'license_status', return_value={'code': 200, 'val': {'status': 'active', 'oem': None}}), \
             patch.object(bridge, 'tool', return_value={'code': 200}) as tool:
            bridge.sync_license_flags()
        calls = [call.args[1] for call in tool.call_args_list]
        self.assertEqual(calls, [
            ['update', '--depth1', 'license', '--depth2', 'status', '--value', 'true'],
            ['update', '--depth1', 'license', '--depth2', 'type', '--value', 'ablestack'],
        ])

    def test_expired_license_cannot_be_activated_by_request_payload(self):
        with patch.object(bridge, 'license_status', return_value={'code': 200, 'val': {'status': 'inactive'}}), \
             patch.object(bridge, 'tool', return_value={'code': 200}) as tool:
            self.request('/api/v1/cube/system/config', {'action': 'update', 'depth1': 'license', 'depth2': 'status', 'value': 'true'}, 'POST')
        self.assertEqual(tool.call_args_list[0].args[1][-1], 'false')

    def test_license_query_error_does_not_change_saved_registration_flags(self):
        with patch.object(bridge, 'license_status', return_value={'code': 500, 'val': '라이선스 조회 실패'}), \
             patch.object(bridge, 'tool') as tool, self.assertRaisesRegex(RuntimeError, '라이선스 조회 실패'):
            bridge.sync_license_flags()
        tool.assert_not_called()

    def test_license_query_error_is_not_classified_as_missing_registration(self):
        with patch.object(bridge, 'cluster', return_value={}), patch.object(bridge, 'props', return_value={}), \
             patch.object(bridge, 'license_status', return_value={'code': 500, 'val': '라이선스 조회 실패'}), \
             self.assertRaisesRegex(RuntimeError, '라이선스 조회 실패'):
            bridge.deployment_status()

    def test_long_operations_are_detached_instead_of_running_in_the_request(self):
        with patch('tasks.start', return_value={'job_id': 'a' * 32}) as start, patch.object(bridge, 'tool') as tool:
            response = self.request('/api/v1/cube/scvm/lifecycle', {'action': 'delete'}, 'POST')
        self.assertEqual(response, {'code': 202, 'bridge_job': 'a' * 32})
        start.assert_called_once()
        tool.assert_not_called()

    def test_license_registration_rejects_path_traversal(self):
        with patch.object(bridge, 'tool') as tool, self.assertRaises(ValueError):
            self.request('/api/v1/cube/license', {'action': 'register', 'original_filename': '../../other', 'license_content': 'content'}, 'POST')
        tool.assert_not_called()

    def test_license_registration_reuses_current_validation_tool(self):
        with patch.object(bridge, 'tool', return_value={'code': 200}) as tool:
            self.request('/api/v1/cube/license', {'action': 'register', 'original_filename': 'license.dat', 'license_content': 'encoded'}, 'POST')
        tool.assert_called_once_with('license/register_license.py', ['--license-content', 'encoded', '--original-filename', 'license.dat'])

    def test_remote_collection_still_uses_cube_agent(self):
        client = Mock()
        client.execute.return_value = subprocess.CompletedProcess([], 0, b'[]', b'')
        module = types.ModuleType('client')
        module.Client = lambda: client
        with patch.dict(sys.modules, {'client': module}):
            self.assertEqual(bridge.command(['python3', 'collector.py'], target='cube2'), '[]')
        client.execute.assert_called_once_with('cube2', ['python3', 'collector.py'], timeout=120, stdin=None)

    def test_ccvm_is_collected_from_actual_running_host(self):
        infrastructure = {'code': 200, 'val': {'ccvm_running_node': 'cube2'}}
        with patch.object(bridge, 'cluster', return_value={'type': 'ablestack-hci'}), \
             patch.object(bridge, 'pcs_status', return_value=infrastructure), \
             patch.object(bridge, 'tool', return_value=[{'Name': 'ccvm', 'State': 'running'}]) as tool:
            self.assertEqual(bridge.cloud_vm_status()['data']['State'], 'running')
        tool.assert_called_once_with('host/virshlist.py', target='cube2')

    def test_removed_ccvm_never_keeps_a_cached_running_state(self):
        with patch.object(bridge, 'cluster', return_value={'type': 'ablestack-standalone'}), \
             patch.object(bridge, 'tool', return_value={'code': 200, 'data': []}):
            self.assertEqual(bridge.cloud_vm_status()['data']['State'], 'not deployed')

    def test_collector_failure_is_not_reported_as_a_deleted_vm(self):
        with patch.object(bridge, 'cluster', return_value={'type': 'ablestack-standalone'}), \
             patch.object(bridge, 'tool', return_value={'code': 500, 'message': 'libvirt connection failed'}), \
             self.assertRaisesRegex(RuntimeError, 'libvirt connection failed'):
            bridge.cloud_vm_status()

    def test_known_standalone_collector_missing_vm_response(self):
        with patch.object(bridge, 'cluster', return_value={'type': 'ablestack-standalone'}), \
             patch.object(bridge, 'tool', return_value={'code': 500, 'message': 'The CloudCenter VM has not been created.'}):
            self.assertEqual(bridge.cloud_vm_status()['data']['State'], 'not deployed')

    def test_libvirt_query_failure_is_not_reported_as_absent(self):
        with patch.object(bridge, 'command', side_effect=RuntimeError('libvirt unavailable')), \
             self.assertRaisesRegex(RuntimeError, 'libvirt unavailable'):
            bridge.vm_state('scvm')
        with patch.object(bridge, 'command', return_value='another-vm\n'):
            self.assertEqual(bridge.vm_state('scvm'), 'not deployed')

    def test_gfs_collectors_have_no_nonexistent_status_argument(self):
        with patch.object(bridge, 'tool', return_value={'code': 200}) as tool:
            self.request('/api/v1/cube/gfs/resource/status')
            self.request('/api/v1/cube/gfs/disk/status')
        self.assertEqual([call.args for call in tool.call_args_list], [('gfs/gfs_resource_status.py',), ('gfs/gfs_disk_status.py',)])

    def test_json_collector_output_can_include_progress_before_result(self):
        self.assertEqual(bridge.parse_output('stage complete\n{\n "code": 200, "val": {"state": "running"}\n}\n'),
                         {'code': 200, 'val': {'state': 'running'}})

    def test_dashboard_stage_uses_current_pcs_and_bootstrap_status(self):
        config = {'type': 'ablestack-hci', 'hosts': [{'hostname': 'cube1'}]}
        settings = {'bootstrap': {'scvm': 'true', 'ccvm': 'false'}}
        with patch.object(bridge, 'cluster', return_value=config), patch.object(bridge, 'props', return_value=settings), \
             patch.object(bridge, 'configuration_prepared', return_value=True), \
             patch.object(bridge, 'license_status', return_value={'code': '200', 'val': {'status': 'active'}}), \
             patch.object(bridge, 'vm_state', return_value='running'), \
             patch.object(bridge, 'pcs_status', return_value={'code': 200, 'val': {'ccvm_running_node': 'cube2'}}):
            response = bridge.deployment_status()['data']
        self.assertEqual(response['stage'], 'cloud_center_configure')
        self.assertEqual(response['raw']['ccvm_status'], 'running')
        self.assertIn('configure_cloud_vm', response['available_actions'])

    def test_status_queries_preserve_completed_configuration_even_when_preparation_check_fails(self):
        settings = {'bootstrap': {'scvm': 'true', 'ccvm': 'true', 'gfs_configure': 'true', 'local_configure': 'true'},
                    'monitoring': {'wall': 'true'}, 'license': {'status': 'true'}}
        for prepared in (True, False):
            with self.subTest(prepared=prepared), tempfile.TemporaryDirectory() as directory:
                properties = Path(directory)
                profile = {'clusterConfig': {'type': 'ablestack-hci', 'hosts': [{'hostname': 'production1'}]}}
                cluster_file, status_file = properties / 'cluster.json', properties / 'ablestack.json'
                cluster_file.write_text(json.dumps(profile))
                status_file.write_text(json.dumps(settings))
                before = (cluster_file.read_bytes(), status_file.read_bytes())
                with patch.object(bridge, 'PROPERTIES', properties), \
                     patch.object(bridge, 'configuration_prepared', return_value=prepared), \
                     patch.object(bridge, 'license_status', return_value={'code': 200, 'val': {'status': 'active'}}), \
                     patch.object(bridge, 'vm_state', return_value='running'), \
                     patch.object(bridge, 'pcs_status', return_value={'code': 200, 'val': {'health': 'ok', 'ccvm_running_node': 'production1'}}), \
                     patch.object(bridge, 'tool', return_value={'code': 200, 'val': {'cluster_status': 'HEALTH_OK'}}) as tool:
                    for _ in range(2):
                        response = bridge.deployment_status()['data']
                        for key in ('scvm_bootstrap_status', 'ccvm_bootstrap_status', 'wall_monitoring_status'):
                            self.assertEqual(response['raw'][key], 'true')
                        if prepared:
                            self.assertEqual(response['stage'], 'ready')
                self.assertEqual((cluster_file.read_bytes(), status_file.read_bytes()), before)
                self.assertTrue(all('update' not in call.args for call in tool.call_args_list))

    def test_unreachable_pcs_does_not_suggest_deploying_a_duplicate_ccvm(self):
        with patch.object(bridge, 'cluster', return_value={'type': 'ablestack-hci'}), \
             patch.object(bridge, 'props', return_value={'bootstrap': {'scvm': 'true', 'ccvm': 'false'}}), \
             patch.object(bridge, 'configuration_prepared', return_value=True), \
             patch.object(bridge, 'license_status', return_value={'code': 200, 'val': {'status': 'active'}}), \
             patch.object(bridge, 'vm_state', side_effect=['running', 'not deployed']), \
             patch.object(bridge, 'pcs_status', side_effect=RuntimeError('agent unavailable')):
            response = bridge.deployment_status()['data']
        self.assertEqual(response['stage'], 'status_unavailable')
        self.assertTrue(response['warnings'])
        self.assertNotIn('deploy_cloud_vm', response['available_actions'])


if __name__ == '__main__':
    unittest.main()
