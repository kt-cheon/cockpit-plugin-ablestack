"""Root-owned configuration and mutually authenticated TLS contexts."""
import hashlib
import json
from pathlib import Path
import ssl
from urllib.parse import urlsplit

DEFAULT_CONFIG = "/etc/ablestack/node-agent/agent.json"


def load_config(filename=DEFAULT_CONFIG):
    path = Path(filename)
    info = path.stat()
    if info.st_uid != 0 or info.st_mode & 0o022:
        raise PermissionError("Node agent configuration must be root-owned and not writable by other users")
    config = json.loads(path.read_text())
    if config.get("enabled") is not True:
        raise ValueError("Node agent is not configured; provision its node certificate and inventory first")
    if not config.get("node_id"):
        raise ValueError("node_id is required")
    return config


def tls_context(config, server=False):
    tls = config["tls"]
    context = ssl.create_default_context(
        ssl.Purpose.CLIENT_AUTH if server else ssl.Purpose.SERVER_AUTH,
        cafile=tls["ca"],
    )
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.verify_mode = ssl.CERT_REQUIRED
    if not server:
        context.check_hostname = True
    key = Path(tls["key"])
    info = key.stat()
    if info.st_mode & 0o077:
        raise PermissionError("Node private key must have mode 0600")
    context.load_cert_chain(tls["cert"], str(key))
    return context


def peer_identity(config, certificate):
    fingerprint = hashlib.sha256(certificate).hexdigest()
    peer = config.get("peers", {}).get(fingerprint)
    if not isinstance(peer, dict) or peer.get("role") not in ("reader", "admin"):
        raise PermissionError("Client certificate is not an enrolled peer")
    return peer


def resolve_target(config, target):
    # Legacy call sites can still contain root@host; authentication uses the node certificate.
    target = str(target).rsplit("@", 1)[-1]
    # /etc/hosts uses contextual names (scvm/ablecube) differently on each node.
    target = config.get("target_aliases", {}).get(target, target)
    for name, node in config.get("nodes", {}).items():
        if target not in [name] + node.get("aliases", []):
            continue
        url = urlsplit(node["url"])
        if (url.scheme != "https" or not url.hostname or url.username or url.password
                or url.path not in ("", "/") or url.query or url.fragment):
            raise ValueError("Node URL must be an HTTPS origin without credentials or a path")
        return url.hostname, url.port or 9445
    raise PermissionError("Target is not in the enrolled node inventory: " + target)
