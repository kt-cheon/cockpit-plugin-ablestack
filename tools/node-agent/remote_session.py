"""Small adapter for legacy storage workflows; no SSH implementation is retained."""
import io

from client import Client


class Output(io.BytesIO):
    def __init__(self, data, code):
        super().__init__(data)
        self.code = code
        self.channel = self

    def recv_exit_status(self):
        return self.code


class RemoteHost:
    def __init__(self, target):
        self.target = target
        self.client = Client()

    def exec_command(self, command):
        result = self.client.execute(self.target, ["/bin/bash", "-c", command], timeout=3600)
        return io.BytesIO(), Output(result.stdout, result.returncode), Output(result.stderr, result.returncode)

    def close(self):
        pass
