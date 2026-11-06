"""Deployment orchestration, reusing Europa's VM, enrollment and bootstrap tools."""
import base64
import ipaddress
import json
import os
from pathlib import Path
import socket
import time
import xml.etree.ElementTree as ET

from operations import atom, checked, choice, flag, host_list, hosts, number, storage_action
from progress import emit, run


def pcs_hosts(a):
    return [str(value) for value in a.cluster().get('pcsCluster', {}).values() if value] or hosts(a)


def local_row(a, target=None):
    name = target or socket.gethostname()
    rows = a.cluster().get('hosts', [])
    return next((row for row in rows if name in (row.get('hostname'), row.get('ablecube'), row.get('ablecubePn'))), {})


def cidr(value, prefix):
    interface = ipaddress.ip_interface(str(value) + ('' if '/' in str(value) else '/' + str(prefix)))
    return str(interface.ip), str(interface.network.prefixlen)


def cloudinit(a, kind, options, target=None):
    config = a.cluster()
    row = local_row(a, target)
    manage = config.get('mngtNic', {})
    ip, prefix = cidr(options.get('mgmt_ip') or (row.get('scvmMngt') if kind == 'scvm' else config['ccvm']['ip']), manage.get('cidr') or 24)
    root = a.ROOT / 'tools/vmconfig' / kind
    key = Path('/root/.ssh/id_rsa').read_text()
    public = Path('/root/.ssh/id_rsa.pub').read_text()
    contents = a.command(['cat', '/etc/hosts'], target=target)
    args = ['-f1', str(root / 'hosts'), '-t1', contents, '-f2', str(root / 'id_rsa'), '-t2', key,
            '-f3', str(root / 'id_rsa.pub'), '-t3', public, '--hostname',
            atom(options.get('hostname') or ('scvm' + str(row.get('index', '1')) if kind == 'scvm' else 'ccvm')),
            '--mgmt-ip', ip, '--mgmt-prefix', prefix]
    for field, value in [('mgmt_gw', options.get('mgmt_gw', manage.get('gw'))),
                         ('dns', options.get('dns', manage.get('dns')))]:
        if value:
            args += ['--' + field.replace('_', '-'), atom(value)]
    if kind == 'scvm':
        for field, profile_key in [('pn', 'scvm'), ('cn', 'scvmCn')]:
            address, bits = cidr(options.get(field + '_ip') or row[profile_key], options.get(field + '_prefix') or 24)
            args += ['--' + field + '-ip', address, '--' + field + '-prefix', bits]
    else:
        args += ['--mgmt-nic', 'enp0s20', '--host-names', ' '.join(map(atom, pcs_hosts(a)))]
        if options.get('sn_ip'):
            address, bits = cidr(options['sn_ip'], options.get('sn_prefix') or 24)
            args += ['--sn-nic', 'enp0s21', '--sn-ip', address, '--sn-prefix', bits]
            for key in ('sn_gw', 'sn_dns'):
                args += ['--' + key.replace('_', '-'), atom(options[key]) if options.get(key) else '']
    return checked(a, 'vm/create_' + kind + '_cloudinit.py', args, target)


def wait_ready(a, target, timeout=1200):
    deadline = time.monotonic() + timeout
    last_error = ''
    while time.monotonic() < deadline:
        try:
            result = a.tool('cloudinit_status/cloudinit_status.py', ['status', '--target', atom(target)], timeout=30)
            value = result.get('val', '')
            status = '\n'.join(map(str, value)) if isinstance(value, list) else str(value)
            if 'status: error' in status:
                raise ValueError(target + ' 초기 설정에 실패했습니다. VM의 /var/log/cloud-init-output.log를 확인해 주세요.')
            if str(result.get('code')) == '200' and 'status: done' in status:
                return {'code': 200}
            last_error = status
        except (OSError, RuntimeError) as error:
            last_error = str(error)
        time.sleep(3)
    raise RuntimeError(target + ' 초기 설정 완료를 기다리는 시간이 초과되었습니다. ' + last_error[-500:])


