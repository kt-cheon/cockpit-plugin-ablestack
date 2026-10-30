"""Typed queries shared by dashboard collectors; these cannot execute shell input."""
from client import Client


def vm_details(target):
    info = Client().rpc(target, "query", name="snapshot")
    size = available = usage = "N/A"
    for line in info.get("df", "").splitlines()[1:]:
        fields = line.split()
        if len(fields) >= 6 and fields[-1] == "/":
            size, available, usage = fields[1], fields[3], fields[4]
            break
    return {"size": size, "available": available, "usage": usage,
            "gateway": info.get("gateway") or "N/A", "dns": next(iter(info.get("dns", [])), "N/A")}


def legacy_vm_output(target):
    info = Client().rpc(target, "query", name="snapshot")
    services = info.get("services", {})
    return "\n".join([info.get("df", "").rstrip(), "__END_DF__", info.get("gateway", ""),
                      next(iter(info.get("dns", [])), ""), services.get("mold.service", "unknown"),
                      services.get("mysqld", "unknown")])
