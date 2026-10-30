#!/usr/bin/env python3
# -*- coding: utf-8 -*-
'''
Copyright (c) 2021 ABLECLOUD Co. Ltd.

SCVM, CCVM의 cloud-init 실행 및 완료 여부 확인하는 스크립트

최초작성일 : 2021-03-15
'''
import os
import argparse
import subprocess
from subprocess import call
from ablestack import *
import sys
sys.path.insert(0, "/usr/libexec/ablestack/node-agent")
from client import Client

from ablestack import *

env = os.environ.copy()
env['LANG'] = "en_US.utf-8"
env['LANGUAGE'] = "en"

# 함수명 : parseArgs
# 주요기능 : 입련된 argument를 파싱하여 dictionary처럼 사용하게 만들어 주는 parser 생성
def parseArgs():

    parser = argparse.ArgumentParser(description='Cloud-Init status check',
                                     epilog='copyrightⓒ 2021 All rights reserved by ABLECLOUD™')
    parser.add_argument('action', choices=['status','ping'], help='choose one of the actions')
    parser.add_argument('--target', metavar='name', type=str, help='Target hostname to cloud-init status')

    return parser.parse_args()


def cloudinitStatus():
    try:
        result = Client().rpc(args.target, 'query', name='cloud-init')
        if result['exit_code'] != 0:
            return createReturn(code=500, val=result['stdout'].splitlines())
        ret_val = result['stdout'].splitlines()
        ret = createReturn(code=200, val=ret_val)
    except Exception as e:
        ret = createReturn(code=500, val=f'{args.target}: cloud-init 상태 조회 실패: {e}')

    return ret

def guestvmPing():
    try:
        Client().rpc(args.target, "health")
        ret = createReturn(code=200, val={"host": args.target, "ping": "OK"})

    except Exception as e:
        ret = createReturn(code=500, val=f'{args.target}: Cube Agent 연결 실패: {e}')

    return ret

if __name__ == '__main__':
    # parser 생성
    args = parseArgs()
    if (args.action) == 'status':
        ret = cloudinitStatus()
        print(ret)
    if (args.action) == 'ping':
        ret = guestvmPing()
        print(ret)