def apply_license(a, roles):
    info = checked(a, 'license/register_license.py', ['--status']).get('val', {})
    if info.get('status') != 'active':
        raise ValueError('등록된 라이선스가 유효하지 않습니다.')
    content = base64.b64encode(Path(info['file_path']).read_bytes()).decode()
    for role in roles:
        target = choice(role, ('ccvm', 'scvm'))
        run(a, '가상머신 초기 설정 완료 확인', lambda: wait_ready(a, target + '-mngt'))
        checked(a, 'license/register_license.py',
                ['--license-content', content, '--original-filename', Path(info['file_path']).name],
                target=target + '-mngt')
    return {'code': 200}


def bootstrap(a, kind):
    title = '스토리지센터' if kind == 'scvm' else '클라우드센터'
    run(a, title + ' 가상머신 초기 설정 확인', lambda: wait_ready(a, kind + '-mngt'))
    info = checked(a, 'license/register_license.py', ['--status']).get('val', {})
    if info.get('status') != 'active':
        raise ValueError('유효한 라이선스 등록이 필요합니다.')
    run(a, title + ' 구성', lambda: a.command(
        ['python3', '-u', str(a.ROOT / 'python/bootstrap/center_bootstrap.py'), kind,
         info.get('oem') or 'ablestack'], timeout=7500))
    return {'code': 200, 'message': ('스토리지센터' if kind == 'scvm' else '클라우드센터') + ' 구성이 완료되었습니다.'}


def check_health(a, option):
    allowed = {'host', 'scvm', 'ccvm'}
    groups = set(option.split(','))
    if not groups <= allowed:
        raise ValueError('지원하지 않는 통신 검사 대상입니다.')
    config = a.cluster()
    addresses = []
    if 'host' in groups:
        addresses += [row['ablecube'] for row in config.get('hosts', [])]
    if 'scvm' in groups:
        addresses += [row['scvmMngt'] for row in config.get('hosts', [])]
    if 'ccvm' in groups:
        addresses.append(config['ccvm']['ip'])
    return checked(a, 'vm/host_ping_test.py', ['--host-names', *map(atom, addresses)])


def ccvm_create(a, definition):
    args = ['--cpu', number(definition['cpu']), '--memory', number(definition['memory']),
            '--management-network-bridge', atom(definition['management_network_bridge']),
            '--host-names', ' '.join(map(atom, pcs_hosts(a)))]
    for key in ('service_network_bridge', 'gfs_mount_point'):
        if definition.get(key):
            args += ['--' + key.replace('_', '-'), atom(definition[key])]
    return checked(a, 'vm/create_ccvm_xml.py', args)


def ccvm_lifecycle(a, action):
    kind = a.cluster()['type']
    if action == 'initialize':
        if kind == 'ablestack-hci':
            # This existing reset removes only the CCVM RBD disk and its dedicated PCS cluster.
            return checked(a, 'vm/reset_cloud_center.py')
        # Shared/local storage is already configured before this wizard. A whole-center reset
        # would destroy that storage; remove only the VM definition and resource here.
        targets = [None] if kind == 'ablestack-standalone' else pcs_hosts(a)
        if kind != 'ablestack-standalone':
            response = a.tool('pcs/main.py', ['remove', '--resource', 'cloudcenter_res'], target=a.pcs_target())
            if str(response.get('code')) not in ('200', '400'):
                a.success(response)
        for target in targets:
            names = a.command(['virsh', 'list', '--all', '--name'], target=target).splitlines()
            if 'ccvm' in names:
                state = a.command(['virsh', 'domstate', 'ccvm'], target=target).strip()
                if state == 'running':
                    a.command(['virsh', 'destroy', 'ccvm'], target=target)
                a.command(['virsh', 'undefine', 'ccvm', '--keep-nvram'], target=target)
        flag(a, 'bootstrap', 'ccvm', 'false', kind != 'ablestack-standalone')
        flag(a, 'monitoring', 'wall', 'false', kind != 'ablestack-standalone')
        if kind == 'ablestack-standalone':
            return checked(a, 'vm/local_ccvm_manage.py', ['copy'])
        return {'code': 200}
    if kind == 'ablestack-standalone':
        if action == 'start' and a.vm_state('ccvm') == 'not deployed':
            return checked(a, 'vm/local_ccvm_manage.py', ['create'])
        return checked(a, 'vm/local_ccvm_manage.py', [choice(action, ('start', 'stop', 'delete', 'create', 'copy'))])
    if action in ('start', 'setup'):
        if action == 'setup':
            if kind == 'ablestack-vm':
                return storage_action(a, 'gfs/manage', {'action': 'create-ccvm-cluster', 'gfs_name': 'glue-gfs',
                                      'mount_point': '/mnt/glue-gfs', 'cluster_name': 'cloudcenter_res'})
            return checked(a, 'vm/setup_pcs_cluster.py', ['--host-names', ' '.join(map(atom, pcs_hosts(a)))])
        status = a.pcs_status()
        if str(status.get('code')) == '400':
            return ccvm_lifecycle(a, 'setup')
        a.success(status)
        root = ET.fromstring(a.command(['pcs', 'status', 'xml'], target=a.pcs_target()))
        if root.find(".//resource[@id='cloudcenter_res']") is None:
            return ccvm_lifecycle(a, 'setup')
    verb = {'start': 'enable', 'stop': 'disable', 'delete': 'remove'}[choice(action, ('start', 'stop', 'delete'))]
    return checked(a, 'pcs/main.py', [verb, '--resource', 'cloudcenter_res'], target=a.pcs_target())


