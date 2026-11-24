"""ISO validation and copy/run regression tests; RPM commands are simulated."""
import importlib.util
import json
import fcntl
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "python/host/ablestack_update.py"
SPEC = importlib.util.spec_from_file_location("ablestack_update", MODULE_PATH)
update = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(update)


class UpdateIsoTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="mold helper tests ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.mount = self.root / "iso"
        self.mount.mkdir()
        self.script_dir = self.mount / "update"
        self.script_dir.mkdir()
        self.work = self.root / "work"
        os_release = self.root / "os-release"
        os_release.write_text('PRETTY_NAME="ABLESTACK Current"\n')
        self.addCleanup(patch.stopall)
        patch.object(update, "OS_RELEASE_PATH", os_release).start()
        patch.object(update, "UPDATE_WORK_DIR", self.work).start()
        patch.object(update, "UPDATE_LOCK_PATH", self.root / "update.lock").start()
        helper = self.root / 'mold-ha.py'
        helper.write_text('''import json,os,subprocess,sys
args=sys.argv[1:]
credentials=json.load(sys.stdin)
assert credentials == {'username':'admin','password':'private-test-password'}
script=args[args.index('--script')+1]
env=dict(os.environ, ABLESTACK_HA_MANAGED='1')
sys.exit(subprocess.call(['/bin/bash',script],env=env))
''')
        patch.object(update, 'HA_HELPER_PATH', helper).start()
        self.real_update = update.run_update
        patch.object(update, 'run_update', side_effect=lambda mount, kind='all', credentials=None:
                     self.real_update(mount, kind, credentials if credentials is not None else
                                      {'username':'admin','password':'private-test-password'})).start()
        self.commands = []
        self.available = {"rpm"}
        self.blocked = set()
        self.installed = True
        self.installed_versions = {"cloudstack-common": "1.0-1", "cloudstack-agent": "9.9-1"}
        patch.object(update.shutil, "which", side_effect=lambda cmd: cmd if cmd in self.available else None).start()
        self.real_run = subprocess.run
        patch.object(update.subprocess, "run", side_effect=self.run_command).start()

    def run_command(self, args, **kwargs):
        self.commands.append(args)
        if args[0] not in ("rpm", "aspkg"):
            return self.real_run(args, **kwargs)
        if "--version" in args:
            return subprocess.CompletedProcess(args, int(args[0] in self.blocked), "", "")
        if "-qp" in args:
            text = Path(args[-1]).read_text()
            if text == "broken":
                return subprocess.CompletedProcess(args, 1, "", "not an RPM")
            return subprocess.CompletedProcess(args, 0, text, "")
        return subprocess.CompletedProcess(args, 0 if self.installed else 1,
                                           self.installed_versions[args[-1]] + "\n" if self.installed else "", "")

    def add_rpm(self, name, filename=None, directory="rpms"):
        path = self.mount / directory / (filename or f"{name}-2.0-1.noarch.rpm")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"{name}\t2.0-1\tnoarch\n")
        return path

    def mold_iso(self, directory="rpms"):
        (self.script_dir / "update-mold.sh").write_text(
            '#!/bin/bash\nset -eu\n'
            'test -f rpms/cloudstack-common-2.0-1.noarch.rpm\n'
            'printf "mold:%s:%s" "$PWD" "$ABLESTACK_UPDATE_TYPE"\n')
        for package in update.MOLD_PACKAGES:
            self.add_rpm(package, directory=directory)

    def full_iso(self):
        ks = self.mount / update.TARGET_KS_PATH
        ks.parent.mkdir(parents=True, exist_ok=True)
        ks.write_text('ABLESTACK_VERSION="ABLESTACK Next"\n')
        (self.script_dir / "update-all.sh").write_text(
            '#!/bin/bash\nset -eu\ntest -f ks/ablestack-ks.cfg\n'
            'printf "all:%s:%s" "$PWD" "$ABLESTACK_UPDATE_TYPE"\n')

    def unified_iso(self):
        (self.script_dir / 'manifest.json').write_text(json.dumps({'format': 'ablestack-rpm-update', 'version': 2}))
        (self.script_dir / 'update-all.sh').write_text('printf "unified:%s" "$PWD"\n')
        (self.script_dir / 'update-mold.sh').write_text('printf "mold-scope:%s" "$PWD"\n')
        (self.mount / 'rpms/repodata').mkdir(parents=True)
        (self.mount / 'rpms/repodata/repomd.xml').write_text('<repomd/>')
        (self.mount / 'SHA256SUMS').write_text('checksums')

    def json_iso(self, host=(), scvm=(), ccvm=()):
        self.unified_iso()
        (self.script_dir / 'manifest.json').write_text(json.dumps({'format': 'ablestack-rpm-update', 'version': 3}))
        (self.mount / 'packages.json').write_text(json.dumps(dict(schema_version=1, host=list(host),
                                                                scvm=list(scvm), ccvm=list(ccvm))))

    def test_json_iso_shows_role_lists_and_ignores_undeclared_rpms(self):
        self.json_iso(host=['cloudstack-agent', 'curl'], scvm=['curl'], ccvm=['cloudstack-ui'])
        for name in ('cloudstack-agent', 'curl', 'cloudstack-ui', 'unlisted'):
            self.add_rpm(name)
        info = update.read_update_info(str(self.mount), 'all')
        self.assertEqual(info['package_count'], 3)
        self.assertEqual(info['role_packages'], dict(host=['cloudstack-agent.noarch', 'curl.noarch'],
                                                     scvm=['curl.noarch'], ccvm=['cloudstack-ui.noarch']))
        self.assertNotIn('unlisted', [row['name'] for row in info['packages']])
        other = update.read_update_info(str(self.mount), 'packages')
        self.assertEqual(other['role_packages'], dict(host=['curl.noarch'], scvm=['curl.noarch'], ccvm=[]))
        self.assertEqual(other['package_count'], 1)

    def test_json_iso_without_cloudstack_can_skip_mold_without_credentials(self):
        self.json_iso(host=['curl'])
        self.add_rpm('curl')
        info = update.read_update_info(str(self.mount), 'mold')
        self.assertEqual(info['role_packages'], dict(host=[], scvm=[], ccvm=[]))
        self.assertTrue(self.real_update(str(self.mount), 'mold')['skipped'])
        self.assertFalse(self.work.exists())

    def test_json_iso_rejects_missing_declared_rpm(self):
        self.json_iso(host=['missing-rpm'])
        self.add_rpm('curl')
        with self.assertRaisesRegex(ValueError, 'missing-rpm'):
            update.read_update_info(str(self.mount), 'all')

    def test_json_iso_rejects_cloudstack_on_scvm(self):
        self.json_iso(scvm=['cloudstack-common'])
        self.add_rpm('cloudstack-common')
        with self.assertRaisesRegex(ValueError, 'scvm'):
            update.read_update_info(str(self.mount), 'all')

    def test_json_iso_requires_packages_file(self):
        self.json_iso(host=['curl'])
        self.add_rpm('curl')
        (self.mount / 'packages.json').unlink()
        with self.assertRaisesRegex(ValueError, 'packages.json'):
            update.read_update_info(str(self.mount), 'all')

    def test_unified_general_only_iso_does_not_require_cloudstack_or_ks(self):
        self.unified_iso()
        self.add_rpm('curl')
        info = update.read_update_info(str(self.mount), 'all')
        self.assertTrue(info['rpm_only'])
        self.assertEqual(info['package_count'], 1)
        self.assertEqual(info['mold_package_count'], 0)
        self.assertEqual(info['target_mold_version'], '포함 안 됨')
        mold = update.read_update_info(str(self.mount), 'mold')
        self.assertEqual(mold['package_count'], 0)
        result = self.real_update(str(self.mount), 'mold')
        self.assertTrue(result['skipped'])
        self.assertFalse(result['background'])
        self.assertFalse(self.work.exists())
        self.assertFalse(any('--credentials-stdin' in command for command in self.commands))

    def test_unified_partial_cloudstack_iso_is_valid_and_each_scope_is_filtered(self):
        self.unified_iso()
        self.add_rpm('cloudstack-agent')
        self.add_rpm('curl')
        for scope, count in [('all', 2), ('mold', 1), ('packages', 1)]:
            with self.subTest(scope=scope):
                self.assertEqual(update.read_update_info(str(self.mount), scope)['package_count'], count)
        with patch.object(update.subprocess, 'run', wraps=self.run_command) as execute:
            update.run_update(str(self.mount), 'all')
        command = next(call.args[0] for call in execute.call_args_list if '--credentials-stdin' in call.args[0])
        self.assertEqual(command[command.index('--kind') + 1], 'rpms')
        self.assertIn('--worker-arg=all', command)
        self.assertNotIn('--worker-arg=--include-cockpit', command)

    def test_unified_other_scope_excludes_optional_cloudstack_rpms(self):
        self.unified_iso()
        self.add_rpm('cloudstack-common')
        self.add_rpm('cloudstack-management')
        self.add_rpm('curl')
        info = update.read_update_info(str(self.mount), 'packages')
        self.assertEqual([row['name'] for row in info['packages']], ['curl'])
        with patch.object(update.subprocess, 'run', wraps=self.run_command) as execute:
            update.run_update(str(self.mount), 'packages')
        command = next(call.args[0] for call in execute.call_args_list if '--credentials-stdin' in call.args[0])
        self.assertIn('--worker-arg=packages', command)

    def test_unified_mold_only_iso_other_scope_skips_without_authentication(self):
        self.unified_iso()
        self.add_rpm('cloudstack-ui')
        result = self.real_update(str(self.mount), 'packages')
        self.assertTrue(result['skipped'])
        self.assertFalse(self.work.exists())

    def tools_iso(self):
        (self.script_dir / "update-qemu-exec-tools.sh").write_text(
            '#!/bin/bash\nset -eu\n'
            'if [ "${1:-}" = --check ]; then\n'
            'printf "TOOLS_CURRENT_KERNEL=5.14.0-new\\nTOOLS_TARGET_KERNEL=5.14.0-new\\n"\n'
            'else printf "tools:%s:%s" "$PWD" "$ABLESTACK_UPDATE_TYPE"; fi\n')

    def test_mold_reads_five_headers_without_ks_config_or_appstream(self):
        self.mold_iso()
        info = update.read_update_info(str(self.mount), "mold")
        self.assertEqual(info["target_mold_version"], "2.0-1")
        self.assertEqual(info["current_mold_version"], "1.0-1")
        self.assertEqual(info["current_ablestack_version"], info["target_ablestack_version"])
        self.assertEqual([p["name"] for p in info["mold_packages"]], list(update.MOLD_PACKAGES))
        self.assertEqual(info["update_script"], str(self.script_dir / "update-mold.sh"))
        self.assertEqual(info["work_update_script"], str(self.work / "update/update-mold.sh"))
        self.assertTrue(all(command[0] == "rpm" for command in self.commands))

    def test_mold_ignores_ks_version_even_if_present(self):
        self.mold_iso()
        self.full_iso()
        (self.mount / update.TARGET_KS_PATH).write_text("no OS version here")
        self.assertEqual(update.read_update_info(str(self.mount), "mold")["target_mold_version"], "2.0-1")

    def test_mold_versions_use_common_version_release_without_epoch_or_arch(self):
        self.mold_iso()
        current = "4.23.0.0-Mold.Europa.202609111701.1"
        target = "4.23.0.0-Mold.Europa.202609141701.1"
        self.installed_versions["cloudstack-common"] = current
        common = next((self.mount / "rpms").glob("cloudstack-common-*.rpm"))
        common.write_text(f"cloudstack-common\t{target}\tx86_64\n")
        info = update.read_update_info(str(self.mount), "mold")
        self.assertEqual(info["current_mold_version"], current)
        self.assertEqual(info["target_mold_version"], target)
        current_query = next(command for command in self.commands if "-q" in command)
        self.assertEqual(current_query[-1], "cloudstack-common")
        self.assertEqual(current_query[current_query.index("--qf") + 1], "%{VERSION}-%{RELEASE}\n")
        self.assertNotIn("EPOCHNUM", update.MOLD_RPM_QUERY_FORMAT)

    def test_mold_supports_iso_root_and_appstream_rpm_layout(self):
        for layout in (".", "AppStream/Packages/mold"):
            with self.subTest(layout=layout):
                self.mold_iso(directory=layout)
                info = update.read_update_info(str(self.mount), "mold")
                self.assertEqual(info["mold_rpm_dir"], str((self.mount / layout).resolve()))

    def test_mold_missing_script_is_rejected(self):
        self.mold_iso()
        (self.script_dir / "update-mold.sh").unlink()
        with self.assertRaisesRegex(FileNotFoundError, "update-mold.sh"):
            update.read_update_info(str(self.mount), "mold")

    def test_mold_script_directory_is_rejected(self):
        self.mold_iso()
        script = self.script_dir / "update-mold.sh"
        script.unlink()
        script.mkdir()
        with self.assertRaises(FileNotFoundError):
            update.read_update_info(str(self.mount), "mold")

    def test_mold_missing_ccvm_package_is_rejected(self):
        self.mold_iso()
        next((self.mount / "rpms").glob("cloudstack-ui-*.rpm")).unlink()
        with self.assertRaisesRegex(FileNotFoundError, "cloudstack-ui"):
            update.read_update_info(str(self.mount), "mold")

    def test_mold_no_rpms_is_rejected(self):
        (self.script_dir / "update-mold.sh").write_text("#!/bin/bash\n")
        with self.assertRaisesRegex(FileNotFoundError, "RPM 파일"):
            update.read_update_info(str(self.mount), "mold")

    def test_duplicate_package_header_is_rejected_despite_filename(self):
        self.mold_iso()
        self.add_rpm("cloudstack-common", filename="unrelated-filename.rpm")
        with self.assertRaisesRegex(ValueError, "cloudstack-common RPM이 중복"):
            update.read_update_info(str(self.mount), "mold")

    def test_misleading_filename_does_not_satisfy_missing_package(self):
        self.mold_iso()
        path = next((self.mount / "rpms").glob("cloudstack-ui-*.rpm"))
        path.write_text("another-package\t0:2.0-1\tnoarch\n")
        with self.assertRaisesRegex(FileNotFoundError, "cloudstack-ui"):
            update.read_update_info(str(self.mount), "mold")

    def test_corrupt_rpm_is_rejected(self):
        self.mold_iso()
        next((self.mount / "rpms").glob("*.rpm")).write_text("broken")
        with self.assertRaisesRegex(ValueError, "RPM 정보를 읽을 수 없습니다"):
            update.read_update_info(str(self.mount), "mold")

    def test_invalid_metadata_format_is_rejected(self):
        self.mold_iso()
        next((self.mount / "rpms").glob("*.rpm")).write_text("invalid header output")
        with self.assertRaisesRegex(ValueError, "RPM 정보 형식"):
            update.read_update_info(str(self.mount), "mold")

    def test_aspkg_is_preferred_and_blocked_command_falls_back(self):
        self.mold_iso()
        self.available.add("aspkg")
        update.read_update_info(str(self.mount), "mold")
        self.assertTrue(all(command[0] == "aspkg" for command in self.commands))
        self.commands.clear()
        self.blocked.add("aspkg")
        update.read_update_info(str(self.mount), "mold")
        self.assertTrue(all(command[0] == "rpm" for command in self.commands if "-qp" in command))

    def test_no_rpm_command_reports_requirement(self):
        self.mold_iso()
        self.available.clear()
        with self.assertRaisesRegex(RuntimeError, "rpm/aspkg"):
            update.read_update_info(str(self.mount), "mold")

    def test_uninstalled_current_version_does_not_invalidate_iso(self):
        self.mold_iso()
        self.installed = False
        self.assertEqual(update.read_update_info(str(self.mount), "mold")["current_mold_version"], "N/A")

    def test_full_update_keeps_ks_version_and_does_not_query_rpm(self):
        self.full_iso()
        info = update.read_update_info(str(self.mount))
        self.assertEqual(info["target_ablestack_version"], "ABLESTACK Next")
        self.assertEqual(info["current_ablestack_version"], "ABLESTACK Current")
        self.assertEqual(info["update_script"], str(self.script_dir / "update-all.sh"))
        self.assertEqual(info["work_update_script"], str(self.work / "update/update-all.sh"))
        self.assertNotIn("target_mold_version", info)
        self.assertEqual(self.commands, [])

    def test_full_update_still_requires_ks_and_version(self):
        self.full_iso()
        ks = self.mount / update.TARGET_KS_PATH
        ks.write_text("ABLESTACK_VERSION=\n")
        with self.assertRaisesRegex(ValueError, "ABLESTACK_VERSION"):
            update.read_update_info(str(self.mount), "all")
        ks.unlink()
        with self.assertRaisesRegex(FileNotFoundError, "ks/ablestack-ks.cfg"):
            update.read_update_info(str(self.mount), "all")

    def test_full_update_does_not_accept_mold_only_iso(self):
        self.mold_iso()
        with self.assertRaises(FileNotFoundError):
            update.read_update_info(str(self.mount), "all")

    def test_root_level_script_does_not_replace_required_update_directory(self):
        for update_type, script_name in (("mold", "update-mold.sh"), ("all", "update-all.sh")):
            with self.subTest(update_type=update_type):
                self.mold_iso()
                self.full_iso()
                (self.script_dir / script_name).rename(self.mount / script_name)
                with self.assertRaises(FileNotFoundError):
                    update.read_update_info(str(self.mount), update_type)

    def test_mold_run_copies_small_iso_and_executes_its_script(self):
        self.mold_iso()
        result = update.run_update(str(self.mount), "mold")
        self.assertEqual(result["stdout"], f"mold:{self.work}:mold")
        self.assertEqual(len(list((self.work / "rpms").glob("*.rpm"))), 5)
        self.assertFalse((self.work / "ks").exists())
        self.assertFalse((self.work / "AppStream").exists())

    def test_credentials_are_sent_only_on_stdin(self):
        self.full_iso()
        with patch.object(update.subprocess, 'run', wraps=self.run_command) as execute:
            update.run_update(str(self.mount), 'all')
        call = next(call for call in execute.call_args_list if '--credentials-stdin' in call.args[0])
        self.assertNotIn('private-test-password', str(call.args[0]))
        self.assertNotIn('private-test-password', str(call.kwargs['env']))
        self.assertEqual(json.loads(call.kwargs['input'])['password'], 'private-test-password')

    def test_missing_credentials_do_not_replace_work(self):
        self.full_iso()
        self.work.mkdir()
        marker = self.work / 'keep'
        marker.write_text('keep')
        with self.assertRaisesRegex(ValueError, 'Mold 관리자'):
            self.real_update(str(self.mount), 'all')
        self.assertTrue(marker.exists())

    def test_credentials_embedded_in_api_url_are_rejected_before_command_execution(self):
        self.full_iso()
        with self.assertRaisesRegex(ValueError, 'Mold API 주소'):
            self.real_update(str(self.mount), 'all', {'username': 'admin', 'password': 'private-test-password',
                             'api_url': 'https://admin:private-url-password@mold.example/client/api'})
        self.assertFalse(self.work.exists())
        self.assertFalse(any('private-url-password' in str(command) for command in self.commands))

    def test_other_packages_iso_uses_rpms_metadata_without_ks(self):
        (self.script_dir / 'update-all.sh').write_text('#!/bin/bash\n')
        (self.mount / 'rpms/repodata').mkdir(parents=True)
        (self.mount / 'rpms/repodata/repomd.xml').write_text('<repomd/>')
        (self.mount / 'SHA256SUMS').write_text('checksums')
        self.add_rpm('glibc')
        info = update.read_update_info(str(self.mount), 'packages')
        self.assertEqual(info['package_count'], 1)
        self.assertEqual(info['target_ablestack_version'], 'ABLESTACK Current')
        self.add_rpm('cloudstack-common')
        with self.assertRaisesRegex(ValueError, 'CloudStack'):
            update.read_update_info(str(self.mount), 'packages')

    def test_mold_run_revalidates_before_replacing_previous_work(self):
        self.mold_iso()
        update.read_update_info(str(self.mount), "mold")
        self.work.mkdir()
        marker = self.work / "previous-update"
        marker.write_text("keep")
        next((self.mount / "rpms").glob("cloudstack-ui-*.rpm")).unlink()
        with self.assertRaises(FileNotFoundError):
            update.run_update(str(self.mount), "mold")
        self.assertEqual(marker.read_text(), "keep")
        self.assertTrue(all(command[0] == "rpm" for command in self.commands))

    def test_full_run_keeps_existing_copy_and_execution_flow(self):
        self.full_iso()
        self.work.mkdir()
        (self.work / "previous-file").write_text("old")
        result = update.run_update(str(self.mount), "all")
        self.assertEqual(result["stdout"], f"all:{self.work}:all")
        self.assertTrue((self.work / update.TARGET_KS_PATH).is_file())
        self.assertFalse((self.work / "previous-file").exists())
        self.assertFalse(any(command[0] in ("rpm", "aspkg") for command in self.commands))

    def test_script_failure_is_reported(self):
        self.mold_iso()
        (self.script_dir / "update-mold.sh").write_text('echo "update failed" >&2\nexit 7\n')
        with self.assertRaisesRegex(RuntimeError, "update failed"):
            update.run_update(str(self.mount), "mold")

    def test_tools_check_and_run_use_separate_script_without_ks(self):
        self.tools_iso()
        info = update.read_update_info(str(self.mount), "tools")
        self.assertEqual(info["current_kernel"], "5.14.0-new")
        self.assertEqual(info["target_kernel"], "5.14.0-new")
        self.assertEqual(info["update_label"], "ABLESTACK Tools 업데이트")
        result = update.run_update(str(self.mount), "tools")
        self.assertEqual(result["stdout"], f"tools:{self.work}:tools")
        self.assertFalse(result["background"])
        self.assertFalse((self.work / "ks").exists())

    def test_tools_kernel_mismatch_does_not_replace_work_directory(self):
        self.tools_iso()
        (self.script_dir / "update-qemu-exec-tools.sh").write_text(
            'echo "현재 커널 버전이 맞지 않아 설치할 수 없습니다."\nexit 1\n')
        self.work.mkdir()
        marker = self.work / "previous-update"
        marker.write_text("keep")
        with self.assertRaisesRegex(ValueError, "현재 커널 버전"):
            update.run_update(str(self.mount), "tools")
        self.assertEqual(marker.read_text(), "keep")

    def test_tools_can_run_from_preserved_work_after_reboot_without_copying_itself(self):
        self.tools_iso()
        update.run_update(str(self.mount), "tools")
        marker = self.work / "keep"
        marker.write_text("keep")
        result = update.run_update(str(self.work), "tools")
        self.assertEqual(result["stdout"], f"tools:{self.work}:tools")
        self.assertTrue(marker.exists())

    def test_background_start_is_not_reported_as_completed_update(self):
        self.full_iso()
        (self.script_dir / "update-all.sh").write_text('printf "ABLESTACK_UPDATE_STARTED_PID=9876\\n"\n')
        result = update.run_update(str(self.mount), "all")
        self.assertTrue(result["background"])
        self.assertEqual(result["pid"], 9876)
        self.assertIn("백그라운드에서 시작", result["message"])
        self.assertNotIn("실행이 완료", result["message"])
        self.assertIn("Tools", result["message"])

    def test_busy_update_prevents_replacing_active_work(self):
        self.full_iso()
        self.work.mkdir()
        marker = self.work / "active-update"
        marker.write_text("keep")
        with update.UPDATE_LOCK_PATH.open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(RuntimeError, "이미 업데이트"):
                update.run_update(str(self.mount), "all")
        self.assertEqual(marker.read_text(), "keep")

    def test_closing_parent_lock_preserves_inherited_background_lock(self):
        with update.update_work_lock() as lock_fd:
            inherited = os.dup(lock_fd)
        try:
            with self.assertRaisesRegex(RuntimeError, "이미 업데이트"):
                with update.update_work_lock():
                    self.fail("must stay locked")
        finally:
            os.close(inherited)
        with update.update_work_lock():
            pass


if __name__ == "__main__":
    unittest.main()
