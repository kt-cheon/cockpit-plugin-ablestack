"""Stream real image-transfer progress on stderr; stdout remains a JSON result channel."""
import collections
import math
import os
from pathlib import Path
import re
import selectors
import shutil
import stat
import subprocess
import sys
import tempfile
import time

PREFIX = '[ABLESTACK-PROGRESS] '
QEMU_PERCENT = re.compile(r'\(([\d.]+)/100%\)')
DD_BYTES = re.compile(r'^\s*(\d+)\s+bytes\b')


def progress(message):
    print(PREFIX + ' '.join(str(message).splitlines()), file=sys.stderr, flush=True)


def duration(seconds):
    seconds = max(0, int(seconds))
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return (str(hours) + '시간 ' if hours else '') + (str(minutes) + '분 ' if minutes or hours else '') + str(seconds) + '초'


class TransferProgress:
    def __init__(self, label, total=None):
        self.label, self.total = label, total
        self.started = time.monotonic()
        self.percent = 0.0
        self.transferred = 0
        self.reported = -1
        self.last_report = self.started
        self.report(force=True)

    def consume(self, line):
        match = QEMU_PERCENT.search(line) if self.total is None else DD_BYTES.match(line)
        if match:
            if self.total is None:
                try:
                    value = float(match.group(1))
                except ValueError:
                    return False
            else:
                self.transferred = max(self.transferred, int(match.group(1)))
                value = self.transferred * 100 / self.total
            if math.isfinite(value):
                self.percent = max(self.percent, min(100.0, value))
                self.report()
            return True
        return False

    def report(self, force=False, complete=False):
        elapsed = max(0, time.monotonic() - self.started)
        # A command can report 100 before its last flush, or even exit nonzero afterwards.
        displayed = 100 if complete else min(99, int(self.percent))
        if not force and displayed == self.reported:
            return
        details = [str(displayed) + '%', '경과 ' + duration(elapsed)]
        if self.total is not None:
            details.append(f'{min(self.transferred, self.total) / 1024**3:.1f}/{self.total / 1024**3:.1f} GiB')
        if complete:
            details.append('완료')
        elif self.percent >= 100:
            details.append('저장장치 반영을 마무리하고 있습니다.')
        elif self.percent > 0 and elapsed >= 5:
            details.append('예상 남은 시간 약 ' + duration(math.ceil(elapsed * (100 - self.percent) / self.percent)))
        else:
            details.append('남은 시간 계산 중')
        progress(self.label + ' · ' + ' · '.join(details))
        self.reported = displayed
        self.last_report = time.monotonic()

    def heartbeat(self):
        if time.monotonic() - self.last_report >= 10:
            self.report(force=True)


def stream_transfer(argv, reporter, timeout=3600):
    """Handle CR-delimited qemu/dd updates without buffering an entire command."""
    process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               stdin=subprocess.DEVNULL, env=dict(os.environ, LC_ALL='C'), bufsize=0)
    pending = b''
    errors = collections.deque(maxlen=20)
    deadline = time.monotonic() + timeout
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while selector.get_map():
                if time.monotonic() >= deadline:
                    raise RuntimeError(reporter.label + ' 제한 시간을 초과했습니다.')
                for key, _ in selector.select(timeout=1):
                    data = os.read(key.fileobj.fileno(), 32768)
                    if not data:
                        selector.unregister(key.fileobj)
                        continue
                    records = re.split(b'[\r\n]', pending + data)
                    pending = records.pop()[-65536:]
                    for record in records:
                        line = record.decode('utf-8', 'replace').strip()
                        if line and not reporter.consume(line):
                            errors.append(line[-1000:])
                reporter.heartbeat()
        if pending:
            line = pending.decode('utf-8', 'replace').strip()
            if line and not reporter.consume(line):
                errors.append(line[-1000:])
        code = process.wait(timeout=max(0.1, deadline - time.monotonic()))
        if code:
            raise RuntimeError(reporter.label + ' 실패 (종료 코드 ' + str(code) + '): ' + '\n'.join(errors)[-4000:])
    except BaseException:
        if process.poll() is None:
            process.kill()
        process.wait()
        raise
    finally:
        process.stdout.close()


def convert_to_rbd(source, destination, label='CCVM 이미지를 RBD로 변환'):
    reporter = TransferProgress(label)
    stream_transfer(['qemu-img', 'convert', '-p', '-f', 'qcow2', '-O', 'rbd', str(source), destination], reporter)
    reporter.report(force=True, complete=True)


def copy_image(source, destination, label='가상머신 이미지 복사'):
    source, destination = Path(source), Path(destination)
    info = source.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size <= 0:
        raise ValueError('복사할 가상머신 이미지가 비어 있거나 일반 파일이 아닙니다.')
    reporter = TransferProgress(label, total=info.st_size)
    descriptor, temporary = tempfile.mkstemp(prefix='.' + destination.name + '.copy-', dir=destination.parent)
    os.close(descriptor)
    try:
        # GNU dd reports actual copied bytes and preserves holes without an extra pv dependency.
        stream_transfer(['dd', 'if=' + str(source), 'of=' + temporary, 'ibs=8M', 'obs=64K',
                         'conv=sparse,fsync', 'status=progress'], reporter)
        if Path(temporary).stat().st_size != info.st_size:
            raise RuntimeError('복사된 이미지의 크기가 원본과 다릅니다.')
        shutil.copymode(source, temporary)
        os.replace(temporary, destination)
        reporter.transferred = info.st_size
        reporter.report(force=True, complete=True)
    finally:
        Path(temporary).unlink(missing_ok=True)


def run_step(message, argv, timeout=120):
    progress(message)
    result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            timeout=timeout, env=dict(os.environ, LC_ALL='C'))
    if result.returncode:
        raise RuntimeError(message + ' 실패: ' + (result.stderr or result.stdout)[-4000:])
    return result