def scvm_prepare(a, definitions, cloudinit_options=None):
    for target, definition in definitions.items():
        if target not in hosts(a):
            raise ValueError('클러스터에 등록되지 않은 호스트입니다.')
        checked(a, 'vm/reset_storage_center.py', target=target)
        cloudinit(a, 'scvm', (cloudinit_options or {}).get(target, {}), target)
        args = ['--cpu', number(definition['cpu']), '--memory', number(definition['memory']),
                '--disk-type', choice(definition['disk_type'], ('raid_passthrough', 'disk_passthrough', 'lun_passthrough')),
                '--management-network-bridge', atom(definition['management_network_bridge']),
                '--storage-traffic-network-type', choice(definition['storage_traffic_network_type'],
                                                       ('nic_passthrough', 'nic_passthrough_bonding', 'bridge'))]
        for key in ('raid_passthrough_list', 'disk_passthrough_list', 'lun_passthrough_list',
                    'server_nic_passthrough', 'replication_nic_passthrough',
                    'server_nic_passthrough_bonding_list', 'replication_nic_passthrough_bonding_list',
                    'server_network_bridge', 'replication_network_bridge'):
            if definition.get(key):
                values = definition[key] if isinstance(definition[key], list) else [definition[key]]
                args += ['--' + key.replace('_', '-'), *map(atom, values)]
        checked(a, 'vm/create_scvm_xml.py', args, target)
        checked(a, 'vm/setup_storage_vm.py', target=target)
    return {'code': 200}


