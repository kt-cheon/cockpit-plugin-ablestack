#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import os
import shlex
import subprocess
from pathlib import Path

try:
    from ablestack import createReturn
except Exception:
    def createReturn(code, val, retname=None):
        ret = {"code": code, "val": val}
        if retname is not None:
            ret["retname"] = retname
        return json.dumps(ret, ensure_ascii=False)


OS_RELEASE_PATH = Path("/etc/os-release")
TARGET_KS_PATH = Path("ks/ablestack-ks.cfg")
TARGET_UPDATE_SCRIPT = Path("update.sh")


def parse_args():
    parser = argparse.ArgumentParser(description="ABLESTACK ISO update helper")
    parser.add_argument("action", choices=["info", "run"], help="Action to execute")
    parser.add_argument("--mount-path", required=True, help="Mounted ABLESTACK ISO path")
    return parser.parse_args()


def normalize_value(value):
    value = value.strip()
    if value == "":
        return ""
    try:
        parsed = shlex.split(value, posix=True)
        if len(parsed) == 1:
            return parsed[0]
    except ValueError:
        pass
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value


def parse_key_values(path):
    values = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = normalize_value(value)
    return values


def validate_mount_path(mount_path):
    if not mount_path:
        raise ValueError("ISO 마운트 경로를 입력해야 합니다.")

    path = Path(mount_path).expanduser()
    if not path.is_absolute():
        raise ValueError("ISO 마운트 경로는 절대 경로로 입력해야 합니다.")
    if not path.exists():
        raise FileNotFoundError("입력한 ISO 마운트 경로가 존재하지 않습니다.")
    if not path.is_dir():
        raise NotADirectoryError("입력한 ISO 마운트 경로가 디렉터리가 아닙니다.")
    return path.resolve()


def read_update_info(mount_path):
    mount = validate_mount_path(mount_path)
    ks_path = mount / TARGET_KS_PATH
    update_script_path = mount / TARGET_UPDATE_SCRIPT

    if not ks_path.exists():
        raise FileNotFoundError(f"{TARGET_KS_PATH} 파일을 찾을 수 없습니다.")
    if not update_script_path.exists():
        raise FileNotFoundError(f"{TARGET_UPDATE_SCRIPT} 파일을 찾을 수 없습니다.")

    current_info = parse_key_values(OS_RELEASE_PATH)
    target_ks_info = parse_key_values(ks_path)

    target_ablestack_version = target_ks_info.get("ABLESTACK_VERSION", "")

    if target_ablestack_version == "":
        raise ValueError(f"{TARGET_KS_PATH} 파일에서 ABLESTACK_VERSION 값을 찾을 수 없습니다.")

    return {
        "mount_path": str(mount),
        "current_ablestack_version": current_info.get("PRETTY_NAME", "N/A"),
        "target_ablestack_version": target_ablestack_version,
        "update_script": str(update_script_path),
    }


def run_update(mount_path):
    info = read_update_info(mount_path)
    env = os.environ.copy()
    env["ABLESTACK_UPDATE_MOUNT_PATH"] = info["mount_path"]

    proc = subprocess.run(
        ["/bin/bash", info["update_script"]],
        cwd=info["mount_path"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=False,
    )
    if proc.returncode != 0:
        message = proc.stderr.strip() or proc.stdout.strip() or "ABLESTACK Version 업데이트 실행 중 오류가 발생했습니다."
        raise RuntimeError(message)

    return {
        "message": "ABLESTACK Version 업데이트 실행이 완료되었습니다.",
        "stdout": proc.stdout.strip(),
        "stderr": proc.stderr.strip(),
    }


def main():
    args = parse_args()
    try:
        if args.action == "info":
            ret = createReturn(code=200, val=read_update_info(args.mount_path))
        else:
            ret = createReturn(code=200, val=run_update(args.mount_path))
    except Exception as e:
        ret = createReturn(code=500, val=str(e))
    print(ret)


if __name__ == "__main__":
    main()
