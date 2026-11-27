"""Mold native resource setup. API contracts: https://cloudstack.apache.org/api/apidocs-4.20/"""
import hashlib
import http.cookiejar
import ipaddress
import json
import os
from pathlib import Path
import sys
import time
from urllib.parse import quote, urlencode
from urllib.request import build_opener, HTTPCookieProcessor

REQUIRED = {'auth': ('username', 'password'), 'zone': ('name', 'dns1', 'internaldns1', 'guestcidraddress'),
            'physical_network': ('name',), 'pod': ('name', 'gateway', 'netmask', 'startip', 'endip'),
            'public_ip': ('gateway', 'netmask', 'startip', 'endip'), 'cluster': ('name',)}


def plan(body):
    missing = [group + '.' + key for group, keys in REQUIRED.items() for key in keys if not body.get(group, {}).get(key)]
    for group, values in body.items():
        if not isinstance(values, dict):
            continue
        for key, value in values.items():
            if value and key in ('dns1', 'dns2', 'internaldns1', 'internaldns2', 'gateway', 'netmask', 'startip', 'endip'):
                ipaddress.ip_address(value)
            if value and key == 'guestcidraddress':
                ipaddress.ip_network(value, strict=False)
    steps = [{'name': name, 'command': command, 'verify_command': verify, 'required_inputs': [], 'missing_inputs': missing, 'notes': []}
             for name, command, verify in [('zone', 'createZone', 'listZones'), ('physical_network', 'createPhysicalNetwork', 'listPhysicalNetworks'),
                 ('traffic', 'addTrafficType', 'listTrafficTypes'), ('pod', 'createPod', 'listPods'),
                 ('public_ip', 'createVlanIpRange', 'listVlanIpRanges'), ('cluster', 'addCluster', 'listClusters'),
                 ('hosts', 'addHost', 'listHosts'), ('primary', 'createStoragePool', 'listStoragePools'),
                 ('secondary', 'addImageStore', 'listImageStores'), ('enable_zone', 'updateZone', 'listZones'),
                 ('system_vms', 'listSystemVms', 'listSystemVms')]]
    return {'code': 200, 'val': {'ready': not missing, 'steps': steps, 'missing_inputs': missing, 'notes': []}}


class NativeClient:
    def __init__(self, auth):
        self.opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.session = ''
        result = self.call('login', username=auth['username'], password=hashlib.md5(auth['password'].encode()).hexdigest(),
                           domain=auth.get('domain', '/'))
        self.session = result['sessionkey']

    def call(self, command, **parameters):
        values = {'command': command, 'response': 'json', **{key: value for key, value in parameters.items() if value != '' or key == 'password'}}
        if self.session:
            values['sessionkey'] = self.session
        # Run inside the CCVM through the authenticated Cube Agent. Credentials stay on loopback.
        with self.opener.open('http://127.0.0.1:8080/client/api', data=urlencode(values).encode(), timeout=60) as response:
            result = json.load(response)
        result = result.get(command.lower() + 'response', result.get('errorresponse', result))
        if result.get('errorcode'):
            raise RuntimeError(str(result.get('errortext', 'Mold 작업 실패')))
        if result.get('jobid'):
            deadline = time.monotonic() + 1800
            while time.monotonic() < deadline:
                task = self.call('queryAsyncJobResult', jobid=result['jobid'])
                if task.get('jobstatus') == 1:
                    return task['jobresult']
                if task.get('jobstatus') == 2:
                    raise RuntimeError(str(task.get('jobresult', {}).get('errortext', 'Mold 비동기 작업 실패')))
                time.sleep(2)
            raise TimeoutError('Mold 작업 결과 대기 시간이 초과되었습니다.')
        return result

    def resource(self, list_command, key, name, create_command, parameters, **scope):
        existing = self.call(list_command, **scope).get(key, [])
        selected = [item for item in existing if item.get('name') == name]
        if len(selected) > 1:
            raise ValueError('동일한 이름의 리소스가 여러 개입니다: ' + name)
        if selected:
            return selected[0]
        result = self.call(create_command, **parameters, **scope)
        value = result.get(key, result)
        return value[0] if isinstance(value, list) else value