def cluster_apply(a, payload):
    emit(a, '클러스터 종류와 호스트 구성 정보를 확인합니다.')
    definition = dict(a.cluster(), **payload['cluster'])
    kind = choice(definition['type'], ('ablestack-hci', 'ablestack-hci-filesystem', 'ablestack-vm', 'ablestack-standalone', 'powerflex'))
    rows = definition['hosts']
    if not rows or len(rows) > 128:
        raise ValueError('클러스터 호스트 목록을 확인해 주세요.')
    for row in rows:
        atom(row['hostname'])
        for key in ('ablecube', 'ablecubePn', 'scvmMngt', 'scvm', 'scvmCn'):
            if row.get(key):
                ipaddress.ip_address(row[key])
    emit(a, '클러스터 구성 정보 확인이 완료되었습니다.')
    pcs = definition.get('pcs_cluster_list', [])
    profile = {'clusterConfig': {'type': kind, 'hosts': rows, 'ccvm': definition.get('ccvm', a.cluster().get('ccvm')),
                                'pcsCluster': {'hostname' + str(i + 1): atom(host) for i, host in enumerate(pcs)}}}
    enrollment = payload.get('enrollment', {})
    source = enrollment.get('source', 'existing')
    run(a, '호스트 통신 등록 및 연결 설정 적용', lambda: a.command(
        ['python3', '/usr/libexec/ablestack/node-agent/cluster_enrollment.py', 'prepare', '--source',
         choice(source, ('new', 'existing'))], timeout=300,
        stdin=json.dumps({'cluster': profile, 'registration': enrollment.get('registration')}).encode()))
    adding = definition.get('option') == 'add'
    args = ['insertAllHost' if adding else 'insert', '--type', kind, '--json-string', json.dumps(rows),
            '--iscsi-storage', str(definition.get('storage_network', 'false')).lower()]
    if adding:
        args += ['--exclude-hostname', atom(definition['new_hostname'])]
    for key, option in [('ccvm', '--ccvm-mngt-ip')]:
        if definition.get(key, {}).get('ip'):
            args += [option, str(ipaddress.ip_address(definition[key]['ip']))]
    manage = definition.get('mngtNic', {})
    for key, option in [('cidr', '--mngt-nic-cidr'), ('gw', '--mngt-nic-gw'), ('dns', '--mngt-nic-dns')]:
        if manage.get(key) != '' and manage.get(key) is not None:
            args += [option, atom(manage[key])]
    if pcs:
        args += ['--pcs-cluster-list', *map(atom, pcs)]
    if definition.get('external_timeserver'):
        args += ['--extenal-timeserver', atom(definition['external_timeserver'])]
    result = checked(a, 'cluster/cluster_config.py', args)
    if adding:
        if kind == 'ablestack-vm':
            ipmi = definition['ipmi']
            fields = [atom(ipmi['ip']), '623', str(ipmi['user']), str(ipmi['password'])]
            if any(',' in value or ';' in value for value in fields):
                raise ValueError('IPMI 계정 정보에는 쉼표와 세미콜론을 사용할 수 없습니다.')
            checked(a, 'gfs/gfs_manage.py', ['--extend-pcs-cluster', '--password', 'password', '--stonith', ','.join(fields),
                     '--mount-point', '/mnt/glue-gfs', '--iscsi-check', str(definition.get('storage_network', 'false')).lower(),
                     '--list-ip', ' '.join(map(atom, pcs))])
        checked(a, 'ablestack_json/ablestackJson.py', ['allUpdate'])
    times = payload.get('time_servers') or [definition.get('external_timeserver')]
    times = [atom(value) for value in times if value]
    if times or payload.get('time_role'):
        def configure_time():
            path = Path('/etc/chrony.conf')
            existing = path.read_text() if path.exists() else ''
            row = local_row(a)
            own = [row.get('ablecube'), row.get('ablecubePn'), '127.0.0.1', 'localhost']
            path.write_text(chrony_settings(existing, times, own, payload.get('time_role')))
            a.command(['systemctl', 'restart', 'chronyd.service'])
        run(a, '시간 동기화 설정 적용 및 서비스 재시작', configure_time)
    emit(a, '클러스터 구성 준비가 완료되었습니다.')
    return result


def chrony_settings(existing, servers, own_addresses, role=None):
    if role is not None:
        choice(role, ('master', 'second', 'other'))
    selected = [server for server in servers if server not in own_addresses]
    lines = [line for line in existing.splitlines() if not line.strip().startswith(('server ', 'pool ', 'peer '))]
    if role:
        lines = [line for line in lines if not line.strip().startswith('local stratum ')]
        if role in ('master', 'second'):
            lines.append('local stratum 10')
        if not any(line.strip().startswith('allow ') for line in lines):
            lines.append('allow 0.0.0.0/0')
    return '\n'.join(['server ' + server + ' iburst' for server in dict.fromkeys(selected)] + lines) + '\n'


def monitoring(a, payload):
    root = '/usr/share/ablestack/ablestack-wall/python/'
    config = a.cluster()
    args = ['config', '--ccvm', *map(atom, payload.get('ccvm') or [config['ccvm']['ip']]),
            '--cube', *map(atom, payload.get('cube') or [row['ablecube'] for row in config['hosts']])]
    storage = payload.get('scvm') or [row['scvmMngt'] for row in config['hosts'] if row.get('scvmMngt')]
    if storage:
        args += ['--scvm', *map(atom, storage)]
    services = ['--service', 'blackbox-exporter', 'node-exporter', 'grafana-server', 'process-exporter', 'prometheus', 'netdive-analyzer']
    for label, script, options in [
        ('기존 모니터링 서비스 중지', 'stop_services.py', ['stop', *services]),
        ('모니터링 대상 및 지표 수집 설정 적용', 'config_wall.py', args),
        ('모니터링 서비스 시작', 'start_services.py', ['start', *services]),
    ]:
        run(a, label, lambda: a.success(a.parse_output(a.command(
            ['python3', root + script, *options], target='ccvm-mngt', timeout=900))))
    smtp = payload.get('smtp', {})
    if smtp.get('enabled'):
        run(a, '모니터링 알림 메일 설정 적용', lambda: a.success(a.parse_output(a.command(
            ['python3', root + 'config_smtp.py', 'config',
             '--host', atom(smtp['host']) + ':' + number(smtp['port'], 1, 65535),
             '--user', smtp['user'], '--password', smtp['password']], target='ccvm-mngt'))))
    flag(a, 'monitoring', 'wall', all_hosts=True)
    emit(a, '모니터링센터 구성이 완료되었습니다.')
    return {'code': 200, 'message': '모니터링센터 구성이 완료되었습니다.'}


