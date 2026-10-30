"""Agent connection failures must retain useful diagnostics without changing the VM."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

REPO = Path(__file__).resolve().parents[1]


class VmReadinessTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse((REPO / "python/cloudinit_status/cloudinit_status.py").read_text())
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name in ("cloudinitStatus", "guestvmPing")]
        self.client = Mock()
        self.namespace = {"args": SimpleNamespace(target="scvm"), "Client": lambda: self.client,
                          "createReturn": lambda **kwargs: kwargs}
        exec(compile(ast.Module(body=functions, type_ignores=[]), "cloudinit_status.py", "exec"), self.namespace)

    def test_missing_agent_config_is_reported_as_connection_failure(self):
        self.client.rpc.side_effect = FileNotFoundError("/etc/ablestack/node-agent/ca.crt")
        result = self.namespace["guestvmPing"]()
        self.assertEqual(result["code"], 500)
        self.assertIn("Cube Agent", result["val"])
        self.assertIn("ca.crt", result["val"])
        self.client.rpc.assert_called_once_with("scvm", "health")

    def test_cloud_init_query_remains_read_only_and_reports_transport_error(self):
        self.client.rpc.side_effect = RuntimeError("TLS verification failed")
        result = self.namespace["cloudinitStatus"]()
        self.assertEqual(result["code"], 500)
        self.assertIn("TLS verification failed", result["val"])
        self.client.rpc.assert_called_once_with("scvm", "query", name="cloud-init")

    def test_successful_cloud_init_keeps_existing_response_contract(self):
        self.client.rpc.return_value = {"exit_code": 0, "stdout": "status: done\n"}
        self.assertEqual(self.namespace["cloudinitStatus"](), {"code": 200, "val": ["status: done"]})


if __name__ == "__main__":
    unittest.main()