def configure(body, client=None):
    if not plan(body)['val']['ready']:
        raise ValueError('클라우드 리소스 필수 입력값을 확인해 주세요.')
    client = client or NativeClient(body['auth'])
    progress = lambda message: print('[ABLESTACK-PROGRESS] ' + message, flush=True)
    progress('클라우드 Zone을 구성합니다.')
    zone = client.resource('listZones', 'zone', body['zone']['name'], 'createZone', body['zone'])
    zoneid = zone['id']
    progress('물리 네트워크를 구성합니다.')
    physical = client.resource('listPhysicalNetworks', 'physicalnetwork', body['physical_network']['name'],
                               'createPhysicalNetwork', body['physical_network'], zoneid=zoneid)
    networkid = physical['id']
    existing = client.call('listTrafficTypes', physicalnetworkid=networkid).get('traffictype', [])
    for traffic in ('Management', 'Public', 'Guest', 'Storage'):
        if not any(item.get('traffictype') == traffic for item in existing):
            client.call('addTrafficType', physicalnetworkid=networkid, traffictype=traffic)
    client.call('updatePhysicalNetwork', id=networkid, state='Enabled', vlan='1-1')
    providers = client.call('listNetworkServiceProviders', physicalnetworkid=networkid).get('networkserviceprovider', [])
    for provider in providers:
        if provider.get('name') == 'VirtualRouter':
            elements = client.call('listVirtualRouterElements', nspid=provider['id']).get('virtualrouterelement', [])
            if not elements:
                raise RuntimeError('가상 라우터 구성을 확인하지 못했습니다.')
            client.call('configureVirtualRouterElement', id=elements[0]['id'], enabled='true')
            client.call('updateNetworkServiceProvider', id=provider['id'], state='Enabled')
    progress('Pod와 공용 IP 대역을 구성합니다.')
    pod = client.resource('listPods', 'pod', body['pod']['name'], 'createPod', body['pod'], zoneid=zoneid)
    ranges = client.call('listVlanIpRanges', zoneid=zoneid).get('vlaniprange', [])
    if not any(item.get('startip') == body['public_ip']['startip'] and item.get('endip') == body['public_ip']['endip'] for item in ranges):
        client.call('createVlanIpRange', zoneid=zoneid, physicalnetworkid=networkid, forvirtualnetwork='true', **body['public_ip'])
    progress('클라우드 클러스터를 구성합니다.')
    parameters = dict(body['cluster'])
    parameters['clustername'] = parameters.pop('name')
    cluster = client.resource('listClusters', 'cluster', body['cluster']['name'], 'addCluster', parameters, zoneid=zoneid, podid=pod['id'])
    profile = body.get('_profile')
    if profile:
        configure_infrastructure(client, profile, zoneid, pod['id'], cluster['id'], body)
    progress('클라우드 리소스 구성이 완료되었습니다.')
    return {'code': 200, 'val': {'zone': zoneid, 'pod': pod['id'], 'cluster': cluster['id']}}


