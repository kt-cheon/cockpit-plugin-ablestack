'''
Copyright (c) 2021 ABLECLOUD Co. Ltd
설명 : 장애조치 클러스터 및 클라우드센터 가상머신 배포를 초기화하는 프로그램
최초 작성일 : 2021. 03. 31
'''

#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import logging
import json
import sys
import os

from ablestack import *
from sh import python3
from sh import ssh

def createArgumentParser():
    '''
    입력된 argument를 파싱하여 dictionary 처럼 사용하게 만들어 주는 parser를 생성하는 함수
    :return: argparse.ArgumentParser
    '''
    # 참조: https://docs.python.org/ko/3/library/argparse.html
    # 프로그램 설명
    parser = argparse.ArgumentParser(description='장애조치 클러스터 및 클라우드센터 가상머신 배포를 초기화하는 프로그램',
                                        epilog='copyrightⓒ 2021 All rights reserved by ABLECLOUD™',
                                        usage='%(prog)s arguments')

    # 인자 추가: https://docs.python.org/ko/3/library/argparse.html#the-add-argument-method

    #parser.add_argument('action', choices=['reset'], help='choose one of the actions')
    parser.add_argument('-d', '--disk', metavar='[Disk Path]', type=str, help='input Value to GFS Disk Path')
    # output 민감도 추가(v갯수에 따라 output및 log가 많아짐):
    parser.add_argument('-v', '--verbose', action='count', default=0, help='increase output verbosity')

    # flag 추가(샘플임, 테스트용으로 json이 아닌 plain text로 출력하는 플래그 역할)
    parser.add_argument('-H', '--Human', action='store_const', dest='flag_readerble', const=True, help='Human readable')

    # Version 추가
    parser.add_argument('-V', '--Version', action='version', version='%(prog)s 1.0')

    return parser

json_file_path = pluginpath+"/tools/properties/cluster.json"

def openClusterJson():
    try:
        with open(json_file_path, 'r') as json_file:
            ret = json.load(json_file)
    except Exception as e:
        ret = createReturn(code=500, val='cluster.json read error')
        print ('EXCEPTION : ',e)

    return ret

json_data = openClusterJson()
os_type = json_data["clusterConfig"]["type"]

