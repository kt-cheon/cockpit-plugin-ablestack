"""Public progress descriptions; command arguments and tool output stay in the private log."""
import os
from pathlib import Path

PREFIX = '[ABLESTACK-PROGRESS] '

TOOL_LABELS = {
    'cluster/cluster_config.py': '클러스터 프로파일 및 호스트 정보 적용',
    'ablestack_json/ablestackJson.py': '구성 상태 파일 갱신',
    'vm/host_ping_test.py': '호스트 및 가상머신 통신 상태 확인',
    'vm/reset_storage_center.py': '스토리지센터 가상머신 배포 환경 초기화',
    'vm/reset_cloud_center.py': '클라우드센터 가상머신 배포 환경 초기화',
    'vm/create_scvm_cloudinit.py': '스토리지센터 가상머신 초기 설정 파일 생성',
    'vm/create_ccvm_cloudinit.py': '클라우드센터 가상머신 초기 설정 파일 생성',
    'vm/create_scvm_xml.py': '스토리지센터 가상머신 장치 및 네트워크 구성',
    'vm/create_ccvm_xml.py': '클라우드센터 가상머신 장치 및 네트워크 구성',
    'vm/setup_storage_vm.py': '스토리지센터 가상머신 이미지 준비 및 시작',
    'vm/setup_pcs_cluster.py': '클라우드센터 고가용성 클러스터 구성',
    'vm/local_ccvm_manage.py': '로컬 클라우드센터 가상머신 구성',
    'local/local_manage.py': '로컬 스토리지 구성',
    'rbd/rbd_manage.py': 'Glue 공유 디스크 구성 및 호스트 연결',
    'license/register_license.py': '라이선스 등록 상태 확인',
    'security_patch/security_patch.py': '보안 설정 점검 및 적용',
    'glue/update_glue_config.py': 'Glue 스토리지 설정 갱신',
}

STORAGE_LABELS = {
    '--init-pcs-cluster': '공유 스토리지용 고가용성 클러스터 초기화',
    '--configure-stonith': '호스트 장애 격리 장치 구성',
    '--check-ipmi': '호스트 전원 관리 장치 연결 확인',
    '--create-gfs': '공유 파일시스템 생성 및 마운트 구성',
    '--create-ccvm-cluster': '클라우드센터 공유 스토리지 리소스 구성',
    '--set-alert': '클러스터 상태 알림 설정',
    '--check-host': '공유 스토리지 호스트 상태 확인',
    '--check-stonith': '호스트 장애 격리 상태 확인 및 조정',
    '--extend-pcs-cluster': '공유 스토리지 클러스터에 호스트 추가',
    '--create-clvm': '공유 스토리지 볼륨 생성',
    '--delete-clvm': '공유 스토리지 볼륨 삭제',
    '--delete-gfs': '공유 파일시스템 삭제',
    '--extend': '공유 스토리지 볼륨 확장',
    '--add-extend': '공유 디스크 추가 및 볼륨 확장',
    '--scan': '공유 스토리지 디스크 검색',
    '--rescan': '공유 스토리지 디스크 재검색',
    '--remove-host': '공유 스토리지 클러스터에서 호스트 제거',
}


def tool_label(name, args):
    if name in ('gfs/gfs_manage.py', 'clvm/disk_manage.py'):
        return STORAGE_LABELS.get(next(iter(args), ''))
    if name == 'license/register_license.py' and '--license-content' in args:
        return '가상머신 라이선스 등록'
    if name == 'rbd/rbd_manage.py' and '--delete-rbd-image' in args:
        return 'Glue 공유 디스크 삭제 및 호스트 연결 해제'
    if name == 'local/local_manage.py':
        if '--reset' in args:
            return '로컬 스토리지 초기화'
        if '--local-disk-status' in args:
            return '로컬 스토리지 상태 확인'
    return TOOL_LABELS.get(name)


def write_progress(path, message):
    # Synchronous bridge calls must print only their JSON response.
    if not isinstance(path, (str, os.PathLike)):
        return
    line = PREFIX + ' '.join(str(message).splitlines()) + '\n'
    descriptor = os.open(Path(path), os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'ab') as output:
        output.write(line.encode('utf-8'))


def emit(adapter, message):
    write_progress(getattr(adapter, 'TASK_LOG', None), message)


def run(adapter, label, operation):
    emit(adapter, label + ' 작업을 시작합니다.')
    try:
        result = operation()
    except Exception:
        emit(adapter, label + ' 작업에 실패했습니다. 마지막 안내와 상세 실행 로그를 확인해 주세요.')
        raise
    emit(adapter, label + ' 작업이 완료되었습니다.')
    return result
