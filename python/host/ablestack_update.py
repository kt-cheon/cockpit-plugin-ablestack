#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
from contextlib import contextmanager
from functools import lru_cache
import fcntl
import json
import os
import shutil
import shlex
import re
import subprocess
import sys
import importlib.util
from string import Formatter
from pathlib import Path
from urllib.parse import urlsplit

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
UPDATE_WORK_DIR = Path("/opt/ABLESTACK_UPDATE")
UPDATE_LOCK_PATH = Path("/run/lock/ablestack-update.lock")
HA_HELPER_PATH = Path(__file__).with_name("mold-ha.py")
PACKAGE_POLICY_PATH = Path(__file__).with_name('package-policy.py')
UPDATE_LOG_PATHS = {
    "all": Path("/var/log/ablestack-update.log"),
    "tools": Path("/var/log/ablestack-update.log"),
    "mold": Path("/var/log/ablestack-mold-update.log"),
    "packages": Path("/var/log/ablestack-rpm-update.log"),
}
MOLD_PACKAGES = (
    "cloudstack-common",
    "cloudstack-agent",
    "cloudstack-management",
    "cloudstack-usage",
    "cloudstack-ui",
)
MOLD_RPM_QUERY_FORMAT = "%{NAME}\t%{VERSION}-%{RELEASE}\t%{ARCH}\n"
UPDATE_SCRIPT_MAP = {
    "all": {
        "label": "전체 패키지 업데이트",
        "script": Path("update/update-all.sh"),
    },
    "mold": {
        "label": "Mold 패키지 업데이트",
        "script": Path("update/update-mold.sh"),
    },
    "tools": {
        "label": "ABLESTACK Tools 업데이트",
        "script": Path("update/update-qemu-exec-tools.sh"),
    },
    "packages": {
        "label": "기타 패키지 업데이트",
        "script": Path("update/update-all.sh"),
    },
}


def parse_args():
    parser = argparse.ArgumentParser(description="ABLESTACK ISO update helper")
    parser.add_argument("action", choices=["info", "run", "log"], help="Action to execute")
    parser.add_argument("--mount-path", help="Mounted ABLESTACK ISO path")
    parser.add_argument("--credentials-stdin", action="store_true", help="Read Mold credentials from stdin only")
    parser.add_argument(
        "--update-type",
        choices=sorted(UPDATE_SCRIPT_MAP.keys()),
        default="all",
        help="Update type to execute",
    )
    return parser.parse_args()


