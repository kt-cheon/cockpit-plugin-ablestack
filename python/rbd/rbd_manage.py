#!/usr/bin/python3
import argparse
import json
import os
import re
import shlex
import subprocess
from typing import Dict, List

import paramiko

from ablestack import *  # 기존 프로젝트 의존성 유지합니다.

json_file_path = pluginpath + "/tools/properties/cluster.json"


def open_cluster_json() -> Dict:
    """cluster.json을 읽어 dict로 반환합니다."""
    with open(json_file_path, "r", encoding="utf-8") as json_file:
        return json.load(json_file)


def run_command(command: str, ssh_client: paramiko.SSHClient = None) -> str:
    """
    로컬 또는 원격에서 명령을 실행합니다.
    원격은 exit status를 확인하여 실패 시 예외를 발생시킵니다.
    """
    if ssh_client:
        stdin, stdout, stderr = ssh_client.exec_command(command)
        exit_code = stdout.channel.recv_exit_status()
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")

        if exit_code != 0:
            raise RuntimeError(f"Remote command failed (exit={exit_code}): {command}\n{err}")

        return out

    result = subprocess.run(command, shell=True, text=True, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(f"Local command failed (exit={result.returncode}): {command}\n{result.stderr}")

    return result.stdout


def run_command_status(command: str, ssh_client: paramiko.SSHClient = None) -> int:
    """
    로컬 또는 원격에서 명령을 실행하고 exit code만 반환합니다.
    """
    if ssh_client:
        _, stdout, _ = ssh_client.exec_command(command)
        return stdout.channel.recv_exit_status()

    result = subprocess.run(command, shell=True)
    return result.returncode


def connect_to_host(ip: str) -> paramiko.SSHClient:
    """호스트에 SSH 연결을 생성합니다."""
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    private_key_path = os.getenv("SSH_PRIVATE_KEY_PATH", "/root/.ssh/id_rsa")
    ssh.connect(ip, username='root', key_filename=private_key_path, timeout=10, banner_timeout=30, auth_timeout=30)

    return ssh


def split_by_2000(size_gb: int, chunk_gb: int = 2000) -> List[int]:
    """
    size_gb를 chunk_gb 단위로 잘라서 리스트로 반환합니다.
    예) 5000 -> [2000, 2000, 1000]
    """
    if size_gb <= 0:
        return []

    parts: List[int] = []
    remaining = size_gb

    while remaining > chunk_gb:
        parts.append(chunk_gb)
        remaining -= chunk_gb

    if remaining > 0:
        parts.append(remaining)

    return parts


def parse_space_separated_ips(ip_text: str) -> List[str]:
    """'ip1 ip2 ip3' 형태를 리스트로 변환합니다."""
    ips = [x.strip() for x in ip_text.split() if x.strip()]
    return ips

def get_next_image_index(pool_name: str, image_prefix: str) -> int:
    """
    pool_name에서 image_prefix로 시작하고 뒤에 숫자만 붙는 이미지들의 최대 번호를 찾아
    다음 생성에 사용할 인덱스(최대 + 1)를 반환합니다.

    예)
    gfs01, gfs02, gfs03 이면 -> 4 반환
    gfs1, gfs02 같이 섞여 있어도 숫자만 추출해서 최대값 기준으로 동작합니다.
    """
    result = subprocess.run(
        ["rbd", "ls", pool_name],
        check=True,
        text=True,
        capture_output=True,
    )

    # gfs01, gfs2 같은 형태만 허용합니다.
    pattern = re.compile(rf"^{re.escape(image_prefix)}(\d+)$")

    max_idx = 0
    for line in result.stdout.splitlines():
        name = line.strip()
        m = pattern.match(name)
        if not m:
            continue
        idx = int(m.group(1))
        if idx > max_idx:
            max_idx = idx

    return max_idx + 1
def create_rbd_images(pool_name: str, image_prefix: str, total_size_gb: int, ip_text: str) -> None:
    """
    total_size_gb를 2000GB 단위로 쪼개서 RBD 이미지를 여러 개 생성합니다.
    생성된 이미지는 각 호스트의 /etc/ceph/rbdmap에도 등록하고, 마지막에 rbdmap.service를 활성화합니다.
    """
    try:
        sizes = split_by_2000(total_size_gb, 2000)
        if not sizes:
            raise ValueError("total_size_gb는 1 이상이어야 합니다.")

        ips = parse_space_separated_ips(ip_text)
        if not ips:
            raise ValueError("--list-ip 값이 비어 있습니다.")

        start_idx = get_next_image_index(pool_name, image_prefix)

        # 호스트별 SSH 연결은 한 번만 만들고 재사용합니다.
        ssh_map: Dict[str, paramiko.SSHClient] = {}

        try:
            for ip in ips:
                ssh_map[ip] = connect_to_host(ip)

            created: List[str] = []

            for idx, size_gb in enumerate(sizes, start=start_idx):
                image_name = f"{image_prefix}{idx:02d}"
                full_name = f"{pool_name}/{image_name}"

                # 1) 이미지 생성
                cmd = ["rbd", "create", full_name, "--size", f"{size_gb}G", "--image-feature", "layering"]
                subprocess.run(cmd, check=True)

                # 2) 각 호스트 rbdmap 등록(중복 방지)
                line = f"{pool_name}/{image_name} id=admin,keyring=/etc/ceph/ceph.client.admin.keyring"
                qline = shlex.quote(line)
                add_rbdmap_cmd = (
                    f"grep -qF {qline} /etc/ceph/rbdmap || "
                    f"echo {qline} | tee -a /etc/ceph/rbdmap >/dev/null"
                )

                for ip, ssh_client in ssh_map.items():
                    # root로 접속하니 sudo 없이도 동작합니다.
                    run_command(add_rbdmap_cmd, ssh_client)

                created.append(full_name)
            # 3) 마지막에 한 번만 rbdmap 서비스 활성화(각 호스트에서 1회)
            for ip, ssh_client in ssh_map.items():
                check = run_command_status("systemctl is-enabled --quiet rbdmap.service", ssh_client)
                if check == 0:

                    run_command("systemctl restart rbdmap.service", ssh_client)
                else:
                    run_command("systemctl enable --now rbdmap.service", ssh_client)

            ret = createReturn(code=200, val=created)
            print(json.dumps(json.loads(ret), indent=4))

        finally:
            for ssh_client in ssh_map.values():
                try:
                    ssh_client.close()
                except Exception:
                    pass

    except Exception:
        ret = createReturn(code=500, val="Create RBD Image and rbdmap Failed.")
        print(json.dumps(json.loads(ret), indent=4))

def _normalize_image_name(raw_name: str) -> str:
    """
    입력이 /dev/rbd/rbd/gfs07 같은 경로여도 마지막 이미지명만 추출합니다.
    """
    name = raw_name.strip()
    if not name:
        return ""
    return name.split("/")[-1]

def _escape_sed_regex(text: str) -> str:
    """
    sed 기본 정규식에서 literal 매칭을 위해 특수문자를 이스케이프합니다.
    delimiter는 '#'로 가정합니다.
    """
    escaped = re.sub(r'([\\.^$*+?()[\]{}])', r'\\\1', text)
    return escaped.replace("#", r"\#")


def delete_rbd_image(pool_name: str, image_names_text: str, ip_text: str) -> None:
    """
    지정된 RBD 이미지를 삭제하고, 각 호스트의 /etc/ceph/rbdmap에서도 제거합니다.
    image_names_text는 콤마로 구분된 이미지명 문자열을 허용합니다.
    """
    try:
        ips = parse_space_separated_ips(ip_text)
        if not ips:
            raise ValueError("--list-ip 값이 비어 있습니다.")

        image_names = [
            _normalize_image_name(x)
            for x in image_names_text.split(",")
            if _normalize_image_name(x)
        ]
        if not image_names:
            raise ValueError("--image-name 값이 비어 있습니다.")

        # 호스트별 SSH 연결은 한 번만 만들고 재사용합니다.
        ssh_map: Dict[str, paramiko.SSHClient] = {}
        try:
            for ip in ips:
                ssh_map[ip] = connect_to_host(ip)

            deleted: List[str] = []

            for image_name in image_names:
                full_name = f"{pool_name}/{image_name}"

                # 1) 각 호스트 rbdmap에서 제거
                for ip, ssh_client in ssh_map.items():
                    remove_rbdmap_cmd = (
                        f"sed -i '\\#^{_escape_sed_regex(full_name)}\\([[:space:]]\\|$\\)#d' /etc/ceph/rbdmap"
                    )

                    run_command(remove_rbdmap_cmd, ssh_client)

            # 모든 이미지 rbdmap 제거 후, 각 호스트에서 rbdmap 서비스 재시작(1회)
            for ip, ssh_client in ssh_map.items():
                run_command("systemctl restart rbdmap.service", ssh_client)

            for image_name in image_names:
                full_name = f"{pool_name}/{image_name}"

                # 2) 이미지 삭제
                cmd = ["rbd", "rm", full_name]
                subprocess.run(cmd, check=True)

                deleted.append(full_name)

            ret = createReturn(code=200, val=deleted)
            print(json.dumps(json.loads(ret), indent=4))

        finally:
            for ssh_client in ssh_map.values():
                try:
                    ssh_client.close()
                except Exception:
                    pass

    except Exception:
        ret = createReturn(code=500, val="Delete RBD Image Failed.")
        print(json.dumps(json.loads(ret), indent=4))

def main() -> None:
    parser = argparse.ArgumentParser(description="Cluster configuration script")

    parser.add_argument("--create-rbd-image", action="store_true", help="Create RBD Images.")
    parser.add_argument("--size", type=int, help="RBD Image Size (GB).")
    parser.add_argument("--list-ip",type=str,help='The IP addresses of hosts, separated by spaces. Example: "100.100.12.1 100.100.12.2 100.100.12.3"')
    parser.add_argument("--delete-rbd-image", action="store_true", help="Delete RBD Image(s).")
    parser.add_argument("--image-name", type=str, help="RBD image name(s), comma-separated. Example: gfs07,gfs08")

    args = parser.parse_args()

    if args.create_rbd_image:
        if not args.size:
            parser.error("--size is required when --create-image is specified.")
        if not args.list_ip:
            parser.error("--list-ip is required when --create-image is specified.")
        create_rbd_images("rbd", "gfs", args.size, args.list_ip)

    if args.delete_rbd_image:
        if not args.list_ip:
            parser.error("--list-ip is required when --delete-rbd-image is specified.")
        if not args.image_name:
            parser.error("--image-name is required when --delete-rbd-image is specified.")

        delete_rbd_image("rbd", args.image_name, args.list_ip)


if __name__ == "__main__":
    main()
