#!/usr/bin/python3
"""Prepare unique node identities offline. The CA private key is never included in a bundle."""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import ssl
import subprocess


def openssl(*args):
    proc = subprocess.run(["openssl", *map(str, args)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode:
        raise RuntimeError(proc.stderr.decode("utf-8", "replace"))


def fingerprint(path):
    return hashlib.sha256(ssl.PEM_cert_to_DER_cert(Path(path).read_text())).hexdigest()


def load_inventory(filename):
    nodes = json.loads(Path(filename).read_text())["nodes"]
    if not isinstance(nodes, list) or not nodes:
        raise ValueError("Inventory needs a nonempty nodes array")
    aliases = set()
    for node in nodes:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", node["id"]):
            raise ValueError("Invalid node id")
        address = ipaddress.ip_address(node["address"])
        if address.is_unspecified or address.is_multicast:
            raise ValueError("Use a node's unicast management address")
        if node.get("role", "admin") not in ("admin", "reader"):
            raise ValueError("Node role must be admin or reader")
        for alias in [node["id"], node["address"], *node.get("aliases", [])]:
            if alias in aliases or not re.fullmatch(r"[A-Za-z0-9_.:-]+", alias):
                raise ValueError("Node aliases must be unique DNS names or IP addresses: " + alias)
            aliases.add(alias)
    node_ids = {node["id"] for node in nodes}
    for node in nodes:
        for alias, target in node.get("target_aliases", {}).items():
            if alias in aliases or not re.fullmatch(r"[A-Za-z0-9_.-]+", alias) or target not in node_ids:
                raise ValueError("Contextual aliases must map a distinct shorthand name to an enrolled node id")
    return nodes


def init_ca(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    request_config = directory / "ca-config.cnf"
    request_config.write_text(
        "[req]\ndistinguished_name=dn\nx509_extensions=ca_extensions\nprompt=no\n"
        "[dn]\nCN=ABLESTACK node management CA\n[ca_extensions]\n"
        "basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n"
        "subjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n")
    openssl("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes",
            "-sha256", "-days", "3650", "-config", request_config,
            "-keyout", directory / "ca.key", "-out", directory / "ca.crt")


def issue_bundles(ca, inventory, output, rpm=None, previous=None):
    ca, output = Path(ca), Path(output)
    nodes = load_inventory(inventory)
    if not (ca / "ca.key").is_file() or not (ca / "ca.crt").is_file():
        raise ValueError("CA key and certificate are required")
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    for node in nodes:
        directory = output / node["id"]
        directory.mkdir(mode=0o700)
        openssl("req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes",
                "-subj", "/CN=" + node["id"], "-keyout", directory / "node.key", "-out", directory / "node.csr")
        names = {node["id"], node["address"], *node.get("aliases", [])}
        sans = []
        for name in sorted(names):
            try:
                ipaddress.ip_address(name)
                sans.append("IP:" + name)
            except ValueError:
                sans.append("DNS:" + name)
        extension = directory / "extensions.conf"
        extension.write_text("basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n"
                             "extendedKeyUsage=serverAuth,clientAuth\nsubjectAltName=" + ",".join(sans) + "\n")
        openssl("x509", "-req", "-in", directory / "node.csr", "-CA", ca / "ca.crt",
                "-CAkey", ca / "ca.key", "-set_serial", str(int.from_bytes(os.urandom(16), "big")),
                "-days", "365", "-sha256", "-extfile", extension, "-out", directory / "node.crt")
        openssl("verify", "-purpose", "sslserver", "-CAfile", ca / "ca.crt", directory / "node.crt")
        (directory / "node.csr").unlink()
        extension.unlink()
        shutil.copyfile(ca / "ca.crt", directory / "ca.crt")
        shutil.copyfile(Path(__file__).parent / "install-bundle.sh", directory / "install-bundle.sh")
        if rpm:
            shutil.copyfile(rpm, directory / "ablecube-agent.rpm")
    peers = {}
    for node in nodes:
        peer = {"name": node["id"], "role": node.get("role", "admin")}
        peers[fingerprint(output / node["id"] / "node.crt")] = peer
        old = Path(previous) / node["id"] / "node.crt" if previous else None
        if old and old.is_file():
            peers[fingerprint(old)] = peer
    endpoints = {}
    for node in nodes:
        address = node["address"]
        if ":" in address:
            address = "[" + address + "]"
        endpoints[node["id"]] = {"url": "https://{}:{}".format(address, node.get("port", 9445)),
                                 "aliases": list(dict.fromkeys([node["address"], *node.get("aliases", [])]))}
    template = json.loads((Path(__file__).parent / "agent.json").read_text())
    for node in nodes:
        config = dict(template, enabled=True, node_id=node["id"], listen=node["address"],
                      port=int(node.get("port", 9445)), nodes=endpoints, peers=peers,
                      target_aliases=node.get("target_aliases", {}))
        (output / node["id"] / "agent.json").write_text(json.dumps(config, indent=2) + "\n")
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    init = sub.add_parser("init-ca")
    init.add_argument("--output", required=True)
    issue = sub.add_parser("issue")
    issue.add_argument("--ca", required=True)
    issue.add_argument("--inventory", required=True)
    issue.add_argument("--output", required=True)
    issue.add_argument("--rpm")
    issue.add_argument("--previous-bundles")
    args = parser.parse_args()
    previous_umask = os.umask(0o077)
    try:
        if args.action == "init-ca":
            init_ca(args.output)
        else:
            issue_bundles(args.ca, args.inventory, args.output, args.rpm, args.previous_bundles)
    finally:
        os.umask(previous_umask)
    print("Prepared:", args.output)


if __name__ == "__main__":
    main()
