import React from 'react';
import { Alert, Button, ExpandableSection, Spinner, Modal, ModalHeader, ModalBody, ModalFooter } from '@patternfly/react-core';
import { requestCubeApi } from '../../services/api/client';
import { useStatusPolling } from '../../hooks/useStatusPolling';

type Task = { job_id: string; status: string; message: string; logs: string[]; created_at: string; cancellable?: boolean };
const EMPTY: Task[] = [];
const fetchTasks = async () => (await requestCubeApi<{ jobs: Task[] }>('/api/v1/cube/_tasks')).jobs;

export default function TaskProgress({ hideSucceeded = false }: { hideSucceeded?: boolean } = {}) {
  const { data, refresh } = useStatusPolling({ fetcher: fetchTasks, fallback: EMPTY, intervalMs: 2000, retainPreviousOnError: true });
  const [expanded, setExpanded] = React.useState(true);
  const [dismissed, setDismissed] = React.useState('');
  const [confirmTask, setConfirmTask] = React.useState<Task | null>(null);
  const [stopping, setStopping] = React.useState(false);
  const [stopError, setStopError] = React.useState('');
  const logRef = React.useRef<HTMLPreElement>(null);
  const stop = async () => {
    if (!confirmTask || stopping) return;
    setStopping(true); setStopError('');
    try {
      await requestCubeApi('/api/v1/cube/_tasks/' + confirmTask.job_id + '/cancel', { method: 'POST' });
      setConfirmTask(null); refresh();
    } catch (error) {
      setStopError(error instanceof Error ? error.message : '작업 중단 요청에 실패했습니다.');
    } finally { setStopping(false); }
  };
  const task = data.find((item) => ['queued', 'running', 'cancelling'].includes(item.status)) || data[0];
  const visible = Boolean(task && task.job_id !== dismissed && !(hideSucceeded && task.status === 'succeeded'));
  const logText = (task?.logs || []).join('\n') || task?.message || '';
  React.useLayoutEffect(() => {
    if (visible && expanded && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [visible, expanded, task?.job_id, logText]);
  if (!task || !visible) return null;
  const running = ['queued', 'running', 'cancelling'].includes(task.status);
  return <><Alert isInline variant={running ? 'info' : task.status === 'failed' ? 'danger' : task.status === 'cancelled' ? 'warning' : 'success'}
    title={task.message} actionLinks={!running
      ? <Button variant="link" onClick={() => setDismissed(task.job_id)}>닫기</Button>
      : task.cancellable ? <Button variant="link" isDisabled={task.status === 'cancelling' || stopping}
          onClick={() => { setStopError(''); setConfirmTask(task); }}>{task.status === 'cancelling' ? '중단 요청됨' : '작업 중단'}</Button> : undefined}>
    {running && <Spinner size="sm" aria-label="작업 진행 중" />}
    <ExpandableSection toggleTextExpanded="로그 숨기기" toggleTextCollapsed="로그 표시"
      isExpanded={expanded} onToggle={(_, value) => setExpanded(value)}>
      <pre ref={logRef} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '20rem', overflow: 'auto' }}>{logText}</pre>
    </ExpandableSection>
  </Alert>
    <Modal isOpen={Boolean(confirmTask)} variant="small" aria-label="실행 중인 작업 중단"
      onClose={() => { if (!stopping) setConfirmTask(null); }}>
      <ModalHeader title="실행 중인 작업 중단" />
      <ModalBody>
        <p>{confirmTask?.message}</p>
        <Alert isInline variant="warning" title="구성 작업을 중단하시겠습니까?">
          실행 중인 명령을 종료합니다. 이미 적용된 설정은 되돌리지 않습니다. 중단 후 로그와 실제 구성 상태를 확인하고 다시 시도해 주세요.
        </Alert>
        {stopError && <Alert isInline variant="danger" title="중단 요청 실패">{stopError}</Alert>}
      </ModalBody>
      <ModalFooter>
        <Button variant="danger" onClick={stop} isDisabled={stopping} isLoading={stopping}>작업 중단</Button>
        <Button variant="link" onClick={() => setConfirmTask(null)} isDisabled={stopping}>계속 진행</Button>
      </ModalFooter>
    </Modal>
  </>;
}
