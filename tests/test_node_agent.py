"""Real loopback mTLS/streaming tests and checks that queries cannot change node state."""
import http.client
import io
import json
import os
from pathlib import Path
import platform
import ssl
import stat
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools/node-agent"))
import agent
import client
import config
import operations
import provision
import transfer


class NodeAgentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="cube-agent-")
        cls.root = Path(cls.temp.name)
        openssl_dir = Path("/opt/homebrew/opt/openssl@1.1/bin")
        env = dict(os.environ)
        if platform.system() == "Darwin" and openssl_dir.is_dir():
            env["PATH"] = str(openssl_dir) + ":" + env.get("PATH", "")
        cls.nodes = [{"id": name, "address": "127.0.0." + str(index), "role": role}
                     for index, (name, role) in enumerate(
                         (("server", "admin"), ("admin", "admin"), ("reader", "reader"), ("unenrolled", "admin")), 1)]
        inventory = cls.root / "inventory.json"
        inventory.write_text(json.dumps({"nodes": cls.nodes}))
        with patch.dict(os.environ, env, clear=True):
            provision.init_ca(cls.root / "ca")
            provision.issue_bundles(cls.root / "ca", inventory, cls.root / "bundles")
        cls.configs = {}
        for node in cls.nodes:
            bundle = cls.root / "bundles" / node["id"]
            cfg = json.loads((bundle / "agent.json").read_text())
            cfg["tls"] = {"ca": str(bundle / "ca.crt"), "cert": str(bundle / "node.crt"), "key": str(bundle / "node.key")}
            cls.configs[node["id"]] = cfg
        cls.server_config = cls.configs["server"]
        del cls.server_config["peers"][provision.fingerprint(cls.root / "bundles/unenrolled/node.crt")]
        cls.server = agent.Server(("127.0.0.1", 0), cls.server_config, config.tls_context(cls.server_config, server=True))
        cls.port = cls.server.server_port
        for cfg in cls.configs.values():
            cfg["nodes"]["server"]["url"] = "https://127.0.0.1:" + str(cls.port)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        cls.temp.cleanup()

    def setUp(self):
        self.admin = client.Client(self.configs["admin"])
        self.reader = client.Client(self.configs["reader"])

    def test_health_authenticates_enrolled_peer(self):
        self.assertEqual(self.admin.rpc("server", "health"), {"node_id": "server", "protocol": 1})

    def test_unenrolled_certificate_is_rejected_even_with_valid_ca(self):
        with self.assertRaisesRegex(RuntimeError, "403"):
            client.Client(self.configs["unenrolled"]).rpc("server", "health")

    def test_client_certificate_is_required(self):
        context = ssl.create_default_context(cafile=self.server_config["tls"]["ca"])
        connection = http.client.HTTPSConnection("127.0.0.1", self.port, timeout=3, context=context)
        self.addCleanup(connection.close)
        with self.assertRaises((ssl.SSLError, OSError, http.client.HTTPException)):
            connection.request("POST", "/v1/rpc", b'{"operation":"health"}', {"Content-Type": "application/json"})
            connection.getresponse()

    def test_wrong_server_hostname_is_rejected(self):
        cfg = dict(self.configs["admin"], nodes={"wrong": {"url": "https://localhost:" + str(self.port)}})
        with self.assertRaises(ssl.SSLCertVerificationError):
            client.Client(cfg).rpc("wrong", "health")

    def test_targets_outside_inventory_are_rejected(self):
        with self.assertRaisesRegex(PermissionError, "inventory"):
            self.admin.rpc("192.0.2.200", "health")

    def test_contextual_aliases_resolve_per_source_node(self):
        cfg = dict(self.configs["admin"], target_aliases={"scvm": "server"})
        self.assertEqual(client.Client(cfg).rpc("scvm", "health")["node_id"], "server")
        different_node = dict(self.configs["reader"], target_aliases={"scvm": "reader"})
        self.assertEqual(config.resolve_target(different_node, "scvm"), ("127.0.0.3", 9445))
        self.assertEqual(config.resolve_target(cfg, "root@scvm"), ("127.0.0.1", self.port))

    def test_reader_can_query_but_cannot_execute_or_access_files(self):
        with self.server.cache_lock:
            self.server.cache.clear()
        with patch.object(agent, "query", return_value={"status": "read-only"}) as collect:
            self.assertEqual(self.reader.rpc("server", "query", name="snapshot"), {"status": "read-only"})
            self.assertEqual(self.reader.rpc("server", "query", name="snapshot"), {"status": "read-only"})
            self.assertEqual(collect.call_count, 1, "polling must reuse the short-lived snapshot")
        with self.assertRaisesRegex(RuntimeError, "403"):
            self.reader.execute("server", ["/bin/true"], options={"directory": str(self.root)})
        with self.assertRaisesRegex(RuntimeError, "403"):
            self.reader.rpc("server", "files.list", pattern=str(self.root / "*"))

    def test_queries_cannot_smuggle_commands(self):
        with self.assertRaisesRegex(RuntimeError, "400"):
            self.admin.rpc("server", "query", name="snapshot", argv=["/bin/false"])
        with self.assertRaisesRegex(RuntimeError, "400"):
            self.admin.rpc("server", "query", name="execute")

    def test_exec_preserves_argument_boundaries_exit_code_and_both_streams(self):
        marker = self.root / "must-not-exist"
        value = "value; touch " + str(marker)
        result = self.admin.execute("server", [sys.executable, "-c",
            'import sys; print(sys.argv[1]); print("stderr", file=sys.stderr); sys.exit(7)', value],
            options={"directory": str(self.root)}, timeout=5)
        self.assertEqual(result.returncode, 7)
        self.assertEqual(result.stdout.decode().strip(), value)
        self.assertEqual(result.stderr.decode().strip(), "stderr")
        self.assertFalse(marker.exists())

    def test_exec_streams_and_accepts_bounded_script_input(self):
        output, errors = io.BytesIO(), io.BytesIO()
        result = self.admin.execute("server", ["/bin/sh", "-s"], stdin=b"printf input-ok\n",
            options={"directory": str(self.root)}, stdout=output, stderr=errors, timeout=5)
        self.assertEqual((result.returncode, output.getvalue(), errors.getvalue()), (0, b"input-ok", b""))

    def test_timed_out_process_is_terminated(self):
        result = self.admin.execute("server", [sys.executable, "-c", "import time; time.sleep(20)"],
            options={"directory": str(self.root)}, timeout=1)
        self.assertEqual(result.returncode, 124)

    def test_binary_file_transfer_is_atomic_and_preserves_mode(self):
        source, remote, downloaded = [self.root / name for name in ("source.bin", "remote.bin", "downloaded.bin")]
        payload = b"\x00\xffdata\n" * 200000
        source.write_bytes(payload)
        source.chmod(0o600)
        remote.write_bytes(b"old contents")
        self.admin.upload("server", source, str(remote))
        self.admin.download("server", str(remote), downloaded)
        self.assertEqual(downloaded.read_bytes(), payload)
        self.assertEqual(stat.S_IMODE(remote.stat().st_mode), 0o600)
        self.assertFalse(list(self.root.glob(".able-transfer-*")))

    def test_incomplete_upload_does_not_destroy_existing_file(self):
        destination = self.root / "incomplete.bin"
        destination.write_bytes(b"previous")
        class Request:
            headers = {"Content-Length": "10", "X-File-Mode": "600"}
            rfile = io.BytesIO(b"short")
            server = type("ServerConfig", (), {"config": {}})()
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            agent.Handler.receive_file(Request(), str(destination))
        self.assertEqual(destination.read_bytes(), b"previous")
        self.assertFalse(list(self.root.glob(".able-transfer-*")))

    def test_query_implementations_only_run_fixed_read_commands(self):
        calls = []
        def command(argv, timeout=2):
            calls.append(argv)
            return {"stdout": "[]" if "route" in argv else "", "exit_code": 0}
        with patch.object(operations, "read_command", side_effect=command):
            operations.snapshot()
        for argv in calls:
            self.assertTrue(argv[:2] in (["/usr/bin/df", "-lhP"], ["/usr/sbin/ip", "-j"], ["/usr/bin/systemctl", "is-active"]))
        self.assertEqual(set(operations.QUERIES), {"snapshot", "cloud-init"})

    def test_transfer_adapter_parses_legacy_and_ipv6_endpoints(self):
        self.assertEqual(transfer.endpoint("root@cube1:/etc/hosts"), ("cube1", "/etc/hosts"))
        self.assertEqual(transfer.endpoint("[2001:db8::1]:/etc/hosts"), ("2001:db8::1", "/etc/hosts"))
        self.assertEqual(transfer.endpoint("/tmp/local:file"), (None, "/tmp/local:file"))

    def test_certificate_bundles_do_not_distribute_the_ca_key(self):
        for bundle in (self.root / "bundles").iterdir():
            self.assertFalse((bundle / "ca.key").exists())
            self.assertEqual(stat.S_IMODE((bundle / "node.key").stat().st_mode), 0o600)


if __name__ == "__main__":
    unittest.main()
