'''
Copyright (c) 2021 ABLECLOUD Co. Ltd
설명 : 클러스터 설정 파일 cluster.json을 편집하는 프로그램
최초 작성일 : 2022. 08. 25
'''

#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import logging
import sys
import os
import json

from ablestack import *
from sh import python3

json_file_path = pluginpath+"/tools/properties/cluster.json"
def createArgumentParser():
    '''
    입력된 argument를 파싱하여 dictionary 처럼 사용하게 만들어 주는 parser를 생성하는 함수
    :return: argparse.ArgumentParser
    '''
    # 참조: https://docs.python.org/ko/3/library/argparse.html
    # 프로그램 설명
    parser = argparse.ArgumentParser(description='클러스터 설정 파일 cluster.json을 편집하는 프로그램',
                                        epilog='copyrightⓒ 2021 All rights reserved by ABLECLOUD™',
                                        usage='%(prog)s arguments')

    # 인자 추가: https://docs.python.org/ko/3/library/argparse.html#the-add-argument-method
    parser.add_argument('action', choices=['insert'], help='choose one of the actions')
    parser.add_argument('-js', '--json-string', metavar='[json string text]', type=str, help='input Value to json string text', required=True)

    # output 민감도 추가(v갯수에 따라 output및 log가 많아짐):
    parser.add_argument('-v', '--verbose', action='count', default=0, help='increase output verbosity')
    
    # flag 추가(샘플임, 테스트용으로 json이 아닌 plain text로 출력하는 플래그 역할)
    parser.add_argument('-H', '--Human', action='store_const', dest='flag_readerble', const=True, help='Human readable')
    
    # Version 추가
    parser.add_argument('-V', '--Version', action='version', version='%(prog)s 1.0')

    return parser

def openClusterJson():
    try:
        with open(json_file_path, 'r') as json_file:
            ret = json.load(json_file)
    except Exception as e:
        ret = createReturn(code=500, val='cluster.json read error')
        print ('EXCEPTION : ',e)

    return ret

# 파라미터로 받은 json 값으로 cluster_config.py 무조건 바꾸는 함수 (동일한 값이 있으면 변경, 없으면 추가)
def insert(args):
    try:
        
        # 파라미터로 받아온 json으로 변환
        param_json = json.loads(args.json_string)

        # 수정할 cluster.json 파일 읽어오기
        json_data = openClusterJson()

        # 기존 file json 데이터를 param json 데이터로 교체
        for p_val in param_json:
            not_matching = True
            for f_val in json_data["clusterConfig"]["hosts"]:
                if f_val["hostname"] == p_val["hostname"]:
                    f_val["index"] = p_val["index"]
                    f_val["hostname"] = p_val["hostname"]
                    f_val["ablecube"] = p_val["ablecube"]
                    f_val["scvmMngt"] = p_val["scvmMngt"]
                    f_val["ablecubePn"] = p_val["ablecubePn"]
                    f_val["scvm"] = p_val["scvm"]
                    f_val["scvmCn"] = p_val["scvmCn"]
                    not_matching = False
            
            # 한번도 매칭되지 않은 param_json을 file json데이터에 appen
            if not_matching:
                json_data["clusterConfig"]["hosts"].append({
                    "index": p_val["index"],
                    "hostname": p_val["hostname"],
                    "ablecube": p_val["ablecube"],
                    "scvmMngt": p_val["scvmMngt"],
                    "ablecubePn": p_val["ablecubePn"],
                    "scvm": p_val["scvm"],
                    "scvmCn": p_val["scvmCn"]
                })

        result = json.loads(python3(pluginpath + '/python/cluster/cluster_hosts_setting.py', 'host_only').stdout.decode())

        # json 변환 정보 cluster.json 파일 수정
        with open(json_file_path, "w") as cluster_json:
            cluster_json.write(json.dumps(json_data, indent=4))
        
        return createReturn(code=200, val=args.json_string)
    except Exception as e:
        # 결과값 리턴
        print(e)
        return createReturn(code=500, val="Please check the \"cluster.json\" file.")


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
    if args.action == 'insert':
        ret = insert(args)
        print(ret)