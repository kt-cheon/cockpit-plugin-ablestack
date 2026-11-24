"""Exercise RPM pre/payload/post behavior without touching installed settings."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
HELPER = REPO / 'tools/makerpm/properties_config.py'
SPEC = importlib.util.spec_from_file_location('properties_config', HELPER)
config = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(config)


class PropertyUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='property upgrade ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.live = self.root / 'live'
        self.defaults = self.root / 'new package'
        self.live.mkdir()
        self.defaults.mkdir()
        self.state = self.root / 'state/pending.json'

    def write(self, directory, name, value):
        path = directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))
        return path

    def capture(self):
        config.capture(self.live, self.state)

    def merge(self):
        config.merge(self.live, self.defaults, self.state)

    def read(self, name):
        return json.loads((self.live / name).read_text())

    def test_existing_nested_values_survive_payload_replacement_and_new_keys_are_added(self):
        old = {'bootstrap': {'scvm': True, 'ccvm': True}, 'ui': {'enabled': False},
               'value': '', 'count': 0, 'unset': None, 'custom': {'site': 'production'}}
        defaults = {'bootstrap': {'scvm': False, 'ccvm': False, 'new_step': False},
                    'ui': {'enabled': True, 'new_control': False}, 'value': 'new default',
                    'count': 10, 'unset': 'default', 'new_section': {'timeout': 30}}
        self.write(self.live, 'ablestack.json', old)
        self.write(self.defaults, 'ablestack.json', defaults)
        self.capture()
        # Older RPMs can replace even the original, unedited package defaults.
        self.write(self.live, 'ablestack.json', defaults)
        self.merge()
        expected = {**old, 'bootstrap': {**old['bootstrap'], 'new_step': False},
                    'ui': {**old['ui'], 'new_control': False}, 'new_section': {'timeout': 30}}
        self.assertEqual(self.read('ablestack.json'), expected)
        self.assertFalse(self.state.exists())

    def test_host_arrays_and_type_changes_keep_the_existing_value(self):
        old = {'hosts': [{'name': 'cube1', 'ip': '192.0.2.1'}], 'empty': [], 'changed_type': False}
        self.write(self.live, 'cluster.json', old)
        self.write(self.defaults, 'cluster.json', {'hosts': [{'name': 'sample'}], 'empty': [1],
                                                  'changed_type': {'new_key': True}, 'new_key': 5})
        self.capture()
        self.merge()
        self.assertEqual(self.read('cluster.json'), {**old, 'new_key': 5})

    def test_first_install_and_new_files_get_new_defaults(self):
        self.write(self.defaults, 'nested/new.json', {'added': True})
        self.capture()
        self.merge()
        self.assertEqual(self.read('nested/new.json'), {'added': True})
        self.assertEqual(stat.S_IMODE((self.live / 'nested/new.json').stat().st_mode), 0o644)

    def test_consecutive_updates_preserve_all_existing_values(self):
        self.write(self.live, 'ablestack.json', {'completed': True})
        for version in (2, 3):
            defaults = {'completed': False, 'added_in_2': version}
            if version == 3:
                defaults['added_in_3'] = True
            self.write(self.defaults, 'ablestack.json', defaults)
            self.capture()
            self.merge()
            self.assertTrue(self.read('ablestack.json')['completed'])
        self.assertEqual(self.read('ablestack.json')['added_in_2'], 2)
        self.assertTrue(self.read('ablestack.json')['added_in_3'])

    def test_private_registration_and_unowned_json_are_unchanged(self):
        secret = self.live / 'cube1.cube-agent.json'
        secret.write_text('private registration, not a defaults file')
        secret.chmod(0o600)
        self.write(self.live, 'custom.json', {'site': 'production'})
        self.write(self.defaults, 'ablestack.json', {'new': True})
        self.capture()
        self.assertNotIn(secret.name, self.state.read_text())
        self.merge()
        self.assertEqual(secret.read_text(), 'private registration, not a defaults file')
        self.assertEqual(stat.S_IMODE(secret.stat().st_mode), 0o600)
        self.assertEqual(self.read('custom.json'), {'site': 'production'})

    def test_live_permissions_are_kept_even_if_rpm_changes_them(self):
        target = self.write(self.live, 'glue_conf.json', {'hypervisor': 'hci'})
        target.chmod(0o600)
        self.write(self.defaults, 'glue_conf.json', {'hypervisor': '', 'added': 10})
        self.capture()
        target.chmod(0o644)
        self.merge()
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        self.assertEqual(target.stat().st_uid, os.geteuid())
        self.assertEqual(stat.S_IMODE(self.state.parent.stat().st_mode), 0o700)

    def test_invalid_existing_json_stops_capture_before_state_is_written(self):
        for contents in ('{broken', '{"key":1,"key":2}', '{"value":NaN}'):
            with self.subTest(contents=contents):
                (self.live / 'ablestack.json').write_text(contents)
                with self.assertRaises(config.ConfigError):
                    self.capture()
                self.assertEqual((self.live / 'ablestack.json').read_text(), contents)
                self.assertFalse(self.state.exists())

    def test_invalid_default_validates_all_files_before_any_merge(self):
        self.write(self.live, 'a.json', {'existing': True})
        self.write(self.defaults, 'a.json', {'new': True})
        (self.defaults / 'z.json').write_text('{broken')
        self.capture()
        with self.assertRaises(config.ConfigError):
            self.merge()
        self.assertEqual(self.read('a.json'), {'existing': True})
        self.assertTrue(self.state.exists())

    def test_missing_defaults_does_not_discard_snapshot(self):
        self.capture()
        with self.assertRaises(config.ConfigError):
            self.merge()
        self.assertTrue(self.state.exists())

    def test_failed_write_keeps_snapshot_for_retry(self):
        self.write(self.live, 'ablestack.json', {'existing': True})
        self.write(self.defaults, 'ablestack.json', {'added': True})
        self.capture()
        with patch.object(config.os, 'replace', side_effect=OSError('simulated full disk')):
            with self.assertRaises(OSError):
                self.merge()
        self.assertTrue(self.state.exists())
        self.assertEqual(self.read('ablestack.json'), {'existing': True})
        self.assertFalse(list(self.live.glob('.properties-merge-*')))
        self.merge()
        self.assertEqual(self.read('ablestack.json'), {'existing': True, 'added': True})

    def test_pending_state_blocks_another_capture(self):
        self.write(self.live, 'ablestack.json', {'existing': True})
        self.capture()
        original = self.state.read_bytes()
        with self.assertRaisesRegex(config.ConfigError, 'Unfinished'):
            self.capture()
        self.assertEqual(self.state.read_bytes(), original)
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o600)

    def test_symlink_files_and_parent_directories_are_not_replaced(self):
        other = self.write(self.root, 'outside.json', {'outside': True})
        (self.live / 'alias.json').symlink_to(other)
        with self.assertRaises(config.ConfigError):
            self.capture()
        (self.live / 'alias.json').unlink()
        self.write(self.defaults, 'nested/a.json', {'added': True})
        self.capture()
        (self.live / 'nested').symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(config.ConfigError):
            self.merge()
        self.assertTrue(self.state.exists())
        self.assertEqual(json.loads(other.read_text()), {'outside': True})

    def test_rpm_pre_script_is_embedded_and_works_without_installed_helper(self):
        spec = (REPO / 'tools/makerpm/ablestack.spec').read_text()
        self.assertIn('%pre -p /usr/bin/python3 -f tools/makerpm/properties_config.py', spec)
        self.write(self.live, 'ablestack.json', {'existing': True})
        body = HELPER.read_text().replace(str(config.PROPERTIES), str(self.live)).replace(str(config.STATE), str(self.state))
        result = subprocess.run([sys.executable, '-B', '-c', body, '2'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.state.read_text())['files']['ablestack.json']['data'], {'existing': True})

    def test_stage_defaults_excludes_runtime_files_and_rejects_invalid_json(self):
        self.write(self.live, 'ablestack.json', {'default': True})
        (self.live / 'cube1.cube-agent.json').write_text('private')
        config.stage_defaults(self.live, self.defaults)
        self.assertEqual(json.loads((self.defaults / 'ablestack.json').read_text()), {'default': True})
        self.assertFalse((self.defaults / 'cube1.cube-agent.json').exists())
        (self.live / 'ablestack.json').write_text('{broken')
        with self.assertRaises(config.ConfigError):
            config.stage_defaults(self.live, self.defaults)


if __name__ == '__main__':
    unittest.main()
