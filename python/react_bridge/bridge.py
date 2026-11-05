#!/usr/bin/env python3
"""React service adapter for the existing tools; this is a Cockpit process, not an HTTP server."""
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
PROPERTIES = ROOT / 'tools/properties'
NODE_TOOLS = Path('/usr/libexec/ablestack/node-agent')
sys.path.insert(0, str(NODE_TOOLS))
sys.path.insert(0, str(Path(__file__).resolve().parent))
TASK_LOG = None


def parse_output(output):
    if isinstance(output, bytes):
        output = output.decode('utf-8', 'replace')
    try:
        return json.loads(output)
    except ValueError:
        decoder = json.JSONDecoder()
        for match in reversed(list(re.finditer(r'(?m)^\s*[\[{]', output))):
            try:
                value, _ = decoder.raw_decode(output[match.start():].lstrip())
                return value
            except ValueError:
                pass
    raise ValueError('작업 결과를 읽지 못했습니다. 서버 실행 로그를 확인해 주세요.')


def command(argv, target=None, timeout=120, stdin=None, record=True):
    if TASK_LOG is not None and record:
        with TASK_LOG.open('ab+') as output:
            output.seek(0, 2)
            offset = output.tell()
            if target:
                from client import Client
                result = Client().execute(target, argv, stdout=output, stderr=output, timeout=timeout, stdin=stdin)
            else:
                result = subprocess.run(argv, input=stdin, stdout=output, stderr=output, timeout=timeout,
                                        cwd=str(ROOT), env=dict(os.environ, LC_ALL='C'))
            output.flush()
            output.seek(offset)
            contents = output.read().decode('utf-8', 'replace')
        if result.returncode:
            raise RuntimeError(contents[-2000:] or '작업 실행에 실패했습니다.')
        return contents
    if target:
        from client import Client
        result = Client().execute(target, argv, timeout=timeout, stdin=stdin)
    else:
        result = subprocess.run(argv, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=timeout, cwd=str(ROOT), env=dict(os.environ, LC_ALL='C'))
    if result.returncode:
        message = result.stderr.decode('utf-8', 'replace') if isinstance(result.stderr, bytes) else result.stderr
        raise RuntimeError((message or '작업 실행에 실패했습니다.').strip()[-1200:])
    return result.stdout.decode('utf-8', 'replace') if isinstance(result.stdout, bytes) else result.stdout


def tool(relative, args=(), target=None, timeout=120, stdin=None):
    # Only application-selected paths reach this function; callers cannot select an executable.
    return parse_output(command(['python3', str(ROOT / 'python' / relative), *map(str, args)], target, timeout, stdin))


def success(response):
    if isinstance(response, dict) and str(response.get('code', 200)) not in ('200', '202'):
        raise RuntimeError(response.get('message') or (response.get('val') if isinstance(response.get('val'), str) else None)
                           or '요청한 작업이 완료되지 않았습니다.')
    return response


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return {} if default is None else default


def cluster():
    return read_json(PROPERTIES / 'cluster.json').get('clusterConfig', {})


def props():
    return read_json(PROPERTIES / 'ablestack.json')


def pcs_target():
    return success(tool('pcs/pcsExehost.py')).get('val')


def pcs_status():
    return tool('cloud_cluster_status/card-cloud-cluster-status.py', ['infrastructureDetail'], target=pcs_target())


def license_status():
    return tool('license/register_license.py', ['--status'])


def vm_state(name):
    # A failed libvirt connection is a query error, not evidence that a VM was deleted.
    names = command(['virsh', 'list', '--all', '--name'], timeout=10).splitlines()
    if name not in names:
        return 'not deployed'
    return command(['virsh', 'domstate', name], timeout=10).strip()


