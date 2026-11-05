import React from 'react';
import { Alert, Button, ExpandableSection, Spinner } from '@patternfly/react-core';
import { requestCubeApi } from '../../services/api/client';
import { useStatusPolling } from '../../hooks/useStatusPolling';

type Task = { job_id: string; status: string; message: string; logs: string[]; created_at: string };
const EMPTY: Task[] = [];
const fetchTasks = async () => (await requestCubeApi<{ jobs: Task[] }>('/api/v1/cube/_tasks')).jobs;

export default function TaskProgress({ hideSucceeded = false }: { hideSucceeded?: boolean } = {}) {
  const { data, refresh } = useStatusPolling({ fetcher: fetchTasks, fallback: EMPTY, intervalMs: 2000, retainPreviousOnError: true });
  const [expanded, setExpanded] = React.useState(true);
  const [dismissed, setDismissed] = React.useState('');
  const task = data.find((item) => ['queued', 'running'].includes(item.status)) || data[0];
  if (!task || task.job_id === dismissed || (hideSucceeded && task.status === 'succeeded')) return null;
  const running = ['queued', 'running'].includes(task.status);
  return <Alert isInline variant={running ? 'info' : task.status === 'failed' ? 'danger' : 'success'}
    title={task.message} actionLinks={<>
      <Button variant="link" onClick={refresh}>로그 새로고침</Button>
      {!running && <Button variant="link" onClick={() => setDismissed(task.job_id)}>닫기</Button>}
    </>}>
    {running && <Spinner size="sm" aria-label="작업 진행 중" />}
    <ExpandableSection toggleText="진행 로그" isExpanded={expanded} onToggle={(_, value) => setExpanded(value)}>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '20rem', overflow: 'auto' }}>{(task.logs || []).join('\n') || task.message}</pre>
    </ExpandableSection>
  </Alert>;
}
