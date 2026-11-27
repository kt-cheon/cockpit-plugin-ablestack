"""Read local version fields independently; optional RPM metadata must not hide the OS."""
from pathlib import Path
import re
import shlex
import subprocess

OS_RELEASE_PATHS = (Path('/etc/os-release'), Path('/usr/lib/os-release'))


def os_version():
    for path in OS_RELEASE_PATHS:
        try:
            contents = path.read_text(encoding='utf-8')
        except FileNotFoundError:
            continue
        values = {}
        for line in contents.splitlines():
            key, separator, value = line.strip().partition('=')
            if not separator or key != 'PRETTY_NAME':
                continue
            try:
                fields = shlex.split(value, comments=True)
            except ValueError:
                continue
            if len(fields) == 1:
                values[key] = fields[0].strip()
        if values.get('PRETTY_NAME'):
            return values['PRETTY_NAME']
        raise ValueError(str(path) + '에서 PRETTY_NAME 값을 찾지 못했습니다.')
    raise FileNotFoundError('/etc/os-release 및 /usr/lib/os-release 파일을 찾지 못했습니다.')


def mold_version(adapter):
    package = adapter.command(
        ['aspkg', '-q', '--qf', '%{VERSION}\t%{RELEASE}\n', '--', 'cloudstack-common'],
        timeout=5, record=False,
    ).strip()
    version, separator, release = package.partition('\t')
    if not separator or not version or not release or '\n' in package:
        raise ValueError('cloudstack-common 패키지에서 Mold 버전을 읽지 못했습니다.')
    # Keep the build timestamp and omit the RPM rebuild number.
    release = re.sub(r'(?<=\d{12})\.\d+$', '', release)
    return f'{version}-{release}'


def version_info(adapter):
    response = {'code': 200, 'errors': {}}
    readers = {
        'os_version': os_version,
        'kernel_version': lambda: adapter.command(['uname', '-r'], timeout=5, record=False).strip(),
        'cockpit_version': lambda: adapter.command(['rpm', '-q', 'ablecube'], timeout=5, record=False).strip(),
        'mold_version': lambda: mold_version(adapter),
    }
    for field, read in readers.items():
        try:
            response[field] = read()
            if not response[field]:
                raise ValueError('버전 정보가 비어 있습니다.')
        except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
            response[field] = ''
            response['errors'][field] = str(error)
    return response
