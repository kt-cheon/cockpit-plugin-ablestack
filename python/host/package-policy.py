#!/usr/bin/env python3
"""Validate an ISO's explicit host/scvm/ccvm package lists using RPM headers."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

ROLES = ('host', 'scvm', 'ccvm')
HOST_PACKAGES = ('cloudstack-common', 'cloudstack-agent')
CCVM_PACKAGES = ('cloudstack-common', 'cloudstack-management', 'cloudstack-usage', 'cloudstack-ui')
NAME = re.compile(r'^[A-Za-z0-9_+.-]+$')


class PolicyError(ValueError):
    pass


def load_config(path):
    try:
        config = json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        raise PolicyError('packages.json을 읽을 수 없거나 JSON 형식이 잘못되었습니다.') from None
    if (not isinstance(config, dict) or set(config) - set(ROLES) - {'schema_version'}
            or config.get('schema_version', 1) != 1 or any(role not in config for role in ROLES)):
        raise PolicyError('packages.json에는 host, scvm, ccvm 배열과 schema_version: 1만 사용할 수 있습니다.')
    for role in ROLES:
        values = config[role]
        if (not isinstance(values, list) or any(not isinstance(value, str) or not NAME.fullmatch(value) for value in values)):
            raise PolicyError('{} 목록에는 정확한 패키지 이름 또는 이름.아키텍처 문자열을 넣으세요.'.format(role))
        if len(values) != len(set(values)):
            raise PolicyError('{} 패키지 목록에 중복이 있습니다.'.format(role))
    return config


def inventory(directory, rpm_command):
    records = []
    for path in sorted(Path(directory).rglob('*.rpm')):
        if not path.is_file() or path.is_symlink():
            continue
        result = subprocess.run([rpm_command, '-qp', '--qf', '%{NAME}|%{ARCH}', '--', str(path)],
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        fields = result.stdout.strip().split('|')
        if result.returncode or len(fields) != 2 or any(not NAME.fullmatch(value) for value in fields):
            raise PolicyError('RPM 헤더 조회 실패: ' + path.name)
        records.append(dict(name=fields[0], arch=fields[1], path=str(path.resolve())))
    if not records:
        raise PolicyError('rpms/에 RPM이 없습니다.')
    return records


def resolve(config, records):
    names, qualified, keys = {}, {}, set()
    for row in records:
        key = (row['name'], row['arch'])
        if key in keys or row['arch'] in ('src', 'nosrc'):
            raise PolicyError('소스 RPM 또는 중복 패키지/아키텍처: ' + '.'.join(key))
        keys.add(key)
        names.setdefault(row['name'], []).append(row)
        qualified[row['name'] + '.' + row['arch']] = row
    plan = {}
    for role in ROLES:
        selected, seen = [], set()
        for spec in config[role]:
            matches = names.get(spec)
            if matches is None:
                matches = [qualified[spec]] if spec in qualified else []
            if not matches:
                raise PolicyError('{}에 선언한 {} RPM이 rpms/에 없습니다.'.format(role, spec))
            if len(matches) != 1:
                raise PolicyError('{}은 여러 아키텍처가 있습니다. 이름.아키텍처로 지정하세요.'.format(spec))
            row = matches[0]
            allowed = HOST_PACKAGES if role == 'host' else CCVM_PACKAGES if role == 'ccvm' else ()
            if row['name'].startswith('cloudstack') and row['name'] not in allowed:
                raise PolicyError('{}에는 {} 패키지를 설치할 수 없습니다.'.format(role, row['name']))
            key = (row['name'], row['arch'])
            if key in seen:
                raise PolicyError('{}에 동일 RPM이 중복 지정되었습니다: {}'.format(role, spec))
            seen.add(key)
            selected.append(row)
        plan[role] = selected
    return plan


def scoped(plan, role, scope):
    return [row for row in plan[role] if scope == 'all'
            or (scope == 'mold') == row['name'].startswith('cloudstack')]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--rpm-dir', required=True)
    parser.add_argument('--rpm-command', choices=('rpm', 'aspkg'), required=True)
    parser.add_argument('--role', choices=ROLES)
    parser.add_argument('--scope', choices=('all', 'mold', 'packages'), default='all')
    parser.add_argument('--output', choices=('json', 'null'), default='json')
    parser.add_argument('--require-targets', action='store_true')
    args = parser.parse_args()
    try:
        plan = resolve(load_config(args.config), inventory(args.rpm_dir, args.rpm_command))
        if args.require_targets and not any(plan.values()):
            raise PolicyError('packages.json에 최소 한 역할의 대상 패키지를 지정하세요.')
        result = scoped(plan, args.role, args.scope) if args.role else plan
        if args.output == 'null':
            if not args.role:
                raise PolicyError('null 출력에는 --role이 필요합니다.')
            for row in result:
                sys.stdout.buffer.write(row['path'].encode('utf-8') + b'\0')
        else:
            print(json.dumps(result, ensure_ascii=False))
        return 0
    except (PolicyError, OSError) as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
