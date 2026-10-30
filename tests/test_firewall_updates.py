"""Exercise application firewall changes with a stub, without any real firewall or VM."""
import ast
import contextlib
import io
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

REPO = Path(__file__).resolve().parents[1]


class BootstrapFirewallTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="cube-firewall-update-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.state = self.root / "state.json"
        self.state.write_text(json.dumps({"runtime": [], "permanent": [], "libvirt_chains": ["libvirt-out", "FP-vnet0"]}))
        binary = self.root / "firewall-cmd"
        binary.write_text("#!" + sys.executable + "\n" + '''
import json, os, pathlib, sys
path = pathlib.Path(os.environ["TEST_FIREWALL_STATE"])
state = json.loads(path.read_text())
args = sys.argv[1:]
if "--list-all" in args:
    sys.exit(0)
if os.environ.get("TEST_FIREWALL_FAIL"):
    print("firewall update denied", file=sys.stderr)
    sys.exit(253)
if "--reload" in args or "--complete-reload" in args:
    state["libvirt_chains"] = []
else:
    rules = [arg for arg in args if arg.startswith(("--add-port=", "--add-service="))]
    if len(rules) != 1 or "--zone=public" not in args:
        raise SystemExit("Unexpected firewall command: " + repr(args))
    scope = "permanent" if "--permanent" in args else "runtime"
    if rules[0] not in state[scope]:
        state[scope].append(rules[0])
path.write_text(json.dumps(state))
''')
        binary.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.root) + ":" + os.environ.get("PATH", ""),
                        TEST_FIREWALL_STATE=str(self.state))

    def run_firewall_block(self, vm):
        source = (REPO / "shell/host" / (vm + "_bootstrap.sh")).read_text()
        marker = "################# firewall setting"
        block = source[source.index(marker):]
        block = block[:block.index("# 라이선스" if vm == "ccvm" else "#ceph 키 복사")]
        # Keep the script's actual pipe-failure behavior without running its database,
        # disk setup or service commands.
        pipefail = "set -o pipefail\n" if "set -o pipefail" in source else ""
        program = "LOGFILE=" + shlex.quote(str(self.root / "firewall.log")) + "\n" + pipefail + block
        return subprocess.run(["bash", "-c", program], env=self.env, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, timeout=10)

    def test_mysql_is_allowed_in_both_scopes_without_discarding_vm_filter_chains(self):
        result = self.run_firewall_block("ccvm")
        self.assertEqual(result.returncode, 0, result.stderr)
        state = json.loads(self.state.read_text())
        self.assertEqual(state["runtime"], ["--add-service=mysql"])
        self.assertEqual(state["permanent"], state["runtime"])
        self.assertEqual(state["libvirt_chains"], ["libvirt-out", "FP-vnet0"])

    def test_gateway_services_and_ports_survive_reboot_without_reloading_firewall(self):
        result = self.run_firewall_block("gwvm")
        self.assertEqual(result.returncode, 0, result.stderr)
        state = json.loads(self.state.read_text())
        expected = {"--add-port=" + port + "/tcp" for port in ("9100", "9095", "5050", "3260")}
        expected.update("--add-service=" + service for service in ("ceph", "ceph-mon", "iscsi-target"))
        self.assertEqual(set(state["runtime"]), expected)
        self.assertEqual(state["permanent"], state["runtime"])
        self.assertEqual(state["libvirt_chains"], ["libvirt-out", "FP-vnet0"])

    def test_firewall_failure_is_not_hidden_by_successful_log_output(self):
        self.env["TEST_FIREWALL_FAIL"] = "1"
        for vm in ("ccvm", "gwvm"):
            with self.subTest(vm=vm):
                result = self.run_firewall_block(vm)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("firewall update denied", result.stdout)


class SambaFirewallTests(unittest.TestCase):
    def test_samba_removal_updates_both_scopes_without_global_reload(self):
        tree = ast.parse((REPO / "python/glue/smb.py").read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "deleteSamba")
        remote = Mock(return_value="")
        namespace = {"subprocess": SimpleNamespace(check_output=Mock(side_effect=[b"user\n", b"user\n"])),
                     "os": SimpleNamespace(system=Mock(return_value=0)), "ssh": remote, "json": json,
                     "createReturn": lambda **kwargs: json.dumps(kwargs)}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "smb.py", "exec"), namespace)
        with contextlib.redirect_stdout(io.StringIO()):
            namespace["deleteSamba"]()
        commands = [call.args[-1] for call in remote.call_args_list if call.args[-1].startswith("firewall-cmd")]
        self.assertEqual(commands, ["firewall-cmd --remove-service=samba", "firewall-cmd --permanent --remove-service=samba"])


if __name__ == "__main__":
    unittest.main()