@lru_cache(maxsize=1)
def update_log_translations():
    """Load display templates only; never rewrite the on-disk update log."""
    catalog = Path(__file__).with_name("ablestack_update_messages.json")
    try:
        entries = json.loads(catalog.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ()
    compiled = []
    for entry in entries:
        pattern, fields, weight = [], set(), 0
        for literal, name, _, _ in Formatter().parse(entry["en"]):
            pattern.append(re.escape(literal))
            weight += len(literal)
            if name is not None:
                pattern.append(f"(?P={name})" if name in fields else f"(?P<{name}>[^\\r\\n]*?)")
                fields.add(name)
        generic = entry["en"] in ("{p0} failed", "{p0} completed", "{p0} started",
                                  "{p0} check passed", "{p0} check failed")
        compiled.append((weight, re.compile("^" + "".join(pattern) + "$"),
                         entry["ko"], entry.get("nested", ()), generic))
    return tuple(sorted(compiled, key=lambda item: -item[0]))


def localize_update_output(output):
    """Translate known script messages, preserving timestamps, values and raw RPM output."""
    def translate(message, depth=0, allow_generic=False):
        # Match specific messages (with or without a severity prefix) before
        # generic endings, so "update not started" is not treated as a start.
        for generic_pass in (False, True):
            if generic_pass:
                severity = re.match(r"^(ERROR: |WARN: )(.*)$", message)
                if severity and depth < 3:
                    return severity[1] + translate(severity[2], depth + 1, allow_generic)
                if not allow_generic:
                    break
            for _, pattern, korean, nested, generic in update_log_translations():
                if generic != generic_pass:
                    continue
                match = pattern.fullmatch(message)
                if match is not None:
                    values = match.groupdict()
                    if depth < 3:
                        for field in nested:
                            values[field] = translate(values[field], depth + 1, True)
                    return korean.format_map(values)
        return message

    lines = []
    for line in output.splitlines(keepends=True):
        body = line.rstrip("\r\n")
        ending = line[len(body):]
        match = re.match(r"^((?:\[[^\]\r\n]+\]\s*)*)(.*)$", body)
        lines.append(match[1] + translate(match[2], allow_generic=bool(match[1])) + ending)
    return "".join(lines)


def read_update_log(update_type="all"):
    """Read a bounded tail of a fixed log path; caller input cannot select a file."""
    get_update_script_info(update_type)
    path = UPDATE_LOG_PATHS[update_type]
    try:
        with path.open("rb") as source:
            size = source.seek(0, os.SEEK_END)
            offset = max(0, size - 65536)
            source.seek(offset)
            data = source.read(65536)
        if offset:
            data = data.partition(b"\n")[2]
        raw = b"\n".join(data.splitlines()[-300:]).decode("utf-8", errors="replace")
    except FileNotFoundError:
        raw = ""
    return {"log_file": str(path), "text": localize_update_output(raw)}


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
    if not path.exists():
        return {}
    return parse_key_values_text(path.read_text(encoding="utf-8", errors="replace"))


def parse_key_values_text(content):
    values = {}
    for raw_line in content.splitlines():
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


def get_update_script_info(update_type):
    script_info = UPDATE_SCRIPT_MAP.get(update_type)
    if script_info is None:
        raise ValueError("지원하지 않는 업데이트 방식입니다.")
    return script_info


def is_path_relative_to(path, parent):
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def detect_rpm_command():
    for command in ("aspkg", "rpm"):
        if shutil.which(command) is None:
            continue
        proc = subprocess.run(
            [command, "--version"],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
        )
        if proc.returncode == 0:
            return command
    raise RuntimeError("Mold RPM을 확인할 수 있는 rpm/aspkg 명령이 없습니다.")


def read_mold_iso_info(mount):
    # update-mold.sh의 검색 순서와 일치시킨다. ks/config/저장소 메타데이터는 불필요하다.
    rpm_dir = mount
    for relative_path in ("rpms", "AppStream/Packages/mold"):
        candidate = mount / relative_path
        if candidate.is_dir():
            rpm_dir = candidate
            break

    rpm_paths = sorted(path for path in rpm_dir.rglob("*.rpm")
                       if path.is_file() and not path.is_symlink())
    if not rpm_paths:
        raise FileNotFoundError(f"Mold RPM 파일을 찾을 수 없습니다: {rpm_dir}")

    rpm_command = detect_rpm_command()
    packages = {}
    for rpm_path in rpm_paths:
        proc = subprocess.run(
            [rpm_command, "-qp", "--qf", MOLD_RPM_QUERY_FORMAT, "--", str(rpm_path)],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
        )
        if proc.returncode != 0:
            raise ValueError(f"RPM 정보를 읽을 수 없습니다: {rpm_path}\n{proc.stderr.strip()}")
        fields = proc.stdout.strip().split("\t")
        if len(fields) != 3 or not all(fields) or "\n" in proc.stdout.strip():
            raise ValueError(f"RPM 정보 형식이 잘못되었습니다: {rpm_path}")
        name, version, arch = fields
        if name not in MOLD_PACKAGES:
            continue
        if name in packages:
            raise ValueError(f"{name} RPM이 중복되었습니다. 패키지별 하나씩만 준비하세요.")
        packages[name] = {"name": name, "version": version, "arch": arch, "path": str(rpm_path)}

    missing = [name for name in MOLD_PACKAGES if name not in packages]
    if missing:
        raise FileNotFoundError(f"필수 Mold RPM이 없습니다: {', '.join(missing)}")

    # 호스트의 cloudstack-common에서 VERSION-RELEASE만 읽는다 (패키지명, epoch, 아키텍처 제외).
    # 설치 가능 여부/CCVM 상태 검사는 실행 스크립트가 담당한다.
    current = subprocess.run(
        [rpm_command, "-q", "--qf", "%{VERSION}-%{RELEASE}\n", "--", "cloudstack-common"],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    current_version = current.stdout.strip() if current.returncode == 0 else ""
    return {
        "mold_rpm_dir": str(rpm_dir),
        "mold_packages": [packages[name] for name in MOLD_PACKAGES],
        "current_mold_version": current_version or "N/A",
        "target_mold_version": packages["cloudstack-common"]["version"],
    }


def read_update_info(mount_path, update_type="all"):
    mount = validate_mount_path(mount_path)
    script_info = get_update_script_info(update_type)
    script_relative_path = script_info["script"]
    update_script_path = mount / script_relative_path

    if not update_script_path.is_file():
        raise FileNotFoundError(f"{script_relative_path} 파일을 찾을 수 없습니다.")

    current_info = parse_key_values(OS_RELEASE_PATH)
    current_ablestack_version = current_info.get("PRETTY_NAME", "N/A")
    mold_info = {}
    manifest = mount / 'update/manifest.json'
    unified = False
    if update_type != 'tools' and manifest.is_file():
        try:
            metadata = json.loads(manifest.read_text(encoding='utf-8'))
            unified = metadata.get('format') == 'ablestack-rpm-update' and metadata.get('version') in (2, 3)
        except (ValueError, AttributeError):
            raise ValueError('통합 업데이트 ISO manifest 형식이 잘못되었습니다.') from None
        if not unified:
            raise ValueError('지원하지 않는 통합 업데이트 ISO 형식입니다.')
    if unified:
        if not (mount / 'rpms/repodata/repomd.xml').is_file() or not (mount / 'SHA256SUMS').is_file():
            raise FileNotFoundError('통합 업데이트 ISO에 RPM 저장소와 SHA256SUMS가 필요합니다.')
        command = detect_rpm_command()
        records = []
        seen = set()
        for path in sorted((mount / 'rpms').rglob('*.rpm')):
            proc = subprocess.run([command, '-qp', '--qf', MOLD_RPM_QUERY_FORMAT, '--', str(path)],
                                  text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            fields = proc.stdout.strip().split('\t')
            if proc.returncode or len(fields) != 3:
                raise ValueError('통합 ISO의 RPM 헤더를 읽을 수 없습니다.')
            name, version, arch = fields
            if arch in ('src', 'nosrc') or (name, arch) in seen:
                raise ValueError('통합 ISO에 소스/중복 RPM이 있습니다.')
            seen.add((name, arch))
            records.append(dict(name=name, version=version, arch=arch))
        if not records:
            raise ValueError('통합 ISO에 RPM이 없습니다.')
        role_packages = None
        if metadata['version'] == 3:
            if not PACKAGE_POLICY_PATH.is_file():
                raise FileNotFoundError('역할별 패키지 검증 모듈이 없습니다. Cockpit 플러그인을 업데이트하세요.')
            spec = importlib.util.spec_from_file_location('ablestack_package_policy', PACKAGE_POLICY_PATH)
            policy = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(policy)
            plan = policy.resolve(policy.load_config(mount / 'packages.json'), records)
            scope = {'all': 'all', 'mold': 'mold', 'packages': 'packages'}[update_type]
            scoped_plan = {role: policy.scoped(plan, role, scope) for role in policy.ROLES}
            role_packages = {role: [row['name'] + '.' + row['arch'] for row in rows] for role, rows in scoped_plan.items()}
            unique = {(row['name'], row['arch']): row for rows in scoped_plan.values() for row in rows}
            records = list(unique.values())
        mold_records = [row for row in records if row['name'] in MOLD_PACKAGES]
        selected = (mold_records if update_type == 'mold' else
                    [row for row in records if not row['name'].startswith('cloudstack')] if update_type == 'packages' else records)
        current = subprocess.run([command, '-q', '--qf', '%{VERSION}-%{RELEASE}\n', '--', 'cloudstack-common'],
                                 text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        common = next((row['version'] for row in mold_records if row['name'] == 'cloudstack-common'), '포함 안 됨')
        mold_info = dict(rpm_only=True, package_count=len(selected), packages=selected,
                         role_packages=role_packages,
                         mold_package_count=len(mold_records), mold_packages=mold_records,
                         current_mold_version=current.stdout.strip() if current.returncode == 0 else 'N/A',
                         target_mold_version=common)
        target_ablestack_version = current_ablestack_version
    elif update_type == "mold":
        mold_info = read_mold_iso_info(mount)
        # Mold 전용 업데이트는 OS 버전을 변경하지 않는다.
        target_ablestack_version = current_ablestack_version
    elif update_type == "packages":
        if not (mount / 'rpms/repodata/repomd.xml').is_file() or not (mount / 'SHA256SUMS').is_file():
            raise FileNotFoundError("기타 패키지 ISO의 rpms/repodata/repomd.xml 및 SHA256SUMS가 필요합니다.")
        command = detect_rpm_command()
        packages = []
        keys = set()
        for path in sorted((mount / 'rpms').rglob('*.rpm')):
            proc = subprocess.run([command, '-qp', '--qf', MOLD_RPM_QUERY_FORMAT, '--', str(path)],
                                  text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            fields = proc.stdout.strip().split('\t')
            if proc.returncode or len(fields) != 3:
                raise ValueError("기타 패키지 RPM 정보 형식 또는 헤더 조회 오류")
            name, version, arch = fields
            if name.startswith('cloudstack') or arch in ('src', 'nosrc') or (name, arch) in keys:
                raise ValueError("기타 패키지 ISO에 CloudStack/소스/중복 RPM이 포함되어 있습니다.")
            keys.add((name, arch))
            packages.append(dict(name=name, version=version, arch=arch))
        if not packages:
            raise ValueError("기타 패키지 ISO에 RPM이 없습니다.")
        mold_info = {'package_count': len(packages), 'packages': packages}
        target_ablestack_version = current_ablestack_version
    elif update_type == "tools":
        proc = subprocess.run(
            ["/bin/bash", str(update_script_path), "--check", "--iso-root", str(mount)],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
        )
        if proc.returncode != 0:
            raise ValueError(localize_update_output(proc.stdout.strip() or proc.stderr.strip()) or "ABLESTACK Tools 커널 확인 실패")
        values = parse_key_values_text(proc.stdout)
        if not values.get("TOOLS_CURRENT_KERNEL") or not values.get("TOOLS_TARGET_KERNEL"):
            raise ValueError("ABLESTACK Tools 스크립트에서 커널 확인 결과를 읽을 수 없습니다.")
        mold_info = {
            "current_kernel": values["TOOLS_CURRENT_KERNEL"],
            "target_kernel": values["TOOLS_TARGET_KERNEL"],
        }
        target_ablestack_version = current_ablestack_version
    else:
        ks_path = mount / TARGET_KS_PATH
        if not ks_path.is_file():
            raise FileNotFoundError(f"{TARGET_KS_PATH} 파일을 찾을 수 없습니다.")
        target_ks_info = parse_key_values(ks_path)
        target_ablestack_version = target_ks_info.get("ABLESTACK_VERSION", "")
        if target_ablestack_version == "":
            raise ValueError(f"{TARGET_KS_PATH} 파일에서 ABLESTACK_VERSION 값을 찾을 수 없습니다.")

    return {
        "mount_path": str(mount),
        "copy_path": str(UPDATE_WORK_DIR),
        "current_ablestack_version": current_ablestack_version,
        "target_ablestack_version": target_ablestack_version,
        "update_type": update_type,
        "update_label": script_info["label"],
        "update_script": str(update_script_path),
        "work_update_script": str(UPDATE_WORK_DIR / script_relative_path),
        **mold_info,
    }


def prepare_update_work_dir(mount_path):
    target_path = UPDATE_WORK_DIR

    if (
        mount_path == target_path
        or is_path_relative_to(target_path, mount_path)
        or is_path_relative_to(mount_path, target_path)
    ):
        raise ValueError("ISO 마운트 경로와 복사 대상 경로를 분리해야 합니다.")
    if target_path.is_symlink():
        raise ValueError(f"{target_path} 경로가 심볼릭 링크입니다.")
    if os.path.ismount(str(target_path)):
        raise ValueError(f"{target_path} 경로가 마운트 지점입니다.")
    if target_path.exists():
        if not target_path.is_dir():
            raise NotADirectoryError(f"{target_path} 경로가 디렉터리가 아닙니다.")
        shutil.rmtree(target_path)

    target_path.mkdir(parents=True, exist_ok=False)
    proc = copy_update_files(mount_path, target_path)
    if proc.returncode != 0:
        message = proc.stderr.strip() or proc.stdout.strip() or "ISO 파일 복사 중 오류가 발생했습니다."
        raise RuntimeError(localize_update_output(message))

    return target_path


def copy_update_files(source_path, target_path):
    copy_args = [f"{source_path}/.", f"{target_path}/"]
    proc = subprocess.run(
        ["cp", "-rRp"] + copy_args,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode == 0 or "R and -r options may not be specified together" not in proc.stderr:
        return proc
    return subprocess.run(
        ["cp", "-Rp"] + copy_args,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


@contextmanager
def update_work_lock():
    UPDATE_LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    lock_fd = os.open(str(UPDATE_LOCK_PATH), os.O_CREAT | os.O_RDWR, 0o600)
    try:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("이미 업데이트가 실행 중입니다. 업데이트 완료 후 다시 실행하세요.")
        yield lock_fd
    finally:
        # nohup 작업에 넘긴 잠금은 유지한다. LOCK_UN은 자식의 잠금도 해제한다.
        os.close(lock_fd)


def run_update(mount_path, update_type="all", credentials=None):
    with update_work_lock() as lock_fd:
        return run_update_locked(mount_path, update_type, lock_fd, credentials)


def run_update_locked(mount_path, update_type, lock_fd, credentials=None):
    info = read_update_info(mount_path, update_type)
    if info.get('rpm_only') and info.get('package_count') == 0:
        return {**info, 'message': '선택한 범위의 RPM이 없어 정상 생략했습니다.', 'background': False,
                'skipped': True, 'pid': None, 'log_file': str(UPDATE_LOG_PATHS[update_type]), 'stdout': '', 'stderr': ''}
    if update_type != 'tools':
        if (not isinstance(credentials, dict) or not isinstance(credentials.get('username'), str)
                or not credentials['username'].strip() or not isinstance(credentials.get('password'), str)
                or not credentials['password']):
            raise ValueError('Mold 관리자 ID와 비밀번호를 입력해야 합니다.')
        if not HA_HELPER_PATH.is_file():
            raise FileNotFoundError('Mold HA 제어 모듈이 없습니다. Cockpit 플러그인을 업데이트하세요.')
        if credentials.get('api_url'):
            try:
                url = urlsplit(credentials['api_url'])
                valid = (url.scheme in ('http', 'https') and url.netloc and not url.username
                         and not url.password and not url.query and not url.fragment)
            except (ValueError, TypeError, AttributeError):
                valid = False
            if not valid:
                raise ValueError('Mold API 주소에는 인증정보나 쿼리를 넣을 수 없습니다.')
    script_info = get_update_script_info(update_type)
    mount = Path(info["mount_path"])
    # 재부팅 후에는 전체 업데이트가 복사한 ISO에서 Tools만 바로 실행할 수 있다.
    if update_type == "tools" and mount == UPDATE_WORK_DIR.resolve():
        if UPDATE_WORK_DIR.is_symlink():
            raise ValueError(f"{UPDATE_WORK_DIR} 경로가 심볼릭 링크입니다.")
        work_dir = mount
    else:
        work_dir = prepare_update_work_dir(mount)
    work_update_script = work_dir / script_info["script"]

    if not work_update_script.exists():
        raise FileNotFoundError(f"{work_update_script} 파일을 찾을 수 없습니다.")

    env = os.environ.copy()
    env["ABLESTACK_UPDATE_MOUNT_PATH"] = info["mount_path"]
    env["ABLESTACK_UPDATE_WORK_PATH"] = str(work_dir)
    env["ABLESTACK_UPDATE_COPY_PATH"] = str(work_dir)
    env["ABLESTACK_UPDATE_TYPE"] = update_type
    env["ABLESTACK_UPDATE_LOCK_FD"] = str(lock_fd)

    command = ["/bin/bash", f"./{script_info['script'].as_posix()}"]
    payload = None
    if update_type != 'tools':
        kind = {'all': 'full', 'mold': 'mold', 'packages': 'rpms'}[update_type]
        command = [sys.executable, '-B', str(HA_HELPER_PATH), '--script', str(work_update_script),
                   '--kind', kind, '--lock-fd', str(lock_fd), '--log-file', str(UPDATE_LOG_PATHS[update_type]),
                   '--credentials-stdin']
        if update_type == 'all':
            if info.get('rpm_only'):
                command[command.index('--kind') + 1] = 'rpms'
            else:
                command.append('--worker-arg=--include-cockpit')
        if info.get('rpm_only'):
            command += ['--worker-arg=--scope', '--worker-arg=' + {'all': 'all', 'mold': 'mold', 'packages': 'packages'}[update_type]]
        for key, flag in (('api_url', '--api-url'), ('domain', '--domain'), ('host_id', '--host-id')):
            if credentials.get(key):
                command += [flag, str(credentials[key])]
        payload = json.dumps({'username': credentials['username'], 'password': credentials['password']})
    proc = subprocess.run(
        command,
        input=payload,
        cwd=str(work_dir),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        pass_fds=(lock_fd,),
        check=False,
    )
    if proc.returncode != 0:
        message = proc.stderr.strip() or proc.stdout.strip() or "ABLESTACK Version 업데이트 실행 중 오류가 발생했습니다."
        raise RuntimeError(localize_update_output(message))

    started = re.search(r"^ABLESTACK_UPDATE_STARTED_PID=([0-9]+)$", proc.stdout, re.M)
    background = update_type != "tools" and started is not None
    message = (f"{script_info['label']}를 백그라운드에서 시작했습니다. 로그에서 업데이트·검증 및 HA 활성화 완료를 확인하세요." if background else
               f"{script_info['label']} 실행이 완료되었습니다.")
    if background and update_type == 'all' and not info.get('rpm_only'):
        message += ' 완료 후 재부팅하고 ABLESTACK Tools를 업데이트하세요.'
    return {
        **info,
        "message": message,
        "background": background,
        "pid": int(started.group(1)) if background else None,
        "log_file": str(UPDATE_LOG_PATHS[update_type]),
        "mount_path": info["mount_path"],
        "copy_path": str(work_dir),
        "update_type": update_type,
        "update_label": script_info["label"],
        "update_script": str(work_update_script),
        "stdout": localize_update_output(proc.stdout.strip()),
        "stderr": localize_update_output(proc.stderr.strip()),
    }


def main():
    args = parse_args()
    try:
        if args.action == "log":
            ret = createReturn(code=200, val=read_update_log(args.update_type))
        elif args.action == "info":
            ret = createReturn(code=200, val=read_update_info(args.mount_path, args.update_type))
        else:
            credentials = None
            if args.credentials_stdin:
                try:
                    credentials = json.loads(sys.stdin.read(65537))
                except (ValueError, TypeError):
                    raise ValueError('Mold 인증정보 입력 형식이 잘못되었습니다.') from None
            ret = createReturn(code=200, val=run_update(args.mount_path, args.update_type, credentials))
    except Exception as e:
        ret = createReturn(code=500, val=str(e))
    print(ret)


if __name__ == "__main__":
    main()
