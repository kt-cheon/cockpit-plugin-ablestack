"""Exercise the real cluster-preparation enrollment flow without host/VM network access."""
import copy
import json
import os
from pathlib import Path
import platform
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools/node-agent"))
import cluster_enrollment as enrollment
import node_setup
import provision


def profile(kind="ablestack-hci"):
    return {"clusterConfig": {"type": kind, "hosts": [
        {"index": str(index), "hostname": "cube" + str(index), "ablecube": "192.0.2." + str(10 + index),
         "ablecubePn": "198.51.100." + str(index), "scvmMngt": "192.0.2." + str(20 + index),
         "scvm": "198.51.100." + str(10 + index), "scvmCn": "203.0.113." + str(10 + index)}
        for index in range(1, 4)], "ccvm": {"ip": "192.0.2.31"},
        "pcsCluster": {"hostname" + str(i): "198.51.100." + str(i) for i in range(1, 4)}}}


class ClusterLayoutTests(unittest.TestCase):
    def test_hci_has_one_scvm_per_host_and_one_mobile_ccvm(self):
        layout = enrollment.cluster_layout(profile())
        nodes = {node["id"]: node for node in layout["inventory"]["nodes"]}
        self.assertEqual(len(nodes), 7)
        for index in range(1, 4):
            host, vm = "cube" + str(index), "scvm" + str(index)
            self.assertEqual(nodes[host]["target_aliases"]["scvm"], vm)
            self.assertEqual(nodes[vm]["target_aliases"]["ablecube"], host)
            self.assertEqual(enrollment.owned_bundles(layout, host), [host, vm, "ccvm"])
        self.assertEqual(nodes["ccvm"]["address"], "192.0.2.31")
        self.assertEqual(nodes["ccvm"]["target_aliases"], {})

    def test_ablestack_vm_excludes_scvm_even_when_profile_contains_stale_fields(self):
        layout = enrollment.cluster_layout(profile("ablestack-vm"))
        self.assertEqual({item["id"] for item in layout["inventory"]["nodes"]}, {"cube1", "cube2", "cube3", "ccvm"})
        self.assertEqual(layout["storage"], {})
        self.assertEqual(enrollment.owned_bundles(layout, "cube2"), ["cube2", "ccvm"])

    def test_ccvm_bundle_is_only_assigned_to_pcs_candidates(self):
        cluster = profile()
        fourth = dict(cluster["clusterConfig"]["hosts"][-1], index="4", hostname="cube4", ablecube="192.0.2.14",
                      ablecubePn="198.51.100.4", scvmMngt="192.0.2.24", scvm="198.51.100.14", scvmCn="203.0.113.14")
        cluster["clusterConfig"]["hosts"].append(fourth)
        self.assertEqual(enrollment.owned_bundles(enrollment.cluster_layout(cluster), "cube4"), ["cube4", "scvm4"])

    def test_duplicate_management_ips_or_host_indexes_are_rejected(self):
        for field, value in (("ablecube", "192.0.2.11"), ("index", "1")):
            cluster = profile()
            cluster["clusterConfig"]["hosts"][1][field] = value
            with self.assertRaises(ValueError):
                enrollment.cluster_layout(cluster)


class ClusterEnrollmentTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="cube-cluster-enrollment-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.rpm = self.root / "ablecube-agent.rpm"
        self.rpm.write_bytes(b"matching-agent-rpm")
        env = dict(os.environ)
        openssl_dir = Path("/opt/homebrew/opt/openssl@1.1/bin")
        if platform.system() == "Darwin" and openssl_dir.is_dir():
            env["PATH"] = str(openssl_dir) + ":" + env.get("PATH", "")
        patcher = patch.dict(os.environ, env, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def prepare(self, host="cube1", cluster=None, **kwargs):
        properties = self.root / host / "properties"
        properties.mkdir(parents=True, exist_ok=True)
        if not (properties / "cluster.json").exists():
            (properties / "cluster.json").write_text(json.dumps(cluster or profile()))
        arguments = dict(config_dir=self.root / host / "etc", state_dir=self.root / host / "var", hostname=host,
                         addresses=[{"interface": "bridge-mgmt", "address": "192.0.2." + str(10 + int(host[-1]))},
                                    {"interface": "storage0", "address": "198.51.100." + host[-1]}], rpm=self.rpm,
                         properties_dir=properties)
        arguments.update(kwargs)
        return enrollment.prepare_cluster(cluster or profile(), **arguments)

    def export(self, host):
        return enrollment.export_registration(host, self.root / "cube1/var", self.root / "cube1/properties")

    def test_same_kickstart_requires_first_host_profile_or_registration_before_issuing_credentials(self):
        with self.assertRaisesRegex(ValueError, "registration file"):
            self.prepare("cube2")
        self.assertFalse((self.root / "cube2/var/authority").exists())
        self.assertFalse((self.root / "cube2/etc/agent.json").exists())

    def test_network_not_ready_is_rejected_before_ca_creation(self):
        with self.assertRaisesRegex(ValueError, "bridge management IP"):
            self.prepare(allow_create=True, addresses=[{"interface": "old-nic", "address": "192.0.2.99"}])
        self.assertFalse((self.root / "cube1/var/authority").exists())

    def test_first_host_enrolls_locally_and_issues_without_contacting_other_hosts_or_vms(self):
        result = self.prepare(allow_create=True)
        self.assertEqual(result["exports"], ["cube1", "cube2", "cube3"])
        cfg = node_setup.read_json(self.root / "cube1/etc/agent.json")
        self.assertTrue(cfg["enabled"])
        self.assertEqual(cfg["listen"], "192.0.2.11")
        self.assertEqual(len(cfg["peers"]), 7)
        self.assertTrue(node_setup.read_json(self.root / "cube1/etc/install.json")["manage_firewall"])
        self.assertEqual(stat.S_IMODE((self.root / "cube1/var/authority/ca.key").stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((self.root / "cube1/var").stat().st_mode), 0o700)
        self.assertEqual((self.root / "cube1/var/bundles/scvm1/ablecube-agent.rpm").read_bytes(), self.rpm.read_bytes())

    def test_per_host_export_excludes_ca_key_other_hosts_and_other_scvms(self):
        self.prepare(allow_create=True)
        registration = self.export("cube2")
        self.assertEqual(set(registration["bundles"]), {"cube2", "scvm2", "ccvm"})
        for contents in registration["bundles"].values():
            self.assertEqual(set(contents), {"agent.json", "ca.crt", "node.crt", "node.key"})
        result = self.prepare("cube2", registration=registration)
        self.assertEqual(result["node_id"], "cube2")
        self.assertFalse((self.root / "cube2/var/authority").exists())
        self.assertEqual(result["exports"], [])
        self.assertEqual(provision.fingerprint(self.root / "cube1/etc/ca.crt"), provision.fingerprint(self.root / "cube2/etc/ca.crt"))
        self.assertNotEqual((self.root / "cube1/etc/node.key").read_bytes(), (self.root / "cube2/etc/node.key").read_bytes())
        saved = self.root / "cube2/properties/cube2.cube-agent.json"
        self.assertEqual(json.loads(saved.read_text()), registration)
        self.assertEqual(stat.S_IMODE(saved.stat().st_mode), 0o600)

    def test_ccvm_identity_stays_the_same_on_all_pcs_candidates(self):
        self.prepare(allow_create=True)
        for host in ("cube2", "cube3"):
            registration = self.export(host)
            self.prepare(host, registration=registration)
        for host in ("cube2", "cube3"):
            self.assertEqual((self.root / host / "var/bundles/ccvm/node.key").read_bytes(),
                             (self.root / "cube1/var/bundles/ccvm/node.key").read_bytes())
            cfg = node_setup.read_json(self.root / host / "etc/agent.json")
            self.assertEqual(cfg["nodes"]["ccvm"]["url"], "https://192.0.2.31:9445")

    def test_wrong_host_profile_unrelated_bundle_or_bad_certificate_never_enrolls_member(self):
        self.prepare(allow_create=True)
        correct = self.export("cube2")
        wrong_host = copy.deepcopy(correct)
        wrong_host["host"] = "cube3"
        unrelated = copy.deepcopy(correct)
        unrelated["bundles"]["../escape"] = {}
        bad_cert = copy.deepcopy(correct)
        bad_cert["bundles"]["scvm2"]["node.crt"] = "not a certificate"
        wrong_profile = copy.deepcopy(correct)
        wrong_profile["digest"] = "0" * 64
        for registration in (wrong_host, unrelated, bad_cert, wrong_profile):
            with self.assertRaises((ValueError, RuntimeError)):
                self.prepare("cube2", registration=registration)
            self.assertFalse((self.root / "cube2/etc/agent.json").exists())
            self.assertFalse((self.root / "cube2/properties/cube2.cube-agent.json").exists())

    def test_repeated_preparation_preserves_identity_operator_settings_and_ca(self):
        self.prepare(allow_create=True)
        cfg_file = self.root / "cube1/etc/agent.json"
        cfg = node_setup.read_json(cfg_file)
        cfg["max_command_timeout"] = 42
        node_setup.atomic_write(cfg_file, json.dumps(cfg).encode())
        files = [cfg_file, Path(cfg["tls"]["key"]), self.root / "cube1/var/authority/ca.key"]
        before = [(path.read_bytes(), path.stat().st_mtime_ns) for path in files]
        self.prepare(allow_create=True)
        self.assertEqual(before, [(path.read_bytes(), path.stat().st_mtime_ns) for path in files])

    def test_changed_cluster_does_not_create_another_ca(self):
        self.prepare(allow_create=True)
        key = (self.root / "cube1/var/authority/ca.key").read_bytes()
        changed = profile()
        changed["clusterConfig"]["ccvm"]["ip"] = "192.0.2.32"
        with self.assertRaisesRegex(ValueError, "layout changed"):
            self.prepare(cluster=changed, allow_create=True)
        self.assertEqual((self.root / "cube1/var/authority/ca.key").read_bytes(), key)

    def test_ablestack_vm_registration_contains_ccvm_and_no_scvm(self):
        cluster = profile("ablestack-vm")
        self.prepare(cluster=cluster, allow_create=True)
        registration = self.export("cube3")
        self.assertEqual(set(registration["bundles"]), {"cube3", "ccvm"})
        self.prepare("cube3", cluster=cluster, registration=registration)
        self.assertFalse((self.root / "cube3/var/bundles/scvm3").exists())

    def test_missing_vm_rpm_fails_before_issuing_credentials(self):
        with self.assertRaisesRegex(ValueError, "RPM is missing"):
            self.prepare(allow_create=True, rpm=self.root / "missing.rpm")
        self.assertFalse((self.root / "cube1/var/authority").exists())

    def test_registration_json_is_saved_beside_cluster_profile_and_download_reads_it(self):
        self.prepare(allow_create=True)
        properties = self.root / "cube1/properties"
        original_profile = (properties / "cluster.json").read_bytes()
        for host in ("cube1", "cube2", "cube3"):
            path = properties / (host + ".cube-agent.json")
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(path.stat().st_uid, os.geteuid())
            saved = json.loads(path.read_text())
            with patch.object(enrollment, "registration_document", side_effect=AssertionError("must read the saved JSON")):
                self.assertEqual(self.export(host), saved)
        paths = list(properties.glob("*.cube-agent.json"))
        before = [(path.read_bytes(), path.stat().st_mtime_ns) for path in paths]
        self.prepare(allow_create=True)
        self.assertEqual(before, [(path.read_bytes(), path.stat().st_mtime_ns) for path in paths])
        self.assertEqual((properties / "cluster.json").read_bytes(), original_profile)
        self.assertNotIn("PRIVATE KEY", original_profile.decode())

    def test_existing_issuance_backfills_missing_json_without_reissuing_keys(self):
        self.prepare(allow_create=True)
        path = self.root / "cube1/properties/cube2.cube-agent.json"
        expected = json.loads(path.read_text())
        path.unlink()
        key = self.root / "cube1/var/authority/ca.key"
        before = key.read_bytes(), key.stat().st_mtime_ns
        self.assertEqual(self.export("cube2"), expected)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual((key.read_bytes(), key.stat().st_mtime_ns), before)

    def test_download_refuses_world_readable_registration_and_wrong_profile(self):
        self.prepare(allow_create=True)
        path = self.root / "cube1/properties/cube2.cube-agent.json"
        path.chmod(0o644)
        with self.assertRaises(PermissionError):
            self.export("cube2")
        path.chmod(0o600)
        data = json.loads(path.read_text())
        data["digest"] = "0" * 64
        path.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "Stored registration"):
            self.export("cube2")

    def test_symlink_registration_cannot_overwrite_another_file(self):
        self.prepare(allow_create=True)
        path = self.root / "cube1/properties/cube2.cube-agent.json"
        victim = self.root / "unrelated.json"
        victim.write_text('{"keep":true}')
        path.unlink()
        path.symlink_to(victim)
        with self.assertRaises(PermissionError):
            self.prepare(allow_create=True)
        self.assertEqual(victim.read_text(), '{"keep":true}')


if __name__ == "__main__":
    unittest.main()
