'''
Copyright (c) 2021 ABLECLOUD Co. Ltd
설명 : 스토리지센터 가상머신을 배포하는 프로그램
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

def createArgumentParser():
    '''
    입력된 argument를 파싱하여 dictionary 처럼 사용하게 만들어 주는 parser를 생성하는 함수
    :return: argparse.ArgumentParser
    '''
    # 참조: https://docs.python.org/ko/3/library/argparse.html
    # 프로그램 설명
    parser = argparse.ArgumentParser(description='스토리지센터 가상머신을 배포하는 프로그램',
                                        epilog='copyrightⓒ 2021 All rights reserved by ABLECLOUD™',
                                        usage='%(prog)s arguments')

    # 인자 추가: https://docs.python.org/ko/3/library/argparse.html#the-add-argument-method

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

def setupStorageVm(args):

    success_bool = True

    # 스토리지 가상머신용 qcow2 이미지 생성
    if os_type == "PowerFlex":
        check_err = os.system("/usr/bin/cp -f /var/lib/libvirt/images/powerflex-scvm-template.qcow2 /var/lib/libvirt/images/scvm.qcow2")
        if check_err != 0 :
            success_bool = False
    else:
        check_err = os.system("/usr/bin/cp -f /var/lib/libvirt/images/ablestack-template-back.qcow2 /var/lib/libvirt/images/scvm.qcow2")
        if check_err != 0 :
            success_bool = False
    # scvm.qcow2 파일 권한 설정
    check_err = os.system("chmod 666 /var/lib/libvirt/images/scvm.qcow2")
    if check_err != 0 :
        success_bool = False

    # vmconfig/scvm 설정 파일 백업
    check_err = os.system("/usr/bin/cp -rf /usr/share/cockpit/ablestack/tools/vmconfig/ /usr/share/ablestack/")
    if check_err != 0 :
        success_bool = False

    # virsh 초기화
    check_err = os.system("virsh define "+pluginpath+"/tools/vmconfig/scvm/scvm.xml > /dev/null")
    if check_err != 0 :
        success_bool = False

    check_err = os.system("virsh start scvm > /dev/null")
    if check_err != 0 :
        success_bool = False

    check_err = os.system("virsh autostart scvm > /dev/null")
    if check_err != 0 :
        success_bool = False

    # 결과값 리턴
    if success_bool:
        return createReturn(code=200, val="storage center setup success")
    else:
        return createReturn(code=500, val="storage center setup fail")

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
    ret = setupStorageVm(args)
    print(ret)
