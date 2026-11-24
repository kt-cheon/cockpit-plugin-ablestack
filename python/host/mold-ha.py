#!/usr/bin/env python3
"""Mold authentication and HA gate for update-all.sh (Python standard library)."""
import argparse
import base64
from contextlib import contextmanager
import fcntl
import getpass
import hashlib
import hmac
import http.cookiejar
import json
import os
from pathlib import Path
import signal
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import warnings


class Failure(Exception):
    pass


def log(message):
    print(time.strftime('[%Y-%m-%d %H:%M:%S] [HA] ') + message, flush=True)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Api:
    def __init__(self, config):
        self.config = dict(config)
        self.endpoint = config['api_url']
        url = urllib.parse.urlsplit(self.endpoint)
        if (url.scheme not in ('http', 'https') or not url.netloc or url.query or url.fragment
                or url.username or url.password):
            raise Failure('API 주소는 인증정보/쿼리 없는 HTTP(S) 주소여야 합니다.')
        algorithm = config.get('signature_algorithm', 'sha256')
        if algorithm not in ('sha256', 'sha1'):
            raise Failure('지원하지 않는 API 서명 알고리즘입니다.')
        self.digest = getattr(hashlib, algorithm)
        self.context = ssl.create_default_context(cafile=config.get('ca_file'))
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
            urllib.request.HTTPSHandler(context=self.context))

    def request(self, opener, command, params):
        params = dict(params, command=command, response='json')
        request = urllib.request.Request(self.endpoint,
            data=urllib.parse.urlencode(params).encode('utf-8'), method='POST')
        try:
            with opener.open(request, timeout=60) as response:
                body = json.load(response)
        except urllib.error.HTTPError as error:
            # Server error text can echo signed parameters; never print raw bodies/URLs.
            raise Failure('Mold API {} HTTP 오류: {}'.format(command, error.code)) from None
        except (OSError, ValueError, urllib.error.URLError):
            raise Failure('Mold API {} 연결/TLS/JSON 오류'.format(command)) from None
        payload = body.get(command.lower() + 'response', body.get('errorresponse')) if isinstance(body, dict) else None
        if not isinstance(payload, dict) or 'errorcode' in payload:
            raise Failure('Mold API {} 응답 오류 또는 권한 부족'.format(command))
        return payload

    def call(self, command, **params):
        params.update(command=command, apikey=self.config['api_key'], response='json')
        params = {key: str(value) for key, value in params.items()}
        canonical = '&'.join(key.lower() + '=' + urllib.parse.quote_plus(params[key], safe='').replace('+', '%20')
                             for key in sorted(params, key=str.lower)).lower()
        params['signature'] = base64.b64encode(hmac.new(self.config['secret_key'].encode('utf-8'),
            canonical.encode('utf-8'), self.digest).digest()).decode('ascii')
        return self.request(self.opener, command, params)

    def records(self, command, collection, **params):
        records = []
        for page in range(1, 10001):
            payload = self.call(command, page=page, pagesize=100, **params)
            batch = payload.get(collection, [])
            if not isinstance(batch, list) or any(not isinstance(row, dict) for row in batch):
                raise Failure(command + ' 목록 형식 오류')
            records.extend(batch)
            count = payload.get('count')
            if count is not None:
                try:
                    count = int(count)
                except (ValueError, TypeError):
                    raise Failure(command + ' count 형식 오류') from None
                if len(records) > count or (not batch and len(records) != count):
                    raise Failure(command + ' 페이지 조회 중 목록이 변경되었습니다.')
                if len(records) == count:
                    return records
            elif len(batch) < 100:
                return records
        raise Failure(command + ' 페이지 조회 한도 초과')


def prompt(label, default=None):
    try:
        with open('/dev/tty', 'w') as output, open('/dev/tty', 'r') as terminal:
            output.write(label + (' [{}]'.format(default) if default else '') + ': ')
            output.flush()
            value = terminal.readline()
            if not value:
                raise Failure('사용자 입력이 종료되었습니다.')
            return value.strip() or default or ''
    except OSError:
        raise Failure('Mold 관리자 로그인은 대화형 터미널에서 실행하세요.') from None


def password_prompt():
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            return getpass.getpass('Mold 관리자 비밀번호: ')
    except (getpass.GetPassWarning, EOFError, OSError):
        raise Failure('비밀번호를 숨겨 입력할 수 있는 터미널이 필요합니다.') from None


