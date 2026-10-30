"""Check VM identity seeding without running cloud-init, RPM, libvirt, or systemctl."""
import ast
import base64
import json
import os
from pathlib import Path
import platform
import shlex
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import yaml

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools/node-agent"))
import config
import cluster_enrollment
import node_setup
import provision


class CloudInitEnrollmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ablestack-vm-seed-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = self.root / "scvm1"
        self.bundle.mkdir()
        (self.bundle / "agent.json").write_text('{"enabled":true,"node_id":"scvm1","listen":"192.0.2.21"}')
        for name in ("ca.crt", "node.crt", "node.key", "ablecube-agent.rpm"):
            (self.bundle / name).write_bytes(("unique-scvm1-" + name).encode())
        self.data = self.root / "user-data"
        self.data.write_text(yaml.safe_dump({"runcmd": [["existing-bootstrap"]], "write_files": []}))
        self.profile = {"clusterConfig": {"type": "ablestack-hci", "hosts": [
            {"index": "1", "hostname": "cube1", "ablecube": "192.0.2.11", "scvmMngt": "192.0.2.21"}],
            "ccvm": {"ip": "192.0.2.31"}}}
        self.plugin = self.root / "plugin"
        properties = self.plugin / "tools/properties"
        properties.mkdir(parents=True)
        (properties / "cluster.json").write_text(json.dumps(self.profile))
        tree = ast.parse((REPO / "tools/cloudinit/gencloudinit.py").read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "attachNodeAgent")
        namespace = {"sys": sys, "json": json, "yaml": yaml, "base64": base64, "tmpdir": str(self.root), "pluginpath": str(self.plugin)}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "gencloudinit.py", "exec"), namespace)
        self.attach = namespace["attachNodeAgent"]

    def test_unique_identity_and_agent_are_seeded_before_existing_bootstrap(self):
        with patch.object(config, "load_config", return_value={"bootstrap_bundles": {"scvm1": str(self.bundle)}}):
            self.attach("scvm1", "192.0.2.21", "enp1s0")
        data = yaml.safe_load(self.data.read_text())
        files = {Path(item["path"]).name: item for item in data["write_files"]}
        self.assertEqual(set(files), {"agent.json", "ca.crt", "node.crt", "node.key", "ablecube-agent.rpm",
                                      "install.json", "bootstrap-vm.sh", "cluster.json", "scvm1.cube-agent.json"})
        self.assertEqual(base64.b64decode(files["node.key"]["content"]), b"unique-scvm1-node.key")
        self.assertTrue(all(item["owner"] == "root:root" and item["permissions"] == ("0700" if name == "bootstrap-vm.sh" else "0600")
                            for name, item in files.items()))
        self.assertEqual(data["runcmd"][-1], ["existing-bootstrap"])
        staging = "/var/lib/ablestack/cube-agent/enrollment/scvm1"
        self.assertTrue(all(item["path"].startswith(staging + "/") for name, item in files.items()
                            if name not in ("cluster.json", "scvm1.cube-agent.json")))
        self.assertEqual(data["bootcmd"][0], ["install", "-d", "-m", "0700",
                         "/var/lib/ablestack/cube-agent", "/var/lib/ablestack/cube-agent/enrollment", staging])
        self.assertEqual(data["runcmd"][:2], ["set -eu", ["/bin/sh", staging + "/bootstrap-vm.sh", staging]])
        policy = json.loads(base64.b64decode(files["install.json"]["content"]))
        self.assertEqual(policy["management_ip"], "192.0.2.21")
        self.assertTrue(policy["manage_firewall"])
        self.assertIsNone(policy["management_interface"], "NIC rename must not make the VM's management IP invalid")
        registration = json.loads(base64.b64decode(files["scvm1.cube-agent.json"]["content"]))
        self.assertEqual(set(registration["bundles"]), {"scvm1"})
        self.assertNotIn("ca.key", registration["bundles"]["scvm1"])

    def test_missing_enrollment_does_not_reuse_another_vm_identity(self):
        before = self.data.read_bytes()
        with patch.object(config, "load_config", return_value={"bootstrap_bundles": {"scvm1": str(self.bundle)}}):
            with self.assertRaisesRegex(ValueError, "unique"):
                self.attach("scvm2", "192.0.2.22")
        self.assertEqual(self.data.read_bytes(), before)

    def test_wrong_management_ip_is_rejected_before_writing_seed(self):
        before = self.data.read_bytes()
        with patch.object(config, "load_config", return_value={"bootstrap_bundles": {"scvm1": str(self.bundle)}}):
            with self.assertRaisesRegex(ValueError, "management IP"):
                self.attach("scvm1", "192.0.2.99")
        self.assertEqual(self.data.read_bytes(), before)

    def test_host_upgrade_uses_current_packaged_agent_without_changing_vm_keys(self):
        current = self.root / "current-agent.rpm"
        current.write_bytes(b"new-agent-package")
        with patch.object(config, "load_config", return_value={"bootstrap_bundles": {"scvm1": str(self.bundle)}}), \
             patch.object(cluster_enrollment, "VM_RPM", current):
            self.attach("scvm1", "192.0.2.21")
        files = {Path(item["path"]).name: item for item in yaml.safe_load(self.data.read_text())["write_files"]}
        self.assertEqual(base64.b64decode(files["ablecube-agent.rpm"]["content"]), b"new-agent-package")
        self.assertEqual(base64.b64decode(files["node.key"]["content"]), b"unique-scvm1-node.key")

    def test_real_scvm_template_never_seeds_world_writable_cluster_json(self):
        tree = ast.parse((REPO / "tools/cloudinit/gencloudinit.py").read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "scvmGen")
        namespace = {"json": json, "yaml": yaml, "base64": base64, "tmpdir": str(self.root),
                     "pluginpath": str(REPO), "os_type": "ablestack-hci", "createReturn": lambda **kwargs: json.dumps(kwargs)}
        (self.root / "network-config.mgmt").write_text(yaml.safe_dump({"network": {"version": 1, "config": []}}))
        exec(compile(ast.Module(body=[function], type_ignores=[]), "gencloudinit.py", "exec"), namespace)
        namespace["scvmGen"](pn_nic="eth1", pn_ip="198.51.100.11", cn_nic="eth2", cn_ip="203.0.113.11")
        entries = [item for item in yaml.safe_load(self.data.read_text())["write_files"]
                   if item["path"].endswith("/tools/properties/cluster.json")]
        self.assertTrue(entries)
        self.assertTrue(all(item["permissions"] == "0600" for item in entries))

    def role_seed(self, vm, cluster_type="ablestack-hci"):
        self.data.write_text(yaml.safe_dump({"runcmd": [["existing-bootstrap"]], "write_files": []}))
        (self.root / "network-config.mgmt").write_text(yaml.safe_dump({"network": {"version": 1, "config": []}}))
        tree = ast.parse((REPO / "tools/cloudinit/gencloudinit.py").read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == vm + "Gen")
        namespace = {"json": json, "yaml": yaml, "base64": base64, "tmpdir": str(self.root),
                     "pluginpath": str(REPO), "os_type": cluster_type, "createReturn": lambda **kwargs: json.dumps(kwargs)}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "gencloudinit.py", "exec"), namespace)
        if vm == "scvm":
            namespace["scvmGen"](pn_nic="eth1", pn_ip="198.51.100.11", cn_nic="eth2", cn_ip="203.0.113.11")
            hostname, address, bundle = "scvm1", "192.0.2.21", self.bundle
        else:
            namespace["ccvmGen"](sn_nic=None, sn_ip=None, sn_prefix=None, sn_gw=None, sn_dns=None)
            hostname, address, bundle = "ccvm", "192.0.2.31", self.root / "ccvm"
            bundle.mkdir()
            (bundle / "agent.json").write_text(json.dumps({"enabled": True, "node_id": hostname, "listen": address}))
            for name in ("ca.crt", "node.crt", "node.key", "ablecube-agent.rpm"):
                (bundle / name).write_bytes(("unique-ccvm-" + name).encode())
        with patch.object(config, "load_config", return_value={"bootstrap_bundles": {hostname: str(bundle)}}):
            self.attach(hostname, address, "enp0s20")
        return yaml.safe_load(self.data.read_text())

    def test_scvm_enables_cockpit_before_nic_rename_reboot_for_all_storage_types(self):
        for cluster_type in ("ablestack-hci", "ablestack-hci-filesystem", "powerflex"):
            with self.subTest(cluster_type=cluster_type):
                seed = self.role_seed("scvm", cluster_type)
                commands = seed["runcmd"]
                self.assertEqual(commands[1], ["/bin/sh", "/var/lib/ablestack/cube-agent/enrollment/scvm1/bootstrap-vm.sh",
                                               "/var/lib/ablestack/cube-agent/enrollment/scvm1"])
                socket = ["/usr/bin/systemctl", "enable", "--now", "cockpit.socket"]
                reboot = ["/usr/bin/bash", "/usr/local/sbin/sortEth.sh"]
                self.assertLess(commands.index(socket), commands.index(reboot))
                self.assertEqual(commands.count(socket), 1)
                self.assertFalse(any(isinstance(command, list) and "cockpit.service" in command
                                     for command in seed.get("bootcmd", []) + commands))

    def test_ccvm_enrolls_agent_but_disables_cockpit_and_stops_its_web_service(self):
        seed = self.role_seed("ccvm")
        commands = seed["runcmd"]
        self.assertEqual(commands[1], ["/bin/sh", "/var/lib/ablestack/cube-agent/enrollment/ccvm/bootstrap-vm.sh",
                                       "/var/lib/ablestack/cube-agent/enrollment/ccvm"])
        self.assertIn(["/usr/bin/systemctl", "disable", "--now", "cockpit.socket"], commands)
        self.assertIn(["/usr/bin/systemctl", "stop", "cockpit.service"], commands)
        self.assertFalse(any(isinstance(command, list) and "enable" in command and
                             any(str(part).startswith("cockpit.") for part in command)
                             for command in seed.get("bootcmd", []) + commands))
        self.assertEqual(commands[-1], ["existing-bootstrap"])

    def test_real_certificates_and_seeded_profile_complete_scvm_and_ccvm_registration(self):
        env = dict(os.environ)
        openssl_dir = Path("/opt/homebrew/opt/openssl@1.1/bin")
        if platform.system() == "Darwin" and openssl_dir.is_dir():
            env["PATH"] = str(openssl_dir) + ":" + env.get("PATH", "")
        inventory = self.root / "inventory.json"
        inventory.write_text(json.dumps(cluster_enrollment.cluster_layout(self.profile)["inventory"]))
        umask = os.umask(0o077)
        try:
            with patch.dict(os.environ, env, clear=True):
                provision.init_ca(self.root / "ca")
                provision.issue_bundles(self.root / "ca", inventory, self.root / "real-bundles")
                for name, address in (("scvm1", "192.0.2.21"), ("ccvm", "192.0.2.31")):
                    bundle = self.root / "real-bundles" / name
                    (bundle / "ablecube-agent.rpm").write_bytes(b"agent-rpm")
                    # Reproduce the reported legacy 0777 entry, then require the final
                    # seed to contain exactly one protected cluster profile.
                    self.data.write_text(yaml.safe_dump({"write_files": [{"path": str(node_setup.CLUSTER_JSON),
                                              "permissions": "0777", "content": "old"}]}))
                    with patch.object(config, "load_config", return_value={"bootstrap_bundles": {name: str(bundle)}}):
                        self.attach(name, address, "enp0s20")
                    data = yaml.safe_load(self.data.read_text())
                    self.assertEqual(sum(item["path"] == str(node_setup.CLUSTER_JSON) for item in data["write_files"]), 1)
                    guest = self.root / ("guest-" + name)
                    for item in data["write_files"]:
                        path = guest / item["path"].lstrip("/")
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(base64.b64decode(item["content"]))
                        path.chmod(int(item["permissions"], 8))
                    profile_path = guest / str(node_setup.CLUSTER_JSON).lstrip("/")
                    profile = node_setup.read_json(profile_path)
                    stage = guest / "var/lib/ablestack/cube-agent/enrollment" / name
                    result = node_setup.initialize(node_setup.read_json(stage / "install.json"), bundle=stage,
                         config_dir=guest / "etc/ablestack/node-agent", state_dir=guest / "var/lib/ablestack/cube-agent",
                         addresses=[{"interface": "renamed-mgmt", "address": address}], hostname=name, cluster=profile)
                    self.assertEqual(result["status"], "ready")
                    settings = node_setup.read_json(guest / "etc/ablestack/node-agent/agent.json")
                    self.assertTrue(settings["enabled"])
                    self.assertEqual(settings["node_id"], name)
                    for filename in ("ca.crt", "node.crt", "node.key"):
                        self.assertTrue((guest / "etc/ablestack/node-agent" / filename).is_file())
                    registration_path = profile_path.with_name(name + ".cube-agent.json")
                    self.assertEqual(stat.S_IMODE(registration_path.stat().st_mode), 0o600)
                    self.assertEqual(set(node_setup.read_json(registration_path)["bundles"]), {name})
        finally:
            os.umask(umask)


class VmBootstrapCommandTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="cube-vm-firstboot-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.bundle = self.root / "bundle"
        self.bundle.mkdir()
        (self.bundle / "install.json").write_text('{"mode":"member"}')
        (self.bundle / "ablecube-agent.rpm").write_bytes(b"fixture")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "commands.log"
        self.env = dict(os.environ, PATH=str(self.bin) + ":" + os.environ.get("PATH", ""), TEST_LOG=str(self.log))
        self.stub("aspkg", 'printf "package\\n" >> "$TEST_LOG"\nexit "${TEST_PACKAGE_EXIT:-0}"\n')
        self.stub("systemctl", 'printf "systemctl %s\\n" "$*" >> "$TEST_LOG"\n')
        setup = self.stub("node-setup", 'printf "node-setup %s\\n" "$*" >> "$TEST_LOG"\nexit "${TEST_SETUP_EXIT:-0}"\n')
        source = (REPO / "tools/node-agent/bootstrap-vm.sh").read_text()
        source = source.replace("config_dir=/etc/ablestack/node-agent", "config_dir=" + shlex.quote(str(self.root / "config")))
        source = source.replace("/usr/libexec/ablestack/node-setup", shlex.quote(str(setup)))
        self.script = self.root / "bootstrap-vm.sh"
        self.script.write_text(source)

    def stub(self, name, text):
        path = self.bin / name
        path.write_text("#!/bin/sh\nset -eu\n" + text)
        path.chmod(0o755)
        return path

    def run_bootstrap(self):
        return subprocess.run(["/bin/sh", str(self.script), str(self.bundle)], env=self.env,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)

    def test_installs_policy_and_enables_retry_units_before_enrolling(self):
        self.assertEqual(self.run_bootstrap().returncode, 0)
        calls = self.log.read_text()
        self.assertIn("enable cube-agent-setup.service cube-agent-setup.path cube-agent.service", calls)
        self.assertIn("--restart", calls)
        self.assertIn("is-active --quiet cube-agent.service", calls)
        self.assertEqual(stat.S_IMODE((self.root / "config/install.json").stat().st_mode), 0o600)

    def test_package_failure_cannot_be_hidden_by_later_successful_commands(self):
        self.env["TEST_PACKAGE_EXIT"] = "7"
        self.assertEqual(self.run_bootstrap().returncode, 7)
        self.assertEqual(self.log.read_text(), "package\n")

    def test_certificate_failure_is_not_reported_as_success(self):
        self.env["TEST_SETUP_EXIT"] = "1"
        self.assertEqual(self.run_bootstrap().returncode, 1)
        self.assertNotIn("is-active", self.log.read_text())

    def test_pending_network_preserves_policy_and_queues_setup_after_nic_rename(self):
        self.env["TEST_SETUP_EXIT"] = "75"
        self.assertEqual(self.run_bootstrap().returncode, 0)
        self.assertIn("systemctl --no-block start cube-agent-setup.service", self.log.read_text())
        self.assertNotIn("is-active", self.log.read_text())

if __name__ == "__main__":
    unittest.main()
