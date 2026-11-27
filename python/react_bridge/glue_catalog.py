"""SCVM UI contracts, taken from src/features/glue/*.js (the existing Glue API)."""
LABELS = {
    'name': '이름', 'vol_name': '파일시스템 이름', 'group_name': '서브볼륨 그룹', 'path': '경로',
    'size': '크기', 'new_size': '변경할 크기', 'data_pool_name': '데이터 풀', 'mode': '접근 권한',
    'hosts': '호스트 목록(한 줄에 하나)', 'cluster_id': 'NFS 클러스터 ID', 'port': '포트',
    'export_id': 'Export ID', 'access_type': '접근 방식', 'pseudo': '공유 경로', 'squash': '사용자 매핑',
    'storage_name': '파일시스템 이름', 'transports': '전송 프로토콜', 'folder_name': '공유 폴더 이름',
    'fs_name': '파일시스템 이름', 'volume_path': '볼륨 경로', 'cache_policy': '캐시 정책',
    'username': '사용자 이름', 'password': '비밀번호', 'realm': 'AD 도메인', 'dns': 'DNS',
    'sec_type': '인증 방식', 'service_id': '서비스 ID', 'pool': '스토리지 풀', 'pool_name': '스토리지 풀',
    'api_port': '관리 포트', 'api_user': '관리 계정', 'api_password': '관리 비밀번호',
    'image_name': '디스크 이미지 이름', 'iqn_id': 'IQN', 'new_iqn_id': '변경할 IQN', 'acl_enabled': 'ACL 사용',
    'ip_address': '포털 IP 목록(한 줄에 하나)', 'subsystem_nqn_id': 'NQN', 'nqn_id': 'NQN',
    'gateway_ip': '게이트웨이 IP', 'service_name': '서비스 이름', 'zonegroup_name': 'Zone Group',
    'zone_name': 'Zone', 'display_name': '표시 이름', 'email': '이메일', 'max_objects': '최대 오브젝트 수',
    'max_size': '최대 크기(예: 10G)', 'scope': '쿼터 대상', 'state': '사용 상태', 'bucket_name': '버킷 이름',
    'lock_enabled': '오브젝트 잠금', 'backend_service': '연결할 서비스', 'virtual_ip': '가상 IP/CIDR',
    'frontend_port': '서비스 포트', 'monitor_port': '모니터 포트', 'target': '대상 호스트',
    'gwvmCpu': 'CPU(vCore)', 'gwvmMemory': '메모리(GiB)', 'gwvmMngtNicParent': '관리 NIC Bridge',
    'gwvmMngtNicIp': '관리 IP/CIDR', 'gwvmStorageNicParent': '스토리지 NIC Bridge', 'gwvmStorageNicIp': '스토리지 IP/CIDR',
}
MULTIPLE = {'hosts', 'ip_address', 'pool_name', 'image_name'}
OPTIONS = {'access_type': ['RW', 'RO'], 'transports': ['TCP', 'UDP'],
           'squash': ['no_root_squash', 'root_squash', 'all_squash'],
           'acl_enabled': ['false', 'true'], 'lock_enabled': ['false', 'true'],
           'state': ['enable', 'disable'], 'scope': ['user', 'bucket'], 'sec_type': ['normal', 'ads'],
           'cache_policy': ['true', 'false']}


def fields(spec):
    result = []
    for part in spec.split():
        name, _, default = part.partition('=')
        optional = name.startswith('?')
        name = name.lstrip('?')
        result.append({'name': name, 'label': LABELS.get(name, name), 'required': not optional,
                       'type': 'password' if 'password' in name else 'multiple' if name in MULTIPLE else 'text',
                       'options': OPTIONS.get(name), 'default': default})
    return result


def action(name, label, method, path, spec='', query=(), repeated=()):
    return {'id': name, 'label': label, 'method': method, 'path': path, 'fields': fields(spec),
            'query': list(query), 'repeated': list(repeated)}


def service(name, title, path, actions):
    return {'id': name, 'title': title, 'actions': [action('list', '목록 조회', 'GET', path), *actions]}