def authenticate(args, credentials=None):
    api = Api(dict(api_url=args.api_url, ca_file=args.ca_file, signature_algorithm=args.signature_algorithm))
    session = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
        urllib.request.HTTPSHandler(context=api.context))
    username = credentials['username'] if credentials is not None else prompt('Mold 관리자 ID', 'admin')
    password = credentials.pop('password') if credentials is not None else password_prompt()
    try:
        login = api.request(session, 'login', dict(username=username, password=password, domain=args.domain))
    finally:
        del password
    try:
        if str(login.get('type')) != '1' or not login.get('userid') or not login.get('sessionkey'):
            raise Failure('Mold 루트 관리자 계정과 정상적인 로그인 응답이 필요합니다.')
        params = dict(id=login['userid'], sessionkey=login['sessionkey'])
        keys = api.request(session, 'getUserKeys', params).get('userkeys', {})
        if keys.get('apikeyaccess') is False:
            raise Failure('이 계정의 API 키 접근이 비활성화되어 있습니다.')
        if not keys.get('apikey') or not keys.get('secretkey'):
            if keys.get('apikey') or keys.get('secretkey'):
                raise Failure('API 키 쌍이 불완전합니다. 기존 키는 변경하지 않았습니다.')
            if args.check:
                raise Failure('기존 API 키가 없습니다. 일반 실행에서 최초 키 쌍을 발급할 수 있습니다.')
            log('기존 API 키가 없어 최초 키 쌍을 발급합니다. 값은 저장하지 않습니다.')
            result = api.request(session, 'registerUserKeys', params)
            keys = result.get('userkeys', result)
            if not keys.get('apikey') or not keys.get('secretkey'):
                raise Failure('최초 API 키 발급 결과가 불완전합니다. 자동 재발급하지 않습니다.')
        api.config.update(api_key=keys['apikey'], secret_key=keys['secretkey'])
    finally:
        try:
            api.request(session, 'logout', dict(sessionkey=login.get('sessionkey', '')))
        except Failure:
            log('로그인 세션 로그아웃 실패. 인증정보는 파일에 저장하지 않았습니다.')
    log('Mold 관리자 인증 완료. API 키는 메모리에서만 사용합니다.')
    return api


def local_identity():
    names = {socket.gethostname().lower(), socket.getfqdn().lower()}
    names.update(name.split('.')[0] for name in list(names))
    addresses = set()
    for name in names:
        try:
            addresses.update(row[4][0] for row in socket.getaddrinfo(name, None))
        except OSError:
            pass
    try:
        result = subprocess.run(['ip', '-j', 'address', 'show'], check=True,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        for interface in json.loads(result.stdout):
            addresses.update(row['local'] for row in interface.get('addr_info', []) if 'local' in row)
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError):
        pass
    return names, addresses - {'127.0.0.1', '::1'}


def discover(api, host_id=None):
    hosts = api.records('listHosts', 'host', type='Routing')
    if host_id:
        matches = [host for host in hosts if host.get('id') == host_id]
    else:
        names, addresses = local_identity()
        matches = [host for host in hosts if str(host.get('name', '')).lower() in names
                   or host.get('ipaddress') in addresses]
    if len(matches) != 1 or not matches[0].get('clusterid'):
        raise Failure('현재 호스트를 Mold에서 유일하게 판별하지 못했습니다. --host-id UUID를 지정하세요.')
    current = matches[0]
    clusters = api.records('listClusters', 'cluster', id=current['clusterid'])
    if len(clusters) != 1 or clusters[0].get('id') != current['clusterid']:
        raise Failure('현재 호스트의 클러스터 조회 실패')
    cluster = clusters[0]
    members = [host for host in hosts if host.get('clusterid') == cluster['id']]
    ids = [host.get('id') for host in members]
    if not members or any(not value for value in ids) or len(ids) != len(set(ids)):
        raise Failure('클러스터 호스트 목록이 비어 있거나 중복/누락되어 있습니다.')
    log('HA 대상 클러스터: {} ({}) / 전체 호스트 {}대'.format(cluster.get('name', ''), cluster['id'], len(members)))
    for host in members:
        log('HA 대상 호스트: {} ({})'.format(host.get('name', ''), host['id']))
    return dict(cluster_id=cluster['id'], host_id=current['id'], host_ids=sorted(ids))