def deploy(a, payload, reporter):
    steps = payload.get('only', [])
    allowed = {'license_apply', 'cluster_apply', 'scvm_prepare', 'scvm_bootstrap', 'storage_verify', 'storage_prepare', 'rbd_prepare',
               'local_prepare', 'ccvm_prepare', 'ccvm_bootstrap', 'monitoring_prepare', 'system_profile'}
    if not steps or any(step not in allowed for step in steps) or len(steps) != len(set(steps)):
        raise ValueError('배포 단계 목록을 확인해 주세요.')
    for name in steps:
        def execute():
            if name == 'cluster_apply':
                return cluster_apply(a, payload)
            if name == 'license_apply':
                return a.sync_license_flags()
            if name == 'scvm_prepare':
                return scvm_prepare(a, payload['scvm_by_host'], payload.get('scvm_cloudinit_by_host'))
            if name in ('scvm_bootstrap', 'ccvm_bootstrap'):
                return bootstrap(a, name[:4])
            if name == 'storage_verify':
                pools = a.parse_output(a.command(['ceph', 'osd', 'pool', 'ls', '--format', 'json'], target='scvm'))
                if 'rbd' not in pools:
                    raise ValueError('스토리지센터에서 OSD와 rbd 풀 구성을 완료한 뒤 다음 단계를 실행해 주세요.')
                return {'code': 200}
            if name == 'rbd_prepare':
                return checked(a, 'rbd/rbd_manage.py', ['--create-rbd-image', '--size', number(payload['rbd']['size']), '--list-ip', host_list(a)])
            if name == 'storage_prepare':
                gfs = payload['gfs']
                disks = gfs.get('disks') or []
                if not disks:
                    inventory = a.tool('disk/disk_action.py', ['hci-shared-file-list'])
                    rows = inventory.get('val', {}).get('blockdevices', [])
                    disks = [row.get('rbd_path') or row.get('path') or '/dev/' + row['name'] for row in rows]
                if not disks:
                    raise ValueError('구성할 공유 디스크를 찾지 못했습니다. 디스크 생성과 호스트 매핑 상태를 확인해 주세요.')
                storage_action(a, 'gfs/manage', dict(gfs, action='init-pcs-cluster', disks=disks, vg_name='vg_glue', lv_name='lv_glue'))
                storage_action(a, 'gfs/manage', dict(gfs, action='configure-stonith'))
                storage_action(a, 'gfs/manage', dict(gfs, action='create-gfs', disks=disks, vg_name='vg_glue',
                               lv_name='lv_glue', gfs_name='glue-gfs', cluster_name='cloudcenter_cluster',
                               mount_point=gfs.get('mount_point', '/mnt/glue-gfs')))
                storage_action(a, 'gfs/manage', {'action': 'set-alert'})
                return flag(a, 'bootstrap', 'gfs_configure', all_hosts=True)
            if name == 'local_prepare':
                checked(a, 'local/local_manage.py', ['--create-local-disk', '--disks', ','.join(map(atom, payload['local']['disks']))])
                return flag(a, 'bootstrap', 'local_configure')
            if name == 'ccvm_prepare':
                ccvm_lifecycle(a, 'initialize')
                cloudinit(a, 'ccvm', payload.get('ccvm_cloudinit', {}))
                ccvm_create(a, payload['ccvm_xml'])
                return ccvm_lifecycle(a, 'create' if a.cluster()['type'] == 'ablestack-standalone' else 'setup')
            if name == 'monitoring_prepare':
                return monitoring(a, payload.get('monitoring', {}))
            result = a.deployment_status()
            if result.get('data', {}).get('stage') != 'ready':
                raise ValueError('일부 구성 단계가 완료되지 않았습니다. 대시보드의 실제 상태와 진행 로그를 확인해 주세요.')
            return result
        labels = {'cluster_apply': '클러스터 구성과 호스트 통신 등록을 적용합니다.', 'license_apply': '라이선스를 확인합니다.',
                  'scvm_prepare': '스토리지센터 가상머신을 배포합니다.', 'scvm_bootstrap': '스토리지센터를 구성합니다.',
                  'storage_verify': 'Glue 스토리지 풀 구성을 확인합니다.',
                  'rbd_prepare': 'Glue 공유 디스크를 생성합니다.', 'storage_prepare': '공유 파일시스템을 구성합니다.',
                  'local_prepare': '로컬 스토리지를 구성합니다.', 'ccvm_prepare': '클라우드센터 가상머신을 배포합니다.',
                  'ccvm_bootstrap': '클라우드센터를 구성합니다.', 'monitoring_prepare': '모니터링센터를 구성합니다.',
                  'system_profile': '구성 결과를 확인합니다.'}
        reporter.step(name, labels[name], execute)
    return {'code': 200}


