"""Deployment completion must find the one CCVM on any PCS candidate."""
import ast
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]


class CcvmOwnerTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse((REPO / "python/vm/setup_pcs_cluster.py").read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "ccvmIsRunning")
        namespace = {"json": json, "subprocess": subprocess}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "setup_pcs_cluster.py", "exec"), namespace)
        self.running = namespace["ccvmIsRunning"]

    def test_ccvm_on_third_host_completes_deployment(self):
        with patch.object(subprocess, "run", side_effect=[subprocess.CompletedProcess([], 0, "shut off\n"),
                          subprocess.CompletedProcess([], 1, ""), subprocess.CompletedProcess([], 0, "running\n")]) as run:
            self.assertTrue(self.running(["cube1", "cube2", "cube3"]))
        self.assertEqual([call.args[0][call.args[0].index("--target") + 1] for call in run.call_args_list],
                         ["cube1", "cube2", "cube3"])
        for call in run.call_args_list:
            self.assertEqual(call.args[0][0], "/usr/libexec/ablestack/node-remote")
            self.assertEqual(json.loads(call.args[0][call.args[0].index("--argv-json") + 1]),
                             ["virsh", "-c", "qemu:///system", "domstate", "ccvm"])

    def test_unreachable_host_does_not_hide_ccvm_on_another_candidate(self):
        with patch.object(subprocess, "run", side_effect=[subprocess.TimeoutExpired([], 8),
                          subprocess.CompletedProcess([], 0, "running\n")]):
            self.assertTrue(self.running(["cube1", "cube2"]))

    def test_no_running_ccvm_is_not_reported_as_success(self):
        with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "shut off\n")):
            self.assertFalse(self.running(["cube1", "cube2", "cube3"]))


if __name__ == "__main__":
    unittest.main()
