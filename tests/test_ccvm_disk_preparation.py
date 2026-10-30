"""Disk preparation failures must reach the wizard before a PCS resource is created."""
import ast
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

REPO = Path(__file__).resolve().parents[1]


class CcvmDiskPreparationTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse((REPO / "python/vm/setup_pcs_cluster.py").read_text())
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name in ("prepareCcvmDisk", "setupPcsCluster")]
        self.pcs = Mock(return_value=json.dumps({"code": 200}))
        self.namespace = {"subprocess": subprocess, "json": json, "os": Mock(), "time": Mock(),
                          "createReturn": lambda **kwargs: kwargs, "os_type": "ablestack-hci",
                          "pluginpath": "/usr/share/cockpit/ablestack", "python3": self.pcs,
                          "ccvmIsRunning": Mock(return_value=True)}
        self.namespace["os"].system.return_value = 0
        exec(compile(ast.Module(body=functions, type_ignores=[]), "setup_pcs_cluster.py", "exec"), self.namespace)
        self.args = SimpleNamespace(host_names=["cube1 cube2 cube3"])

    def deploy(self):
        return self.namespace["setupPcsCluster"](self.args)

    def test_conversion_failure_is_reported_and_cannot_create_or_resize_a_resource(self):
        with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "rbd: permission denied")) as run:
            result = self.deploy()
        self.assertEqual(result["code"], 500)
        self.assertIn("permission denied", result["val"])
        self.assertIn("이미지 변환", result["val"])
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0][0], "qemu-img")
        self.pcs.assert_not_called()
        self.namespace["ccvmIsRunning"].assert_not_called()

    def test_resize_failure_cannot_create_or_poll_a_resource(self):
        with patch.object(subprocess, "run", side_effect=[subprocess.CompletedProcess([], 0, "", ""),
                          subprocess.CompletedProcess([], 2, "", "rbd: image not found")]) as run:
            result = self.deploy()
        self.assertEqual(result["code"], 500)
        self.assertIn("크기 변경", result["val"])
        self.assertIn("image not found", result["val"])
        self.assertEqual(run.call_args.args[0], ["rbd", "resize", "-s", "500G", "ccvm"])
        self.pcs.assert_not_called()

    def test_successful_disk_preparation_continues_to_pcs_and_checks_all_candidates(self):
        with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")) as run:
            result = self.deploy()
        self.assertEqual(result["code"], 200)
        self.assertEqual([call.args[0][0] for call in run.call_args_list], ["qemu-img", "rbd"])
        self.assertEqual([call.args[1] for call in self.pcs.call_args_list], ["config", "create"])
        self.namespace["ccvmIsRunning"].assert_called_once_with(["cube1", "cube2", "cube3"])

    def test_missing_executable_is_reported_as_a_deployment_failure(self):
        with patch.object(subprocess, "run", side_effect=FileNotFoundError("qemu-img executable missing")):
            result = self.deploy()
        self.assertEqual(result["code"], 500)
        self.assertIn("qemu-img executable missing", result["val"])
        self.pcs.assert_not_called()


if __name__ == "__main__":
    unittest.main()
