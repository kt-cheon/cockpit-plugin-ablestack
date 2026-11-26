#!/usr/bin/python3
"""Inspect and explicitly zap selected local data disks; never run on import."""
import argparse
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import socket
import stat
import subprocess
import sys
import xml.etree.ElementTree as ET

CONFIRMATION = '확인했습니다.'
DEVICE = re.compile(r'^/dev/[A-Za-z0-9._-]+$')
LSBLK = ['lsblk', '--json', '--bytes', '--paths', '--output',
         'NAME,KNAME,PATH,MAJ:MIN,TYPE,SIZE,MODEL,SERIAL,WWN,FSTYPE,MOUNTPOINTS,RO,RM']


def run(argv, timeout=30):
    result = subprocess.run(argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=timeout, env=dict(os.environ, LC_ALL='C'))
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout or '명령 실행 실패').strip()[-1600:])
    return result.stdout


def nodes(device):
    yield device
    for child in device.get('children') or []:
        yield from nodes(child)


def real(path):
    return os.path.realpath(path)


def device_stamp(path):
    info = os.stat(path)
    if not stat.S_ISBLK(info.st_mode):
        raise ValueError('블록 장치가 아닙니다: ' + path)
    return dict(device=info.st_rdev, inode=info.st_ino)


def vm_disks():
    if not shutil.which('virsh'):
        raise RuntimeError('가상머신의 디스크 사용 현황을 확인할 수 없습니다.')
    sources = set()
    for name in run(['virsh', '-c', 'qemu:///system', 'list', '--state-running', '--name']).splitlines():
        if name.strip():
            document = ET.fromstring(run(['virsh', '-c', 'qemu:///system', 'dumpxml', '--domain', name.strip()]))
            for source in document.findall('./devices/disk//source'):
                if source.get('dev'):
                    sources.add(real(source.get('dev')))
    return sources


def inventory():
    raw = json.loads(run(LSBLK)).get('blockdevices', [])
    try:
        busy = vm_disks()
        vm_error = ''
    except (OSError, RuntimeError, ValueError, ET.ParseError, subprocess.TimeoutExpired):
        busy, vm_error = set(), '가상머신의 디스크 사용 현황을 확인할 수 없습니다.'
    tools_ready = bool(shutil.which('ceph-volume') and shutil.which('udevadm')
                       and (shutil.which('partprobe') or shutil.which('blockdev')))
    result, seen = [], set()
    for device in raw:
        if device.get('type') != 'disk':
            continue
        path = device.get('path') or device.get('name', '')
        if not DEVICE.fullmatch(path) or path != real(path) or path in seen:
            continue
        seen.add(path)
        family = list(nodes(device))
        reason = ''
        if any(node.get('mountpoints') and any(node['mountpoints']) for node in family):
            reason = '마운트되어 있거나 스왑으로 사용 중인 디스크입니다.'
        elif any(node.get('fstype') == 'swap' for node in family):
            reason = '스왑 파티션이 있는 디스크입니다.'
        elif any(real(node.get('path') or node.get('name', '')) in busy for node in family):
            reason = '실행 중인 가상머신이 사용 중인 디스크입니다.'
        elif any(node.get('type') not in ('disk', 'part', 'lvm') for node in family):
            reason = 'RAID·암호화·멀티패스 등 다른 장치가 사용 중인 디스크입니다.'
        elif bool(device.get('ro')) or bool(device.get('rm')):
            reason = '읽기 전용 또는 이동식 디스크입니다.'
        elif vm_error:
            reason = vm_error
        elif not tools_ready:
            reason = '초기화 도구(ceph-volume, udevadm, partprobe/blockdev)가 필요합니다.'
        try:
            stamp = device_stamp(path)
        except (OSError, ValueError):
            stamp, reason = {}, '실제 블록 장치를 확인할 수 없습니다.'
        identity = dict(path=path, number=device.get('maj:min'), size=device.get('size'),
                        serial=device.get('serial'), wwn=device.get('wwn'), stamp=stamp)
        fingerprint = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        size = int(device.get('size') or 0)
        size_label = '{:.1f} GiB'.format(size / 1024 ** 3)
        model = ' '.join(str(device.get('model') or '').split())
        has_configuration = len(family) > 1 or any(node.get('fstype') for node in family)
        result.append(dict(path=path, identity=fingerprint, size_bytes=size,
                           label=' · '.join(filter(None, [path, size_label, model])),
                           can_initialize=not reason, reason=reason,
                           state='파티션 또는 파일시스템이 있습니다.' if has_configuration else '파티션 없음',
                           _nodes=family))
    return result


def public_inventory():
    return dict(code=200, hostname=socket.gethostname(),
                disks=[{key: value for key, value in row.items() if not key.startswith('_')} for row in inventory()])


