"""Version queries use fixture release files and commands only."""
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python/react_bridge'))
import system_version as versions


class VersionTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.primary = Path(folder.name) / 'etc-os-release'
        self.fallback = Path(folder.name) / 'usr-lib-os-release'
        patched = patch.object(versions, 'OS_RELEASE_PATHS', (self.primary, self.fallback))
        patched.start()
        self.addCleanup(patched.stop)

    def test_pretty_name_is_found_regardless_of_comments_blanks_or_field_order(self):
        self.primary.write_text('\n# distribution metadata\nNAME="ABLESTACK"\nVERSION_ID=6\nPRETTY_NAME="ABLESTACK Europa v6.0"\n')
        self.assertEqual(versions.os_version(), 'ABLESTACK Europa v6.0')

    def test_fallback_path_uses_pretty_name_and_missing_pretty_name_is_reported(self):
        self.fallback.write_text('NAME="ABLESTACK"\nPRETTY_NAME="ABLESTACK Europa v4.10.0"\n')
        self.assertEqual(versions.os_version(), 'ABLESTACK Europa v4.10.0')
        self.primary.write_text('NAME="ABLESTACK"\nVERSION_ID="6.1"\n')
        with self.assertRaisesRegex(ValueError, 'PRETTY_NAME'):
            versions.os_version()

    def test_quoted_values_are_parsed_as_data_without_executing_shell_expressions(self):
        marker = self.primary.parent / 'must-not-exist'
        value = 'ABLESTACK $(touch ' + str(marker) + ')'
        self.primary.write_text('PRETTY_NAME="' + value + '"\n')
        self.assertEqual(versions.os_version(), value)
        self.assertFalse(marker.exists())

    def test_optional_rpm_failure_does_not_hide_os_or_kernel(self):
        self.primary.write_text('NAME="ABLESTACK"\nPRETTY_NAME="ABLESTACK Europa"\n')
        adapter = SimpleNamespace(command=Mock(side_effect=[
            '5.14.0-fixture\n', RuntimeError('package ablecube is not installed'),
            '4.23.0.0\tMold.Europa.202611251209.1\n',
        ]))
        result = versions.version_info(adapter)
        self.assertEqual(result['code'], 200)
        self.assertEqual(result['os_version'], 'ABLESTACK Europa')
        self.assertEqual(result['kernel_version'], '5.14.0-fixture')
        self.assertEqual(result['cockpit_version'], '')
        self.assertEqual(result['mold_version'], '4.23.0.0-Mold.Europa.202611251209')
        self.assertEqual(result['errors'], {'cockpit_version': 'package ablecube is not installed'})
        self.assertTrue(all(call.kwargs == {'timeout': 5, 'record': False} for call in adapter.command.call_args_list))

    def test_missing_or_invalid_release_data_keeps_other_versions_and_explains_os_failure(self):
        for contents in (None, '', 'NAME="unterminated\nID=fixture\n'):
            with self.subTest(contents=contents):
                if contents is not None:
                    self.primary.write_text(contents)
                adapter = SimpleNamespace(command=Mock(side_effect=[
                    '5.14.0-fixture\n', 'ablecube-fixture\n', '4.23.0.0\tMold.Europa.202611251209\n',
                ]))
                result = versions.version_info(adapter)
                self.assertEqual(result['os_version'], '')
                self.assertTrue(result['errors']['os_version'])
                self.assertEqual(result['kernel_version'], '5.14.0-fixture')
                self.assertEqual(result['cockpit_version'], 'ablecube-fixture')
                self.assertEqual(result['mold_version'], '4.23.0.0-Mold.Europa.202611251209')

    def test_kernel_query_failure_keeps_pretty_name_and_rpm_metadata(self):
        self.primary.write_text('PRETTY_NAME="ABLESTACK Europa v4.10.0"\n')
        adapter = SimpleNamespace(command=Mock(side_effect=[
            RuntimeError('uname failed'), 'ablecube-fixture\n', RuntimeError('cloudstack-common is not installed'),
        ]))
        result = versions.version_info(adapter)
        self.assertEqual(result['os_version'], 'ABLESTACK Europa v4.10.0')
        self.assertEqual(result['kernel_version'], '')
        self.assertEqual(result['cockpit_version'], 'ablecube-fixture')
        self.assertEqual(result['mold_version'], '')
        self.assertEqual(result['errors'], {
            'kernel_version': 'uname failed', 'mold_version': 'cloudstack-common is not installed',
        })
        adapter.command.assert_called_with(
            ['aspkg', '-q', '--qf', '%{VERSION}\t%{RELEASE}\n', '--', 'cloudstack-common'],
            timeout=5, record=False,
        )


if __name__ == '__main__':
    unittest.main()
