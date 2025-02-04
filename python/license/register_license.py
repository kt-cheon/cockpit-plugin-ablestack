#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import sys
import os
import shutil
from datetime import datetime

def process_license_file(license_type=None, product_id=None, license_key=None, 
                        license_file=None, status=None, start_date=None, end_date=None):
    """라이센스 파일 처리"""
    try:
        if license_file is None:
            # 인자가 없을 경우 라이센스 상태만 반환
            return {'code': '200', 'val': []}

        # 입력 파일 존재 여부 확인
        if not os.path.exists(license_file):
            return {'code': '404', 'val': f'라이센스 파일을 찾을 수 없습니다: {license_file}'}

        # 라이센스 정보 구성
        license_info = {
            'type': license_type,
            'product_id': product_id,
            'license_key': license_key,
            'status': status or 'active',
            'start_date': start_date,
            'end_date': end_date,
            'file_path': license_file
        }

        # 라이센스 정보 저장
        license_db_path = "/root/license_db.json"
        licenses = []
        if os.path.exists(license_db_path):
            with open(license_db_path, 'r') as f:
                try:
                    licenses = json.load(f)
                except json.JSONDecodeError:
                    licenses = []

        licenses.append(license_info)
        
        with open(license_db_path, 'w') as f:
            json.dump(licenses, f, indent=4)

        # 파일 권한 설정
        os.chmod(license_db_path, 0o600)
        os.chmod(license_file, 0o600)

        return {'code': '200', 'val': '라이센스가 성공적으로 등록되었습니다.'}

    except Exception as e:
        return {'code': '500', 'val': f'라이센스 등록 중 오류가 발생했습니다: {str(e)}'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='ABLESTACK 라이센스 등록')
    parser.add_argument('--type', help='라이센스 타입')
    parser.add_argument('--product-id', help='제품 ID')
    parser.add_argument('--license-key', help='라이센스 키')
    parser.add_argument('--license-file', help='라이센스 파일 경로')
    parser.add_argument('--status', help='라이센스 상태', default='active')
    parser.add_argument('--start-date', help='시작일')
    parser.add_argument('--end-date', help='만료일')
    
    args = parser.parse_args()
    result = process_license_file(
        license_type=args.type,
        product_id=args.product_id,
        license_key=args.license_key,
        license_file=args.license_file,
        status=args.status,
        start_date=args.start_date,
        end_date=args.end_date
    )
    print(json.dumps(result))
    sys.exit(0)