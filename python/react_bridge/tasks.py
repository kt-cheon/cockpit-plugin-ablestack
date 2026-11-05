"""Private, persistent Cockpit tasks. No HTTP listener or independent agent is installed."""
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

DIRECTORY = Path('/var/lib/ablestack/react-tasks')
ID_PATTERN = re.compile(r'^[a-f0-9]{32}$')
TERMINAL = ('succeeded', 'failed')


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def boot_id():
    try:
        return Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    except OSError:
        return ''


def directory(task_id):
    if not isinstance(task_id, str) or not ID_PATTERN.fullmatch(task_id):
        raise ValueError('유효하지 않은 작업 번호입니다.')
    return DIRECTORY / task_id


def save(path, value):
    temporary = path.with_suffix('.tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(value, stream, ensure_ascii=False)
    os.replace(temporary, path)


def start(request, kind='operation'):
    DIRECTORY.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(DIRECTORY, 0o700)
    task_id = uuid.uuid4().hex
    folder = directory(task_id)
    folder.mkdir(mode=0o700)
    state = {'job_id': task_id, 'kind': kind, 'status': 'queued', 'mode': request.get('body', {}).get('mode', 'partial'),
             'message': '작업을 준비하고 있습니다.', 'current_step': '', 'steps': [],
             'created_at': now(), 'started_at': '', 'finished_at': ''}
    save(folder / 'request.json', request)
    save(folder / 'state.json', state)
    descriptor = os.open(folder / 'execution.log', os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, 'ab') as output:
            process = subprocess.Popen([sys.executable, str(Path(__file__).with_name('bridge.py')), '--worker', task_id],
                                       stdin=subprocess.DEVNULL, stdout=output, stderr=output, start_new_session=True,
                                       close_fds=True)
        save(folder / 'worker.json', {'pid': process.pid, 'boot_id': boot_id()})
    except Exception:
        (folder / 'request.json').unlink(missing_ok=True)
        save(folder / 'state.json', dict(state, status='failed', message='작업 프로세스를 시작하지 못했습니다.', finished_at=now()))
        raise
    # The worker owns state.json from this point. Do not overwrite its first update.
    return dict(state, pid=process.pid)


def snapshot(task_id):
    folder = directory(task_id)
    state = json.loads((folder / 'state.json').read_text())
    if state['status'] not in TERMINAL and (folder / 'worker.json').exists():
        worker = json.loads((folder / 'worker.json').read_text())
        interrupted = worker.get('boot_id') != boot_id()
        try:
            os.kill(int(worker['pid']), 0)
        except ProcessLookupError:
            interrupted = True
        except PermissionError:
            pass
        if interrupted:
            # The process may have committed its final state between the first read and exit.
            state = json.loads((folder / 'state.json').read_text())
            if state['status'] not in TERMINAL:
                state.update(status='failed', message='서버 재시작 또는 프로세스 종료로 작업이 중단되었습니다. 진행 로그와 실제 상태를 확인해 주세요.', finished_at=now())
                save(folder / 'state.json', state)
                (folder / 'request.json').unlink(missing_ok=True)
    messages = []
    try:
        with (folder / 'execution.log').open('rb') as stream:
            stream.seek(0, 2)
            stream.seek(max(0, stream.tell() - 65536))
            for line in stream.read().decode('utf-8', 'replace').splitlines():
                if line.startswith('[ABLESTACK-PROGRESS]'):
                    messages.append(line.partition(']')[2].strip().replace('Ceph', 'Glue').replace('ceph', 'Glue'))
    except FileNotFoundError:
        pass
    state['logs'] = messages[-200:]
    return state


def list_tasks(kind=None):
    if not DIRECTORY.exists():
        return []
    result = []
    for folder in DIRECTORY.iterdir():
        if ID_PATTERN.fullmatch(folder.name):
            try:
                state = snapshot(folder.name)
                if kind is None or state.get('kind') == kind:
                    result.append(state)
            except (OSError, ValueError):
                continue
    return sorted(result, key=lambda item: item['created_at'], reverse=True)[:50]


class Reporter:
    def __init__(self, task_id):
        self.folder = directory(task_id)
        self.state = snapshot(task_id)
        self.state.pop('logs', None)

    def update(self, **values):
        self.state.update(values)
        save(self.folder / 'state.json', self.state)

    def step(self, name, message, function):
        self.update(current_step=name, message=message)
        print('[ABLESTACK-PROGRESS] ' + message, flush=True)
        step = {'name': name, 'status': 'running', 'message': message, 'started_at': now(), 'finished_at': ''}
        self.state['steps'].append(step)
        self.update()
        try:
            value = function()
            step.update(status='succeeded', finished_at=now(), message='완료', output=value)
            self.update()
            return value
        except Exception as error:
            step.update(status='failed', finished_at=now(), message=str(error))
            self.update()
            raise


def worker(task_id, adapter):
    reporter = Reporter(task_id)
    request_file = reporter.folder / 'request.json'
    try:
        request = json.loads(request_file.read_text())
        # All mutations share a lock: two independent UI sessions cannot deploy/reset concurrently.
        with (DIRECTORY / 'operation.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError('다른 구성 작업이 진행 중입니다. 완료된 후 다시 시도해 주세요.')
            reporter.update(status='running', started_at=now(), pid=os.getpid())
            adapter.TASK_LOG = reporter.folder / 'execution.log'
            if request['path'] == '/api/v1/cube/deploy/run':
                from workflows import deploy
                value = deploy(adapter, request['body'], reporter)
            else:
                from operations import dispatch
                value = reporter.step('execute', request.get('title', '요청한 작업을 실행합니다.'),
                                      lambda: dispatch(adapter, request, reporter))
                adapter.success(value)
            reporter.update(status='succeeded', message='작업이 완료되었습니다.', result=value, finished_at=now())
    except Exception as error:
        reporter.update(status='failed', message=str(error), finished_at=now())
    finally:
        request_file.unlink(missing_ok=True)
