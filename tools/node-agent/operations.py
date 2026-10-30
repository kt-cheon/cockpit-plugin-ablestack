"""Read-only snapshots are deliberately independent of the administrator execution path."""
import glob
import json
import os
from pathlib import Path
import socket
import subprocess
import time


def read_command(argv, timeout=2):
    """Run only a fixed command chosen by a query implementation, never caller shell text."""
    try:
        proc = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              timeout=timeout, env=dict(os.environ, LC_ALL="C"))
        return {"stdout": proc.stdout.decode("utf-8", "replace"), "exit_code": proc.returncode}
    except (OSError, subprocess.TimeoutExpired):
        return {"stdout": "", "exit_code": 1}


def snapshot():
    # Avoid statfs calls to NFS/Ceph mounts while collecting a VM's local disks.
    df = read_command(["/usr/bin/df", "-lhP"])
    routes = read_command(["/usr/sbin/ip", "-j", "route", "show", "default"])
    try:
        gateway = next((item.get("gateway", "") for item in json.loads(routes["stdout"])), "")
    except (ValueError, TypeError):
        gateway = ""
    try:
        dns = [line.split()[1] for line in Path("/etc/resolv.conf").read_text().splitlines()
               if line.split()[:1] == ["nameserver"] and len(line.split()) > 1]
    except OSError:
        dns = []
    services = {}
    for name in ("mold.service", "mysqld", "mariadb"):
        services[name] = read_command(["/usr/bin/systemctl", "is-active", name])["stdout"].strip() or "unknown"
    return {"hostname": socket.gethostname(), "df": df["stdout"], "gateway": gateway,
            "dns": dns, "services": services, "collected_at": time.time()}


def cloud_init():
    return read_command(["/usr/bin/cloud-init", "status"], timeout=3)


QUERIES = {"snapshot": snapshot, "cloud-init": cloud_init}


def query(name):
    if name not in QUERIES:
        raise ValueError("Unknown read-only query")
    return QUERIES[name]()


def file_info(path):
    path = Path(path)
    info = path.stat()
    return {"path": str(path), "size": info.st_size, "mode": info.st_mode & 0o777,
            "directory": path.is_dir()}


def list_files(pattern):
    if not isinstance(pattern, str) or not pattern.startswith("/") or "\x00" in pattern:
        raise ValueError("An absolute file path is required")
    paths = glob.glob(pattern)
    if len(paths) > 4096:
        raise ValueError("Too many files in transfer")
    return [file_info(path) for path in paths]