def boolean(value):
    if value is True or str(value).lower() == 'true':
        return True
    if value is False or str(value).lower() == 'false':
        return False
    raise Failure('HA 상태 응답의 true/false 값이 잘못되었습니다.')


class HAController:
    def __init__(self, api, target, timeout=300, interval=5):
        self.api, self.target = api, target
        self.timeout, self.interval = timeout, interval
        self.enabling = False

    def wait(self, predicate, description):
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                if predicate():
                    return
            except Failure:
                # Only read/poll operations are retried; mutation requests are never replayed.
                pass
            if time.monotonic() >= deadline:
                raise Failure(description + ' 확인 시간 초과')
            time.sleep(self.interval)

    def mutate(self, command, **params):
        result = self.api.call(command, **params)
        if result.get('jobid'):
            job_id = result['jobid']
            completed = []

            def done():
                status = self.api.call('queryAsyncJobResult', jobid=job_id)
                state = str(status.get('jobstatus'))
                if state == '0':
                    return False
                if state != '1':
                    # Do not retry a failed async job until timeout.
                    completed.append(None)
                else:
                    completed.append(status.get('jobresult'))
                return True

            self.wait(done, command + ' 비동기 작업')
            result = completed[0]
        if not isinstance(result, dict) or not result:
            raise Failure(command + ' 작업 결과가 실패하거나 비어 있습니다.')
        pending = [result]
        while pending:
            item = pending.pop()
            if ('errorcode' in item or ('success' in item and not boolean(item['success']))
                    or ('status' in item and not boolean(item['status']))):
                raise Failure(command + ' 작업 실패')
            pending.extend(value for value in item.values() if isinstance(value, dict))

    def cluster_enabled(self):
        rows = self.api.records('listResourceDetails', 'resourcedetail', resourcetype='Cluster',
                                resourceid=self.target['cluster_id'], key='resourceHAEnabled')
        if not rows:  # CloudStack treats an absent cluster detail as enabled.
            return True
        if len(rows) != 1 or rows[0].get('key') != 'resourceHAEnabled':
            raise Failure('클러스터 HA 설정 조회 결과가 잘못되었습니다.')
        return boolean(rows[0].get('value'))

    def host_ha(self, host_id):
        # This API extends BaseCmd, not BaseListCmd: it has no page/pagesize parameters.
        rows = self.api.call('listHostHAResources', hostid=host_id).get('hostha', [])
        if (not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict)
                or rows[0].get('hostid') != host_id or not rows[0].get('haprovider')):
            raise Failure('호스트 {}의 HA 제공자가 구성되어 있지 않거나 조회 결과가 잘못되었습니다.'.format(host_id))
        boolean(rows[0].get('haenable'))
        return rows[0]

    def validate_inventory(self):
        rows = self.api.records('listHosts', 'host', type='Routing', clusterid=self.target['cluster_id'])
        ids = [row.get('id') for row in rows]
        if (any(not isinstance(value, str) for value in ids) or sorted(ids) != self.target['host_ids']
                or any(row.get('clusterid') != self.target['cluster_id'] for row in rows)):
            raise Failure('실행 중 클러스터 호스트 구성이 변경되었습니다. HA를 활성화하지 않습니다.')
        return rows

    def preflight(self):
        self.validate_inventory()
        log('현재 클러스터 HA: ' + str(self.cluster_enabled()))
        for host_id in self.target['host_ids']:
            row = self.host_ha(host_id)
            log('현재 호스트 {} HA: {} / {}'.format(host_id, row['haenable'], row.get('hastate', '')))

    def disabled(self):
        return (not self.cluster_enabled() and all(not boolean(self.host_ha(host_id)['haenable'])
                                                  for host_id in self.target['host_ids']))

    def disable(self):
        log('클러스터 및 전체 호스트 HA 비활성화 시작')
        self.mutate('disableHAForCluster', clusterid=self.target['cluster_id'])
        self.wait(lambda: not self.cluster_enabled(), '클러스터 HA 비활성화')
        for host_id in self.target['host_ids']:
            self.mutate('disableHAForHost', hostid=host_id)
        self.wait(self.disabled, '클러스터/전체 호스트 HA 비활성화')
        log('클러스터 및 전체 호스트 HA 비활성화 검증 완료')

    def verify_hosts(self):
        def healthy():
            rows = self.validate_inventory()
            return all(row.get('state') == 'Up' and row.get('resourcestate') == 'Enabled' for row in rows)
        self.wait(healthy, 'Mold 전체 호스트 Up/Enabled')
        log('Mold 전체 호스트 Up/Enabled 및 클러스터 구성 검증 완료')

    def enable(self):
        self.enabling = True
        # Keep the cluster gate closed until every host-level flag is enabled.
        log('전체 호스트 HA 활성화 시작 (클러스터 HA는 마지막에 활성화)')
        for host_id in self.target['host_ids']:
            self.mutate('enableHAForHost', hostid=host_id)
        self.wait(lambda: all(boolean(self.host_ha(host_id)['haenable']) for host_id in self.target['host_ids']),
                  '전체 호스트 HA 활성화')
        self.mutate('enableHAForCluster', clusterid=self.target['cluster_id'])

        def enabled():
            self.validate_inventory()
            return self.cluster_enabled() and all(boolean(row['haenable']) and row.get('hastate') == 'Available'
                for row in (self.host_ha(host_id) for host_id in self.target['host_ids']))

        self.wait(enabled, '클러스터 HA 및 전체 호스트 HA Available')
        self.verify_hosts()
        log('클러스터 및 전체 호스트 HA 활성화 검증 완료')


