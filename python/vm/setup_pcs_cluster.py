'''
Copyright (c) 2021 ABLECLOUD Co. Ltd
설명 : 장애조치 클러스터를 구성하고 클라우드센터 가상머신을 배포하는 프로그램
최초 작성일 : 2021. 03. 31
'''

#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import logging
import json
import sys
import os
import time
import subprocess
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'common'))
from deployment_progress import convert_to_rbd, progress, run_step

from ablestack import *
from sh import python3

cluster_json_file_path = pluginpath + "/tools/properties/cluster.json"
def createArgumentParser():
    '''
    입력된 argument를 파싱하여 dictionary 처럼 사용하게 만들어 주는 parser를 생성하는 함수
    :return: argparse.ArgumentParser
    '''
    # 참조: https://docs.python.org/ko/3/library/argparse.html
    # 프로그램 설명
    parser = argparse.ArgumentParser(description='장애조치 클러스터를 구성하고 클라우드센터 가상머신을 배포하는 프로그램',
                                        epilog='copyrightⓒ 2021 All rights reserved by ABLECLOUD™',
                                        usage='%(prog)s arguments')

    # 인자 추가: https://docs.python.org/ko/3/library/argparse.html#the-add-argument-method

    #parser.add_argument('action', choices=['reset'], help='choose one of the actions')

    parser.add_argument('-hns', '--host-names', metavar='IP', type=str, nargs='+', help='input Value to three host names', required=True)

    # output 민감도 추가(v갯수에 따라 output및 log가 많아짐):
    parser.add_argument('-v', '--verbose', action='count', default=0, help='increase output verbosity')

    # flag 추가(샘플임, 테스트용으로 json이 아닌 plain text로 출력하는 플래그 역할)
    parser.add_argument('-H', '--Human', action='store_const', dest='flag_readerble', const=True, help='Human readable')

    # Version 추가
    parser.add_argument('-V', '--Version', action='version', version='%(prog)s 1.0')

    return parser

def openClusterJson():
    try:
        with open(cluster_json_file_path, 'r') as json_file:
            ret = json.load(json_file)
    except Exception as e:
        ret = createReturn(code=500, val='cluster.json read error')


    return ret

cluster_json_data = openClusterJson()
os_type = cluster_json_data["clusterConfig"]["type"]

