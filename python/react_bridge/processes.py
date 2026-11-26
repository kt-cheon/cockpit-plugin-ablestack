"""Bound local tool lifetimes to their task, including grandchildren."""
import os
import signal
import subprocess


def run(argv, *, timeout, stdin=None, stdout=None, stderr=None, **options):
    process = subprocess.Popen(argv, stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                               stdout=stdout, stderr=stderr, start_new_session=True, **options)
    try:
        output, errors = process.communicate(input=stdin, timeout=timeout)
        if process.returncode:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        return subprocess.CompletedProcess(argv, process.returncode, output, errors)
    except BaseException as error:
        # Killing only the helper leaves its shell/remote client running with stale locks.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate()
        if isinstance(error, subprocess.TimeoutExpired):
            raise RuntimeError('작업 실행 제한 시간(' + str(timeout) + '초)을 초과하여 중단했습니다. 마지막 진행 단계와 실제 구성을 확인해 주세요.') from None
        raise
