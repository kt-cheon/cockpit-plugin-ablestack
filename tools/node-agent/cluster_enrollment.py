#!/usr/bin/python3
"""Enroll Cube nodes from the Cockpit cluster preparation profile, after bridge setup."""
import argparse
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import socket
import sys
import tempfile

import node_setup as setup
import provision

FORMAT = "ablestack-cube-enrollment-v1"
FILES = {"agent.json", "ca.crt", "node.crt", "node.key"}
VM_RPM = Path("/usr/share/cockpit/ablestack/tools/node-agent/ablecube-agent.rpm")
PROPERTIES_DIR = setup.CLUSTER_JSON.parent
MAX_INPUT = 1024 * 1024


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", value):
        raise ValueError("Invalid cluster node name")
    return value


def address(value):
    parsed = ipaddress.ip_address(value)
    if parsed.is_unspecified or parsed.is_loopback or parsed.is_link_local or parsed.is_multicast:
        raise ValueError("A usable management IP is required")
    return str(parsed)


def cluster_layout(profile):
    cluster = profile["clusterConfig"]
    kind = cluster["type"]
    if kind not in ("ablestack-hci", "ablestack-hci-filesystem", "ablestack-vm", "ablestack-standalone", "powerflex"):
        raise ValueError("Unsupported cluster type")
    hci = kind not in ("ablestack-vm", "ablestack-standalone")
    hosts, nodes, storage = [], [], {}
    rows = sorted(cluster["hosts"], key=lambda item: int(item["index"]))
    if not rows or len(rows) > 128 or len({int(row["index"]) for row in rows}) != len(rows):
        raise ValueError("Cluster host indexes must be unique")
    for row in rows:
        name, index = identifier(row["hostname"]), str(int(row["index"]))
        hosts.append(name)
        aliases = [row.get("ablecubePn"), "pn-ablecube" + index if row.get("ablecubePn") else None]
        node = {"id": name, "address": address(row["ablecube"]), "role": "admin",
                "aliases": list(dict.fromkeys(value for value in aliases if value and value != row["ablecube"] and value != name)),
                "target_aliases": {"ablecube": name}}
        if row.get("ablecubePn"):
            node["target_aliases"]["pn-ablecube"] = name
        nodes.append(node)
        if hci:
            vm = "scvm" + index
            storage[name] = vm
            aliases = [vm + "-mngt", row.get("scvm"), row.get("scvmCn"), "pn-scvm" + index, "cn-scvm" + index]
            nodes.append({"id": vm, "address": address(row["scvmMngt"]), "role": "admin",
                          "aliases": list(dict.fromkeys(value for value in aliases if value and value != row["scvmMngt"] and value != vm)),
                          "target_aliases": {"ablecube": name, "pn-ablecube": name,
                                             "scvm": vm, "scvm-mngt": vm, "pn-scvm": vm, "cn-scvm": vm}})
            node["target_aliases"].update({"scvm": vm, "scvm-mngt": vm, "pn-scvm": vm, "cn-scvm": vm})
    nodes.append({"id": "ccvm", "address": address(cluster["ccvm"]["ip"]),
                  "role": "admin", "aliases": ["ccvm-mngt"]})
    # A shorthand equal to a real node name resolves globally without another mapping.
    global_names = {value for node in nodes for value in [node["id"], node["address"], *node.get("aliases", [])]}
    for node in nodes:
        node["target_aliases"] = {key: target for key, target in node.get("target_aliases", {}).items()
                                  if key not in global_names}
    candidates = []
    for value in cluster.get("pcsCluster", {}).values():
        matches = [node["id"] for node in nodes if node["id"] in hosts and
                   value in [node["id"], node["address"], *node.get("aliases", [])]]
        if matches:
            candidates.extend(matches)
    candidates = sorted(set(candidates or hosts[:3]))
    # Reuse the issuer's strict alias/ID/address checks without maintaining a second schema.
    inventory = {"nodes": nodes}
    with tempfile.TemporaryDirectory(prefix="cube-inventory-") as directory:
        filename = Path(directory) / "nodes.json"
        filename.write_text(json.dumps(inventory))
        provision.load_inventory(filename)
    return {"type": kind, "inventory": inventory, "hosts": hosts, "storage": storage, "pcs_hosts": candidates}