def ccvmIsRunning(host_names):
    """PCS may start the one CCVM on any candidate, including a different Cube host."""
    for host in host_names:
        try:
            result = subprocess.run([
                '/usr/libexec/ablestack/node-remote', 'exec', '--target', host,
                '--argv-json', json.dumps(['virsh', '-c', 'qemu:///system', 'domstate', 'ccvm']),
                '--options-json', json.dumps({'environ': ['LC_ALL=C']}), '--timeout', '5'
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=8)
            if result.returncode == 0 and result.stdout.strip() == 'running':
                return True
        except (OSError, subprocess.TimeoutExpired):
            continue
    return False


def prepareCcvmDisk():
    """Stop before creating a PCS resource when its RBD disk could not be prepared."""
    try:
        progress('CCVM OS 이미지를 스토리지에 적재합니다. 이미지 적재 후 디스크 크기 설정, 고가용성 리소스 등록, VM 시작을 진행합니다.')
        convert_to_rbd('/var/lib/libvirt/images/ablestack-template-back.qcow2', 'rbd:rbd/ccvm')
        run_step('CCVM RBD 디스크 크기를 500 GiB로 설정합니다.', ['rbd', 'resize', '-s', '500G', 'ccvm'])
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
        return createReturn(code=500, val='CCVM 디스크 이미지 변환 또는 크기 변경 실패: ' + str(error))
    return None


def setupPcsCluster(args):

    success_bool = True
    progress('각 호스트에 클라우드센터 백업 예약을 등록합니다.')

    # psc 구성한 3대의 호스트 crontab에 ccvm 스냅샷 기능 추가
    for host in args.host_names[0].split():
        progress('클라우드센터 백업 예약을 등록합니다: ' + host)
        check_err = 0

        check_err = os.system("/usr/libexec/ablestack/node-remote root@"+host+" \"rm -f /var/spool/cron/tmpfile\"")
        if check_err != 0 :
            return createReturn(code=500, val=host+" : /var/spool/cron/tmpfile delete failed")

        # /var/spool/cron/root 파일이 존재하면 실행 (file_exist 값이 0 이면 존재)
        file_exist = os.system("/usr/libexec/ablestack/node-remote root@"+host+" \"ls /var/spool/cron |grep root > /dev/null\"")
        if file_exist == 0 :
            check_err = os.system("/usr/libexec/ablestack/node-remote root@"+host+" \"awk '!/create_ccvm_snap.py/' /var/spool/cron/root > /var/spool/cron/tmpfile && mv -f /var/spool/cron/tmpfile /var/spool/cron/root\"")
            if check_err != 0 :
                return createReturn(code=500, val=host+" : awk '!/create_ccvm_snap.py/' failed")

        # crontab에 등록
        check_err = os.system("/usr/libexec/ablestack/node-remote root@"+host+" \"echo -e \'0 1 * * * /usr/bin/python3 /usr/share/cockpit/ablestack/python/ccvm_snap/create_ccvm_snap.py\' >> /var/spool/cron/root | chmod 600 /var/spool/cron/root\"")
        if check_err != 0 :
            return createReturn(code=500, val=host+" : cron registration failed")

        # crond 재시작
        check_err = os.system("/usr/libexec/ablestack/node-remote root@"+host+" \"systemctl restart crond.service\"")
        if check_err != 0 :
            return createReturn(code=500, val=host+" : systemctl restart crond.service failed")

    #=========== pcs cluster 구성 ===========
    # ablestack-hci-filesystem 타입인 경우 glue 이미지 초기화 및 cloudcenter_res 리소스 초기화
    if os_type == "ablestack-hci-filesystem":
        result = os.system("rbd ls -p rbd | grep ccvm > /dev/null")
        if result == 0:
            os.system("rbd rm --no-progress rbd/ccvm")
            result = json.loads(python3(pluginpath+'/python/pcs/main.py', 'remove', '--resource', 'cloudcenter_res'))
            if result['code'] not in [200]:
                return createReturn(code=500, val='기존 CCVM 리소스 정리에 실패했습니다. 이미지 변환을 시작하지 않았습니다.')
            else :
                os.system("pcs constraint order start glue-gfs-clone then cloudcenter_res")

    disk_error = prepareCcvmDisk()
    if disk_error is not None:
        return disk_error

    host_names = args.host_names[0].split()
    # 클러스터 구성
    if os_type == "ablestack-hci":
        progress('클라우드센터 고가용성 클러스터를 설정합니다.')
        result = json.loads(python3(pluginpath + '/python/pcs/main.py', 'config', '--cluster', 'cloudcenter_cluster', '--hosts', host_names[0], host_names[1], host_names[2] ))
        if result['code'] not in [200]:
            return createReturn(code=500, val='클라우드센터 고가용성 클러스터 설정에 실패했습니다.')

    # 리소스 생성
    progress('클라우드센터 가상머신을 고가용성 리소스에 등록합니다. 다음으로 VM의 실행 상태를 확인합니다.')
    result = json.loads(python3(pluginpath+'/python/pcs/main.py', 'create', '--resource', 'cloudcenter_res', '--xml', pluginpath+'/tools/vmconfig/ccvm/ccvm.xml' ))
    if result['code'] not in [200]:
        return createReturn(code=500, val='CCVM 고가용성 리소스 등록에 실패했습니다. VM 시작 대기는 실행하지 않았습니다.')
    else :
        os.system("pcs constraint order start glue-gfs-clone then cloudcenter_res")

    #ccvm이 정상적으로 생성 되었는지 확인
    domid_check = 0
    cnt_num = 0
    wait_started = time.monotonic()
    last_notice = wait_started
    progress('클라우드센터 VM이 시작되기를 기다립니다. 시작 후 초기 설정 확인과 라이선스 등록을 진행합니다.')
    while True:
        time.sleep(5)
        cnt_num += 1
        domid_check = 0 if ccvmIsRunning(host_names) else 1
        if domid_check == 0 or cnt_num > 300:
            break
        current = time.monotonic()
        if current - last_notice >= 30:
            progress('클라우드센터 VM 시작 대기 중 · 경과 ' + str(int(current - wait_started)) + '초. 각 후보 호스트의 실행 상태를 확인하고 있습니다.')
            last_notice = current

    if domid_check != 0:
        success_bool = False

    # 결과값 리턴
    if success_bool:
        progress('클라우드센터 이미지 적재와 VM 시작이 완료되었습니다.')
        return createReturn(code=200, val="cloud center setup success")
    else:
        return createReturn(code=500, val="cloud center setup fail")

# Press the green button in the gutter to run the script.
if __name__ == '__main__':
    # parser 생성
    parser = createArgumentParser()
    # input 파싱
    args = parser.parse_args()

    verbose = (5 - args.verbose) * 10

    # 로깅을 위한 logger 생성, 모든 인자에 default 인자가 있음.
    logger = createLogger(verbosity=logging.CRITICAL, file_log_level=logging.ERROR, log_file='test.log')

    # 실제 로직 부분 호출 및 결과 출력
    ret = setupPcsCluster(args)
    print(ret)