def configure_infrastructure(client, profile, zone, pod, cluster, body):
    progress = lambda message: print('[ABLESTACK-PROGRESS] ' + message, flush=True)
    progress('클라우드 호스트를 등록합니다.')
    key_paths = [Path(root) / 'management/.ssh/id_rsa.pub' for root in ('/var/mold', '/var/cloudstack', '/var/lib/cloudstack')]
    public = next((path.read_text() for path in key_paths if path.is_file()), None)
    if not public:
        raise RuntimeError('Mold 관리 서비스의 호스트 등록 공개키를 찾지 못했습니다.')
    sys.path.insert(0, '/usr/libexec/ablestack/node-agent')
    from client import Client
    agent = Client()
    install_key = """import os,sys
from pathlib import Path
root=Path('/root/.ssh'); root.mkdir(mode=0o700,exist_ok=True)
key=sys.stdin.read().strip()
if not key.startswith(('ssh-rsa ', 'ssh-ed25519 ')): raise ValueError('Invalid public key')
path=root/'authorized_keys'
existing=path.read_text() if path.exists() else ''
if key not in existing.splitlines(): path.write_text(existing.rstrip()+'\\n'+key+'\\n')
path.chmod(0o600)
"""
    existing = client.call('listHosts', clusterid=cluster).get('host', [])
    for host in profile['hosts']:
        if any(item.get('ipaddress') == host['ablecube'] for item in existing):
            continue
        result = agent.execute(host['hostname'], ['python3', '-c', install_key], stdin=public.encode(), timeout=30)
        if result.returncode:
            raise RuntimeError(host['hostname'] + '의 호스트 등록 공개키 적용에 실패했습니다.')
        client.call('addHost', hypervisor='KVM', zoneid=zone, podid=pod, clusterid=cluster,
                    url='http://' + host['ablecube'], username='root', password='')
    progress('주 스토리지를 등록합니다.')
    override = body.get('primary_storage', {})
    if override.get('url'):
        url = override['url']
    elif profile['type'] == 'ablestack-hci':
        monitor = profile['hosts'][0]['scvm']
        url = 'rbd://admin:' + quote(profile['_storage_secret'], safe='') + '@' + monitor + ':6789/rbd'
    elif profile['type'] in ('ablestack-vm', 'ablestack-hci-filesystem', 'ablestack-standalone'):
        mount = '/mnt/glue' if profile['type'] == 'ablestack-standalone' else '/mnt/glue-gfs'
        url = 'SharedMountPoint://localhost' + mount
    else:
        raise ValueError('이 제품의 주 스토리지 URL과 제공자를 입력해 주세요.')
    client.resource('listStoragePools', 'storagepool', 'Primary Storage', 'createStoragePool',
                    {'name': 'Primary Storage', 'provider': override.get('provider') or 'DefaultPrimary', 'url': url,
                     'scope': 'CLUSTER', 'hypervisor': 'KVM', 'podid': pod, 'clusterid': cluster}, zoneid=zone)
    progress('보조 스토리지를 등록합니다.')
    secondary = 'nfs://' + profile['ccvm']['ip'] + '/nfs/secondary'
    stores = client.call('listImageStores', zoneid=zone).get('imagestore', [])
    if not any(item.get('url', '').rstrip('/') == secondary for item in stores):
        client.call('addImageStore', name='Secondary Storage', provider='NFS', url=secondary, zoneid=zone)
    progress('클라우드 Zone을 활성화합니다.')
    client.call('updateZone', id=zone, allocationstate='Enabled')
    progress('시스템 가상머신 실행 상태를 확인합니다.')
    deadline = time.monotonic() + 1800
    while time.monotonic() < deadline:
        systems = client.call('listSystemVms', zoneid=zone).get('systemvm', [])
        if len(systems) >= 2 and all(item.get('state', '').lower() == 'running' for item in systems):
            return
        time.sleep(5)
    raise RuntimeError('클라우드 리소스는 등록됐지만 시스템 가상머신 실행을 확인하지 못했습니다. 관리·서비스 네트워크와 템플릿 상태를 확인해 주세요.')


def handle(adapter, request, reporter=None):
    from tasks import snapshot, start
    path, body = request['path'], request.get('body', {})
    if '/jobs/' in path:
        if request.get('method', 'GET') != 'GET':
            raise ValueError('작업 결과는 조회 요청으로 확인해 주세요.')
        return {'code': 200, 'job': snapshot(path.rsplit('/', 1)[-1])}
    if path not in ('/api/v1/mold/bootstrap/plan', '/api/v1/mold/bootstrap') or request.get('method', 'GET') != 'POST':
        raise ValueError('지원하지 않는 클라우드 리소스 요청입니다.')
    if path.endswith('/plan'):
        return plan(body)
    if reporter is None:
        state = start(request, 'mold')
        return {'code': 202, 'job_id': state['job_id'], 'status': state['status']}
    body = dict(body)
    body['_profile'] = dict(adapter.cluster())
    if body['_profile'].get('type') == 'ablestack-hci' and not body.get('primary_storage', {}).get('url'):
        body['_profile']['_storage_secret'] = adapter.command(['ceph', 'auth', 'get-key', 'client.admin'], target='scvm', record=False).strip()
    return reporter.step('mold', '클라우드 리소스를 구성합니다.', lambda: adapter.parse_output(
        adapter.command(['python3', '-u', '-c', __file_contents()], target='ccvm-mngt',
                        stdin=json.dumps(body).encode(), timeout=3600)))


def __file_contents():
    from pathlib import Path
    return Path(__file__).read_text()


if __name__ == '__main__':
    payload = json.load(sys.stdin)
    try:
        print(json.dumps(configure(payload), ensure_ascii=False))
    except Exception as error:
        message = str(error)
        for secret in [payload.get('auth', {}).get('password'), payload.get('_profile', {}).get('_storage_secret')]:
            if secret:
                message = message.replace(secret, '***')
        print(json.dumps({'code': 500, 'val': message}, ensure_ascii=False))
        sys.exit(1)
