#!/usr/bin/python3
"""Initialize an installed node from its actual network configuration and trusted install assets."""
import argparse
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import ssl
import subprocess
import sys
import tempfile
import uuid

import provision

CONFIG_DIR = Path("/etc/ablestack/node-agent")
STATE_DIR = Path("/var/lib/ablestack/cube-agent")
CLUSTER_JSON = Path("/usr/share/cockpit/ablestack/tools/properties/cluster.json")


class Pending(Exception):
    """Installation assets or the configured management network are not ready yet."""


def read_json(path, default=None):
    path = Path(path)
    if not path.exists():
        return {} if default is None else default
    info = path.stat()
    if path.is_symlink() or info.st_uid != os.geteuid() or info.st_mode & 0o022:
        raise PermissionError("Installation settings must be owned by the setup user and not writable by others: " + str(path))
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object: " + str(path))
    return value


def private_directory(path):
    path = Path(path)
    if path.is_symlink():
        raise PermissionError("Private installation directory must not be a symlink: " + str(path))
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.stat().st_uid != os.geteuid():
        raise PermissionError("Private installation directory has a different owner: " + str(path))
    path.chmod(0o700)
    return path


def atomic_write(path, contents, mode=0o600):
    path = Path(path)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=str(path.parent), prefix=".cube-setup-", delete=False) as stream:
            temporary = stream.name
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), mode)
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            os.unlink(temporary)


def network_addresses():
    proc = subprocess.run(["ip", "-j", "address", "show"], stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, text=True, check=True, timeout=5)
    result = []
    for interface in json.loads(proc.stdout):
        if "UP" not in interface.get("flags", []):
            continue
        for address in interface.get("addr_info", []):
            if address.get("scope") != "global" or address.get("tentative") or address.get("dadfailed"):
                continue
            value = ipaddress.ip_address(address["local"])
            if value.is_loopback or value.is_link_local or value.is_unspecified or value.is_multicast:
                continue
            result.append({"interface": interface["ifname"], "address": str(value)})
    return result


def select_management_ip(addresses, interface=None, requested=None, cluster=None, hostname=None):
    candidates = addresses
    if interface:
        candidates = [item for item in candidates if item["interface"] == interface]
    available = {item["address"] for item in candidates}
    if requested:
        requested = str(ipaddress.ip_address(requested))
        if requested not in available:
            raise Pending("Configured management IP is not active on this node: " + requested)
        return requested
    if not available:
        raise Pending("Waiting for the management interface to obtain its configured IP")
    cluster = (cluster or {}).get("clusterConfig", {})
    configured = set()
    local_names = {hostname, (hostname or "").split(".")[0]}
    for host in cluster.get("hosts", []):
        if host.get("hostname") in local_names and host.get("ablecube") in available:
            configured.add(host["ablecube"])
        for prefix, field in (("scvm", "scvmMngt"),):
            if prefix + str(host.get("index", "")) in local_names and host.get(field) in available:
                configured.add(host[field])
    for name, field in (("ccvm", "ip"), ("gwvm", "ip"), ("pfmp", "ingress_ip")):
        value = cluster.get(name, {}).get(field)
        if name in local_names and value in available:
            configured.add(value)
    if len(configured) == 1:
        return configured.pop()
    cidr = cluster.get("mngtNic", {}).get("cidr")
    if cidr:
        try:
            subnet = ipaddress.ip_network(cidr, strict=False)
            filtered = {value for value in available if ipaddress.ip_address(value) in subnet}
            if len(filtered) == 1:
                return filtered.pop()
        except ValueError:
            pass
    if len(available) == 1:
        return available.pop()
    ipv4 = {value for value in available if ipaddress.ip_address(value).version == 4}
    if len(ipv4) == 1 and len({item["interface"] for item in candidates}) == 1:
        return ipv4.pop()
    raise Pending("Multiple active IPs found; the installer must select management_interface or management_ip")


