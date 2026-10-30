#!/usr/bin/python3
"""Compatibility entry point: certificate enrollment replaces SSH host-key scans."""
import json
print(json.dumps({"code": 200, "val": "Node certificate enrollment is used; no scan was performed."}))