def validate_targets(request, current):
    if request.get('confirmation') != CONFIRMATION:
        raise ValueError('확인 문구가 일치하지 않습니다. ' + CONFIRMATION + ' 를 정확히 입력하세요.')
    requested = request.get('devices')
    if not isinstance(requested, list) or not 1 <= len(requested) <= 128:
        raise ValueError('초기화할 디스크를 선택하세요.')
    index = {row['path']: row for row in current}
    selected = []
    for item in requested:
        if not isinstance(item, dict) or not isinstance(item.get('path'), str) or not isinstance(item.get('identity'), str):
            raise ValueError('디스크 선택 정보가 올바르지 않습니다.')
        row = index.get(item['path'])
        if row is None or not hmac.compare_digest(row['identity'], item['identity']):
            raise ValueError('디스크 정보가 변경되었습니다. 목록을 새로 조회하고 다시 확인하세요.')
        if not row['can_initialize']:
            raise ValueError(row['path'] + ': ' + row['reason'])
        if row['path'] in [value['path'] for value in selected]:
            raise ValueError('동일한 디스크가 중복 선택되었습니다.')
        selected.append(row)
    return selected


def validate_volume_groups(selected):
    # A zap must not remove a volume group containing an unselected physical disk.
    if not any(node.get('fstype') == 'LVM2_member' for row in selected for node in row['_nodes']):
        return
    allowed = {real(node.get('path') or node.get('name', '')) for row in selected for node in row['_nodes']}
    report = json.loads(run(['pvs', '--readonly', '--reportformat', 'json', '-o', 'pv_name,vg_name']))
    volumes = [pv for section in report.get('report', []) for pv in section.get('pv', [])]
    if not volumes:
        raise ValueError('LVM 볼륨그룹의 디스크 구성을 확인할 수 없습니다.')
    groups = {pv.get('vg_name', '').strip() for pv in volumes if real(pv['pv_name'].strip()) in allowed}
    if any(pv.get('vg_name', '').strip() in groups - {''} and real(pv['pv_name'].strip()) not in allowed for pv in volumes):
        raise ValueError('선택하지 않은 디스크와 LVM 볼륨그룹을 공유합니다. 같은 볼륨그룹의 디스크를 모두 확인하세요.')


def initialize(request):
    # Validate the entire batch before the first destructive command.
    selected = validate_targets(request, inventory())
    validate_volume_groups(selected)
    results = []
    for expected in selected:
        path = expected['path']
        started, erased = False, False
        try:
            fresh = validate_targets(request, inventory())
            validate_volume_groups(fresh)
            row = next(value for value in fresh if value['path'] == path)
            started = True
            run(['ceph-volume', 'lvm', 'zap', '--destroy', path], timeout=900)
            erased = True
            # Invalidate the kernel partition table and udev's filesystem metadata.
            run(['partprobe', path] if shutil.which('partprobe') else ['blockdev', '--rereadpt', path])
            run(['udevadm', 'trigger', '--action=change', '/sys/class/block/' + Path(path).name])
            run(['udevadm', 'settle', '--timeout=30'], timeout=40)
            current = next((value for value in inventory() if value['path'] == path), None)
            if (current is None or current['identity'] != row['identity'] or len(current['_nodes']) != 1
                    or current['_nodes'][0].get('fstype') or not current['can_initialize']):
                raise RuntimeError('초기화 후 파티션·파일시스템·장치 사용 상태가 해제되지 않았습니다. 사용 중인 프로세스를 확인하세요.')
            results.append(dict(path=path, status='completed', message='초기화 및 디스크 상태 재조회 완료'))
        except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
            prefix = ('데이터 삭제 후 장치 상태 갱신·검증에 실패했습니다: ' if erased else
                      '초기화 도중 실패했습니다. 데이터가 일부 삭제되었을 수 있습니다: ' if started else '')
            results.append(dict(path=path, status='failed', message=prefix + str(error)))
    return dict(code=200, success=all(row['status'] == 'completed' for row in results), results=results)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('list', 'initialize'))
    args = parser.parse_args()
    try:
        if args.action == 'list':
            result = public_inventory()
        else:
            if os.geteuid() != 0:
                raise ValueError('디스크 초기화에는 관리자 권한이 필요합니다.')
            request = json.load(sys.stdin)
            descriptor = os.open('/run/lock/ablestack-disk-initialize.lock', os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, 'a') as lock:
                info = os.fstat(lock.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_uid != 0:
                    raise ValueError('초기화 잠금 파일의 소유자를 확인하세요.')
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise ValueError('이 호스트에서 다른 디스크 초기화 작업이 실행 중입니다.') from None
                result = initialize(request)
        print(json.dumps(result, ensure_ascii=False))
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        print('디스크 초기화 작업 실패: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
