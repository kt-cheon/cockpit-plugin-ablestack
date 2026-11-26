"""Private, persistent Cockpit tasks. No HTTP listener or independent agent is installed."""
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import uuid
from progress import write_progress

DIRECTORY = Path('/var/lib/ablestack/react-tasks')
ID_PATTERN = re.compile(r'^[a-f0-9]{32}$')
TERMINAL = ('succeeded', 'failed', 'cancelled')


class TaskCancelled(BaseException):
    """Do not let a workflow's retry/Exception handler swallow cancellation."""


def process_info(pid):
    """Linux PID identity, including zombies and PID reuse (comm may contain spaces)."""
    try:
        fields = Path('/proc') / str(int(pid)) / 'stat'
        fields = fields.read_text().rsplit(')', 1)[1].split()
        return {'state': fields[0], 'start_time': fields[19]}
    except (OSError, ValueError, IndexError):
        return None


def worker_matches(worker, task_id):
    argv = (Path('/proc') / str(int(worker['pid'])) / 'cmdline').read_bytes().split(b'\0')
    expected = [str(Path(__file__).with_name('bridge.py')).encode(), b'--worker', task_id.encode()]
    return any(argv[index:index + 3] == expected for index in range(len(argv)))


def worker_alive(worker, task_id=None):
    if worker.get('boot_id') != boot_id():
        return False
    try:
        os.kill(int(worker['pid']), 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        pass
    info = process_info(worker['pid'])
    if info and (info['state'] in ('Z', 'X') or
                 (worker.get('start_time') and worker['start_time'] != info['start_time'])):
        return False
    if info and not worker.get('start_time') and task_id:
        try:
            return worker_matches(worker, task_id)
        except FileNotFoundError:
            return False
        except PermissionError:
            pass
    return True


def finish_interrupted(folder, state):
    cancelled = (folder / 'cancel.json').exists()
    message = ('작업이 중단되었습니다. 적용된 설정은 되돌리지 않습니다. 실제 상태를 확인한 후 다시 구성해 주세요.' if cancelled else
               '서버 재시작 또는 프로세스 종료로 작업이 중단되었습니다. 진행 로그와 실제 상태를 확인해 주세요.')
    state.update(status='cancelled' if cancelled else 'failed', message=message, finished_at=now())
    for step in state.get('steps', []):
        if step['status'] == 'running':
            step.update(status=state['status'], message=message, finished_at=state['finished_at'])
    save(folder / 'state.json', state)
    (folder / 'request.json').unlink(missing_ok=True)
    return state


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
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(value, stream, ensure_ascii=False)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def start(request, kind='operation'):
    DIRECTORY.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(DIRECTORY, 0o700)
    task_id = uuid.uuid4().hex
    folder = directory(task_id)
    folder.mkdir(mode=0o700)
    state = {'job_id': task_id, 'kind': kind, 'status': 'queued', 'mode': request.get('body', {}).get('mode', 'partial'),
             'cancellable': request.get('path') != '/api/v1/cube/disk/initialize',
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
        info = process_info(process.pid) or {}
        save(folder / 'worker.json', {'pid': process.pid, 'boot_id': boot_id(), 'start_time': info.get('start_time', '')})
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
        if not worker_alive(worker, task_id):
            # The process may have committed its final state between the first read and exit.
            state = json.loads((folder / 'state.json').read_text())
            if state['status'] not in TERMINAL:
                state = finish_interrupted(folder, state)
    elif state['status'] not in TERMINAL:
        # A parent can exit between creating the task and launching its worker.
        age = datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(state['created_at'])
        if age.total_seconds() > 60:
            state = finish_interrupted(folder, state)
    if state['status'] not in TERMINAL and (folder / 'cancel.json').exists():
        state.update(status='cancelling', message='작업 중단을 요청했습니다. 실행 프로세스가 종료될 때까지 기다려 주세요.')
    if 'cancellable' not in state:
        # Tasks created by an earlier RPM can also be stopped after upgrading.
        try:
            request = json.loads((folder / 'request.json').read_text())
            state['cancellable'] = request.get('path') != '/api/v1/cube/disk/initialize'
        except (OSError, ValueError):
            state['cancellable'] = False
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


def cancel(task_id):
    folder = directory(task_id)
    state = snapshot(task_id)
    if state['status'] in TERMINAL:
        return state
    if not state.get('cancellable'):
        raise ValueError('디스크 초기화는 실행 도중 중단할 수 없습니다. 디스크별 결과를 기다려 주세요.')
    worker = json.loads((folder / 'worker.json').read_text())
    if not worker_alive(worker, task_id):
        return snapshot(task_id)
    # Validate the command as well as boot/start time; never signal a reused/unrelated PID.
    try:
        matches = worker_matches(worker, task_id)
    except OSError:
        if not worker_alive(worker, task_id):
            return snapshot(task_id)
        raise RuntimeError('작업 프로세스 정보를 읽지 못해 중단하지 않았습니다. 서버 작업 로그를 확인해 주세요.') from None
    if not matches:
        raise RuntimeError('작업 프로세스의 신원을 확인할 수 없어 중단하지 않았습니다. 서버 작업 로그를 확인해 주세요.')
    if not worker_alive(worker, task_id):
        return snapshot(task_id)
    save(folder / 'cancel.json', {'requested_at': now()})
    # New workers handle TERM and clean up their subprocesses before releasing the lock.
    # Old workers have their own session, so terminate only that verified worker's group.
    try:
        if state.get('worker_version', 0) >= 2:
            os.kill(int(worker['pid']), signal.SIGTERM)
        elif os.getpgid(int(worker['pid'])) == int(worker['pid']):
            os.killpg(int(worker['pid']), signal.SIGTERM)
        else:
            raise RuntimeError('작업 전용 프로세스 그룹을 확인할 수 없습니다.')
    except ProcessLookupError:
        pass
    return snapshot(task_id)


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
        write_progress(self.folder / 'execution.log', message)
        step = {'name': name, 'status': 'running', 'message': message, 'started_at': now(), 'finished_at': ''}
        self.state['steps'].append(step)
        self.update()
        try:
            value = function()
            step.update(status='succeeded', finished_at=now(), message='완료', output=value)
            self.update()
            return value
        except (Exception, TaskCancelled) as error:
            step.update(status='cancelled' if isinstance(error, TaskCancelled) else 'failed',
                        finished_at=now(), message='사용자가 작업 중단을 요청했습니다.' if isinstance(error, TaskCancelled) else str(error))
            self.update()
            raise


def worker(task_id, adapter):
    reporter = Reporter(task_id)
    request_file = reporter.folder / 'request.json'
    def stop(_signal, _frame):
        # A repeated stop must not interrupt subprocess cleanup/final state persistence.
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        raise TaskCancelled()
    previous_handler = signal.signal(signal.SIGTERM, stop)
    try:
        reporter.update(worker_version=2)
        if (reporter.folder / 'cancel.json').exists():
            raise TaskCancelled()
        request = json.loads(request_file.read_text())
        # All mutations share a lock: two independent UI sessions cannot deploy/reset concurrently.
        with (DIRECTORY / 'operation.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError('다른 구성 작업이 진행 중입니다. 진행 로그에서 실행 중인 작업을 확인하고, 멈춘 작업은 중단한 후 다시 시도해 주세요.')
            reporter.update(status='running', started_at=now(), pid=os.getpid())
            adapter.TASK_LOG = reporter.folder / 'execution.log'
            if request['path'] == '/api/v1/cube/deploy/run':
                from workflows import deploy
                value = deploy(adapter, request['body'], reporter)
            else:
                from operations import dispatch
                value = reporter.step('execute', request.get('title', '요청한 작업을 실행합니다.'),
                                      lambda: adapter.success(dispatch(adapter, request, reporter)))
            reporter.update(status='succeeded', message='작업이 완료되었습니다.', result=value, finished_at=now())
            write_progress(reporter.folder / 'execution.log', '요청한 작업이 모두 완료되었습니다.')
    except TaskCancelled:
        finish_interrupted(reporter.folder, reporter.state)
        write_progress(reporter.folder / 'execution.log', '사용자 요청으로 작업이 중단되었습니다. 실제 구성을 확인한 후 다시 시도해 주세요.')
    except Exception as error:
        reporter.update(status='failed', message=str(error), finished_at=now())
        write_progress(reporter.folder / 'execution.log', '작업이 중단되었습니다. 마지막 진행 단계와 오류 안내를 확인해 주세요.')
    finally:
        signal.signal(signal.SIGTERM, previous_handler)
        request_file.unlink(missing_ok=True)
