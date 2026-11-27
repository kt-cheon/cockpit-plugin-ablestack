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
        self.convert = Mock()
        self.step = Mock()
        self.namespace = {"subprocess": subprocess, "json": json, "os": Mock(), "time": Mock(),
                          "createReturn": lambda **kwargs: kwargs, "os_type": "ablestack-hci",
                          "pluginpath": "/usr/share/cockpit/ablestack", "python3": self.pcs,
                          "ccvmIsRunning": Mock(return_value=True), 'progress': Mock(),
                          'convert_to_rbd': self.convert, 'run_step': self.step}
        self.namespace["os"].system.return_value = 0
        exec(compile(ast.Module(body=functions, type_ignores=[]), "setup_pcs_cluster.py", "exec"), self.namespace)
        self.args = SimpleNamespace(host_names=["cube1 cube2 cube3"])

    def deploy(self):
        return self.namespace["setupPcsCluster"](self.args)

    def test_conversion_failure_is_reported_and_cannot_create_or_resize_a_resource(self):
        self.convert.side_effect = RuntimeError('rbd: permission denied')
        result = self.deploy()
        self.assertEqual(result["code"], 500)
        self.assertIn("permission denied", result["val"])
        self.assertIn("이미지 변환", result["val"])
        self.convert.assert_called_once()
        self.step.assert_not_called()
        self.pcs.assert_not_called()
        self.namespace["ccvmIsRunning"].assert_not_called()

    def test_resize_failure_cannot_create_or_poll_a_resource(self):
        self.step.side_effect = RuntimeError('rbd: image not found')
        result = self.deploy()
        self.assertEqual(result["code"], 500)
        self.assertIn("크기 변경", result["val"])
        self.assertIn("image not found", result["val"])
        self.assertEqual(self.step.call_args.args[1], ["rbd", "resize", "-s", "500G", "ccvm"])
        self.pcs.assert_not_called()

    def test_successful_disk_preparation_continues_to_pcs_and_checks_all_candidates(self):
        result = self.deploy()
        self.assertEqual(result["code"], 200)
        self.convert.assert_called_once_with('/var/lib/libvirt/images/ablestack-template-back.qcow2', 'rbd:rbd/ccvm')
        self.assertEqual(self.step.call_args.args[1][0], 'rbd')
        self.assertEqual([call.args[1] for call in self.pcs.call_args_list], ["config", "create"])
        self.namespace["ccvmIsRunning"].assert_called_once_with(["cube1", "cube2", "cube3"])

    def test_missing_executable_is_reported_as_a_deployment_failure(self):
        self.convert.side_effect = FileNotFoundError('qemu-img executable missing')
        result = self.deploy()
        self.assertEqual(result["code"], 500)
        self.assertIn("qemu-img executable missing", result["val"])
        self.pcs.assert_not_called()

    def test_pcs_configuration_failure_cannot_create_or_wait_for_a_vm(self):
        self.pcs.return_value = json.dumps({'code': 500})
        self.assertEqual(self.deploy()['code'], 500)
        self.assertEqual(self.pcs.call_count, 1)
        self.namespace['ccvmIsRunning'].assert_not_called()

    def test_resource_creation_failure_cannot_wait_for_a_vm_that_was_never_created(self):
        self.pcs.side_effect = [json.dumps({'code': 200}), json.dumps({'code': 500})]
        self.assertEqual(self.deploy()['code'], 500)
        self.namespace['ccvmIsRunning'].assert_not_called()

    def test_vm_wait_messages_include_time_spent_querying_hosts(self):
        self.namespace['time'].monotonic.side_effect = [0, 35, 70]
        self.namespace['ccvmIsRunning'].side_effect = [False, False, True]
        self.assertEqual(self.deploy()['code'], 200)
        messages = [call.args[0] for call in self.namespace['progress'].call_args_list]
        self.assertTrue(any('경과 35초' in message for message in messages))
        self.assertTrue(any('경과 70초' in message for message in messages))


if __name__ == "__main__":
    unittest.main()
