"""React contracts mapped to the existing Europa command entry points."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import socket
import zipfile
from urllib.parse import parse_qs, urlsplit

PATHS = {
    'nics', 'disk', 'ssh/key', 'downloads', 'cluster/health', 'cluster/apply-local',
    'scvm/lifecycle', 'scvm/bootstrap', 'ccvm/lifecycle', 'ccvm/edit', 'ccvm/create',
    'ccvm/bootstrap', 'ccvm/secondary/resize', 'ccvm/service/control', 'ccvm/snap', 'db/dump',
    'cloudinit/ccvm/generate', 'license/apply', 'pcs/control', 'gluecluster/update',
    'gluecluster/config', 'gluecluster/url', 'gfs/manage', 'clvm/manage', 'hba/manage',
    'multipath/sync', 'auto-shutdown', 'ccvm/monitoring/config', 'version/update',
    'security/patch', 'security/evidence', 'security/evidence/download', 'url',
    'deploy/jobs', 'deploy/run', 'hosts/remove', 'system/config', 'cluster/registration',
    'local/manage', 'rbd/manage', 'glue/config/update', '_tasks', 'backup/manage',
    'powerflex/status', 'powerflex/manage', 'glue/catalog', 'glue/service', 'system/context',
}
SSH_CONTEXT = b'ablestack-api:ssh-key-bundle:v1'
SSH_SECRET = b'ablestack-api-ssh-key-bundle-default-secret-v1'


def split_request(request):
    url = urlsplit(request.get('path', ''))
    return url.path.removeprefix('/api/v1/cube/'), parse_qs(url.query)


def handles(request):
    path, _ = split_request(request)
    return (path in PATHS or path.startswith('_tasks/') or path.startswith('hosts/remove/jobs/') or
            request.get('path', '').startswith('/api/v1/mold/') or
            request.get('path') == '/api/v1/version')


def should_queue(request):
    path, _ = split_request(request)
    if request.get('path', '').startswith('/api/v1/mold/'):
        return False
    if path == 'glue/service':
        from glue_catalog import operation
        body = request.get('body', {})
        return operation(body['service'], body.get('action', 'list'))['method'] != 'GET'
    action = (request.get('body') or {}).get('action', '')
    if str(action).startswith(('list', 'check')) or action in ('info', 'status', 'overview'):
        return False
    return (request.get('method', 'GET') == 'POST' and path not in {
        'ssh/key', 'downloads', 'cluster/registration', 'deploy/run', 'system/config',
        'hosts/remove',
    } and not path.startswith('_tasks/'))


def atom(value):
    value = str(value)
    if not value or not re.fullmatch(r'[A-Za-z0-9_./:@,+%=-]+', value) or value.startswith('-'):
        raise ValueError('장치·주소·이름의 형식을 확인해 주세요.')
    return value


def number(value, minimum=1, maximum=1048576):
    value = int(value)
    if not minimum <= value <= maximum:
        raise ValueError('입력한 수치가 허용 범위를 벗어났습니다.')
    return str(value)


def choice(value, choices):
    if value not in choices:
        raise ValueError('지원하지 않는 작업입니다: ' + str(value))
    return value


def hosts(a):
    return [row['hostname'] for row in a.cluster().get('hosts', [])]


def host_list(a):
    return ' '.join(map(atom, hosts(a)))


def checked(a, name, args=(), target=None, timeout=3600):
    return a.success(a.tool(name, args, target=target, timeout=timeout))


def flag(a, section, key, value='true', all_hosts=False):
    targets = hosts(a) if all_hosts else [None]
    for target in targets:
        checked(a, 'ablestack_json/ablestackJson.py',
                ['update', '--depth1', section, '--depth2', key, '--value', str(value)], target)
    return {'code': 200}


def ssh_keys(a, body):
    root = Path('/root/.ssh')
    private, public = root / 'id_rsa', root / 'id_rsa.pub'
    action = body.get('action', 'status')
    if action == 'generate':
        root.mkdir(mode=0o700, exist_ok=True)
        if not private.exists():
            a.command(['ssh-keygen', '-q', '-t', 'rsa', '-b', '3072', '-N', '', '-f', str(private)])
        if not public.exists():
            public.write_text(a.command(['ssh-keygen', '-y', '-f', str(private)]).strip() + '\n')
        return {'code': 200}
    if action == 'upload':
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        incoming = base64.b64decode(body['content'], validate=True)
        if not incoming.startswith(b'ASK1') or len(incoming) < 32:
            raise ValueError('SSH KEY 파일 형식을 확인해 주세요.')
        key = hashlib.sha256(SSH_CONTEXT + b'\0' + SSH_SECRET).digest()
        archive = AESGCM(key).decrypt(incoming[4:16], incoming[16:], SSH_CONTEXT)
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            contents = {name: bundle.read(name) for name in ('id_rsa', 'id_rsa.pub')}
        if not contents['id_rsa'].startswith(b'-----BEGIN ') or not contents['id_rsa.pub'].startswith(b'ssh-'):
            raise ValueError('SSH KEY 내용이 올바르지 않습니다.')
        root.mkdir(mode=0o700, exist_ok=True)
        # Validate the pair before replacing the currently installed keys.
        import tempfile
        with tempfile.TemporaryDirectory(dir=root) as work:
            staged = Path(work) / 'id_rsa'
            staged.write_bytes(contents['id_rsa'])
            staged.chmod(0o600)
            derived = a.command(['ssh-keygen', '-y', '-f', str(staged)]).split()[:2]
            if derived != contents['id_rsa.pub'].decode().split()[:2]:
                raise ValueError('개인키와 공개키가 일치하지 않습니다.')
            for name, value in contents.items():
                destination = root / name
                destination.write_bytes(value)
                destination.chmod(0o600 if name == 'id_rsa' else 0o644)
        return {'code': 200}
    if action == 'download':
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_STORED) as bundle:
            bundle.writestr('id_rsa', private.read_bytes())
            bundle.writestr('id_rsa.pub', public.read_bytes())
        key = hashlib.sha256(SSH_CONTEXT + b'\0' + SSH_SECRET).digest()
        nonce = os.urandom(12)
        content = b'ASK1' + nonce + AESGCM(key).encrypt(nonce, buffer.getvalue(), SSH_CONTEXT)
        return {'code': 200, 'content': base64.b64encode(content).decode(),
                'private_key': private.read_text(), 'public_key': public.read_text(), 'filename': 'ssh-key.dat'}
    return {'code': 200, 'val': {'private_key': private.read_text(), 'public_key': public.read_text()}}


def download(a, body):
    kind = body.get('kind')
    if kind == 'registrations':
        result = a.parse_output(a.command(['python3', '/usr/libexec/ablestack/node-agent/cluster_enrollment.py', 'list-exports']))
        exports = []
        for item in result['exports']:
            name = item if isinstance(item, str) else item.get('host') or item.get('hostname')
            value = a.parse_output(a.command(['python3', '/usr/libexec/ablestack/node-agent/cluster_enrollment.py',
                                            'export', '--host', atom(name)]))
            exports.append({'filename': name + '.cube-agent.json', 'content': json.dumps(value, ensure_ascii=False, indent=2)})
        return {'code': 200, 'files': exports}
    files = {'private': Path('/root/.ssh/id_rsa'), 'public': Path('/root/.ssh/id_rsa.pub'),
             'cluster': a.PROPERTIES / 'cluster.json'}
    path = files[choice(kind, files)]
    return {'code': 200, 'filename': path.name, 'content': base64.b64encode(path.read_bytes()).decode()}


def dispatch(a, request, reporter=None):
    if request.get('path', '').startswith('/api/v1/mold/'):
        from mold import handle
        return handle(a, request, reporter)
    path, query = split_request(request)
    body = request.get('body') or {}
    method = request.get('method', 'GET')
    if not isinstance(body, dict) or method not in ('GET', 'POST'):
        raise ValueError('유효하지 않은 요청입니다.')
    action = body.get('action', '')
    if method == 'GET' and not (path in {'_tasks', 'deploy/jobs', 'nics', 'disk', 'ssh/key', 'cluster/health',
           'system/config', 'security/evidence', 'security/evidence/download', 'url', 'gluecluster/url', 'powerflex/status',
           'system/context', 'glue/catalog'} or
           path.startswith(('_tasks/', 'hosts/remove/jobs/')) or request['path'] == '/api/v1/version'):
        raise ValueError('이 작업에는 실행 요청이 필요합니다.')
    if path == '_tasks':
        from tasks import list_tasks
        return {'code': 200, 'jobs': list_tasks()}
    if path == 'system/context':
        identity = a.read_json('/etc/ablestack/node-agent/agent.json').get('node_id', '')
        hostname = socket.gethostname()
        role = 'scvm' if str(identity).startswith('scvm') or 'scvm' in hostname.lower() else 'host'
        return {'code': 200, 'role': role, 'hostname': hostname}
    if path == 'glue/catalog':
        from glue_catalog import catalog
        return {'code': 200, 'services': catalog()}
    if path == 'glue/service':
        from glue_service import execute
        return execute(a, body)
    if path.startswith('_tasks/'):
        from tasks import snapshot
        return {'code': 200, 'job': snapshot(path.split('/')[-1])}
    if path.startswith('hosts/remove/jobs/'):
        from tasks import snapshot
        return {'code': 200, 'job': snapshot(path.split('/')[-1])}
    if path == 'deploy/jobs':
        from tasks import list_tasks
        return {'code': 200, 'jobs': list_tasks('deploy')}
    if path == 'deploy/run':
        from tasks import start
        state = start(request, 'deploy')
        return {'code': 202, 'job_id': state['job_id'], 'status': state['status'], 'steps': state['steps']}
    if path == 'nics':
        return a.tool('nic/network_action.py', ['list'])
    if path == 'powerflex/status':
        return a.tool('powerflex_status/powerflex_status.py', ['detail'])
    if path == 'powerflex/manage':
        if action == 'deploy':
            from workflows import pfmp_deploy
            return pfmp_deploy(a, body)
        if action == 'add-user':
            return checked(a, 'powerflex_status/powerflex_user_add.py',
                           ['add', '--username', body['username'], '--password', body['password']])
        if action == 'install':
            checked(a, 'pfmp/pfmp_install.py', ['pre_install'])
        result = checked(a, 'pfmp/pfmp_install.py', [choice(action, ('install', 'remove', 'reset', 'test'))])
        if action == 'install':
            flag(a, 'bootstrap', 'pfmp', all_hosts=True)
        return result
    if path == 'disk':
        source = query.get('action', ['list'])[0]
        return a.tool('disk/disk_action.py', [{'gfs': 'gfs-list', 'detail': 'gfs-list', 'rbd': 'hci-shared-file-list'}.get(source, 'list')])
    if path == 'ssh/key':
        if method == 'GET' and action not in ('', 'status', 'download'):
            raise ValueError('SSH KEY 변경에는 실행 요청이 필요합니다.')
        return ssh_keys(a, body)
    if path == 'downloads':
        return download(a, body)
    if path == 'cluster/registration':
        profile = body['cluster']
        return a.parse_output(a.command(['python3', '/usr/libexec/ablestack/node-agent/cluster_enrollment.py',
                                        'prepare', '--source', choice(body.get('source', 'existing'), ('new', 'existing'))],
                                       stdin=json.dumps({'cluster': profile, 'registration': body.get('registration')}).encode(),
                                       timeout=300))
    if path == 'cluster/health':
        from workflows import check_health
        return check_health(a, query.get('option', ['host'])[0])
    if path == 'system/config':
        if method == 'GET':
            return {'code': 200, 'val': a.props()}
        if action == 'update' and body.get('depth1') == 'license' and body.get('depth2') == 'status':
            return a.sync_license_flags()
        if action == 'gfs-configure':
            return flag(a, 'bootstrap', 'gfs_configure', all_hosts=True)
        raise ValueError('지원하지 않는 설정 변경입니다.')
    if path == 'scvm/lifecycle':
        args = [choice(action, ('start', 'stop', 'delete', 'resource'))]
        if action == 'resource':
            args += ['--cpu', number(body['cpu']), '--memory', number(body['memory'])]
        return checked(a, 'scvm_status/scvm_status_update.py', args)
    if path in ('scvm/bootstrap', 'ccvm/bootstrap'):
        from workflows import bootstrap
        return bootstrap(a, path[:4])
    if path == 'cloudinit/ccvm/generate':
        from workflows import cloudinit
        return cloudinit(a, 'ccvm', body)
    if path == 'ccvm/create':
        from workflows import ccvm_create
        return ccvm_create(a, body)
    if path == 'ccvm/lifecycle':
        from workflows import ccvm_lifecycle
        return ccvm_lifecycle(a, action)
    if path == 'ccvm/edit':
        return checked(a, 'host/virshedit.py', ['edit', '--cpu', number(body['cpu']), '--memory', number(body['memory'])],
                       target=a.pcs_target() if a.cluster().get('type') != 'ablestack-standalone' else None)
    if path == 'ccvm/secondary/resize':
        return checked(a, 'vm/ccvm_secondary_resize.py', ['--add-size', number(body['add_size'])])
    if path == 'ccvm/service/control':
        return checked(a, 'ccvm_service/ccvm_service_control.py',
                       [choice(action, ('start', 'stop', 'restart', 'status')), '--service-name',
                        choice(body['service_name'], ('mold.service', 'mysqld'))])
    if path == 'ccvm/snap':
        args = [choice(action, ('backup', 'rollback', 'list'))]
        if body.get('snap_name'):
            args += ['--snap-name', atom(body['snap_name'])]
        return checked(a, 'ccvm_snap/ccvm_snap_action.py', args)
    if path == 'db/dump':
        body = dict({'path': '/home/db_backup', 'repeat': 'daily', 'timeone': '02:00',
                     'timetwo': '0', 'delete': '30', 'checkOption': 'r'}, **body)
        args = [choice(action, ('instantBackup', 'regularBackup', 'deleteOldBackup', 'checkBackup', 'deactiveBackup'))]
        for key in ('path', 'repeat', 'timeone', 'timetwo', 'delete', 'checkOption'):
            if body.get(key):
                args += ['--' + key, atom(body[key])]
        return checked(a, 'vm/dump_ccvm.py', args)
    if path == 'backup/manage':
        args = [choice(action, ('backup', 'status', 'list', 'restore', 'overview', 'sync', 'schedule',
                               'unschedule', 'schedule-delete', 'unschedule-delete'))]
        for key in ('repeat', 'time', 'target_dir', 'target_file', 'mode'):
            if body.get(key):
                args += ['--' + key.replace('_', '-'), atom(body[key])]
        for key in ('day', 'month', 'retain_months'):
            if body.get(key):
                args += ['--' + key.replace('_', '-'), number(body[key])]
        return checked(a, 'backup/ccvm_backup.py', args, timeout=43200)
    if path == 'license/apply':
        from workflows import apply_license
        return apply_license(a, body.get('roles', ['ccvm']))
    if path == 'pcs/control':
        args = [choice(action, ('move', 'cleanup')), '--resource', 'cloudcenter_res']
        if action == 'move':
            args += ['--target', atom(body['target'])]
        return checked(a, 'pcs/main.py', args, target=a.pcs_target())
    if path == 'gluecluster/update':
        return checked(a, 'scc_status/scc_status_update.py', [choice(action, ('set_noout', 'unset_noout'))])
    if path in ('gluecluster/config', 'glue/config/update'):
        return checked(a, 'glue/update_glue_config.py', ['update'], target='scvm')
    if path in ('url', 'gluecluster/url'):
        option = query.get('option', ['storageCenter' if path.startswith('glue') else 'cloudCenter'])[0]
        result = checked(a, 'url/create_address.py', [choice(option, ('storageCenter', 'cloudCenter', 'wallCenter', 'cloudCenterVm', 'storageCenterVm'))])
        value = result.get('val')
        if isinstance(value, str):
            return {'code': 200, 'val': {option: value}}
        return result
    if path in ('clvm/manage', 'hba/manage', 'gfs/manage'):
        return storage_action(a, path, body)
    if path == 'local/manage':
        return checked(a, 'local/local_manage.py',
                       ['--' + choice(action, ('create-local-disk', 'local-disk-status', 'reset'))] +
                       (['--disks', ','.join(map(atom, body['disks']))] if body.get('disks') else []))
    if path == 'rbd/manage':
        args = ['--' + choice(action, ('create-rbd-image', 'delete-rbd-image')), '--list-ip', host_list(a)]
        for key in ('size', 'image_name'):
            if key in body:
                args += ['--' + key.replace('_', '-'), atom(body[key])]
        return checked(a, 'rbd/rbd_manage.py', args)
    if path == 'multipath/sync':
        a.command(['bash', str(a.ROOT / 'shell/host/multipath_sync.sh'), choice(action, ('sync', 'rescan'))], timeout=900)
        return {'code': 200, 'action': action, 'message': '외부 스토리지 작업이 완료되었습니다.', 'results': []}
    if path == 'auto-shutdown':
        return checked(a, 'host/auto-shutdown.py', [choice(action, ('check_mount', 'stop_scvms', 'shutdown_hosts'))])
    if path == 'cluster/apply-local' and action == 'reset':
        return checked(a, 'cluster/remove_cube_host.py', ['remove'])
    if path == 'ccvm/monitoring/config':
        from workflows import monitoring
        return monitoring(a, body)
    if path == 'version/update':
        return checked(a, 'host/ablestack_update.py',
                       [choice(action, ('info', 'run')), '--mount-path', atom(body['mount_path']),
                        '--update-type', choice(body.get('update_type', 'all'), ('all', 'mold'))])
    if request['path'] == '/api/v1/version':
        return {'code': 200, 'os_version': Path('/etc/os-release').read_text().splitlines()[0],
                'kernel_version': a.command(['uname', '-r']).strip(),
                'cockpit_version': a.command(['rpm', '-q', 'ablecube']).strip()}
    if path == 'security/patch':
        args = []
        if body.get('ssh_user'):
            args += ['--ssh-user', atom(body['ssh_user'])]
        for key in ('add_host', 'port_change', 'update_json_file', 'local', 'dry_run'):
            if body.get(key):
                args.append('--' + key.replace('_', '-'))
        if body.get('new_port'):
            args += ['--new-port', number(body['new_port'], 1, 65535)]
        if body.get('ssh_port'):
            args += ['--ssh-port', number(body['ssh_port'], 1, 65535)]
        if body.get('targets'):
            args += ['--targets', *[choice(item, ('ccvm', 'ablecube', 'scvm', 'all')) for item in body['targets']]]
        if body.get('dry_run') or body.get('update_json_file'):
            return checked(a, 'security_patch/security_patch.py', args)
        maintenance = a.cluster().get('type') != 'ablestack-standalone'
        if maintenance:
            checked(a, 'gfs/gfs_manage.py', ['--check-stonith', '--control', 'security-disable'])
        try:
            result = checked(a, 'security_patch/security_patch.py', args)
            if not body.get('port_change'):
                checked(a, 'security_patch/security_patch.py', ['--update-json-file'] + (['--local'] if body.get('add_host') else []))
            if body.get('new_port') and not body.get('add_host') and a.cluster().get('type') in ('ablestack-hci', 'ablestack-hci-filesystem'):
                checked(a, 'security_patch/security_patch.py', ['--ceph-ssh-change', '--new-port', number(body['new_port'], 1, 65535)])
            return result
        finally:
            if maintenance:
                checked(a, 'gfs/gfs_manage.py', ['--check-stonith', '--control', 'security-enable'])
    if path.startswith('security/evidence'):
        if path.endswith('/download'):
            response = checked(a, 'security_evidence/security_evidence_package.py', ['latest'])
            info = response.get('val', {})
            archive = Path(info.get('zip_path') or info.get('path', ''))
            if not archive.resolve().is_relative_to(Path('/var/lib/ablestack/security-evidence')):
                raise ValueError('증적 파일 경로를 확인하지 못했습니다.')
            return {'code': 200, 'content': base64.b64encode(archive.read_bytes()).decode()}
        args = ['generate'] if method == 'POST' else ['latest']
        if method == 'POST':
            args += ['--targets', *[choice(item, ('ccvm', 'ablecube', 'scvm', 'all')) for item in body.get('targets', ['all'])]]
            for key in ('items', 'ssh_port', 'timeout', 'max_output_lines'):
                if body.get(key):
                    args += ['--' + key.replace('_', '-'), atom(body[key])]
            for host in body.get('hosts', []):
                args += ['--host', atom(host)]
        return a.tool('security_evidence/security_evidence_package.py', args, timeout=14400)
    if path == 'hosts/remove':
        if reporter is None:
            from tasks import start
            state = start(request, 'hosts-remove')
            return {'code': 202, 'job_id': state['job_id']}
        from workflows import remove_host
        return remove_host(a, atom(body['hostname']), reporter)
    raise ValueError('연결되지 않은 작업입니다: ' + path)


def storage_action(a, path, body):
    action = body.get('action', 'list-hba-wwn' if path == 'hba/manage' else '')
    gfs_actions = {'init-pcs-cluster', 'create-gfs', 'configure-stonith', 'check-ipmi', 'set-alert',
                   'check-host', 'check-stonith', 'remove-host', 'create-ccvm-cluster'}
    clvm_actions = {'list-hba-wwn', 'list-clvm', 'create-clvm', 'delete-clvm', 'delete-gfs', 'extend', 'add-extend', 'rescan', 'scan', 'list-gfs'}
    choice(action, gfs_actions | clvm_actions)
    module = 'gfs/gfs_manage.py' if action in gfs_actions else 'clvm/disk_manage.py'
    args = ['--' + action]
    if action in ('configure-stonith', 'check-ipmi'):
        devices = body.get('stonith', [])
        if not devices:
            raise ValueError('IPMI 설정이 필요합니다.')
        values = []
        for device in devices:
            fields = [str(device[key]) if key != 'ipport' else str(device.get(key) or '623')
                      for key in ('ipaddr', 'ipport', 'login', 'passwd')]
            if any(',' in field or ';' in field for field in fields):
                raise ValueError('IPMI 계정 정보에는 쉼표와 세미콜론을 사용할 수 없습니다.')
            values.append(','.join(fields))
        args += (['--stonith'] if action == 'check-ipmi' else []) + [';'.join(values)]
    list_keys = ('disks', 'vg_names', 'lv_names', 'pv_names')
    for key in list_keys:
        if body.get(key):
            values = body[key] if isinstance(body[key], list) else str(body[key]).split(',')
            args += ['--' + key.replace('_', '-'), ','.join(map(atom, values))]
    for key in ('vg_name', 'lv_name', 'gfs_name', 'mount_point', 'cluster_name', 'non_stop_check', 'target_ip', 'hostname', 'control'):
        if body.get(key) is not None:
            option = key + 's' if module.startswith('clvm/') and key in ('vg_name', 'lv_name') else key
            args += ['--' + option.replace('_', '-'), atom(body[key])]
    if body.get('stonith'):
        for device in body['stonith']:
            atom(device['ipaddr'])
            if device.get('hostname'):
                atom(device['hostname'])
        if action not in ('configure-stonith', 'check-ipmi'):
            args += ['--stonith', json.dumps(body['stonith'])]
    if module.startswith('gfs/'):
        args += ['--list-ip', host_list(a)]
        if action == 'create-gfs':
            args += ['--journal-nums', str(len(hosts(a)) + 1)]
    return checked(a, module, args)
