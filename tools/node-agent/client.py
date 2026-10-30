"""HTTPS client. No insecure TLS option, SSH fallback, or automatic peer discovery."""
import base64
import http.client
import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import urlencode

from config import load_config, resolve_target, tls_context


class Client:
    def __init__(self, config=None):
        self.config = load_config() if config is None else config
        self.context = tls_context(self.config)

    def connection(self, target, timeout=5):
        hostname, port = resolve_target(self.config, target)
        return http.client.HTTPSConnection(hostname, port, timeout=timeout, context=self.context)

    @staticmethod
    def check(response):
        if response.status != 200:
            message = response.read(65536).decode("utf-8", "replace")
            raise RuntimeError("Node agent HTTP {}: {}".format(response.status, message))

    def rpc(self, target, operation, **params):
        connection = self.connection(target)
        try:
            body = json.dumps({"operation": operation, "params": params}).encode()
            connection.request("POST", "/v1/rpc", body, {"Content-Type": "application/json"})
            response = connection.getresponse()
            self.check(response)
            result = response.read(4 * 1024 * 1024 + 1)
            if len(result) > 4 * 1024 * 1024:
                raise RuntimeError("Node response exceeds the limit")
            return json.loads(result)
        finally:
            connection.close()

    def execute(self, target, argv, options=None, stdout=None, stderr=None, timeout=600, stdin=None):
        connection = self.connection(target)
        output = bytearray()
        errors = bytearray()
        try:
            request = {"argv": argv, "options": options or {}, "timeout": timeout}
            if stdin is not None:
                if len(stdin) > 512 * 1024:
                    raise ValueError("Command input exceeds the limit")
                request["stdin_b64"] = base64.b64encode(stdin).decode()
            body = json.dumps(request).encode()
            connection.request("POST", "/v1/exec", body, {"Content-Type": "application/json"})
            # TLS connection establishment has a short deadline; execution can take longer.
            connection.sock.settimeout(timeout + 10)
            response = connection.getresponse()
            self.check(response)
            while True:
                line = response.readline(128 * 1024)
                if not line:
                    raise RuntimeError("Remote command disconnected without an exit status")
                event = json.loads(line)
                if "exit_code" in event:
                    return subprocess.CompletedProcess(argv, event["exit_code"], bytes(output), bytes(errors))
                channel = event.get("channel")
                if channel not in ("stdout", "stderr"):
                    raise RuntimeError("Invalid node agent response")
                data = base64.b64decode(event["data"], validate=True)
                sink = stdout if channel == "stdout" else stderr
                if sink is not None:
                    sink.write(data)
                    sink.flush()
                else:
                    buffer = output if channel == "stdout" else errors
                    if len(buffer) + len(data) > 32 * 1024 * 1024:
                        raise RuntimeError("Remote output exceeds the capture limit")
                    buffer.extend(data)
        finally:
            connection.close()

    def download(self, target, remote_path, destination):
        destination = Path(destination)
        connection = self.connection(target, timeout=60)
        temporary = None
        try:
            connection.request("GET", "/v1/file?" + urlencode({"path": remote_path}))
            response = connection.getresponse()
            self.check(response)
            mode = int(response.getheader("X-File-Mode", "600"), 8) & 0o777
            remaining = int(response.getheader("Content-Length"))
            with tempfile.NamedTemporaryFile(dir=str(destination.parent), prefix=".able-transfer-", delete=False) as stream:
                temporary = stream.name
                while remaining:
                    data = response.read(min(1024 * 1024, remaining))
                    if not data:
                        raise RuntimeError("Incomplete file download")
                    stream.write(data)
                    remaining -= len(data)
                stream.flush()
                os.fsync(stream.fileno())
                os.fchmod(stream.fileno(), mode)
            os.replace(temporary, destination)
            temporary = None
        finally:
            connection.close()
            if temporary is not None:
                os.unlink(temporary)

    def upload(self, target, source, remote_path):
        source = Path(source)
        info = source.stat()
        connection = self.connection(target, timeout=60)
        try:
            with source.open("rb") as stream:
                connection.request("PUT", "/v1/file?" + urlencode({"path": remote_path}), stream,
                                   {"Content-Length": str(info.st_size),
                                    "X-File-Mode": format(info.st_mode & 0o777, "o")})
            response = connection.getresponse()
            self.check(response)
            response.read(65536)
        finally:
            connection.close()
