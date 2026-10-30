"""Render real VM templates without libvirt, host firewall or remote execution."""
import ast
import fileinput
from pathlib import Path
import random
import shlex
import shutil
import sys
import tempfile
from types import SimpleNamespace
import unittest
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[1]


class VmBridgeXmlTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="cube-vm-bridge-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "tools/xml-template").mkdir(parents=True)
        for name in ("ccvm", "scvm"):
            (self.root / "tools/vmconfig" / name).mkdir(parents=True)
            shutil.copyfile(REPO / "tools/xml-template" / (name + "-xml-template.xml"),
                            self.root / "tools/xml-template" / (name + "-xml-template.xml"))
        self.ovs = False
        self.commands = []

    def system(self, command):
        self.commands.append(command)
        if command.startswith("systemctl is-active openvswitch"):
            return 0 if self.ovs else 3
        if command.startswith("yes|cp -f "):
            source, destination = shlex.split(command[len("yes|cp -f "):])
            shutil.copyfile(source, destination)
        elif command.startswith("/usr/bin/cp -f "):
            source, destination = shlex.split(command[len("/usr/bin/cp -f "):])
            shutil.copyfile(source, destination)
        elif command.startswith("mv "):
            source, destination = shlex.split(command[len("mv "):])
            shutil.move(source, destination)
        # All remaining commands (including remote copy, chmod and cleanup) are
        # recorded only. These tests never invoke a host command or another node.
        return 0

    def render(self, name, **changes):
        tree = ast.parse((REPO / "python/vm" / ("create_" + name + "_xml.py")).read_text())
        create = "createCcvmXml" if name == "ccvm" else "createScvmXml"
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name in (create, "generateMacAddress", "generateDecToHex")]
        namespace = {"os": SimpleNamespace(system=self.system), "fileinput": fileinput, "sys": sys,
                     "random": random, "pluginpath": str(self.root), "os_type": "ablestack-hci",
                     "createReturn": lambda **kwargs: kwargs}
        exec(compile(ast.Module(body=functions, type_ignores=[]), name + "-xml.py", "exec"), namespace)
        options = dict(cpu=8, memory=16, management_network_bridge="bridge0", service_network_bridge="bridge1",
                       host_names=["cube1 cube2 cube3"], storage_traffic_network_type="bridge",
                       server_network_bridge="storage0", replication_network_bridge="replication0",
                       disk_type="lun_passthrough", lun_passthrough_list=["/dev/fixture-lun"],
                       server_nic_passthrough="0000:41:00.0", replication_nic_passthrough="0000:42:00.0")
        options.update(changes)
        result = namespace[create](SimpleNamespace(**options))
        self.assertEqual(result["code"], 200, result)
        filename = "ccvm-temp.xml" if name == "ccvm" else "scvm.xml"
        return ET.parse(self.root / "tools/vmconfig" / name / filename).getroot()

    def test_ccvm_linux_bridges_do_not_require_pass_through_filter_chains(self):
        root = self.render("ccvm")
        interfaces = root.findall("./devices/interface")
        self.assertEqual([interface.find("source").get("bridge") for interface in interfaces], ["bridge0", "bridge1"])
        self.assertFalse(root.findall(".//filterref"))
        self.assertEqual(root.find("./devices/disk[@device='cdrom']/source").get("file"),
                         "/var/lib/libvirt/images/ccvm-cloudinit.iso")
        self.assertEqual(root.find("./devices/disk[@type='network']/source").get("name"), "rbd/ccvm")
        self.assertEqual(root.find("vcpu").text, "8")
        self.assertEqual(root.find("memory").text, "16")

    def test_scvm_management_storage_replication_bridges_and_lun_remain_valid(self):
        root = self.render("scvm")
        self.assertEqual([source.get("bridge") for source in root.findall("./devices/interface/source")],
                         ["bridge0", "storage0", "replication0"])
        self.assertFalse(root.findall(".//filterref"))
        self.assertEqual(root.find("./devices/disk[@device='lun']/source").get("dev"), "/dev/fixture-lun")
        self.assertEqual(root.find("./devices/disk[@device='cdrom']/source").get("file"),
                         "/var/lib/libvirt/images/scvm-cloudinit.iso")

    def test_scvm_pci_passthrough_does_not_turn_into_bridge_interfaces(self):
        root = self.render("scvm", storage_traffic_network_type="nic_passthrough")
        self.assertEqual(len(root.findall("./devices/interface")), 1)
        self.assertEqual([address.get("bus") for address in root.findall("./devices/hostdev/source/address")],
                         ["0x41", "0x42"])
        self.assertFalse(root.findall(".//filterref"))

    def test_ovs_management_interfaces_keep_their_virtualport_configuration(self):
        self.ovs = True
        for name in ("ccvm", "scvm"):
            with self.subTest(vm=name):
                root = self.render(name)
                self.assertEqual(root.find("./devices/interface/virtualport").get("type"), "openvswitch")
                self.assertFalse(root.findall(".//filterref"))

    def test_operator_filter_in_a_custom_template_is_preserved(self):
        for name in ("ccvm", "scvm"):
            with self.subTest(vm=name):
                template = self.root / "tools/xml-template" / (name + "-xml-template.xml")
                contents = template.read_text().replace("<!--management_network_bridge-->",
                    "<interface type='bridge'><source bridge='operator0'/>"
                    "<filterref filter='operator-restricted'/></interface>\n    <!--management_network_bridge-->")
                template.write_text(contents)
                root = self.render(name)
                self.assertEqual([item.get("filter") for item in root.findall(".//filterref")], ["operator-restricted"])


if __name__ == "__main__":
    unittest.main()