def remove_host(a, hostname, reporter):
    row = next((row for row in a.cluster()['hosts'] if row['hostname'] == hostname), None)
    if row is None:
        raise ValueError('클러스터에 등록되지 않은 호스트입니다.')
    if hostname == socket.gethostname():
        raise ValueError('현재 접속한 호스트는 제거할 수 없습니다.')
    step = reporter.step
    def precheck():
        running = a.command(['virsh', 'list', '--name'], target=hostname).splitlines()
        if any(name.strip() for name in running):
            raise ValueError('제거할 호스트의 가상머신을 먼저 이전하거나 종료해 주세요.')
        if a.cluster()['type'] in ('ablestack-hci', 'ablestack-hci-filesystem'):
            daemons = a.parse_output(a.command(['ceph', 'orch', 'ps', '--hostname', 'scvm' + str(row['index']), '--format', 'json'], target='scvm'))
            if daemons:
                raise ValueError('스토리지센터에서 해당 SCVM의 데이터 이동과 Glue 데몬 제거를 먼저 완료해 주세요.')
        return {'code': 200}
    step('precheck', '호스트의 가상머신과 스토리지 사용 여부를 확인합니다.', precheck)
    if a.cluster()['type'] in ('ablestack-vm', 'ablestack-hci-filesystem'):
        step('remove_pcs_node', '공유 스토리지 클러스터에서 호스트를 제거합니다.',
             lambda: checked(a, 'gfs/gfs_manage.py', ['--remove-host', '--target-ip', atom(row['ablecube']), '--hostname', atom(hostname)]))
    step('update_cluster_files', '호스트 설정을 초기화하고 클러스터 프로파일을 갱신합니다.',
         lambda: checked(a, 'cluster/remove_cube_host.py', ['remove'], target=hostname))
    return {'code': 200}


def pfmp_deploy(a, body):
    checked(a, 'pfmp/reset_pfmp_vm.py')
    root = a.ROOT / 'tools/vmconfig/pfmp'
    options = ['-f1', str(root / 'id_rsa'), '-t1', Path('/root/.ssh/id_rsa').read_text(),
               '-f2', str(root / 'id_rsa.pub'), '-t2', Path('/root/.ssh/id_rsa.pub').read_text(),
               '--hostname', 'pfmp', '--mgmt-ip', str(ipaddress.ip_address(body['mgmt_ip'])),
               '--mgmt-prefix', number(body['mgmt_prefix'], 0, 32),
               '--ingress-ip', str(ipaddress.ip_address(body['mgmt_pool']))]
    for key in ('mgmt_gw', 'dns'):
        if body.get(key):
            options += ['--' + key.replace('_', '-'), atom(body[key])]
    checked(a, 'pfmp/create_pfmp_cloudinit.py', options)
    checked(a, 'pfmp/create_pfmp_xml.py', ['-c', number(body['cpu']), '-m', number(body['memory']),
                                        '-mnb', atom(body['management_network_bridge'])])
    args = []
    for key, option in [('mgmt_pool', '-mgmt'), ('data1_pool', '-data1'), ('data2_pool', '-data2')]:
        start = ipaddress.IPv4Address(body[key])
        args += [option, str(start) + ' - ' + str(start + 4)]
    return checked(a, 'pfmp/create_pfmp_setup.py', args)
