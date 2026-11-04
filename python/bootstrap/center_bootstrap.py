#!/usr/bin/env python3
"""Run center configuration with a jumbo-frame gate and public, streamed progress messages."""
import argparse
import json
import os
from pathlib import Path
import sys

from jumbo_precheck import PREFIX, failure_guidance, progress, storage_targets


class ProgressStream:
    """Keep command output in the administrator log and forward only explicit progress lines."""
    def __init__(self, logfile):
        self.logfile = logfile
        self.pending = b''

    def write(self, data):
        self.logfile.write(data)
        self.pending += data
        while b'\n' in self.pending:
            line, self.pending = self.pending.split(b'\n', 1)
            self.forward(line)
        if len(self.pending) > 65536:
            self.pending = b''

    def forward(self, line):
        if line.startswith(PREFIX.encode()):
            print(line.decode('utf-8', 'replace'), flush=True)

    def flush(self):
        self.logfile.flush()

    def finish(self):
        self.forward(self.pending)
        self.pending = b''
        self.flush()


def execute_logged(client, target, argv, logfile, **options):
    output, errors = ProgressStream(logfile), ProgressStream(logfile)
    try:
        result = client.execute(target, argv, stdout=output, stderr=errors, **options)
    finally:
        output.finish()
        errors.finish()
    return result.returncode


def configure_center(kind, license_type, client, plugin_root, logfile, hosts_file=Path('/etc/hosts')):
    profile = json.loads((plugin_root / 'tools/properties/cluster.json').read_text())['clusterConfig']
    hosts = [host['hostname'] for host in profile['hosts']]
    if not hosts:
        raise ValueError('클러스터 프로파일에 호스트가 없습니다.')
    title = '스토리지센터' if kind == 'scvm' else '클라우드센터'
    if kind == 'scvm':
        contents = hosts_file.read_text()
        targets = storage_targets(contents)
        progress('구성 전 점보 프레임 통신 검사를 시작합니다.')
        # The contextual "scvm" alias selects only this host's SCVM. All pings run there.
        probe = (Path(__file__).with_name('jumbo_precheck.py')).read_text()
        try:
            code = execute_logged(client, 'scvm', ['python3', '-u', '-c', probe], logfile,
                                  stdin=contents.encode(), timeout=min(3600, 30 + len(targets) * 15))
        except Exception:
            failure_guidance()
            raise
        if code:
            failure_guidance()
            raise RuntimeError('점보 프레임 통신 검사에 실패했습니다. 스토리지센터 구성은 실행하지 않았습니다.')

    script = 'ccvm_bootstrap.sh' if kind == 'ccvm' else (
        'scvm_pf_bootstrap.sh' if profile['type'] == 'powerflex' else 'scvm_bootstrap.sh')
    progress(title + ' 구성 스크립트를 준비합니다.')
    # Refresh the seeded script so already-deployed VMs also emit the current progress messages.
    client.upload(kind, plugin_root / 'shell/host' / script, '/root/bootstrap.sh')
    progress(title + ' 구성 작업을 시작합니다.')
    # Keep the lock in flock's parent process, out of daemon/service descendants.
    command = ['flock', '-n', '-E', '75', '-o', '/run/lock/ablestack-' + kind + '-bootstrap.lock',
               '/bin/bash', '/root/bootstrap.sh']
    if kind == 'ccvm':
        command.append(license_type)
    code = execute_logged(client, kind, command, logfile, timeout=3600)
    if code == 75:
        raise RuntimeError('다른 작업에서 이미 ' + title + '를 구성하고 있습니다.')
    if code:
        raise RuntimeError(title + ' 구성 스크립트가 실패했습니다. 마지막 진행 단계를 확인하십시오. (종료 코드 ' + str(code) + ')')

    progress('각 호스트에 ' + title + ' 구성 완료 상태를 저장합니다.')
    for host in hosts:
        result = client.execute(host, ['python3', str(plugin_root / 'python/ablestack_json/ablestackJson.py'),
                                      'update', '--depth1', 'bootstrap', '--depth2', kind, '--value', 'true'], timeout=30)
        logfile.write(result.stdout)
        logfile.write(result.stderr)
        logfile.flush()
        if result.returncode or json.loads(result.stdout).get('code') != 200:
            raise RuntimeError(title + ' 구성은 완료됐지만 ' + host + '의 완료 상태 저장에 실패했습니다.')
    progress(title + ' 구성이 완료되었습니다.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=('scvm', 'ccvm'))
    parser.add_argument('license_type', nargs='?', default='ablestack')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise PermissionError('Cockpit 관리자 접근이 필요합니다.')
    sys.path.insert(0, '/usr/libexec/ablestack/node-agent')
    from client import Client
    log_path = Path('/var/log') / (args.kind + '_bootstrap.log')
    descriptor = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
    os.fchmod(descriptor, 0o600)
    with os.fdopen(descriptor, 'ab') as logfile:
        try:
            configure_center(args.kind, args.license_type, Client(), Path(__file__).resolve().parents[2], logfile)
        except Exception:
            progress('상세 실행 로그: ' + str(log_path))
            raise


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        progress('구성 실패: ' + str(error))
        sys.exit(1)
