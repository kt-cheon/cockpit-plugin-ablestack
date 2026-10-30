#!/usr/bin/python3
"""Atomic file transfers; all remote endpoints must be enrolled TLS peers."""
import glob
import http.client
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile

from client import Client


def endpoint(value):
    match = re.match(r"^(?:([^@/:]+)@)?(\[[^\]]+\]|[^/:]+):(/.*)$", value) if not value.startswith("/") else None
    if not match:
        return None, value
    return match.group(2).strip("[]"), match.group(3)


def parse_args(args):
    args = list(args)
    recursive = False
    while args and args[0].startswith("-"):
        option = args.pop(0)
        if option == "--":
            break
        if option in ("-o", "-P", "-i"):
            if not args:
                raise ValueError("Missing transfer option value")
            args.pop(0)
        elif option in ("-r", "-rp", "-pr"):
            recursive = True
        elif option not in ("-q", "-p", "-B", "-3", "-4", "-6"):
            raise ValueError("Unsupported transfer option: " + option)
    if len(args) < 2:
        raise ValueError("Provide one or more source files and a destination")
    return args[:-1], args[-1], recursive


def transfer(client, source_host, source, destination_host, destination, recursive):
    source = Path(source)
    destination = Path(destination)
    info = client.rpc(source_host, "files.stat", path=str(source)) if source_host else {
        "directory": source.is_dir()}
    if info["directory"]:
        if not recursive:
            raise ValueError("Use -r to transfer a directory")
        if destination_host:
            client.rpc(destination_host, "files.mkdir", path=str(destination))
        else:
            destination.mkdir(parents=True, exist_ok=True)
        entries = (client.rpc(source_host, "files.list", pattern=str(source / "*")) if source_host
                   else [{"path": str(path)} for path in source.iterdir()])
        for entry in entries:
            path = Path(entry["path"])
            transfer(client, source_host, path, destination_host, destination / path.name, recursive)
    elif source_host and destination_host:
        with tempfile.TemporaryDirectory(prefix="able-transfer-") as temporary:
            local = Path(temporary) / source.name
            client.download(source_host, str(source), local)
            client.upload(destination_host, local, str(destination))
    elif source_host:
        client.download(source_host, str(source), destination)
    elif destination_host:
        client.upload(destination_host, source, str(destination))
    else:
        shutil.copy2(source, destination)


def main(argv=None):
    if os.geteuid() != 0:
        raise PermissionError("Administrator access is required; enable it in Cockpit")
    sources, destination, recursive = parse_args(sys.argv[1:] if argv is None else argv)
    client = Client()
    destination_host, destination_path = endpoint(destination)
    if destination_host:
        try:
            destination_is_dir = client.rpc(destination_host, "files.stat", path=destination_path)["directory"]
        except RuntimeError:
            if destination_path.endswith("/"):
                raise
            destination_is_dir = False
    else:
        destination_is_dir = Path(destination_path).is_dir()
    expanded = []
    for source in sources:
        host, pattern = endpoint(source)
        matches = (client.rpc(host, "files.list", pattern=pattern) if host
                   else [{"path": filename} for filename in glob.glob(pattern)])
        if not matches:
            raise FileNotFoundError("No transfer source matched: " + pattern)
        expanded.extend((host, item["path"]) for item in matches)
    if len(expanded) > 1 and not destination_is_dir:
        raise ValueError("Multiple sources require an existing destination directory")
    for host, source in expanded:
        target = str(Path(destination_path) / Path(source).name) if destination_is_dir else destination_path
        transfer(client, host, source, destination_host, target, recursive)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, http.client.HTTPException) as error:
        print("ABLESTACK file transport: " + str(error), file=sys.stderr)
        sys.exit(1)