def node_id(requested=None, hostname=None, machine_id_path=Path("/etc/machine-id")):
    value = requested or hostname or socket.gethostname()
    if value in ("localhost", "localhost.localdomain", ""):
        machine = Path(machine_id_path).read_text().strip()
        if not re.fullmatch(r"[a-fA-F0-9]{32}", machine) or set(machine) == {"0"}:
            raise Pending("Waiting for the installer to assign a unique hostname or machine-id")
        value = "node-" + machine[:16].lower()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", value):
        raise ValueError("Invalid installation node ID")
    return value


def validate_files(files, address, allow_symlinks=False):
    for name, path in files.items():
        info = path.stat()
        if (path.is_symlink() and not allow_symlinks) or info.st_uid != os.geteuid() or info.st_mode & 0o022:
            raise PermissionError("Untrusted enrollment file: " + str(path))
        if name == "node.key" and info.st_mode & 0o077:
            raise PermissionError("Enrollment private key must have mode 0600")
    provision.openssl("verify", "-purpose", "sslserver", "-verify_ip", address,
                      "-CAfile", files["ca.crt"], files["node.crt"])
    provision.openssl("verify", "-purpose", "sslclient", "-CAfile", files["ca.crt"], files["node.crt"])
    context = ssl.create_default_context(cafile=str(files["ca.crt"]))
    context.load_cert_chain(str(files["node.crt"]), str(files["node.key"]))


def validate_identity(directory, settings, address):
    directory = Path(directory)
    if settings.get("enabled") is not True or not settings.get("node_id"):
        raise ValueError("Enrollment bundle must contain an enabled node identity")
    if str(ipaddress.ip_address(settings["listen"])) != address:
        raise ValueError("Enrollment bundle does not match the active management IP")
    files = {name: directory / name for name in ("ca.crt", "node.crt", "node.key")}
    validate_files(files, address)
    return files


def identity_links(config_dir, files):
    for name, destination in files.items():
        public = config_dir / name
        if public.is_symlink() and public.resolve() == destination.resolve():
            continue
        link = config_dir / (".identity-" + name)
        if link.is_symlink():
            link.unlink()
        os.symlink(str(destination), link)
        os.replace(link, public)


def import_bundle(bundle, address, config_dir=CONFIG_DIR):
    bundle, config_dir = Path(bundle), private_directory(config_dir)
    settings = read_json(bundle / "agent.json")
    files = validate_identity(bundle, settings, address)
    generation = private_directory(config_dir / "identities" / provision.fingerprint(files["node.crt"]))
    for name, path in files.items():
        atomic_write(generation / name, path.read_bytes(), 0o600 if name == "node.key" else 0o644)
    previous = read_json(config_dir / "agent.json")
    merged = dict(settings, **previous)
    for name in ("enabled", "node_id", "listen", "port", "nodes", "peers", "target_aliases"):
        if name in settings:
            merged[name] = settings[name]
    merged["tls"] = {"ca": str(generation / "ca.crt"), "cert": str(generation / "node.crt"),
                     "key": str(generation / "node.key")}
    atomic_write(config_dir / "agent.json", (json.dumps(merged, indent=2) + "\n").encode())
    # Keep the existing public paths usable while each config selects a complete identity generation.
    identity_links(config_dir, {name: generation / name for name in files})
    return merged


def find_bundle(enrollment_dir, address, requested_id=None):
    root = Path(enrollment_dir)
    candidates = [root]
    if root.is_dir():
        candidates.extend(path for path in root.iterdir() if path.is_dir() and not path.is_symlink())
    matches = []
    for candidate in candidates:
        if not (candidate / "agent.json").is_file():
            continue
        settings = read_json(candidate / "agent.json")
        if str(ipaddress.ip_address(settings.get("listen", "0.0.0.0"))) == address and (not requested_id or settings.get("node_id") == requested_id):
            matches.append(candidate)
    if len(matches) > 1:
        raise ValueError("Multiple enrollment bundles match this node")
    if not matches:
        raise Pending("Stage this node's common-CA bundle in " + str(root))
    return matches[0]