def completion_prefix(args):
    kind = getattr(args, 'kind', 'rpms')
    return 'Full update' if kind == 'full' else 'Mold update' if kind == 'mold' else 'RPM update'


def run_job(args, api, target, output=None):
    controller = HAController(api, target)
    changed = False
    try:
        controller.preflight()
        if not args.check:
            changed = True  # Include partially applied or response-lost disable requests.
            controller.disable()
        kind = getattr(args, 'kind', 'rpms')
        if kind == 'full':
            command = ['bash', args.script, '--background-worker'] + args.worker_arg
        elif kind == 'mold':
            command = ['bash', args.script, '--role', 'host']
        else:
            command = ['bash', args.script, '--background-worker', '--foreground', '--mode', args.mode]
            command += getattr(args, 'worker_arg', [])
        if args.check:
            command.append('--check')
        env = dict(os.environ, ABLESTACK_RPM_UPDATE_LOCK_FD=str(args.lock_fd),
                   ABLESTACK_UPDATE_LOCK_FD=str(args.lock_fd), ABLESTACK_HA_MANAGED='1', LOGFILE=args.log_file)
        # The package worker retains the host lock even if this supervisor exits.
        process = subprocess.Popen(command, env=env, pass_fds=(args.lock_fd,),
                                   stdout=output, stderr=subprocess.STDOUT)
        if process.wait() != 0:
            raise Failure('RPM 업데이트 또는 설치 후 검증에 실패했습니다.')
        if args.check:
            log('Mold HA 조회 및 RPM 사전 검사 완료. HA 설정/RPM 설치는 변경하지 않았습니다.')
            return
        controller.verify_hosts()
        controller.wait(controller.disabled, '업데이트 중 HA 비활성화 유지')
        controller.enable()
        log(completion_prefix(args) + ' finished: completed. Package, host and HA verification completed.')
    except BaseException:
        if changed:
            if controller.enabling:
                try:
                    controller.disable()
                except Failure:
                    log('ERROR: HA 재비활성화 실패. 클러스터 및 호스트의 실제 HA 상태를 확인하세요.')
            log('ERROR: HA 자동 활성화를 완료하지 않았습니다. 원인 해결 후 같은 ISO로 재실행하세요.')
        raise


@contextmanager
def logging_to(path, mirror):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(descriptor, 'a', encoding='utf-8', buffering=1) as stream:
        original = sys.stdout

        class Output:
            def write(self, text):
                stream.write(text)
                if mirror:
                    original.write(text)

            def flush(self):
                stream.flush()
                if mirror:
                    original.flush()

        sys.stdout = Output()
        try:
            yield stream
        finally:
            sys.stdout = original