def resetCloudCenter(args):

    success_bool = True

    if os_type == "ABLESTACK-HCI":
        #=========== pcs cluster 초기화 ===========
        # 리소스 삭제
        result = json.loads(python3(pluginpath + '/python/pcs/main.py', 'remove', '--resource', 'cloudcenter_res'))
        if result['code'] not in [200,400]:
            success_bool = False

        # 클러스터 삭제
        result = json.loads(python3(pluginpath + '/python/pcs/main.py', 'destroy'))
        if result['code'] not in [200,400]:
            success_bool = False

        # ceph rbd 이미지 삭제
        result = os.system("rbd ls -p rbd | grep ccvm > /dev/null")
        if result == 0:
            os.system("rbd rm --no-progress rbd/ccvm")

        # virsh 초기화
        os.system("virsh destroy ccvm > /dev/null")
        os.system("virsh undefine ccvm --keep-nvram> /dev/null")

        # 작업폴더 생성
        os.system("mkdir -p "+pluginpath+"/tools/vmconfig/ccvm")

        # cloudinit iso 삭제
        os.system("rm -f /var/lib/libvirt/images/ccvm-cloudinit.iso")

        # 확인후 폴더 밑 내용 다 삭제해도 무관하면 아래 코드 수행
        os.system("rm -rf "+pluginpath+"/tools/vmconfig/ccvm/*")

        # 결과값 리턴
        if success_bool:
            return createReturn(code=200, val="cloud center reset success")
        else:
            return createReturn(code=500, val="cloud center reset fail")

    elif os_type == "PowerFlex":
        pcs_list = []

        for i in range(len(json_data["clusterConfig"]["pcsCluster"])):
            if json_data["clusterConfig"]["pcsCluster"]["hostname"+str(i+1)]:
                pcs_list.append(json_data["clusterConfig"]["pcsCluster"]["hostname"+str(i+1)])

        pcs_list_str = " ".join(pcs_list)
        # GFS용 초기화
        vg_name_check = os.popen("pvs --noheadings -o vg_name | grep 'vg_glue'").read().strip().splitlines()
        if vg_name_check:
            disk = os.popen("pvs --noheadings -o pv_name,vg_name | grep 'vg_glue' | awk '{print $1}' | sed 's/[0-9]*$//'").read()
            result = json.loads(python3(pluginpath + '/python/pcs/gfs-manage.py', '--init-pcs-cluster','--disks', disk ,'--vg-name', 'vg_glue', '--lv-name', 'lv_glue', '--list-ip', pcs_list_str))
            if result['code'] not in [200,400]:
                success_bool = False
        else:
            result = json.loads(python3(pluginpath + '/python/pcs/gfs-manage.py', '--init-pcs-cluster', '--list-ip', pcs_list_str))
            if result['code'] not in [200,400]:
                success_bool = False
        # virsh 초기화
        os.system("virsh destroy ccvm > /dev/null 2>&1")
        os.system("virsh undefine ccvm --keep-nvram> /dev/null 2>&1")

        # 작업폴더 생성
        os.system("mkdir -p "+pluginpath+"/tools/vmconfig/ccvm")

        # cloudinit iso 삭제
        os.system("rm -f /var/lib/libvirt/images/ccvm-cloudinit.iso")

        # 확인후 폴더 밑 내용 다 삭제해도 무관하면 아래 코드 수행
        os.system("rm -rf "+pluginpath+"/tools/vmconfig/ccvm/*")
        # 결과값 리턴
        if success_bool:
            return createReturn(code=200, val="cloud center reset success")
        else:
            return createReturn(code=500, val="cloud center reset fail")
    elif os_type == "general-virtualization":
        pcs_list = []

        for i in range(len(json_data["clusterConfig"]["pcsCluster"])):
            if json_data["clusterConfig"]["pcsCluster"]["hostname"+str(i+1)]:
                pcs_list.append(json_data["clusterConfig"]["pcsCluster"]["hostname"+str(i+1)])
        # GFS용 초기화
        pcs_list_str = " ".join(pcs_list)
        vg_name_check = os.popen("pvs --noheadings -o vg_name 2>/dev/null | grep 'vg_glue' | uniq").read().strip().splitlines()
        if vg_name_check:
            disk_list = os.popen("pvs --noheadings -o pv_name,vg_name 2>/dev/null | grep 'vg_glue' | awk '{print $1}' | sed 's/[0-9]*$//'").read().strip().split("\n")
            disk = ",".join(disk_list)
            result = json.loads(python3(pluginpath + '/python/pcs/gfs-manage.py', '--init-pcs-cluster','--disks', disk ,'--vg-name', 'vg_glue', '--lv-name', 'lv_glue', '--list-ip', pcs_list_str))
            if result['code'] not in [200,400]:
                success_bool = False
        else:
            result = json.loads(python3(pluginpath + '/python/pcs/gfs-manage.py', '--init-pcs-cluster', '--list-ip', pcs_list_str))
            if result['code'] not in [200,400]:
                success_bool = False

        # virsh 초기화
        os.system("virsh destroy ccvm > /dev/null 2>&1")
        os.system("virsh undefine ccvm --keep-nvram> /dev/null 2>&1")

        # 작업폴더 생성
        os.system("mkdir -p "+pluginpath+"/tools/vmconfig/ccvm")

        # cloudinit iso 삭제
        os.system("rm -f /var/lib/libvirt/images/ccvm-cloudinit.iso")

        # 확인후 폴더 밑 내용 다 삭제해도 무관하면 아래 코드 수행
        os.system("rm -rf "+pluginpath+"/tools/vmconfig/ccvm/*")
        # 결과값 리턴
        if success_bool:
            for i in range(len(json_data["clusterConfig"]["hosts"])):
                ablecube = json_data["clusterConfig"]["hosts"][i]["ablecube"]
                ssh('-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=5',ablecube,'python3', pluginpath + '/python/ablestack_json/ablestackJson.py', 'update','--depth1', 'bootstrap', '--depth2', 'ccvm', '--value', 'false')
                ssh('-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=5',ablecube,'python3', pluginpath + '/python/ablestack_json/ablestackJson.py', 'update','--depth1', 'monitoring', '--depth2', 'wall', '--value', 'false')
            return createReturn(code=200, val="cloud center reset success")
        else:
            return createReturn(code=500, val="cloud center reset fail")
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
    ret = resetCloudCenter(args)
    print(ret)
