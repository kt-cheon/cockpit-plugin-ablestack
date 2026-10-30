#!/usr/bin/python3
"""Command adapter for existing workflows, carried exclusively over authenticated HTTPS."""
import argparse
import http.client
import json
import os
import sys

from client import Client


def legacy_command(args):
    args = list(args)
    while args and args[0].startswith("-"):
        option = args.pop(0)
        if option == "--":
            break
        if option in ("-o", "-p", "-i", "-l", "-F"):
            if not args:
                raise ValueError("Missing legacy transport option value")
            args.pop(0)
        elif option not in ("-q", "-n", "-T", "-t", "-tt", "-4", "-6"):
            raise ValueError("Unsupported legacy transport option: " + option)
    if not args:
        raise ValueError("A target node is required")
    target = args.pop(0)
    while args and args[0] in ("-t", "-tt", "-T"):
        args.pop(0)
    command = " ".join(args)
    stdin = None
    if len(args) >= 2 and args[0] in ("bash", "/bin/bash", "sh", "/bin/sh") and "-s" in args[1:]:
        stdin = sys.stdin.buffer.read(512 * 1024 + 1)
    return target, ["/bin/bash", "-c", command] if command else None, {}, 3600, stdin


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if os.geteuid() != 0:
        raise PermissionError("Administrator access is required; enable it in Cockpit")
    if argv and argv[0] in ("exec", "query", "health"):
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument("operation", choices=("exec", "query", "health"))
        parser.add_argument("--target", required=True)
        parser.add_argument("--argv-json")
        parser.add_argument("--options-json", default="{}")
        parser.add_argument("--name", choices=("snapshot", "cloud-init"))
        parser.add_argument("--timeout", type=int, default=3600)
        args = parser.parse_args(argv)
        client = Client()
        if args.operation == "health":
            print(json.dumps(client.rpc(args.target, "health")))
            return 0
        if args.operation == "query":
            if not args.name:
                parser.error("--name is required for a query")
            print(json.dumps(client.rpc(args.target, "query", name=args.name)))
            return 0
        target, command, options, timeout, stdin = (
            args.target, json.loads(args.argv_json), json.loads(args.options_json), args.timeout, None)
    else:
        target, command, options, timeout, stdin = legacy_command(argv)
        client = Client()
    if command is None:
        client.rpc(target, "health")
        return 0
    result = client.execute(target, command, options=options, timeout=timeout, stdin=stdin,
                            stdout=sys.stdout.buffer, stderr=sys.stderr.buffer)
    return result.returncode if result.returncode >= 0 else 128 - result.returncode


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, http.client.HTTPException) as error:
        print("ABLESTACK remote transport: " + str(error), file=sys.stderr)
        sys.exit(1)
