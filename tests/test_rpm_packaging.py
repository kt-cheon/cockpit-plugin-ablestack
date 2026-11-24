"""Diplo's single-RPM manifest and source export, without installing packages."""
import json
import os
from pathlib import Path
import shlex
import shutil
import stat
import subprocess
import tarfile
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
MAKERPM = REPO / 'tools/makerpm'


class RpmPackagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='diplo RPM ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        for directory in ['node_modules', 'images', 'sample', 'src', 'shell', 'python']:
            (self.source / directory).mkdir(parents=True)
        for name in ['README.md', 'main.html', 'manifest.json', 'index.html', 'index.js',
                     'main-glue.html', 'main-glue-no-permission.html']:
            (self.source / name).write_text('fixture')
        shutil.copytree(MAKERPM, self.source / 'tools/makerpm')
        shutil.copytree(REPO / 'tools/properties', self.source / 'tools/properties')

    def export(self):
        return subprocess.run(['bash', str(self.source / 'tools/makerpm/rpmbuild.sh'),
                               '1.0', '1', '--source-only'], cwd=self.root, text=True, capture_output=True)

    def test_export_contains_merge_helper_but_no_runtime_values_or_generated_defaults(self):
        artifacts = ['tools/properties/cube1.cube-agent.json', 'tools/properties/ablestack.json.rpmnew',
                     'tools/properties/.properties-merge-private', 'tools/makerpm/property-defaults/stale.json',
                     'tools/vmconfig/ccvm/id_rsa', 'tools/makerpm/rpmbuild/old.rpm']
        for name in artifacts:
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('private runtime data')
        result = self.export()
        self.assertEqual(result.returncode, 0, result.stderr)
        with tarfile.open(self.source / 'rpmbuild/SOURCES/ablecube-1.0.tar.gz') as archive:
            names = archive.getnames()
            self.assertIn('ablecube-1.0/tools/makerpm/properties_config.py', names)
            for name in artifacts:
                self.assertNotIn('ablecube-1.0/' + name, names)
                self.assertTrue((self.source / name).exists())

    def test_manifest_keeps_live_configs_and_packaged_defaults_separate(self):
        spec = (MAKERPM / 'ablestack.spec').read_text()
        install = spec.split('\n%install\n', 1)[1].split('\n%post\n', 1)[0].replace('%%', '%')
        buildroot = self.root / 'buildroot'
        result = subprocess.run(['bash', '-eu', '-c', install], cwd=self.source, text=True, capture_output=True,
                                env=dict(os.environ, RPM_BUILD_ROOT=str(buildroot)))
        self.assertEqual(result.returncode, 0, result.stderr)
        entries = {}
        for line in (self.source / 'ablestack-files.list').read_text().splitlines():
            fields = shlex.split(line)
            self.assertNotIn(fields[-1], entries)
            entries[fields[-1]] = fields[:-1]
        plugin = buildroot / 'usr/share/cockpit/ablestack'
        for path in (plugin / 'tools/properties').glob('*.json'):
            self.assertEqual(entries['/' + str(path.relative_to(buildroot))], ['%config(noreplace)'])
            default = plugin / 'tools/makerpm/property-defaults' / path.name
            self.assertEqual(json.loads(default.read_text()), json.loads(path.read_text()))
            self.assertEqual(entries['/' + str(default.relative_to(buildroot))], [])
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644)
        self.assertEqual(stat.S_IMODE(plugin.stat().st_mode), 0o755)
        self.assertNotIn('%package agent', spec)
        self.assertIn('%pre -p /usr/bin/python3 -f tools/makerpm/properties_config.py', spec)
        self.assertIn('properties_config.py merge || exit 1', spec)

    def test_missing_helper_stops_export(self):
        (self.source / 'tools/makerpm/properties_config.py').unlink()
        result = self.export()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Missing property merge helper', result.stderr)
        self.assertFalse((self.source / 'rpmbuild/SOURCES/ablecube-1.0.tar.gz').exists())

    def test_update_does_not_restart_cockpit(self):
        binaries = self.root / 'bin'
        binaries.mkdir()
        command = binaries / 'systemctl'
        command.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_SYSTEMCTL_LOG"\n')
        command.chmod(0o755)
        log = self.root / 'systemctl.log'
        env = dict(os.environ, PATH=str(binaries) + ':' + os.environ.get('PATH', ''), TEST_SYSTEMCTL_LOG=str(log))
        for count in ['2', '3']:
            result = subprocess.run(['sh', str(MAKERPM / 'ablestack.sh'), count], env=env, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(log.exists())


if __name__ == '__main__':
    unittest.main()