def launch_background(args, api, target, stream):
    read_fd, write_fd = os.pipe()
    try:
        process = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()),
            '--background-worker', str(read_fd), str(args.lock_fd)], stdin=subprocess.DEVNULL,
            stdout=stream, stderr=subprocess.STDOUT, start_new_session=True,
            pass_fds=(read_fd, args.lock_fd))
        os.close(read_fd)
        read_fd = -1
        with os.fdopen(write_fd, 'w', encoding='utf-8') as pipe:
            write_fd = -1
            json.dump(dict(args=vars(args), api=api.config, target=target), pipe)
        log('RPM 업데이트 시작. PID: {}'.format(process.pid))
        log('ABLESTACK_UPDATE_STARTED_PID={}'.format(process.pid))
        # Machine-readable launcher result for Cockpit; no authentication data.
        print('ABLESTACK_UPDATE_STARTED_PID={}'.format(process.pid), flush=True)
        log('진행 확인: tail -f ' + args.log_file)
    finally:
        if read_fd >= 0:
            os.close(read_fd)
        if write_fd >= 0:
            os.close(write_fd)


def interrupted(signum, frame):
    raise Failure('작업이 신호 {}로 중단되었습니다.'.format(signum))


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == '--background-worker':
        state_fd, lock_fd = map(int, argv[1:])
        os.set_inheritable(lock_fd, False)
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        signal.signal(signal.SIGHUP, signal.SIG_IGN)
        signal.signal(signal.SIGTERM, interrupted)
        with os.fdopen(state_fd, 'r', encoding='utf-8') as pipe:
            state = json.load(pipe)
        args = argparse.Namespace(**state['args'])
        api, target = Api(state['api']), state['target']
        del state
        try:
            run_job(args, api, target)
            return 0
        except Failure as error:
            log('ERROR: ' + str(error))
            log('ERROR: ' + completion_prefix(args) + ' finished: failed. HA/업데이트 로그를 확인하세요.')
            return 1
        except (OSError, KeyboardInterrupt):
            log('ERROR: ' + completion_prefix(args) + ' finished: failed. HA/업데이트 로그를 확인하세요.')
            return 1
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--script', required=True)
    parser.add_argument('--lock-fd', required=True, type=int)
    parser.add_argument('--log-file', required=True)
    parser.add_argument('--mode', choices=('auto', 'hci', 'vm'), default='auto')
    parser.add_argument('--kind', choices=('rpms', 'full', 'mold'), default='rpms')
    parser.add_argument('--worker-arg', action='append', default=[])
    parser.add_argument('--credentials-stdin', action='store_true')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--foreground', action='store_true')
    parser.add_argument('--api-url', default='http://ccvm:8080/client/api')
    parser.add_argument('--domain', default='/')
    parser.add_argument('--host-id')
    parser.add_argument('--ca-file')
    parser.add_argument('--signature-algorithm', choices=('sha256', 'sha1'), default='sha256')
    args = parser.parse_args(argv)
    os.set_inheritable(args.lock_fd, False)
    fcntl.flock(args.lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    # Cockpit may pass FD 3; shell updaters reserve FD 3 for console logging and FD 9 for locking.
    if args.lock_fd != 9:
        original_fd = args.lock_fd
        os.dup2(original_fd, 9, inheritable=False)
        args.lock_fd = 9
        os.close(original_fd)
    signal.signal(signal.SIGTERM, interrupted)
    with logging_to(args.log_file, True) as stream:
        try:
            if args.credentials_stdin:
                try:
                    credentials = json.loads(sys.stdin.read(65537))
                    if (not isinstance(credentials, dict) or not isinstance(credentials.get('username'), str)
                            or not credentials['username'].strip() or not isinstance(credentials.get('password'), str)
                            or not credentials['password']):
                        raise ValueError()
                except (ValueError, TypeError):
                    raise Failure('Mold 관리자 ID/비밀번호 입력 형식이 잘못되었습니다.') from None
                api = authenticate(args, credentials)
                del credentials
            else:
                api = authenticate(args)
            target = discover(api, args.host_id)
            HAController(api, target).preflight()
            if args.foreground or args.check:
                # Package command output goes straight to the log; HA progress is mirrored.
                run_job(args, api, target, output=stream)
            else:
                launch_background(args, api, target, stream)
            return 0
        except Failure as error:
            log('ERROR: ' + str(error))
            log('ERROR: ' + completion_prefix(args) + ' finished: failed.')
            return 1
        except (OSError, KeyboardInterrupt):
            log('ERROR: ' + completion_prefix(args) + ' finished: failed (실행 오류 또는 사용자 중단).')
            return 1


if __name__ == '__main__':
    sys.exit(main())
