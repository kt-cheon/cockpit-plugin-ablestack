"""RPM source/post-install checks, plus an isolated RPM upgrade test on Linux."""
import os
from pathlib import Path
import platform
import shlex
import shutil
import stat
import subprocess
import tarfile
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[1]
MAKERPM = REPO / "tools/makerpm"
PLUGIN = Path("usr/share/cockpit/ablestack")


def run(args, **kwargs):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, **kwargs)
    if result.returncode:
        raise AssertionError(f"{args} failed ({result.returncode}):\n"
                             f"{result.stdout}\n{result.stderr}")
    return result


def fixture(root):
    for directory in ("node_modules", "images", "sample", "src", "shell/host", "python"):
        (root / directory).mkdir(parents=True, exist_ok=True)
    for filename in ("README.md", "main.html", "manifest.json", "index.html", "index.js",
                     "main-glue.html", "main-glue-no-permission.html", "shell/host/ipcorrector",
                     "shell/host/bootstrap.sh", "python/helper.py"):
        (root / filename).write_text("original\n")
    shutil.copytree(MAKERPM, root / "tools/makerpm")
    shutil.copytree(REPO / "tools/node-agent", root / "tools/node-agent")
    shutil.copytree(REPO / "tools/properties", root / "tools/properties")
    (root / "tools/vmconfig").mkdir()
    (root / "tools/vmconfig/readme.md").write_text("VM working directory\n")


class RpmPackagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="rpm packaging ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / "source"
        fixture(self.source)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ.get('PATH', '')}")

    def stub(self, name, body):
        path = self.bin / name
        path.write_text("#!/bin/sh\nset -eu\n" + body)
        path.chmod(0o755)

    def build_source(self, *extra):
        self.env["TEST_RPMBUILD_LOG"] = str(self.root / "rpmbuild.log")
        self.stub("rpmbuild", r'''
printf '%s\n' "$*" >> "$TEST_RPMBUILD_LOG"
if [ "${TEST_RPMBUILD_EXIT:-0}" != 0 ]; then exit "$TEST_RPMBUILD_EXIT"; fi
mode=$1
rpm_dir=
source_dir=
while [ "$#" -gt 0 ]; do
    if [ "$1" = --define ]; then
        case "$2" in
            '_rpmdir '*) rpm_dir=${2#_rpmdir } ;;
            '_srcrpmdir '*) source_dir=${2#_srcrpmdir } ;;
        esac
        shift
    fi
    shift
done
test -n "$rpm_dir"
mkdir -p "$rpm_dir/noarch" "$rpm_dir/x86_64" "$source_dir"
if [ "${TEST_SKIP_AGENT_MODE:-}" != "$mode" ]; then
    printf 'agent fixture' > "$rpm_dir/noarch/ablecube-agent-1.0-1.noarch.rpm"
fi
if [ "${TEST_SKIP_MAIN_MODE:-}" != "$mode" ]; then
    printf 'main fixture' > "$rpm_dir/x86_64/ablecube-1.0-1.x86_64.rpm"
fi
if [ "$mode" = -ba ]; then
    printf 'source fixture' > "$source_dir/ablecube-1.0-1.src.rpm"
fi
''')
        self.stub("rpm", r'''
case "$1:$2" in
    '-qp:--requires')
        if [ "${TEST_MISSING_DEPENDENCY:-0}" = 0 ]; then printf 'ablecube-agent = 1.0-1\n'; fi
        ;;
    '-qpl:'*)
        if [ "${TEST_MISSING_SERVICE:-0}" = 0 ]; then printf '/usr/lib/systemd/system/cube-agent.service\n'; fi
        ;;
    '-qp:--qf')
        for package_path do :; done
        case "$package_path" in
            */ablecube-agent-*) printf 'ablecube-agent|%s|noarch' "${TEST_AGENT_VERSION:-1.0-1}" ;;
            *) printf 'ablecube|1.0-1|x86_64' ;;
        esac
        ;;
    *) exit 9 ;;
esac
''')
        return run(["bash", str(self.source / "tools/makerpm/rpmbuild.sh"), "1.0", "1", *extra],
                   cwd=self.root, env=self.env)

    def test_archive_excludes_runtime_files_and_previous_builds(self):
        artifacts = ("tools/vmconfig/ccvm/id_rsa", "tools/vmconfig/scvm/scvm.xml",
                     "tools/vmconfig/pfmp/pfmp-cloudinit.iso", "tools/makerpm/rpmbuild/old.rpm",
                     "python/__pycache__/helper.pyc", "images/.DS_Store",
                     "tools/properties/cluster.json.rpmnew", "tools/properties/cluster.json.rpmsave",
                     "tools/properties/cluster.json.rpmorig", "rpmbuild/SOURCES/ablecube-1.0/stale",
                     "tools/properties/cube2.cube-agent.json", "tools/properties/cube2.cube-agent.json.bak",
                     "tools/properties/.cube-setup-private")
        for filename in artifacts:
            path = self.source / filename
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("must not be packaged\n")
        self.build_source()
        archive = self.source / "rpmbuild/SOURCES/ablecube-1.0.tar.gz"
        with tarfile.open(archive) as source_tar:
            names = {member.name.rstrip("/") for member in source_tar.getmembers()}
        for filename in artifacts:
            self.assertNotIn(f"ablecube-1.0/{filename}", names)
            self.assertTrue((self.source / filename).exists())
        self.assertNotIn("ablecube-1.0/stale", names)
        self.assertIn("ablecube-1.0/tools/vmconfig/readme.md", names)
        self.assertIn("ablecube-1.0/tools/node-agent/ablecube-agent.rpm", names)
        with tarfile.open(archive) as source_tar:
            self.assertEqual(source_tar.extractfile("ablecube-1.0/tools/node-agent/ablecube-agent.rpm").read(), b"agent fixture")
        for config in (self.source / "tools/properties").glob("*.json"):
            if not config.name.endswith(".cube-agent.json"):
                self.assertIn(f"ablecube-1.0/tools/properties/{config.name}", names)
        self.assertFalse(list((self.source / "rpmbuild/SOURCES").glob(".ablecube-*")))

    def test_explicit_build_path_is_supported(self):
        result = self.build_source(str(self.source))
        self.assertTrue((self.source / "rpmbuild/SOURCES/ablecube-1.0.tar.gz").is_file())
        self.assertIn("ablecube-agent-1.0-1.noarch.rpm", result.stdout)
        self.assertIn("BUILD_LAYOUT = ablecube-and-agent-v1", result.stdout)
        self.assertIn(str(self.source / "tools/makerpm/ablestack.spec"), result.stdout)
        for filename in ("noarch/ablecube-agent-1.0-1.noarch.rpm", "x86_64/ablecube-1.0-1.x86_64.rpm"):
            self.assertTrue((self.source / "rpmbuild/RPMS" / filename).is_file())
        self.assertTrue((self.source / "rpmbuild/SRPMS/ablecube-1.0-1.src.rpm").is_file())
        self.assertEqual(len((self.root / "rpmbuild.log").read_text().splitlines()), 2)

    def test_old_main_only_spec_fails_before_running_rpmbuild(self):
        (self.source / "tools/makerpm/ablestack.spec").write_text("Name: ablecube\n%description\nOld spec\n")
        with self.assertRaisesRegex(AssertionError, "Outdated RPM spec"):
            self.build_source()
        self.assertFalse((self.root / "rpmbuild.log").exists())

    def test_partial_source_copy_is_reported_before_building(self):
        (self.source / "tools/node-agent/agent.py").unlink()
        with self.assertRaisesRegex(AssertionError, "Missing agent source"):
            self.build_source()
        self.assertFalse((self.root / "rpmbuild.log").exists())

    def test_source_export_includes_untracked_agent_code_without_running_rpmbuild(self):
        self.build_source(str(self.source), "--source-only")
        self.assertFalse((self.root / "rpmbuild.log").exists())
        with tarfile.open(self.source / "rpmbuild/SOURCES/ablecube-1.0.tar.gz") as archive:
            self.assertIn("ablecube-1.0/tools/node-agent/agent.py", archive.getnames())
            self.assertIn(b"%package agent", archive.extractfile("ablecube-1.0/tools/makerpm/ablestack.spec").read())

    def test_previous_agent_rpm_cannot_mask_missing_new_output(self):
        old = self.source / "rpmbuild/RPMS/noarch/ablecube-agent-1.0-1.noarch.rpm"
        old.parent.mkdir(parents=True)
        old.write_text("previous build")
        self.env["TEST_SKIP_AGENT_MODE"] = "-bb"
        with self.assertRaisesRegex(AssertionError, "Required RPM was not produced"):
            self.build_source()
        self.assertEqual(old.read_text(), "previous build")

    def test_bootstrap_main_package_cannot_mask_missing_final_output(self):
        self.env["TEST_SKIP_MAIN_MODE"] = "-ba"
        with self.assertRaisesRegex(AssertionError, "Required RPM was not produced"):
            self.build_source()
        self.assertFalse((self.source / "rpmbuild/RPMS/x86_64/ablecube-1.0-1.x86_64.rpm").exists())

    def test_missing_final_agent_is_not_accepted_from_bootstrap_pass(self):
        self.env["TEST_SKIP_AGENT_MODE"] = "-ba"
        with self.assertRaisesRegex(AssertionError, "Required RPM was not produced"):
            self.build_source()

    def test_wrong_agent_metadata_is_reported(self):
        self.env["TEST_AGENT_VERSION"] = "old-version"
        with self.assertRaisesRegex(AssertionError, "Unexpected RPM metadata"):
            self.build_source()

    def test_missing_main_dependency_is_reported(self):
        self.env["TEST_MISSING_DEPENDENCY"] = "1"
        with self.assertRaisesRegex(AssertionError, "does not require the matching"):
            self.build_source()

    def test_agent_without_systemd_service_is_rejected(self):
        self.env["TEST_MISSING_SERVICE"] = "1"
        with self.assertRaisesRegex(AssertionError, "does not contain cube-agent.service"):
            self.build_source()

    def test_failed_rpmbuild_is_reported_and_staging_is_cleaned(self):
        self.env["TEST_RPMBUILD_EXIT"] = "7"
        with self.assertRaisesRegex(AssertionError, "failed \\(7\\)"):
            self.build_source()
        self.assertFalse(list((self.source / "rpmbuild/SOURCES").glob(".ablecube-*")))

    def test_install_manifest_preserves_all_settings_and_file_permissions(self):
        extra = self.source / "tools/properties/site overrides/extra.conf"
        extra.parent.mkdir()
        extra.write_text("site-specific configuration\n")
        for filename in ("cube2.cube-agent.json", "cube2.cube-agent.json.bak", ".cube-setup-private"):
            (self.source / "tools/properties" / filename).write_text("runtime private key")
        (self.source / "sample/image-link").symlink_to("../images", target_is_directory=True)
        buildroot = self.root / "build root"
        install = (MAKERPM / "ablestack.spec").read_text().split("\n%install\n", 1)[1]
        install = install.split("\n%post\n", 1)[0].replace("%%", "%")
        run(["bash", "-eu", "-c", install], cwd=self.source,
            env=dict(self.env, RPM_BUILD_ROOT=str(buildroot)))
        plugin = buildroot / PLUGIN
        for filename in ("cube2.cube-agent.json", "cube2.cube-agent.json.bak", ".cube-setup-private"):
            self.assertFalse((plugin / "tools/properties" / filename).exists())
            self.assertEqual((self.source / "tools/properties" / filename).read_text(), "runtime private key")
        entries = {}
        for line in (self.source / "ablestack-files.list").read_text().splitlines():
            fields = shlex.split(line)
            path = fields[-1].replace("%%", "%")
            self.assertNotIn(path, entries, f"duplicate RPM entry: {path}")
            entries[path] = fields[:-1]
        expected = {"/" + str(path.relative_to(buildroot))
                    for path in [plugin, *plugin.rglob("*")]}
        self.assertEqual(set(entries), expected)
        for path in [plugin, *plugin.rglob("*")]:
            name = "/" + str(path.relative_to(buildroot))
            mode = stat.S_IMODE(path.stat().st_mode)
            if path.is_dir() and not path.is_symlink():
                self.assertEqual(entries[name], ["%dir"])
                self.assertEqual(mode, 0o755)
            elif "/tools/properties/" in name:
                self.assertEqual(entries[name], ["%config(noreplace)"])
                self.assertEqual(mode, 0o644)
            elif path.suffix in (".sh", ".py") or path.name == "ipcorrector":
                self.assertEqual(entries[name], ["%attr(0755,root,root)"])
            else:
                self.assertEqual(entries[name], [])
        for filename in ("shell/host/ipcorrector", "shell/host/bootstrap.sh", "python/helper.py",
                         "tools/makerpm/ablestack.sh"):
            self.assertEqual(entries["/" + str(PLUGIN / filename)], ["%attr(0755,root,root)"])
        self.assertEqual(stat.S_IMODE((plugin / "index.js").stat().st_mode), 0o644)
        for executable in ("node-remote", "node-copy", "node-setup"):
            path = buildroot / "usr/libexec/ablestack" / executable
            self.assertTrue(path.is_file())
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o755)
        bootstrap = buildroot / "usr/libexec/ablestack/node-agent/bootstrap-vm.sh"
        self.assertEqual(bootstrap.read_bytes(), (REPO / "tools/node-agent/bootstrap-vm.sh").read_bytes())
        firewall = bootstrap.with_name("management_firewall.py")
        self.assertEqual(firewall.read_bytes(), (REPO / "tools/node-agent/management_firewall.py").read_bytes())
        config = buildroot / "etc/ablestack/node-agent/agent.json"
        self.assertEqual(stat.S_IMODE(config.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(config.parent.stat().st_mode), 0o700)
        policy = config.parent / "install.json"
        self.assertEqual(stat.S_IMODE(policy.stat().st_mode), 0o600)
        spec = (MAKERPM / "ablestack.spec").read_text()
        self.assertIn("%config(noreplace) /etc/ablestack/node-agent/install.json", spec)
        for unit in ("cube-agent.service", "cube-agent-setup.service", "cube-agent-setup.path"):
            self.assertTrue((buildroot / "usr/lib/systemd/system" / unit).is_file())
        for directory in ("", "bundles", "enrollment"):
            path = buildroot / "var/lib/ablestack/cube-agent" / directory
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700)
        dispatcher = buildroot / "etc/NetworkManager/dispatcher.d/90-cube-agent-setup"
        self.assertEqual(stat.S_IMODE(dispatcher.stat().st_mode), 0o755)

    def test_agent_update_preserves_service_state_and_initialization_policy(self):
        log = self.root / "systemctl.log"
        self.env["TEST_SYSTEMCTL_LOG"] = str(log)
        self.stub("systemctl", 'printf "%s\\n" "$*" >> "$TEST_SYSTEMCTL_LOG"\n')
        post = (MAKERPM / "ablestack.spec").read_text().split("\n%post agent\n", 1)[1]
        post = post.split("\n%preun agent\n", 1)[0]
        run(["sh", "-c", post, "post-agent", "2"], env=self.env)
        self.assertEqual(log.read_text(), "daemon-reload\n")
        log.unlink()
        run(["sh", "-c", post, "post-agent", "1"], env=self.env)
        lines = log.read_text().splitlines()
        self.assertIn("enable cube-agent-setup.service cube-agent-setup.path cube-agent.service", lines)
        self.assertFalse(any("restart" in line for line in lines))

    def test_post_install_only_enables_socket_on_first_install(self):
        log = self.root / "systemctl.log"
        self.env["TEST_SYSTEMCTL_LOG"] = str(log)
        self.stub("systemctl", 'printf "%s\\n" "$*" >> "$TEST_SYSTEMCTL_LOG"\n')
        script = ["sh", str(MAKERPM / "ablestack.sh")]
        for count in ("2", "3"):
            run([*script, count], env=self.env)
            self.assertFalse(log.exists(), "an upgrade must not change running services")
        run([*script, "1"], env=self.env)
        self.assertEqual(log.read_text(), "enable --now cockpit.socket\n")

    def test_post_install_reports_socket_failure_without_failing_package(self):
        self.stub("systemctl", "exit 1\n")
        result = run(["sh", str(MAKERPM / "ablestack.sh"), "1"], env=self.env)
        self.assertIn("Warning:", result.stderr)