def catalog():
    return [
        service('hosts', '스토리지 호스트', '/api/v1/glue/hosts', []),
        service('gluefs', 'GlueFS', '/api/v1/gluefs', [
            action('create', '파일시스템 생성', 'POST', '/api/v1/gluefs/{name}', 'name'),
            action('delete', '파일시스템 삭제', 'DELETE', '/api/v1/gluefs/{name}', 'name'),
            action('groups', '서브볼륨 그룹 조회', 'GET', '/api/v1/gluefs/subvolume/group', 'vol_name', ('vol_name',)),
            action('group-create', '서브볼륨 그룹 생성', 'POST', '/api/v1/gluefs/subvolume/group', 'vol_name group_name size data_pool_name mode=777'),
            action('group-resize', '서브볼륨 그룹 크기 변경', 'PUT', '/api/v1/gluefs/subvolume/group', 'vol_name group_name new_size'),
            action('group-delete', '서브볼륨 그룹 삭제', 'DELETE', '/api/v1/gluefs/subvolume/group', 'vol_name path group_name', ('vol_name', 'path', 'group_name')),
        ]),
        service('nfs', 'NFS', '/api/v1/nfs', [
            action('create', 'NFS 서비스 생성', 'POST', '/api/v1/nfs/{cluster_id}/{port}', 'cluster_id port=2049 hosts'),
            action('edit', 'NFS 서비스 변경', 'PUT', '/api/v1/nfs/{cluster_id}/{port}', 'cluster_id port=2049 hosts'),
            action('delete', 'NFS 서비스 삭제', 'DELETE', '/api/v1/nfs/{cluster_id}', 'cluster_id'),
            action('exports', 'Export 목록 조회', 'GET', '/api/v1/nfs/export', '?cluster_id', ('cluster_id',)),
            action('export-create', 'Export 생성', 'POST', '/api/v1/nfs/export/{cluster_id}', 'cluster_id access_type=RW pseudo squash=no_root_squash storage_name transports=TCP'),
            action('export-edit', 'Export 변경', 'PUT', '/api/v1/nfs/export/{cluster_id}', 'cluster_id export_id access_type=RW pseudo squash=no_root_squash storage_name transports=TCP'),
            action('export-delete', 'Export 삭제', 'DELETE', '/api/v1/nfs/export/{cluster_id}/{export_id}', 'cluster_id export_id'),
        ]),
        service('smb', 'SMB', '/api/v1/smb', [
            action('create', 'SMB 서비스 생성', 'POST', '/api/v1/smb', 'hosts folder_name path fs_name volume_path cache_policy=true username password sec_type=normal ?realm ?dns'),
            action('delete', 'SMB 서비스 삭제', 'DELETE', '/api/v1/smb', 'hosts', ('hosts',)),
            action('folder-create', '공유 폴더 생성', 'POST', '/api/v1/smb/folder', 'hosts folder_name path fs_name volume_path cache_policy'),
            action('folder-delete', '공유 폴더 삭제', 'DELETE', '/api/v1/smb/folder', 'hosts folder_name path fs_name', ('hosts', 'folder_name', 'path', 'fs_name')),
            action('user-create', '사용자 추가', 'POST', '/api/v1/smb/user', 'hosts username password'),
            action('user-edit', '사용자 비밀번호 변경', 'PUT', '/api/v1/smb/user', 'hosts username password'),
            action('user-delete', '사용자 삭제', 'DELETE', '/api/v1/smb/user', 'hosts username', ('hosts', 'username')),
        ]),
        service('iscsi', 'iSCSI', '/api/v1/service?service_type=iscsi', [
            action('create', 'iSCSI 서비스 생성·변경', 'POST', '/api/v1/iscsi', 'service_id pool api_port=5000 api_user api_password hosts'),
            action('delete', 'iSCSI 서비스 삭제', 'DELETE', '/api/v1/service/{service_id}', 'service_id'),
            action('targets', '타깃 목록 조회', 'GET', '/api/v1/iscsi/target', '?iqn_id', ('iqn_id',)),
            action('target-create', '타깃 생성', 'POST', '/api/v1/iscsi/target', 'iqn_id acl_enabled=false pool_name image_name hosts ip_address'),
            action('target-edit', '타깃 변경', 'PUT', '/api/v1/iscsi/target', 'iqn_id new_iqn_id acl_enabled=false pool_name image_name hosts ip_address'),
            action('target-delete', '타깃 삭제', 'DELETE', '/api/v1/iscsi/target', 'iqn_id', ('iqn_id',)),
        ]),
        service('images', '공유 디스크 이미지', '/api/v1/image', [
            action('create', '디스크 이미지 생성', 'POST', '/api/v1/image', 'pool_name image_name size'),
            action('pools', '스토리지 풀 조회', 'GET', '/api/v1/pool?pool_type=rbd'),
        ]),
        service('nvmeof', 'NVMe-oF', '/api/v1/service?service_type=nvmeof', [
            action('create', 'NVMe-oF 서비스 생성', 'POST', '/api/v1/nvmeof', 'pool_name hosts'),
            action('delete', 'NVMe-oF 서비스 삭제', 'DELETE', '/api/v1/service/{service_id}', 'service_id'),
            action('targets', '타깃 목록 조회', 'GET', '/api/v1/nvmeof/target'),
            action('target-create', '타깃 생성', 'POST', '/api/v1/nvmeof/target', 'subsystem_nqn_id gateway_ip pool_name image_name ?size'),
            action('target-delete', '서브시스템 삭제', 'DELETE', '/api/v1/nvmeof/subsystem', 'subsystem_nqn_id', ('subsystem_nqn_id',)),
        ]),
        service('rgw', 'Object Gateway', '/api/v1/service?service_type=rgw', [
            action('create', 'Object Gateway 생성', 'POST', '/api/v1/rgw', 'service_name zonegroup_name zone_name port hosts'),
            action('edit', 'Object Gateway 변경', 'PUT', '/api/v1/rgw', 'service_id port hosts'),
            action('delete', 'Object Gateway 삭제', 'DELETE', '/api/v1/service/{service_id}', 'service_id'),
        ]),
        service('rgw-users', '오브젝트 사용자·쿼터', '/api/v1/rgw/user', [
            action('create', '사용자 생성', 'POST', '/api/v1/rgw/user', 'username display_name ?email'),
            action('edit', '사용자 변경', 'PUT', '/api/v1/rgw/user', 'username display_name ?email'),
            action('delete', '사용자 삭제', 'DELETE', '/api/v1/rgw/user', 'username', ('username',)),
            action('quota', '쿼터 설정', 'POST', '/api/v1/rgw/quota', 'username max_objects max_size scope=user state=enable'),
        ]),
        service('rgw-buckets', '오브젝트 버킷', '/api/v1/rgw/bucket?detail=true', [
            action('create', '버킷 생성', 'POST', '/api/v1/rgw/bucket', 'bucket_name username lock_enabled=false'),
            action('edit', '버킷 변경', 'PUT', '/api/v1/rgw/bucket', 'bucket_name username lock_enabled=false'),
            action('delete', '버킷 삭제', 'DELETE', '/api/v1/rgw/bucket', 'bucket_name', ('bucket_name',)),
        ]),
        service('ingress', 'Ingress', '/api/v1/service?service_type=ingress', [
            action('create', 'Ingress 생성·변경', 'POST', '/api/v1/ingress', 'service_id backend_service hosts virtual_ip frontend_port monitor_port'),
            action('delete', 'Ingress 삭제', 'DELETE', '/api/v1/service/{service_id}', 'service_id'),
        ]),
        service('gateway', '게이트웨이 가상머신', '/api/v1/gwvm/detail/cell', [
            action('placement', '가상머신 배치 조회', 'GET', '/api/v1/gwvm/cell'),
            action('deploy', '게이트웨이 가상머신 배포', 'POST', '/api/v1/gwvm/cell',
                   'gwvmCpu=4 gwvmMemory=8 gwvmMngtNicParent gwvmMngtNicIp gwvmStorageNicParent gwvmStorageNicIp'),
            action('start', '가상머신 시작', 'PATCH', '/api/v1/gwvm/start/cell'),
            action('stop', '가상머신 정지', 'PATCH', '/api/v1/gwvm/stop/cell'),
            action('cleanup', '클러스터 클린업', 'PATCH', '/api/v1/gwvm/cleanup/cell'),
            action('move', '가상머신 마이그레이션', 'PATCH', '/api/v1/gwvm/migrate/cell', 'target'),
            action('delete', '가상머신 삭제', 'DELETE', '/api/v1/gwvm/delete/cell'),
        ]),
    ]


def operation(service_id, action_id):
    for group in catalog():
        if group['id'] == service_id:
            for entry in group['actions']:
                if entry['id'] == action_id:
                    return entry
    raise ValueError('지원하지 않는 스토리지 서비스 작업입니다.')
