#!/usr/bin/python3
"""Management-network node agent, authenticated by CA and enrolled certificate fingerprints."""
import base64
import contextlib
import http.server
import json
import logging
import os
from pathlib import Path
import selectors
import signal
import socket
import socketserver
import subprocess
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlsplit

from config import load_config, peer_identity, tls_context
from operations import file_info, list_files, query

LOG = logging.getLogger("cube-agent")
MAX_REQUEST = 1024 * 1024


def authorize(peer, operation):
    if operation not in ("health", "query") and peer.get("role") != "admin":
        raise PermissionError("This operation requires an administrator node certificate")


def command_spec(body, maximum_timeout):
    argv = body.get("argv")
    if not isinstance(argv, list) or not argv or not all(isinstance(arg, str) and "\x00" not in arg for arg in argv):
        raise ValueError("argv must be a nonempty array of strings")
    options = body.get("options") or {}
    if not isinstance(options, dict) or set(options) - {"directory", "environ"}:
        raise ValueError("Unsupported execution options")
    directory = options.get("directory", "/root")
    if not isinstance(directory, str) or not os.path.isabs(directory):
        raise ValueError("directory must be absolute")
    environ = dict(os.environ, HOME="/root", LIBVIRT_DEFAULT_URI="qemu:///system", LC_ALL="C")
    extra = options.get("environ", [])
    if not isinstance(extra, list):
        raise ValueError("environ must be an array")
    for entry in extra:
        if not isinstance(entry, str) or "=" not in entry or "\x00" in entry:
            raise ValueError("Invalid environment entry")
        name, value = entry.split("=", 1)
        if not name or not name.replace("_", "a").isalnum() or name[0].isdigit():
            raise ValueError("Invalid environment name")
        environ[name] = value
    timeout = int(body.get("timeout", 600))
    if timeout < 1 or timeout > maximum_timeout:
        raise ValueError("Command timeout is outside the configured limit")
    stdin = body.get("stdin_b64")
    if stdin is not None:
        stdin = base64.b64decode(stdin, validate=True)
        if len(stdin) > 512 * 1024:
            raise ValueError("Command input exceeds the limit")
    return argv, directory, environ, timeout, stdin


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, address, config, context):
        if ":" in address[0]:
            self.address_family = socket.AF_INET6
        self.config = config
        self.context = context
        self.slots = threading.BoundedSemaphore(16)
        self.command_slots = threading.BoundedSemaphore(8)
        self.cache_lock = threading.Lock()
        self.cache = {}
        super().__init__(address, Handler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            request.settimeout(10)
            with self.context.wrap_socket(request, server_side=True) as secure:
                super().process_request_thread(secure, client_address)
        except (OSError, ValueError):
            self.shutdown_request(request)
        finally:
            self.slots.release()

    def cached_query(self, name):
        # Short cache and bounded concurrency prevent dashboard polling from flooding services.
        with self.cache_lock:
            now = time.monotonic()
            cached = self.cache.get(name)
            if cached and now - cached[0] < 5:
                return cached[1]
            value = query(name)
            self.cache[name] = (now, value)
            return value


class Handler(http.server.BaseHTTPRequestHandler):
    # Closing each connection avoids persistent-connection/request framing ambiguity.
    protocol_version = "HTTP/1.0"
    server_version = "ABLESTACK-node-agent/1"
    sys_version = ""

    def log_message(self, fmt, *args):
        # Paths, shell text and request bodies may contain passwords or private file names.
        pass

    def response(self, code, value):
        body = json.dumps(value).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.response_started = True
        super().end_headers()

    def body(self):
        if self.headers.get("Transfer-Encoding"):
            raise ValueError("Transfer-Encoding is not supported")
        size = int(self.headers.get("Content-Length", "-1"))
        if size < 0 or size > MAX_REQUEST:
            raise ValueError("Invalid request length")
        data = self.rfile.read(size)
        if len(data) != size:
            raise ValueError("Incomplete request body")
        value = json.loads(data)
        if not isinstance(value, dict):
            raise ValueError("Request must be an object")
        return value

    def identity(self, operation):
        peer = peer_identity(self.server.config, self.connection.getpeercert(binary_form=True))
        authorize(peer, operation)
        LOG.info("peer=%s role=%s operation=%s", peer.get("name", "enrolled"), peer["role"], operation)
        return peer

    def dispatch(self):
        parsed = urlsplit(self.path)
        if parsed.path == "/v1/rpc" and self.command == "POST":
            body = self.body()
            operation = body.get("operation")
            self.identity(operation)
            params = body.get("params", {})
            if operation == "health":
                value = {"node_id": self.server.config["node_id"], "protocol": 1}
            elif operation == "query":
                if set(params) != {"name"}:
                    raise ValueError("Query accepts only a registered name")
                value = self.server.cached_query(params["name"])
            elif operation == "files.list":
                value = list_files(params["pattern"])
            elif operation == "files.stat":
                value = file_info(self.absolute_path(params["path"]))
            elif operation == "files.mkdir":
                Path(self.absolute_path(params["path"])).mkdir(parents=True, exist_ok=True, mode=0o700)
                value = {}
            else:
                raise ValueError("Unknown operation")
            self.response(200, value)
        elif parsed.path == "/v1/exec" and self.command == "POST":
            self.identity("exec")
            body = self.body()
            spec = command_spec(body, int(self.server.config.get("max_command_timeout", 3600)))
            if not self.server.command_slots.acquire(blocking=False):
                self.response(503, {"error": "Node command capacity reached"})
                return
            try:
                self.execute(spec)
            finally:
                self.server.command_slots.release()
        elif parsed.path == "/v1/file" and self.command in ("GET", "PUT"):
            self.identity("files.read" if self.command == "GET" else "files.write")
            params = parse_qs(parsed.query, strict_parsing=True)
            if set(params) != {"path"} or len(params["path"]) != 1:
                raise ValueError("Exactly one file path is required")
            path = self.absolute_path(params["path"][0])
            if self.command == "GET":
                self.send_file(path)
            else:
                self.receive_file(path)
        else:
            self.response(404, {"error": "Unknown endpoint"})

    @staticmethod
    def absolute_path(path):
        if not isinstance(path, str) or not path.startswith("/") or "\x00" in path:
            raise ValueError("An absolute file path is required")
        return path

    def do_GET(self):
        self.response_started = False
        try:
            self.dispatch()
        except PermissionError:
            if not self.response_started:
                self.response(403, {"error": "Peer is not authorized for this operation"})
        except (ValueError, KeyError, TypeError, OSError) as error:
            if not self.response_started:
                self.response(400, {"error": type(error).__name__})

    do_POST = do_GET
    do_PUT = do_GET

    def event(self, value):
        self.wfile.write(json.dumps(value).encode() + b"\n")
        self.wfile.flush()

    def execute(self, spec):
        argv, directory, environ, timeout, stdin = spec
        with contextlib.ExitStack() as stack:
            command_input = subprocess.DEVNULL
            if stdin is not None:
                command_input = stack.enter_context(tempfile.TemporaryFile())
                command_input.write(stdin)
                command_input.seek(0)
            process = stack.enter_context(subprocess.Popen(
                argv, cwd=directory, env=environ, stdin=command_input,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True))
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.end_headers()
            deadline = time.monotonic() + timeout
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(process.stdout, selectors.EVENT_READ, "stdout")
                    selector.register(process.stderr, selectors.EVENT_READ, "stderr")
                    while selector.get_map():
                        if time.monotonic() >= deadline:
                            raise subprocess.TimeoutExpired(argv, timeout)
                        for key, _ in selector.select(timeout=0.5):
                            chunk = os.read(key.fileobj.fileno(), 32768)
                            if chunk:
                                self.event({"channel": key.data, "data": base64.b64encode(chunk).decode()})
                            else:
                                selector.unregister(key.fileobj)
                code = process.wait(timeout=max(0.01, deadline - time.monotonic()))
                self.event({"exit_code": code})
            except (OSError, subprocess.TimeoutExpired):
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
                try:
                    self.event({"channel": "stderr", "data": base64.b64encode(b"Remote command interrupted or timed out\n").decode()})
                    self.event({"exit_code": 124})
                except OSError:
                    pass

    def send_file(self, filename):
        with open(filename, "rb") as stream:
            info = os.fstat(stream.fileno())
            import stat
            if not stat.S_ISREG(info.st_mode):
                raise ValueError("Only regular files can be transferred")
            self.send_response(200)
            self.send_header("Content-Length", str(info.st_size))
            self.send_header("X-File-Mode", format(info.st_mode & 0o777, "o"))
            self.end_headers()
            while True:
                data = stream.read(1024 * 1024)
                if not data:
                    break
                self.wfile.write(data)

    def receive_file(self, filename):
        if self.headers.get("Transfer-Encoding"):
            raise ValueError("Transfer-Encoding is not supported")
        size = int(self.headers.get("Content-Length", "-1"))
        if size < 0 or size > int(self.server.config.get("max_file_size", 16 * 1024 ** 3)):
            raise ValueError("Invalid file size")
        mode = int(self.headers.get("X-File-Mode", "600"), 8) & 0o777
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=str(Path(filename).parent), prefix=".able-transfer-", delete=False) as stream:
                temporary = stream.name
                remaining = size
                while remaining:
                    data = self.rfile.read(min(1024 * 1024, remaining))
                    if not data:
                        raise ValueError("Incomplete file upload")
                    stream.write(data)
                    remaining -= len(data)
                stream.flush()
                os.fsync(stream.fileno())
                os.fchmod(stream.fileno(), mode)
            os.replace(temporary, filename)
            temporary = None
            self.response(200, {})
        finally:
            if temporary is not None:
                os.unlink(temporary)


def main():
    if os.geteuid() != 0:
        raise PermissionError("Run the node agent through its system service")
    logging.basicConfig(level=logging.INFO)
    config = load_config()
    address = config.get("listen", "127.0.0.1")
    if address in ("0.0.0.0", "::", ""):
        raise ValueError("Bind the node agent to its management IP, not a wildcard address")
    with Server((address, int(config.get("port", 9445))), config, tls_context(config, server=True)) as server:
        server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
