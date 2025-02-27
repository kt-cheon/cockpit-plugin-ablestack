#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import sys
import os
import shutil
from datetime import datetime

def get_license_status():
    """현재 등록된 라이센스 상태 확인"""
    try:
        # /root 디렉토리에서 라이센스 파일 찾기
        license_file = None
        for file in os.listdir("/root"):
            if file.startswith("license_") and file.endswith(".lic"):
                license_file = os.path.join("/root", file)
                break

        if not license_file:
            return {'code': '404', 'val': '등록된 라이센스가 없습니다.'}

        return {
            'code': '200',
            'val': {
                'status': '라이센스 파일이 등록되어 있습니다. 다시 등록하면 새 라이센스로 교체됩니다.',
                'fileName': os.path.basename(license_file)
            }
        }
    except Exception as e:
        return {'code': '500', 'val': f'라이센스 상태 확인 중 오류가 발생했습니다: {str(e)}'}

def validate_license_file(file_path):
    """라이센스 파일 유효성 검사"""
    try:
        if not os.path.exists(file_path) or os.path.getsize(file_path) == 0:
            return False
        if not file_path.lower().endswith(('.dat','.lic')):  # .lic 확장자 허용
            return False
        return True
    except:
        return False

def process_license_file(license_file=None):
    """라이센스 파일 처리"""
    try:
        if license_file is None:
            # 라이센스 파일이 지정되지 않은 경우 현재 상태 반환
            return get_license_status()

        # 입력 파일 존재 여부 확인
        if not os.path.exists(license_file):
            return {'code': '404', 'val': f'라이센스 파일을 찾을 수 없습니다: {license_file}'}

        # 라이센스 파일 유효성 검사
        if not validate_license_file(license_file):
            return {'code': '400', 'val': '유효하지 않은 라이센스 파일입니다. .lic 확장자의 파일만 등록 가능합니다.'}

        # 기존 라이센스 파일 확인
        existing_license = False
        for file in os.listdir("/root"):
            if file.startswith("license_") and file.endswith(".lic"):
                existing_license = True
                break

        # 타임스탬프를 이용한 새 파일명 생성
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        new_filename = f"license_{timestamp}.lic"
        new_filepath = os.path.join("/root", new_filename)

        # 기존 라이센스 파일이 있다면 삭제
        for file in os.listdir("/root"):
            if file.startswith("license_") and file.endswith(".lic"):
                try:
                    os.remove(os.path.join("/root", file))
                except:
                    pass

        # 새 파일 복사
        shutil.copy2(license_file, new_filepath)

        # 파일 권한 설정 (600)
        os.chmod(new_filepath, 0o600)

        # 임시 파일 삭제
        try:
            if os.path.exists(license_file):
                os.remove(license_file)
        except:
            pass

        # 라이센스 파일이 정상적으로 복사되었는지 확인
        if not os.path.exists(new_filepath):
            return {'code': '500', 'val': '라이센스 파일 복사 실패'}

        # 복사된 파일 크기 확인
        if os.path.getsize(new_filepath) == 0:
            os.remove(new_filepath)
            return {'code': '500', 'val': '라이센스 파일이 비어있습니다.'}

        # 등록 성공 메시지 반환
        message = "라이센스가 성공적으로 등록되었습니다."
        if existing_license:
            message = "기존 라이센스가 새로운 라이센스로 교체되었습니다."

        return {'code': '200', 'val': message}

    except Exception as e:
        return {'code': '500', 'val': f'라이센스 등록 중 오류가 발생했습니다: {str(e)}'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='ABLESTACK 라이센스 등록')
    parser.add_argument('--license-file', help='라이센스 파일 경로', required=False)
    parser.add_argument('--status', help='라이센스 상태 확인', action='store_true')

    args = parser.parse_args()

    if args.status:
        result = get_license_status()
    else:
        result = process_license_file(args.license_file)

    print(json.dumps(result))
    sys.exit(0)