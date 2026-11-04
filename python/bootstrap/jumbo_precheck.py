#!/usr/bin/env python3
"""Check storage-network jumbo frames from a single SCVM; stdin contains the host's /etc/hosts."""
import ipaddress
import os
import subprocess
import sys

PREFIX = '[ABLESTACK-PROGRESS] '


def progress(message):
    print(PREFIX + message, flush=True)


def failure_guidance():
    progress('통신 실패의 가능한 원인은 다음과 같습니다.')
    progress('1. 스토리지 네트워크의 NIC·브릿지·VLAN·MTU가 올바르게 구성되지 않았을 수 있습니다.')
    progress('2. 일부 스토리지센터 가상머신이 아직 배포 중이거나 초기 네트워크 설정을 적용 중일 수 있습니다.')
    progress('3. 케이블 연결이나 스위치 포트 설정으로 인해 통신이 원활하지 않을 수 있습니다.')
    progress('잠시 후 스토리지센터 구성하기를 다시 실행해 주십시오.')
    progress('같은 증상이 계속 반복되면 각 SCVM과 호스트의 스토리지 네트워크 및 스위치의 VLAN·점보 프레임(MTU) 설정을 확인해 주십시오.')


def storage_targets(contents):
    targets = {}
    groups = set()
    entries = [line.split('#', 1)[0].split() for line in contents.splitlines()]
    # Exclude the entire CCVM IP, including storage aliases on another hosts-file row.
    excluded = {fields[0] for fields in entries
                if len(fields) >= 2 and any('ccvm' in name.lower() for name in fields[1:])}
    for fields in entries:
        if len(fields) < 2 or fields[0] in excluded:
            continue
        aliases = []
        for name in fields[1:]:
            short = name.lower().split('.')[0]
            if 'mngt' in short:
                continue
            if short.startswith('pn'):
                groups.add('pn')
            elif short.startswith('cn-scvm'):
                groups.add('cn-scvm')
            elif short.startswith('scvm'):
                groups.add('scvm')
            else:
                continue
            aliases.append(name)
        if aliases:
            address = str(ipaddress.IPv4Address(fields[0]))
            names = targets.setdefault(address, [])
            names.extend(name for name in aliases if name not in names)
    missing = {'pn', 'scvm', 'cn-scvm'} - groups
    if missing:
        raise ValueError('/etc/hosts에 검사할 스토리지망 주소가 없습니다: ' + ', '.join(sorted(missing)))
    return targets


def check_jumbo(contents):
    targets = storage_targets(contents)
    failures = []
    progress('현재 호스트의 SCVM에서 점보 프레임 통신을 검사합니다. 대상 IP ' + str(len(targets)) + '개, 각 3회')
    for address, aliases in targets.items():
        label = '/'.join(aliases) + ' (' + address + ')'
        progress('점보 프레임 검사 중: ' + label)
        received = 0
        for _ in range(3):
            try:
                result = subprocess.run(
                    ['ping', '-n', '-M', 'do', '-s', '8972', '-c', '1', '-W', '2', address],
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=4,
                    env=dict(os.environ, LC_ALL='C'))
                received += result.returncode == 0
            except (OSError, subprocess.TimeoutExpired):
                pass
        if received == 3:
            progress('통신 정상: ' + label + ' — 3/3 응답')
        else:
            failures.append(label)
            progress('통신 실패: ' + label + ' — ' + str(received) + '/3 응답')
    if failures:
        progress('점보 프레임 검사 실패: ' + str(len(failures)) + '개 대상과 정상 통신하지 못해 스토리지센터 구성을 중단합니다.')
        return 1
    progress('모든 대상의 점보 프레임 통신 검사가 완료되었습니다.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(check_jumbo(sys.stdin.read()))
    except (OSError, ValueError) as error:
        progress('점보 프레임 검사를 시작할 수 없습니다: ' + str(error))
        sys.exit(1)