def prepare_authority(settings, address, identity, state_dir=STATE_DIR):
    state_dir = private_directory(state_dir)
    authority = Path(settings.get("authority_dir", state_dir / "authority"))
    if not authority.exists():
        previous_umask = os.umask(0o077)
        try:
            provision.init_ca(authority)
        finally:
            os.umask(previous_umask)
    private_directory(authority)
    if not (authority / "ca.key").is_file() or not (authority / "ca.crt").is_file():
        raise ValueError("Existing authority is incomplete; it will not be replaced automatically")
    bundles = private_directory(settings.get("bundles_dir", state_dir / "bundles"))
    if (bundles / identity).exists():
        existing = read_json(bundles / identity / "agent.json")
        validate_identity(bundles / identity, existing, address)
        return bundles / identity
    inventory = read_json(settings.get("inventory", CONFIG_DIR / "nodes.json"), {"nodes": []})
    nodes = inventory.get("nodes", [])
    found = False
    for node in nodes:
        if node.get("id") == identity:
            node["address"] = address
            found = True
    if not found:
        nodes.append({"id": identity, "address": address, "role": "admin"})
    inventory_path = state_dir / "nodes.json"
    atomic_write(inventory_path, (json.dumps({"nodes": nodes}, indent=2) + "\n").encode())
    output = state_dir / (".issuance-" + uuid.uuid4().hex)
    previous_umask = os.umask(0o077)
    try:
        provision.issue_bundles(authority, inventory_path, output, rpm=settings.get("agent_rpm"))
        for issued in output.iterdir():
            destination = bundles / issued.name
            if destination.exists():
                raise ValueError("Existing node bundle will not be overwritten: " + str(destination))
        for issued in output.iterdir():
            os.replace(issued, bundles / issued.name)
        output.rmdir()
    finally:
        os.umask(previous_umask)
    return bundles / identity


def initialize(settings, config_dir=CONFIG_DIR, state_dir=STATE_DIR, bundle=None,
               addresses=None, hostname=None, cluster=None):
    config_dir, state_dir = Path(config_dir), private_directory(state_dir)
    previous = read_json(config_dir / "agent.json")
    addresses = network_addresses() if addresses is None else addresses
    hostname = hostname or socket.gethostname()
    requested_ip = settings.get("management_ip")
    if bundle:
        requested_ip = read_json(Path(bundle) / "agent.json").get("listen")
    elif previous.get("enabled") is True:
        requested_ip = requested_ip or previous.get("listen")
    address = select_management_ip(addresses, settings.get("management_interface"), requested_ip,
                                   cluster, hostname)
    if previous.get("enabled") is True and not bundle:
        # A normal boot/RPM update preserves the existing identity and operator settings.
        tls = previous.get("tls", {})
        if all(Path(tls.get(name, "/nonexistent")).is_file() for name in ("ca", "cert", "key")):
            files = {"ca.crt": Path(tls["ca"]), "node.crt": Path(tls["cert"]), "node.key": Path(tls["key"])}
            validate_files(files, address, allow_symlinks=True)
            if all(config_dir / "identities" in path.parents for path in files.values()):
                identity_links(config_dir, files)
            return {"status": "ready", "changed": False, "node_id": previous["node_id"], "management_ip": address}
        raise ValueError("Configured node identity is incomplete; supply its enrollment bundle")
    mode = settings.get("mode", "member")
    if mode not in ("member", "authority"):
        raise ValueError("Installation mode must be member or authority")
    if bundle:
        selected = Path(bundle)
    elif mode == "authority":
        requested_id = settings.get("node_id")
        if not requested_id:
            inventory = read_json(settings.get("inventory", config_dir / "nodes.json"), {"nodes": []})
            matched = {item["id"] for item in inventory.get("nodes", [])
                       if hostname in [item.get("id"), *item.get("aliases", [])] or item.get("address") == address}
            if len(matched) > 1:
                raise ValueError("Installation inventory identifies this node more than once")
            requested_id = next(iter(matched), None)
        identity = node_id(requested_id, hostname)
        selected = prepare_authority(settings, address, identity, state_dir)
    else:
        selected = find_bundle(settings.get("enrollment_dir", state_dir / "enrollment"), address, settings.get("node_id"))
    imported = import_bundle(selected, address, config_dir)
    return {"status": "ready", "changed": True, "node_id": imported["node_id"], "management_ip": address}


