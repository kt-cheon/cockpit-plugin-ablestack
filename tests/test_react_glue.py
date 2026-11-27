"""Existing Glue service contracts, tested with local response fixtures only."""
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python/react_bridge'))
import glue_catalog
import glue_service
import operations


def adapter():
    value = Mock()
    value.PROPERTIES = Path('/fixture')
    value.read_json.return_value = {'apiPort': '8080'}
    return value


class GlueContractTests(unittest.TestCase):
    def call(self, service, action, values):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'[]' if glue_catalog.operation(service, action)['method'] == 'GET' else b'"Success"'
        with patch.object(glue_service, 'urlopen', return_value=response) as opened:
            result = glue_service.execute(adapter(), {'service': service, 'action': action, 'values': values})
        return result, opened.call_args.args[0]

    def test_every_catalog_action_has_unique_fields_and_a_supported_method(self):
        for group in glue_catalog.catalog():
            ids = [action['id'] for action in group['actions']]
            self.assertEqual(len(ids), len(set(ids)), group['id'])
            for entry in group['actions']:
                self.assertIn(entry['method'], ('GET', 'POST', 'PUT', 'PATCH', 'DELETE'))
                self.assertTrue(entry['path'].startswith('/api/v1/'))
                fields = [field['name'] for field in entry['fields']]
                self.assertEqual(len(fields), len(set(fields)))

    def test_scvm_lists_use_existing_glue_service_on_loopback_only(self):
        result, request = self.call('gluefs', 'list', {})
        self.assertEqual(result, {'code': 200, 'val': []})
        self.assertEqual(request.full_url, 'https://127.0.0.1:8080/api/v1/gluefs')
        self.assertEqual(request.method, 'GET')

    def test_repeated_host_names_and_credentials_are_form_encoded(self):
        _, request = self.call('iscsi', 'create', {'service_id': 'storage', 'pool': 'rbd', 'api_port': '5000',
                              'api_user': 'admin', 'api_password': 'fixture & secret', 'hosts': 'scvm1\nscvm2'})
        values = parse_qs(request.data.decode())
        self.assertEqual(values['hosts'], ['scvm1', 'scvm2'])
        self.assertEqual(values['api_password'], ['fixture & secret'])
        self.assertNotIn('fixture', request.full_url)

    def test_delete_targets_keep_legacy_query_and_body_arguments(self):
        _, request = self.call('nvmeof', 'target-delete', {'subsystem_nqn_id': 'nqn.fixture'})
        self.assertEqual(parse_qs(urlsplit(request.full_url).query)['subsystem_nqn_id'], ['nqn.fixture'])
        self.assertEqual(parse_qs(request.data.decode())['nqn_id'], ['nqn.fixture'])
        self.assertEqual(request.method, 'DELETE')

    def test_gateway_lifecycle_preserves_native_patch_endpoint(self):
        _, request = self.call('gateway', 'stop', {})
        self.assertEqual(request.method, 'PATCH')
        self.assertTrue(request.full_url.endswith('/api/v1/gwvm/stop/cell'))

    def test_gateway_creation_preserves_cell_parameter(self):
        values = {name: 'fixture' for name in ('gwvmMngtNicParent', 'gwvmMngtNicIp', 'gwvmStorageNicParent', 'gwvmStorageNicIp')}
        values.update(gwvmCpu='4', gwvmMemory='8')
        _, request = self.call('gateway', 'deploy', values)
        self.assertEqual(parse_qs(request.data.decode())['hypervisorType'], ['cell'])

    def test_arbitrary_urls_operations_and_unknown_fields_are_rejected(self):
        for body in [
            {'service': 'https://example.test', 'action': 'list'},
            {'service': 'nfs', 'action': 'execute'},
            {'service': 'nfs', 'action': 'list', 'values': {'url': 'https://example.test'}},
            {'service': 'gluefs', 'action': 'delete', 'values': {'name': '../nfs'}},
        ]:
            with self.subTest(body=body), patch.object(glue_service, 'urlopen') as opened, self.assertRaises(ValueError):
                glue_service.execute(adapter(), body)
            opened.assert_not_called()

    def test_read_requests_do_not_create_background_mutation_jobs(self):
        read = {'path': '/api/v1/cube/glue/service', 'method': 'POST', 'body': {'service': 'gluefs', 'action': 'list'}}
        self.assertFalse(operations.should_queue(read))
        read['body']['action'] = 'delete'
        self.assertTrue(operations.should_queue(read))

    def test_current_smb_and_quota_values_match_the_legacy_forms(self):
        fields = {field['name']: field for field in glue_catalog.operation('smb', 'create')['fields']}
        self.assertEqual(fields['sec_type']['default'], 'normal')
        self.assertEqual(fields['cache_policy']['default'], 'true')
        self.assertEqual(glue_catalog.operation('rgw-users', 'quota')['fields'][-1]['default'], 'enable')

    def test_native_error_string_is_never_reported_as_a_successful_mutation(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'"Error"'
        with patch.object(glue_service, 'urlopen', return_value=response), self.assertRaisesRegex(RuntimeError, '성공을 확인하지 못했습니다'):
            glue_service.execute(adapter(), {'service': 'gluefs', 'action': 'delete', 'values': {'name': 'fixture'}})


if __name__ == '__main__':
    unittest.main()