def layout_digest(layout):
    return hashlib.sha256(json.dumps(layout, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def local_host(layout, hostname, addresses):
    names = {hostname, hostname.split(".")[0]}
    matched = [node for node in layout["inventory"]["nodes"] if node["id"] in layout["hosts"] and node["id"] in names]
    if len(matched) != 1:
        raise ValueError("The current hostname must identify exactly one host in the cluster profile")
    node = matched[0]
    if node["address"] not in {item["address"] for item in addresses}:
        raise ValueError("Apply the bridge management IP from the cluster profile on this host before preparing the cluster")
    return node


def owned_bundles(layout, host):
    result = [host]
    if host in layout["storage"]:
        result.append(layout["storage"][host])
    if host in layout["pcs_hosts"]:
        result.append("ccvm")
    return result


def registration_document(host, manifest, bundles):
    layout = manifest["layout"]
    if host not in layout["hosts"]:
        raise ValueError("Unknown cluster host")
    return {"format": FORMAT, "host": host, "digest": manifest["digest"],
            "bundles": {name: {filename: (bundles / name / filename).read_text() for filename in FILES}
                        for name in owned_bundles(layout, host)}}


def registration_path(host, properties_dir):
    return Path(properties_dir) / (identifier(host) + ".cube-agent.json")


def vm_registration_document(hostname, profile, bundle):
    """A VM receives only its own identity, never its physical host's private key."""
    layout = cluster_layout(profile)
    if hostname in layout["hosts"]:
        raise ValueError("A VM bootstrap identity must not be a physical host identity")
    expected = next((node for node in layout["inventory"]["nodes"] if node["id"] == hostname), None)
    if expected is None and hostname in ("gwvm", "pfmp"):
        field = "ip" if hostname == "gwvm" else "ingress_ip"
        value = profile["clusterConfig"].get(hostname, {}).get(field)
        if value:
            expected = {"address": address(value)}
    if expected is None:
        raise ValueError("VM is not in the prepared cluster profile")
    contents = {filename: (Path(bundle) / filename).read_text() for filename in FILES}
    settings = json.loads(contents["agent.json"])
    if settings.get("node_id") != hostname or settings.get("enabled") is not True or address(settings["listen"]) != expected["address"]:
        raise ValueError("VM identity does not match the prepared cluster profile")
    return {"format": FORMAT, "host": hostname, "digest": layout_digest(layout), "bundles": {hostname: contents}}


def save_registration(document, properties_dir):
    directory = Path(properties_dir)
    directory.mkdir(parents=True, exist_ok=True, mode=0o755)
    info = directory.stat()
    if directory.is_symlink() or info.st_uid != os.geteuid() or info.st_mode & 0o022:
        raise PermissionError("Registration directory must be owned by the administrator and not writable by others")
    path = registration_path(document["host"], directory)
    if path.is_symlink():
        raise PermissionError("Registration file must not be a symlink")
    if path.exists():
        setup.read_json(path)  # Reject an untrusted owner or writable file before replacing it.
        path.chmod(0o600)
    contents = (json.dumps(document, indent=2) + "\n").encode()
    if not path.exists() or path.read_bytes() != contents:
        setup.atomic_write(path, contents)
    return path


def check_existing_ca(config_dir, ca):
    current = setup.read_json(config_dir / "agent.json")
    if current.get("enabled") is True:
        existing = Path(current["tls"]["ca"])
        if provision.fingerprint(existing) != provision.fingerprint(ca):
            raise ValueError("This host is already enrolled in a different cluster CA")


def apply_local(layout, node, bundles, config_dir, state_dir, rpm):
    expected = {item["id"]: item for item in layout["inventory"]["nodes"]}
    names = owned_bundles(layout, node["id"])
    # Validate everything before installing any identity or replacing operational files.
    for name in names:
        cfg = setup.read_json(bundles / name / "agent.json")
        if cfg.get("node_id") != name:
            raise ValueError("Enrollment bundle has the wrong node ID")
        setup.validate_identity(bundles / name, cfg, expected[name]["address"])
        if provision.fingerprint(bundles / name / "ca.crt") != provision.fingerprint(bundles / node["id"] / "ca.crt"):
            raise ValueError("All node bundles must use the same cluster CA")
    check_existing_ca(config_dir, bundles / node["id"] / "ca.crt")
    current = setup.read_json(config_dir / "agent.json")
    if current.get("enabled") is True:
        if provision.fingerprint(Path(current["tls"]["cert"])) != provision.fingerprint(bundles / node["id"] / "node.crt"):
            raise ValueError("Certificate rotation requires the explicit certificate renewal workflow")
    setup.private_directory(state_dir / "bundles")
    for name in names:
        destination = setup.private_directory(state_dir / "bundles" / name)
        if (destination / "node.crt").exists() and provision.fingerprint(destination / "node.crt") != provision.fingerprint(bundles / name / "node.crt"):
            raise ValueError("An existing VM/node identity will not be replaced automatically")
    for name in names:
        destination = state_dir / "bundles" / name
        for filename in FILES:
            setup.atomic_write(destination / filename, (bundles / name / filename).read_bytes())
        shutil.copyfile(Path(__file__).parent / "install-bundle.sh", destination / "install-bundle.sh")
        if name not in layout["hosts"]:
            setup.atomic_write(destination / "ablecube-agent.rpm", rpm.read_bytes())
    # Preserve an existing operational identity and settings during repeated preparation.
    if current.get("enabled") is not True:
        setup.import_bundle(state_dir / "bundles" / node["id"], node["address"], config_dir)
    policy = setup.read_json(config_dir / "install.json")
    policy.update(mode="member", node_id=node["id"], management_ip=node["address"], management_interface=None,
                  manage_firewall=True)
    setup.atomic_write(config_dir / "install.json", (json.dumps(policy, indent=2) + "\n").encode())


def prepare_cluster(profile, registration=None, allow_create=False, config_dir=setup.CONFIG_DIR,
                    state_dir=setup.STATE_DIR, hostname=None, addresses=None, rpm=VM_RPM,
                    properties_dir=PROPERTIES_DIR):
    config_dir, state_dir, rpm = Path(config_dir), Path(state_dir), Path(rpm)
    layout = cluster_layout(profile)
    node = local_host(layout, hostname or socket.gethostname(), setup.network_addresses() if addresses is None else addresses)
    setup.private_directory(config_dir)
    setup.private_directory(state_dir)
    if any(name not in layout["hosts"] for name in owned_bundles(layout, node["id"])) and not rpm.is_file():
        raise ValueError("VM bootstrap agent RPM is missing; install the matching ablecube package")
    manifest = state_dir / "cluster-enrollment.json"
    if manifest.exists():
        previous = setup.read_json(manifest)
        if previous["digest"] != layout_digest(layout):
            raise ValueError("The enrolled cluster layout changed; update membership using the existing CA before applying this profile")
    source = state_dir / "issuer-bundles"
    if registration is not None:
        if registration.get("format") != FORMAT or registration.get("host") != node["id"] or registration.get("digest") != layout_digest(layout):
            raise ValueError("Select the registration file for this host and this cluster profile")
        expected = set(owned_bundles(layout, node["id"]))
        if set(registration.get("bundles", {})) != expected:
            raise ValueError("Registration file contains missing or unrelated node bundles")
        with tempfile.TemporaryDirectory(prefix=".registration-", dir=str(state_dir)) as directory:
            source = Path(directory)
            for name, contents in registration["bundles"].items():
                if set(contents) != FILES or not all(isinstance(text, str) and len(text) < 262144 for text in contents.values()):
                    raise ValueError("Invalid registration file contents")
                target = setup.private_directory(source / name)
                for filename, content in contents.items():
                    setup.atomic_write(target / filename, content.encode())
            apply_local(layout, node, source, config_dir, state_dir, rpm)
    elif source.is_dir():
        if not manifest.exists() or setup.read_json(manifest)["digest"] != layout_digest(layout):
            raise ValueError("Existing issuer files do not match this cluster profile")
        apply_local(layout, node, source, config_dir, state_dir, rpm)
    elif setup.read_json(config_dir / "agent.json").get("enabled") is True and manifest.exists():
        apply_local(layout, node, state_dir / "bundles", config_dir, state_dir, rpm)
    else:
        if not allow_create:
            raise ValueError("Upload this host's registration file downloaded from the first cluster host")
        authority = state_dir / "authority"
        if authority.exists() or setup.read_json(config_dir / "agent.json").get("enabled") is True:
            raise ValueError("Existing credentials will not be replaced by a new cluster CA")
        previous_umask = os.umask(0o077)
        try:
            provision.init_ca(authority)
            inventory = state_dir / "nodes.json"
            setup.atomic_write(inventory, json.dumps(layout["inventory"], indent=2).encode())
            provision.issue_bundles(authority, inventory, source)
        finally:
            os.umask(previous_umask)
        # Persist the issued plan before local import, so a retry uses the same identities.
        setup.atomic_write(manifest, json.dumps({"digest": layout_digest(layout), "layout": layout}).encode())
        apply_local(layout, node, source, config_dir, state_dir, rpm)
    setup.atomic_write(manifest, json.dumps({"digest": layout_digest(layout), "layout": layout}).encode())
    saved_manifest = {"digest": layout_digest(layout), "layout": layout}
    issuer = state_dir / "issuer-bundles"
    export_hosts = layout["hosts"] if issuer.is_dir() else []
    for host in export_hosts or [node["id"]]:
        save_registration(registration_document(host, saved_manifest, issuer if export_hosts else state_dir / "bundles"),
                          properties_dir)
    status = {"status": "ready", "node_id": node["id"], "management_ip": node["address"]}
    setup.atomic_write(state_dir / "setup-status.json", json.dumps(status).encode())
    return dict(status, exports=export_hosts)


def export_registration(host, state_dir=setup.STATE_DIR, properties_dir=PROPERTIES_DIR):
    state_dir = Path(state_dir)
    manifest = setup.read_json(state_dir / "cluster-enrollment.json")
    layout = manifest["layout"]
    if host not in layout["hosts"]:
        raise ValueError("Unknown cluster host")
    path = registration_path(host, properties_dir)
    if not path.exists():
        # Existing installations keep their original CA and keys; materialize the
        # managed JSON from their existing issuance files on the next download.
        root = state_dir / "issuer-bundles"
        if not root.is_dir():
            root = state_dir / "bundles"
        save_registration(registration_document(host, manifest, root), properties_dir)
    document = setup.read_json(path)
    if path.stat().st_mode & 0o077:
        raise PermissionError("Registration file containing private keys must have mode 0600")
    if document.get("format") != FORMAT or document.get("host") != host or document.get("digest") != manifest["digest"]:
        raise ValueError("Stored registration file does not match this host and cluster")
    return document


def main():
    if os.geteuid() != 0:
        raise PermissionError("Cockpit administrator access is required")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "export"))
    parser.add_argument("--source", choices=("new", "existing"), default="existing")
    parser.add_argument("--host")
    args = parser.parse_args()
    if args.action == "export":
        print(json.dumps(export_registration(args.host)))
        return
    incoming = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(incoming) > MAX_INPUT:
        raise ValueError("Cluster registration input is too large")
    request = json.loads(incoming)
    setup.private_directory(setup.STATE_DIR)
    with (setup.STATE_DIR / "setup.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        result = prepare_cluster(request["cluster"], request.get("registration"), args.source == "new")
        firewall = setup.configure_firewall(setup.read_json(setup.CONFIG_DIR / "install.json"))
        if firewall is not None:
            result["firewall"] = firewall
        setup.start_service()
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Cube cluster enrollment: " + str(error), file=sys.stderr)
        sys.exit(1)