@unittest.skipUnless(platform.system() == "Linux" and shutil.which("rpm") and shutil.which("rpmbuild"),
                     "actual RPM upgrade requires Linux with rpm and rpm-build")
class RpmUpgradeTests(unittest.TestCase):
    def test_legacy_and_subsequent_upgrades_preserve_live_settings(self):
        # All files and the RPM database stay inside this temporary directory.
        # Scriptlets are checked separately above; never run systemctl from this test.
        with tempfile.TemporaryDirectory(prefix="ablestack-rpm-") as directory:
            root = Path(directory).resolve()
            source = root / "source"
            fixture(source)
            spec_path = source / "tools/makerpm/ablestack.spec"
            # Relocate only the test packages so installation needs no root/chroot.
            # Their payload and config flags still come from the production spec.
            spec = spec_path.read_text().replace(
                "Name: ablecube\n", "Name: ablecube\nPrefix: /usr/share/cockpit/ablestack\n"
            ).replace("BuildRequires: /bin/bash\n", "")
            for name in ("defaults.json", "missing.json"):
                (source / "tools/properties" / name).write_text('{"old_default": true}\n')
            spec_path.write_text(spec.replace(
                "%files -f ablestack-files.list\n%defattr(-,root,root,0755)",
                "%files\n%defattr(-,root,root,0755)\n/usr/share/cockpit/ablestack"))

            def build(version):
                run(["bash", str(source / "tools/makerpm/rpmbuild.sh"), version, "1"])
                agent_rpm = source / f"rpmbuild/RPMS/noarch/ablecube-agent-{version}-1.noarch.rpm"
                self.assertEqual(run(["rpm", "-qp", "--qf", "%{NAME}", str(agent_rpm)]).stdout,
                                 "ablecube-agent")
                return source / f"rpmbuild/RPMS/x86_64/ablecube-{version}-1.x86_64.rpm"

            legacy = build("1.0")
            install_root = root / "installed"
            install_root.mkdir()
            rpm = ["rpm", "--dbpath", str(root / "rpmdb")]
            run([*rpm, "--initdb"])
            live = install_root / PLUGIN

            def upgrade(package):
                run([*rpm, "-U", "--nodeps", "--noscripts", "--ignorearch", "--relocate",
                     f"/usr/share/cockpit/ablestack={live}", str(package)])

            upgrade(legacy)
            configs = [path for path in (live / "tools/properties").glob("*.json")
                       if path.name not in ("defaults.json", "missing.json")]
            for config in configs:
                config.write_text('{"production": true}\n')
            (live / "tools/properties/missing.json").unlink()
            state = live / "tools/vmconfig/ccvm/id_rsa"
            state.parent.mkdir()
            state.write_text("runtime state\n")
            state.chmod(0o600)
            registration = live / "tools/properties/cube2.cube-agent.json"
            registration.write_text('{"private_registration":true}\n')
            registration.chmod(0o600)
            # Change defaults to force .rpmnew, and add a newly introduced setting.
            spec_path.write_text(spec)
            (source / "tools/properties/new.json").write_text('{"new": true}\n')
            for version in ("2.0", "3.0"):
                with self.subTest(version=version):
                    new_default = '{"new_default": "' + version + '"}\n'
                    for config in (source / "tools/properties").glob("*.json"):
                        if config.name != "new.json":
                            config.write_text(new_default)
                    (source / "index.js").write_text(f"code {version}\n")
                    package = build(version)
                    flags = run(["rpm", "-qp", "--qf", "[%{FILENAMES}\\t%{FILEFLAGS}\\n]",
                                 str(package)]).stdout
                    for line in flags.splitlines():
                        name, value = line.split("\t")
                        if "/tools/properties/" in name:
                            self.assertEqual(int(value) & 17, 17)  # CONFIG | NOREPLACE
                    upgrade(package)
                    for config in configs:
                        self.assertEqual(config.read_text(), '{"production": true}\n')
                        self.assertEqual(Path(str(config) + ".rpmnew").read_text(), new_default)
                    for name in ("defaults.json", "missing.json"):
                        self.assertEqual((live / "tools/properties" / name).read_text(), new_default)
                    self.assertEqual((live / "index.js").read_text(), f"code {version}\n")
                    self.assertEqual((live / "tools/properties/new.json").read_text(),
                                     '{"new": true}\n')
                    self.assertEqual(state.read_text(), "runtime state\n")
                    self.assertEqual(stat.S_IMODE(state.stat().st_mode), 0o600)
                    self.assertEqual(registration.read_text(), '{"private_registration":true}\n')
                    self.assertEqual(stat.S_IMODE(registration.stat().st_mode), 0o600)
                    for script in ("shell/host/ipcorrector", "shell/host/bootstrap.sh",
                                   "python/helper.py", "tools/makerpm/ablestack.sh"):
                        self.assertEqual(stat.S_IMODE((live / script).stat().st_mode), 0o755)


if __name__ == "__main__":
    unittest.main()