def start_service(restart=False, nonblocking=False):
    subprocess.run(["systemctl", "enable", "cube-agent.service"], check=True)
    command = ["systemctl"] + (["--no-block"] if nonblocking else [])
    subprocess.run(command + ["restart" if restart else "start", "cube-agent.service"], check=True)


def configure_firewall(settings, config_dir=CONFIG_DIR):
    if settings.get("manage_firewall") is not True:
        return None
    from management_firewall import configure
    return configure(read_json(Path(config_dir) / "agent.json"), network_addresses())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--auto", action="store_true", help="Wait harmlessly when network/install assets are not ready")
    parser.add_argument("--authority", action="store_true", help="Only on the designated first installation node")
    parser.add_argument("--bundle")
    parser.add_argument("--management-interface")
    parser.add_argument("--management-ip")
    parser.add_argument("--node-id")
    parser.add_argument("--start", action="store_true")
    parser.add_argument("--restart", action="store_true")
    parser.add_argument("--nonblocking", action="store_true")
    parser.add_argument("--configure-firewall", action="store_true", help="Allow enrolled management IPs on the agent port")
    args = parser.parse_args(argv)
    if os.geteuid() != 0:
        raise PermissionError("Run installation setup with administrator privileges")
    settings = read_json(CONFIG_DIR / "install.json")
    if args.authority:
        settings["mode"] = "authority"
    if args.configure_firewall:
        settings["manage_firewall"] = True
    for name in ("management_interface", "management_ip", "node_id"):
        if getattr(args, name) is not None:
            settings[name] = getattr(args, name)
    private_directory(CONFIG_DIR)
    private_directory(STATE_DIR)
    with (STATE_DIR / "setup.lock").open("a") as lock:
        try:
            # RPM installation may already have queued automatic setup. An explicit
            # installer invocation waits for it instead of failing a successful install.
            fcntl.flock(lock, fcntl.LOCK_EX | (fcntl.LOCK_NB if args.auto else 0))
        except BlockingIOError:
            print(json.dumps({"status": "pending", "reason": "Installation setup is already running"}))
            return 0 if args.auto else 75
        try:
            result = initialize(settings, config_dir=CONFIG_DIR, state_dir=STATE_DIR,
                                bundle=args.bundle, cluster=read_json(CLUSTER_JSON))
            if args.start or args.restart or args.configure_firewall:
                firewall = configure_firewall(settings, CONFIG_DIR)
                if firewall is not None:
                    result["firewall"] = firewall
            if args.start or args.restart:
                start_service(args.restart and result["changed"], args.nonblocking)
            if args.configure_firewall:
                atomic_write(CONFIG_DIR / "install.json", (json.dumps(settings, indent=2) + "\n").encode())
        except Pending as error:
            result = {"status": "pending", "reason": str(error)}
            atomic_write(STATE_DIR / "setup-status.json", (json.dumps(result, indent=2) + "\n").encode())
            print(json.dumps(result))
            return 0 if args.auto else 75
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
            result = {"status": "error", "reason": str(error)}
            atomic_write(STATE_DIR / "setup-status.json", (json.dumps(result, indent=2) + "\n").encode())
            raise
        atomic_write(STATE_DIR / "setup-status.json", (json.dumps(result, indent=2) + "\n").encode())
        print(json.dumps(result))
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print("Cube agent installation: " + str(error), file=sys.stderr)
        sys.exit(1)
