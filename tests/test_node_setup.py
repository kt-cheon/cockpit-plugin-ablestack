"""Installation enrollment checks using real certificates without changing host networking/services."""
import json
import os
from pathlib import Path
import platform
import shutil
import ssl
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools/node-agent"))
import node_setup as setup
import provision


class ManagementAddressTests(unittest.TestCase):
    def setUp(self):
        self.addresses = [{"interface": "mgmt0", "address": "192.0.2.11"},
                          {"interface": "storage0", "address": "198.51.100.11"}]

    def test_installer_interface_selects_its_active_address(self):
        self.assertEqual(setup.select_management_ip(self.addresses, interface="mgmt0"), "192.0.2.11")

    def test_inactive_installer_address_waits_instead_of_binding_another_interface(self):
        with self.assertRaises(setup.Pending):
            setup.select_management_ip(self.addresses, requested="192.0.2.99")
        with self.assertRaises(setup.Pending):
            setup.select_management_ip(self.addresses, interface="storage0", requested="192.0.2.11")

    def test_cluster_host_mapping_and_management_subnet(self):
        cluster = {"clusterConfig": {"hosts": [{"hostname": "cube1", "ablecube": "192.0.2.11",
                                               "index": 1, "scvmMngt": "192.0.2.21"}]}}
        self.assertEqual(setup.select_management_ip(self.addresses, cluster=cluster, hostname="cube1.example"),
                         "192.0.2.11")
        vm = [{"interface": "eth0", "address": "192.0.2.21"}, self.addresses[1]]
        self.assertEqual(setup.select_management_ip(vm, cluster=cluster, hostname="scvm1"), "192.0.2.21")
        subnet = {"clusterConfig": {"mngtNic": {"cidr": "192.0.2.0/24"}}}
        self.assertEqual(setup.select_management_ip(self.addresses, cluster=subnet), "192.0.2.11")

    def test_multiple_interfaces_without_management_selection_wait(self):
        with self.assertRaisesRegex(setup.Pending, "Multiple active IPs"):
            setup.select_management_ip(self.addresses)
        with self.assertRaises(setup.Pending):
            setup.select_management_ip([])

    def test_single_dual_stack_interface_uses_ipv4(self):
        addresses = [self.addresses[0], {"interface": "mgmt0", "address": "2001:db8::11"}]
        self.assertEqual(setup.select_management_ip(addresses), "192.0.2.11")

    def test_network_discovery_excludes_down_and_unusable_addresses(self):
        data = [{"ifname": "mgmt0", "flags": ["UP"], "addr_info": [
                    {"scope": "global", "local": "192.0.2.11"},
                    {"scope": "link", "local": "fe80::1"},
                    {"scope": "global", "local": "2001:db8::1", "tentative": True}]},
                {"ifname": "storage0", "flags": [], "addr_info": [
                    {"scope": "global", "local": "198.51.100.11"}]}]
        with patch.object(setup.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps(data))) as run:
            self.assertEqual(setup.network_addresses(), [self.addresses[0]])
        self.assertEqual(run.call_args.args[0], ["ip", "-j", "address", "show"])


class NodeSetupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="cube-setup-certificates-")
        cls.addClassCleanup(cls.temp.cleanup)
        cls.fixtures = Path(cls.temp.name)
        env = dict(os.environ)
        openssl_dir = Path("/opt/homebrew/opt/openssl@1.1/bin")
        if platform.system() == "Darwin" and openssl_dir.is_dir():
            env["PATH"] = str(openssl_dir) + ":" + env.get("PATH", "")
        cls.env = env
        cls.nodes = [{"id": "cube1", "address": "192.0.2.11", "aliases": ["first-host"]},
                     {"id": "cube2", "address": "192.0.2.12"}]
        inventory = cls.fixtures / "nodes.json"
        inventory.write_text(json.dumps({"nodes": cls.nodes}))
        umask = os.umask(0o077)
        try:
            with patch.dict(os.environ, env, clear=True):
                provision.init_ca(cls.fixtures / "ca")
                provision.issue_bundles(cls.fixtures / "ca", inventory, cls.fixtures / "bundles")
        finally:
            os.umask(umask)

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="cube-setup-install-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.config = self.root / "etc"
        self.state = self.root / "var"
        self.settings = {"mode": "member", "management_interface": "mgmt0"}
        self.addresses = [{"interface": "mgmt0", "address": "192.0.2.11"},
                          {"interface": "storage0", "address": "198.51.100.11"}]
        patcher = patch.dict(os.environ, self.env, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def initialize(self, **kwargs):
        values = dict(config_dir=self.config, state_dir=self.state, addresses=self.addresses, hostname="first-host")
        values.update(kwargs)
        return setup.initialize(self.settings, **values)

    def stage(self, name="cube1"):
        bundle = self.state / "enrollment" / name
        shutil.copytree(self.fixtures / "bundles" / name, bundle)
        return bundle

    def test_member_waits_for_common_ca_bundle_without_creating_a_private_ca(self):
        with self.assertRaisesRegex(setup.Pending, "common-CA bundle"):
            self.initialize()
        self.assertFalse((self.state / "authority").exists())
        self.assertFalse((self.config / "agent.json").exists())

    def test_member_selects_own_bundle_by_active_ip_and_preserves_operator_settings(self):
        self.stage("cube1")
        self.stage("cube2")
        self.config.mkdir()
        (self.config / "agent.json").write_text(json.dumps({"enabled": False, "max_command_timeout": 42,
                                                          "bootstrap_bundles": {"scvm1": "/var/lib/custom/scvm1"}}))
        result = self.initialize()
        self.assertEqual(result, {"status": "ready", "changed": True, "node_id": "cube1", "management_ip": "192.0.2.11"})
        cfg = setup.read_json(self.config / "agent.json")
        self.assertEqual(cfg["max_command_timeout"], 42)
        self.assertEqual(cfg["bootstrap_bundles"]["scvm1"], "/var/lib/custom/scvm1")
        self.assertEqual(stat.S_IMODE(Path(cfg["tls"]["key"]).stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.config.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o700)
        self.assertEqual(provision.fingerprint(self.config / "ca.crt"), provision.fingerprint(self.fixtures / "ca/ca.crt"))
        self.assertFalse((self.state / "authority").exists())

    def test_normal_boot_preserves_identity_and_configuration_and_repairs_compatibility_links(self):
        self.stage()
        self.initialize()
        config_file = self.config / "agent.json"
        key = Path(setup.read_json(config_file)["tls"]["key"])
        before = (config_file.read_bytes(), key.read_bytes(), config_file.stat().st_mtime_ns, key.stat().st_mtime_ns)
        (self.config / "node.key").unlink()
        result = self.initialize()
        self.assertFalse(result["changed"])
        self.assertEqual(before, (config_file.read_bytes(), key.read_bytes(), config_file.stat().st_mtime_ns, key.stat().st_mtime_ns))
        self.assertEqual((self.config / "node.key").resolve(), key.resolve())

    def test_changed_ip_waits_for_reenrollment_without_replacing_identity(self):
        self.stage()
        self.initialize()
        before = (self.config / "agent.json").read_bytes()
        with self.assertRaises(setup.Pending):
            self.initialize(addresses=[{"interface": "mgmt0", "address": "192.0.2.99"}])
        self.assertEqual((self.config / "agent.json").read_bytes(), before)

    def test_inactive_explicit_bundle_is_rejected_before_installation(self):
        with self.assertRaises(setup.Pending):
            self.initialize(bundle=self.fixtures / "bundles/cube2")
        self.assertFalse((self.config / "agent.json").exists())

    def test_wrong_san_key_pair_or_key_permissions_never_replace_existing_identity(self):
        bundle = self.stage()
        self.initialize()
        before = (self.config / "agent.json").read_bytes()
        shutil.copyfile(self.fixtures / "bundles/cube2/node.key", bundle / "node.key")
        with self.assertRaises(ssl.SSLError):
            self.initialize(bundle=bundle)
        shutil.copyfile(self.fixtures / "bundles/cube1/node.key", bundle / "node.key")
        bundle.joinpath("node.key").chmod(0o644)
        with self.assertRaises(PermissionError):
            self.initialize(bundle=bundle)
        bundle.joinpath("node.key").chmod(0o600)
        cfg = setup.read_json(bundle / "agent.json")
        cfg["listen"] = "192.0.2.99"
        (bundle / "agent.json").write_text(json.dumps(cfg))
        with self.assertRaises(RuntimeError):
            self.initialize(bundle=bundle, addresses=[{"interface": "mgmt0", "address": "192.0.2.99"}])
        self.assertEqual((self.config / "agent.json").read_bytes(), before)

    def test_multiple_bundles_for_same_address_are_not_silently_selected(self):
        bundle = self.stage()
        shutil.copytree(bundle, bundle.parent / "duplicate")
        with self.assertRaisesRegex(ValueError, "Multiple enrollment"):
            self.initialize()

    def test_designated_authority_generates_common_ca_and_all_inventory_bundles_once(self):
        inventory = self.root / "nodes.json"
        # The first node's saved inventory address may precede its installer network change.
        nodes = [dict(node) for node in self.nodes]
        nodes[0]["address"] = "192.0.2.100"
        inventory.write_text(json.dumps({"nodes": nodes}))
        rpm = self.root / "ablecube-agent.rpm"
        rpm.write_bytes(b"installer-provided-rpm")
        self.settings.update(mode="authority", inventory=str(inventory), agent_rpm=str(rpm))
        result = self.initialize()
        self.assertEqual(result["node_id"], "cube1")
        ca = self.state / "authority/ca.key"
        before = (ca.read_bytes(), ca.stat().st_mtime_ns)
        self.assertEqual(stat.S_IMODE(ca.stat().st_mode), 0o600)
        for name in ("cube1", "cube2"):
            bundle = self.state / "bundles" / name
            self.assertFalse((bundle / "ca.key").exists())
            self.assertEqual((bundle / "ablecube-agent.rpm").read_bytes(), rpm.read_bytes())
        self.assertEqual(setup.read_json(self.state / "bundles/cube1/agent.json")["listen"], "192.0.2.11")
        self.assertFalse(self.initialize()["changed"])
        self.assertEqual(before, (ca.read_bytes(), ca.stat().st_mtime_ns))
        # Another host consumes its own bundle, never the issuer private key.
        member_config, member_state = self.root / "member-etc", self.root / "member-var"
        member = setup.initialize({"enrollment_dir": str(self.state / "bundles")}, config_dir=member_config,
                                  state_dir=member_state, addresses=[{"interface": "eth0", "address": "192.0.2.12"}])
        self.assertEqual(member["node_id"], "cube2")
        self.assertEqual(provision.fingerprint(member_config / "ca.crt"), provision.fingerprint(self.config / "ca.crt"))

    def test_localhost_uses_unique_installed_machine_id(self):
        machine_id = self.root / "machine-id"
        machine_id.write_text("0123456789abcdef0123456789abcdef\n")
        self.assertEqual(setup.node_id(hostname="localhost", machine_id_path=machine_id), "node-0123456789abcdef")
        machine_id.write_text("0" * 32)
        with self.assertRaises(setup.Pending):
            setup.node_id(hostname="localhost", machine_id_path=machine_id)

    def test_automatic_pending_initialization_reports_status_without_starting_service(self):
        with patch.object(setup, "CONFIG_DIR", self.config), patch.object(setup, "STATE_DIR", self.state), \
             patch.object(setup, "CLUSTER_JSON", self.root / "missing-cluster.json"), \
             patch.object(setup.os, "geteuid", return_value=0), patch.object(setup, "read_json", return_value={}), \
             patch.object(setup, "private_directory", side_effect=lambda p: Path(p).mkdir(parents=True, exist_ok=True)), \
             patch.object(setup, "initialize", side_effect=setup.Pending("Network is not ready")), \
             patch.object(setup, "start_service") as start:
            self.assertEqual(setup.main(["--auto", "--start"]), 0)
            self.assertEqual(setup.main(["--start"]), 75)
            start.assert_not_called()
        self.assertEqual(json.loads((self.state / "setup-status.json").read_text())["status"], "pending")

    def test_systemd_start_from_setup_unit_is_nonblocking(self):
        with patch.object(setup.subprocess, "run") as run:
            setup.start_service(nonblocking=True)
        self.assertEqual(run.call_args_list[-1].args[0], ["systemctl", "--no-block", "start", "cube-agent.service"])


if __name__ == "__main__":
    unittest.main()
