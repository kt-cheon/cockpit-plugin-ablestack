"""Security boundaries across application entry points; no system commands are run."""
import ast
from pathlib import Path
import re
import unittest


REPO = Path(__file__).resolve().parents[1]


class TransportMigrationTests(unittest.TestCase):
    def test_application_commands_cannot_bypass_privileged_entry_points(self):
        pattern = re.compile(r"cockpit\.(spawn|script|file)\s*\(")
        paths = [REPO / "index.js", *list((REPO / "src/features").rglob("*.js")),
                 REPO / "src/common/wizard-common.js", REPO / "src/common/logger.js"]
        for path in paths:
            self.assertIsNone(pattern.search(path.read_text()), str(path))

    def test_python_transports_do_not_execute_openssh_or_import_paramiko(self):
        for path in (REPO / "python").rglob("*.py"):
            tree = ast.parse(path.read_text())
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    self.assertNotIn("paramiko", [item.name for item in node.names], str(path))
                if isinstance(node, ast.ImportFrom):
                    self.assertNotEqual(node.module, "paramiko", str(path))
                    if node.module == "sh":
                        self.assertFalse({"ssh", "scp"} & {item.name for item in node.names}, str(path))
                if isinstance(node, ast.Constant) and isinstance(node.value, str):
                    if path.name == "pacemaker.py" and node.value == "ssh":
                        continue  # External VirtualDomain migration protocol, documented separately.
                    self.assertFalse(re.match(r"^(?:/usr/bin/|/bin/)?(?:ssh|scp)(?:\s|$)", node.value),
                                     str(path) + ": " + node.value[:80])

    def test_shell_workflows_do_not_execute_openssh(self):
        pattern = re.compile(r"(?<![\w/-])(?:/usr/bin/|/bin/)?(?:ssh|scp)\s")
        for path in (REPO / "shell").rglob("*.sh"):
            for line in path.read_text().splitlines():
                if not line.lstrip().startswith("#"):
                    self.assertIsNone(pattern.search(line), str(path) + ": " + line)


if __name__ == "__main__":
    unittest.main()
