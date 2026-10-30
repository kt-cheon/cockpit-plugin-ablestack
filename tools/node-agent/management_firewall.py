"""Configure only the enrolled peers' access to the management agent during enrollment."""
import ipaddress
import os
import re
import shutil
import subprocess
from urllib.parse import urlsplit


def command(arguments, allowed=(0,)):
    result = subprocess.run(["firewall-cmd", *arguments], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, timeout=10,
                            env=dict(os.environ, LC_ALL="C"))
    if result.returncode not in allowed:
        message = result.stderr.strip() or result.stdout.strip() or str(result.returncode)
        raise RuntimeError("Cube Agent firewall setup failed: " + message)
    return result


def rule_plan(config, addresses):
    listen = ipaddress.ip_address(config["listen"])
    if listen.is_unspecified or listen.is_loopback or listen.is_link_local or listen.is_multicast:
        raise ValueError("Firewall setup requires a unicast management address")
    interfaces = {item["interface"] for item in addresses if ipaddress.ip_address(item["address"]) == listen}
    if len(interfaces) != 1:
        raise ValueError("The agent management IP must identify exactly one active interface")
    port = int(config.get("port", 9445))
    if not 1 <= port <= 65535:
        raise ValueError("Invalid agent port")
    peers = set()
    for endpoint in config.get("nodes", {}).values():
        url = urlsplit(endpoint["url"])
        if url.scheme != "https" or not url.hostname or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment:
            raise ValueError("Firewall peers must use registered HTTPS management origins")
        try:
            address = ipaddress.ip_address(url.hostname)
        except ValueError:
            raise ValueError("Firewall enrollment requires literal peer management IPs") from None
        if address.is_unspecified or address.is_loopback or address.is_link_local or address.is_multicast:
            raise ValueError("Firewall peers must use unicast management IPs")
        if address.version == listen.version and address != listen:
            peers.add(address)
    family = "ipv4" if listen.version == 4 else "ipv6"
    suffix = "32" if listen.version == 4 else "128"
    rules = ['rule family="{}" source address="{}/{}" destination address="{}/{}" '
             'port port="{}" protocol="tcp" accept'.format(family, address, suffix, listen, suffix, port)
             for address in sorted(peers)]
    return next(iter(interfaces)), rules


def configure(config, addresses):
    # Validate the complete plan before the first firewall mutation.
    interface, rules = rule_plan(config, addresses)
    if shutil.which("firewall-cmd") is None:
        return {"status": "unavailable", "interface": interface}
    state = command(["--state"], allowed=(0, 1, 252))
    if state.returncode:
        if "not running" in (state.stdout + " " + state.stderr).lower():
            return {"status": "not-running", "interface": interface}
        raise RuntimeError("Cannot determine firewalld state: " + (state.stderr.strip() or state.stdout.strip()))
    result = command(["--get-zone-of-interface=" + interface], allowed=(0, 2))
    zone = result.stdout.strip()
    if result.returncode == 2 or zone in ("", "no zone"):
        zone = command(["--get-default-zone"]).stdout.strip()
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}", zone):
        raise ValueError("Invalid firewalld management zone")
    for rule in rules:
        for permanent in (True, False):
            arguments = (["--permanent"] if permanent else []) + ["--zone=" + zone]
            present = command([*arguments, "--query-rich-rule=" + rule], allowed=(0, 1))
            if present.returncode == 1:
                command([*arguments, "--add-rich-rule=" + rule])
    # No daemon restart/reload, zone/interface changes, broad port openings or
    # modifications to existing rules are necessary.
    return {"status": "configured", "interface": interface, "zone": zone, "rules": len(rules)}
