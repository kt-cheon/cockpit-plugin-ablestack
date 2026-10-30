"""Verify enrollment firewall scope and retry behavior without modifying any firewall."""
import contextlib
import copy
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools/node-agent"))
import management_firewall as firewall
import node_setup as setup


class ManagementFirewallTests(unittest.TestCase):
    def setUp(self):
        self.config = {"listen": "192.0.2.21", "port": 9445, "nodes": {
            "cube1": {"url": "https://192.0.2.11:9445"},
            "cube2": {"url": "https://192.0.2.12:9445"},
            "cube1-alias": {"url": "https://192.0.2.11:9445"},
            "scvm1": {"url": "https://192.0.2.21:9445"}}}
        self.addresses = [{"interface": "mgmt0", "address": "192.0.2.21"},
                          {"interface": "storage0", "address": "198.51.100.21"}]
        self.calls = []
        self.existing = set()
        self.zone = "public"
        self.state = (0, "running")
        self.add_failure = False

    def fake_run(self, argv, **kwargs):
        self.calls.append(argv)
        self.assertEqual(argv[0], "firewall-cmd")
        self.assertEqual(kwargs["timeout"], 10)
        args = argv[1:]
        status, output, error = 0, "", ""
        if args == ["--state"]:
            status, output = self.state
        elif args == ["--get-zone-of-interface=mgmt0"]:
            status, output = (0, self.zone) if self.zone else (2, "no zone")
        elif args == ["--get-default-zone"]:
            output = "internal"
        elif args[-1].startswith("--query-rich-rule="):
            key = ("--permanent" in args, args[-1].split("=", 1)[1])
            status = 0 if key in self.existing else 1
        elif args[-1].startswith("--add-rich-rule="):
            key = ("--permanent" in args, args[-1].split("=", 1)[1])
            if self.add_failure:
                status, error = 253, "Not authorized"
            else:
                self.existing.add(key)
        else:
            self.fail("Unexpected firewall mutation: " + str(argv))
        return subprocess.CompletedProcess(argv, status, output, error)

    def configure(self):
        with patch.object(firewall.shutil, "which", return_value="/usr/bin/firewall-cmd"), \
             patch.object(firewall.subprocess, "run", side_effect=self.fake_run):
            return firewall.configure(self.config, self.addresses)

    def test_only_peer_to_management_ip_agent_port_is_allowed_and_retries_are_idempotent(self):
        result = self.configure()
        self.assertEqual(result, {"status": "configured", "interface": "mgmt0", "zone": "public", "rules": 2})
        expected = {'rule family="ipv4" source address="{}/32" destination address="192.0.2.21/32" '
                    'port port="9445" protocol="tcp" accept'.format(address)
                    for address in ("192.0.2.11", "192.0.2.12")}
        self.assertEqual(self.existing, {(permanent, rule) for rule in expected for permanent in (False, True)})
        before = len([call for call in self.calls if call[-1].startswith("--add-rich-rule=")])
        self.configure()
        self.assertEqual(len([call for call in self.calls if call[-1].startswith("--add-rich-rule=")]), before)
        self.assertFalse(any("--reload" in call or "--runtime-to-permanent" in call for call in self.calls))

    def test_default_zone_is_used_for_unbound_management_interface(self):
        self.zone = ""
        self.assertEqual(self.configure()["zone"], "internal")
        self.assertTrue(all("--zone=internal" in call for call in self.calls if "rich-rule=" in call[-1]))

    def test_ipv6_rules_use_individual_addresses_and_configured_local_port(self):
        config = {"listen": "2001:db8::21", "port": 10445, "nodes": {
            "cube1": {"url": "https://[2001:db8::11]:9445"},
            "self": {"url": "https://[2001:db8::21]:9445"},
            "ipv4": {"url": "https://192.0.2.11:9445"}}}
        interface, rules = firewall.rule_plan(config, [{"interface": "mgmt6", "address": "2001:db8::21"}])
        self.assertEqual(interface, "mgmt6")
        self.assertEqual(rules, ['rule family="ipv6" source address="2001:db8::11/128" '
                                'destination address="2001:db8::21/128" port port="10445" protocol="tcp" accept'])

    def test_missing_or_duplicate_management_interface_cannot_open_a_different_network(self):
        for addresses in ([], [self.addresses[1]],
                          [self.addresses[0], {"interface": "other0", "address": "192.0.2.21"}]):
            with self.subTest(addresses=addresses), self.assertRaises(ValueError):
                firewall.rule_plan(self.config, addresses)

    def test_invalid_peer_is_rejected_before_any_firewall_command(self):
        for url in ("https://0.0.0.0:9445", "https://127.0.0.1:9445", "http://192.0.2.11:9445",
                    "https://cube1.example:9445", "https://192.0.2.11:9445/api", "https://u:p@192.0.2.11"):
            with self.subTest(url=url):
                self.config["nodes"]["invalid"] = {"url": url}
                with self.assertRaises(ValueError):
                    self.configure()
                self.assertFalse(self.calls)

    def test_disabled_or_unavailable_firewalld_is_reported_without_starting_it(self):
        with patch.object(firewall.shutil, "which", return_value=None), \
             patch.object(firewall.subprocess, "run") as run:
            self.assertEqual(firewall.configure(self.config, self.addresses)["status"], "unavailable")
            run.assert_not_called()
        self.state = (252, "not running")
        self.assertEqual(self.configure()["status"], "not-running")
        self.assertEqual(self.calls, [["firewall-cmd", "--state"]])

    def test_permission_error_is_not_reported_as_firewall_success(self):
        self.add_failure = True
        with self.assertRaisesRegex(RuntimeError, "Not authorized"):
            self.configure()

    def test_default_installation_policy_does_not_change_the_firewall(self):
        with patch.object(setup, "network_addresses") as addresses, \
             patch.object(firewall, "configure") as configure:
            self.assertIsNone(setup.configure_firewall({"manage_firewall": False}))
            addresses.assert_not_called()
            configure.assert_not_called()

    def test_opted_in_setup_uses_enrolled_config_and_actual_network_addresses(self):
        with patch.object(setup, "read_json", return_value=self.config), \
             patch.object(setup, "network_addresses", return_value=self.addresses), \
             patch.object(firewall, "configure", return_value={"status": "configured"}) as configure:
            self.assertEqual(setup.configure_firewall({"manage_firewall": True}), {"status": "configured"})
            configure.assert_called_once_with(self.config, self.addresses)


class FirewallSetupIntegrationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="cube-firewall-setup-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.config = self.root / "config"
        self.state = self.root / "state"
        self.policy = {"mode": "member", "management_ip": "192.0.2.21", "manage_firewall": False}
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.object(setup, "CONFIG_DIR", self.config))
        stack.enter_context(patch.object(setup, "STATE_DIR", self.state))
        stack.enter_context(patch.object(setup, "CLUSTER_JSON", self.root / "cluster.json"))
        stack.enter_context(patch.object(setup.os, "geteuid", return_value=0))
        stack.enter_context(patch.object(setup, "read_json", side_effect=lambda path: copy.deepcopy(self.policy)
                                        if Path(path).name == "install.json" else {}))
        stack.enter_context(patch.object(setup, "private_directory", side_effect=lambda p: Path(p).mkdir(parents=True, exist_ok=True)))
        stack.enter_context(patch.object(setup, "initialize", return_value={"status": "ready", "changed": False}))
        self.firewall = stack.enter_context(patch.object(setup, "configure_firewall", return_value={"status": "configured"}))
        self.start = stack.enter_context(patch.object(setup, "start_service"))
        stack.enter_context(contextlib.redirect_stdout(io.StringIO()))

    def test_explicit_firewall_setup_persists_choice_and_starts_without_rotating_identity(self):
        self.assertEqual(setup.main(["--configure-firewall", "--start"]), 0)
        self.assertTrue(self.firewall.call_args.args[0]["manage_firewall"])
        self.start.assert_called_once_with(False, False)
        self.assertTrue(json.loads((self.config / "install.json").read_text())["manage_firewall"])
        self.assertEqual(json.loads((self.state / "setup-status.json").read_text())["firewall"]["status"], "configured")

    def test_firewall_setup_failure_cannot_mark_installation_ready_or_start_service(self):
        self.firewall.side_effect = RuntimeError("Firewall access denied")
        with self.assertRaisesRegex(RuntimeError, "Firewall access denied"):
            setup.main(["--configure-firewall", "--start"])
        self.start.assert_not_called()
        self.assertEqual(json.loads((self.state / "setup-status.json").read_text())["status"], "error")

if __name__ == "__main__":
    unittest.main()