def deployment_status():
    config, settings = cluster(), props()
    kind = config.get('type', '')
    boot = settings.get('bootstrap', {})
    license_response = license_status()
    if str(license_response.get('code')) != '404':
        success(license_response)
    licensed = license_response.get('val', {})
    licensed = (str(license_response.get('code')) == '200' and
                isinstance(licensed, dict) and licensed.get('status') == 'active')
    prepared = configuration_prepared(config)
    has_storage = kind in ('ablestack-hci', 'ablestack-hci-filesystem', 'powerflex')
    scvm = vm_state('scvm') if has_storage and prepared else ''
    warnings = []
    try:
        infrastructure = pcs_status() if prepared and kind != 'ablestack-standalone' else {}
        if str(infrastructure.get('code', 200)) != '400':
            success(infrastructure)
        infrastructure = infrastructure.get('val', {}) if str(infrastructure.get('code')) == '200' else {}
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired):
        infrastructure = {}
        warnings.append({'key': 'infrastructure_status',
                         'message': '인프라 클러스터 상태를 조회하지 못했습니다. 연결 상태를 확인한 후 새로고침해 주세요.'})
    ccvm = ('running' if infrastructure.get('ccvm_running_node') else vm_state('ccvm')) if prepared else ''
    raw = {
        'license_status': str(licensed).lower(), 'ccfg_status': str(prepared).lower(),
        'scvm_status': scvm, 'scvm_bootstrap_status': str(boot.get('scvm', 'false')).lower(),
        'sc_status': '', 'cc_status': {'ok': 'HEALTH_OK', 'warn': 'HEALTH_WARN', 'err': 'HEALTH_ERR'}.get(infrastructure.get('health'), ''),
        'ccvm_status': ccvm,
        'ccvm_bootstrap_status': str(boot.get('ccvm', 'false')).lower(),
        'wall_monitoring_status': str(settings.get('monitoring', {}).get('wall', 'false')).lower(),
        'gfs_configure': str(boot.get('gfs_configure', 'false')).lower(),
        'local_configure': str(boot.get('local_configure', 'false')).lower(),
        'security_patch': str(settings.get('security_patch', {}).get('status', 'false')).lower(),
    }
    if has_storage and raw['scvm_bootstrap_status'] == 'true':
        try:
            if kind == 'powerflex':
                storage = tool('powerflex_status/powerflex_status.py', ['status'], timeout=60)
                raw['sc_status'] = 'HEALTH_OK' if str(storage.get('code')) == '200' else 'HEALTH_ERR'
            else:
                storage = tool('scc_status/scc_status_detail.py', ['detail'], timeout=60)
                raw['sc_status'] = storage.get('val', {}).get('cluster_status', '')
        except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired):
            warnings.append({'key': 'storage_status', 'message': '스토리지 클러스터 상태를 확인하지 못했습니다.'})
    actions = ['manage_license', 'download_config_file', 'ablestack_update', 'security_evidence']
    stage, message, order = 'license_register', 'license_required', 0
    if licensed:
        if not prepared:
            stage, message, order = 'cluster_config_prepare', 'cluster_config_required', 1
            actions.append('prepare_cluster_config')
        elif has_storage and scvm != 'running':
            stage, message, order = 'storage_vm_deploy', 'storage_vm_not_deployed', 2
            actions.append('deploy_storage_vm')
        elif has_storage and raw['scvm_bootstrap_status'] != 'true':
            stage, message, order = 'storage_cluster_configure', 'storage_vm_not_configured', 3
            actions.append('configure_storage_vm')
        elif kind in ('ablestack-vm', 'ablestack-hci-filesystem') and raw['gfs_configure'] != 'true':
            stage, message, order = 'gfs_storage_configure', 'gfs_storage_not_configured', 4
            actions.append('configure_gfs_storage')
        elif kind == 'ablestack-standalone' and raw['local_configure'] != 'true':
            stage, message, order = 'local_storage_configure', 'local_storage_not_configured', 4
            actions.append('configure_local_storage')
        elif ccvm != 'running':
            if warnings:
                stage, message, order = 'status_unavailable', 'infrastructure_status_unavailable', 5
            else:
                stage, message, order = 'cloud_vm_deploy', 'cloud_vm_not_deployed', 5
                actions.append('deploy_cloud_vm')
        elif raw['ccvm_bootstrap_status'] != 'true':
            stage, message, order = 'cloud_center_configure', 'cloud_vm_not_configured', 6
            actions.append('configure_cloud_vm')
        else:
            stage, message, order = 'ready', 'ready', 9
            actions.extend(['open_cloud_center', 'configure_monitoring', 'configure_cloud_resource'])
        if has_storage and raw['scvm_bootstrap_status'] == 'true':
            actions.append('open_storage_center')
        if raw['wall_monitoring_status'] == 'true':
            actions.append('open_monitoring_center')
        actions.append('run_security_patch')
    polling = {name: {'enabled': licensed and prepared, 'reason': ''} for name in
               ('storage_vm', 'storage_cluster', 'gfs_resource', 'gfs_disk', 'cloud_vm', 'cloud_cluster', 'mold')}
    return {'code': 200, 'data': {'os_type': kind, 'stage': stage, 'stage_order': order,
            'severity': 'success' if stage == 'ready' else 'warning', 'message_key': message,
            'available_actions': actions, 'warnings': warnings, 'raw': raw, 'polling': polling,
            'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}}


def configuration_prepared(config):
    try:
        hosts = Path('/etc/hosts').read_text()
        return bool(config.get('hosts')) and 'ablecube' in hosts and Path('/root/.ssh/id_rsa.pub').is_file()
    except OSError:
        return False


def cloud_vm_status():
    target = None
    if cluster().get('type') != 'ablestack-standalone':
        status = pcs_status()
        if str(status.get('code')) == '200':
            target = status.get('val', {}).get('ccvm_running_node') or None
    response = tool('host/virshlist.py', target=target)
    if isinstance(response, dict) and str(response.get('code', 200)) != '200':
        if response.get('message') == 'The CloudCenter VM has not been created.':
            return {'code': 200, 'data': {'State': 'not deployed'}}
        success(response)
    rows = response.get('data', []) if isinstance(response, dict) else response
    if not isinstance(rows, list):
        raise ValueError('클라우드센터 가상머신 상태를 읽지 못했습니다.')
    vm = next((row for row in rows if row.get('Name') == 'ccvm'), None)
    if vm is None:
        return {'code': 200, 'data': {'State': 'not deployed'}}
    return {'code': 200, 'data': vm}


def sync_license_flags():
    response = license_status()
    if str(response.get('code')) != '404':
        success(response)
    info = response.get('val', {})
    active = str(response.get('code')) == '200' and isinstance(info, dict) and info.get('status') == 'active'
    for key, value in [('status', str(active).lower()), ('type', (info.get('oem') or 'ablestack') if active else '')]:
        success(tool('ablestack_json/ablestackJson.py', ['update', '--depth1', 'license', '--depth2', key, '--value', value]))
    return {'code': 200, 'val': {'status': active}}


def route(request):
    if not isinstance(request, dict) or request.get('method', 'GET') not in ('GET', 'POST') or not isinstance(request.get('body', {}), dict):
        raise ValueError('유효하지 않은 요청입니다.')
    from operations import handles, dispatch, should_queue
    from tasks import start
    if handles(request):
        if should_queue(request):
            state = start(request)
            return {'code': 202, 'bridge_job': state['job_id']}
        return dispatch(sys.modules[__name__], request)
    url = urlsplit(request.get('path', ''))
    path = url.path
    method = request.get('method', 'GET')
    body = request.get('body') or {}
    if method not in ('GET', 'POST') or not isinstance(body, dict):
        raise ValueError('유효하지 않은 요청입니다.')
    action = str(body.get('action', ''))
    if path == '/api/v1/cube/license':
        if action in ('', 'status'):
            return license_status()
        if action == 'register' and method == 'POST':
            name = body.get('original_filename') or 'license'
            if Path(name).name != name or name in ('.', '..'):
                raise ValueError('유효하지 않은 라이선스 파일 이름입니다.')
            return tool('license/register_license.py', ['--license-content', body['license_content'], '--original-filename', name])
    if path == '/api/v1/cube/system/config':
        if method == 'GET':
            return {'code': 200, 'val': props()}
        if action == 'update' and body.get('depth1') == 'license' and body.get('depth2') == 'status':
            return sync_license_flags()
    if method != 'GET':
        raise ValueError('지원하지 않는 실행 요청입니다.')
    if path == '/api/v1/cube/cluster/config':
        return read_json(PROPERTIES / 'cluster.json')
    if path == '/api/v1/cube/deploy/status':
        return deployment_status()
    if path == '/api/v1/cube/infrastructure/status':
        return pcs_status()
    if path == '/api/v1/cube/scvm/status':
        response = tool('scvm_status/scvm_status_detail.py', ['detail'])
        return {'code': int(response['code']), 'data': response.get('val', {})}
    if path == '/api/v1/cube/ccvm/status':
        return cloud_vm_status()
    if path == '/api/v1/cube/gluecluster/status':
        return success(tool('scc_status/scc_status_detail.py', ['detail'])).get('val', {})
    if path == '/api/v1/cube/gfs/resource/status':
        return tool('gfs/gfs_resource_status.py')
    if path == '/api/v1/cube/gfs/disk/status':
        return tool('gfs/gfs_disk_status.py')
    raise ValueError('지원하지 않는 조회 요청입니다.')


def main():
    if os.geteuid() != 0:
        raise PermissionError('Cockpit에서 관리자 접근을 활성화해 주세요.')
    if len(sys.argv) == 3 and sys.argv[1] == '--worker':
        from tasks import worker
        worker(sys.argv[2], sys.modules[__name__])
        return
    request = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
    if len(request) > 4 * 1024 * 1024:
        raise ValueError('요청 내용이 너무 큽니다.')
    print(json.dumps(route(json.loads(request)), ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'code': 500, 'bridge_error': True, 'message': str(error)}, ensure_ascii=False))
