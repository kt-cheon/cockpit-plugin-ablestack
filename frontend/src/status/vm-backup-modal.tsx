import React from 'react';
import { Alert, Button, Checkbox, Form, FormGroup, Modal, ModalBody, ModalFooter, ModalHeader, TextInput } from '@patternfly/react-core';
import { requestCubeApi } from '../services/api/client';

const ACTIONS: Record<string, string> = {
  overview: '백업 상태 조회', list: '복원 가능한 백업 목록', backup: '즉시 백업', restore: '백업 복원',
  schedule: '정기 백업 설정', unschedule: '정기 백업 해제', 'schedule-delete': '오래된 백업 정리 설정',
  'unschedule-delete': '오래된 백업 정리 해제', sync: '백업 동기화 제어',
};
export default function VmBackupModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [action, setAction] = React.useState('overview');
  const [directory, setDirectory] = React.useState('/mnt/glue-gfs/backup/ccvm');
  const [file, setFile] = React.useState('');
  const [repeat, setRepeat] = React.useState('daily');
  const [time, setTime] = React.useState('02:00');
  const [day, setDay] = React.useState('1');
  const [retain, setRetain] = React.useState('3');
  const [mode, setMode] = React.useState('start');
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [output, setOutput] = React.useState('');
  const readonly = ['overview', 'list', 'status'].includes(action);
  const schedule = ['schedule', 'schedule-delete'].includes(action);
  const run = async () => {
    setBusy(true); setError(''); setOutput('');
    try {
      const response = await requestCubeApi<{code: number; val: unknown}>('/api/v1/cube/backup/manage', {
        method: 'POST', maxTimeSeconds: 43200, body: { action, target_dir: directory,
          ...(action === 'restore' ? { target_file: file } : {}),
          ...(schedule ? { repeat, time, day: Number(day), retain_months: Number(retain) } : {}),
          ...(action === 'sync' ? { mode } : {}),
        },
      });
      if (Number(response.code) !== 200) throw new Error(String(response.val));
      setOutput(typeof response.val === 'string' ? response.val : JSON.stringify(response.val, null, 2));
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  return <Modal isOpen={isOpen} onClose={() => !busy && onClose()} variant="medium" aria-label="클라우드센터 가상머신 백업·복원">
    <ModalHeader title="클라우드센터 가상머신 백업·복원" />
    <ModalBody><Form>
      <FormGroup label="작업" fieldId="vm-backup-action">
        <select id="vm-backup-action" value={action} disabled={busy} onChange={(event) => { setAction(event.target.value); setConfirmed(false); setOutput(''); }}>
          {Object.entries(ACTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </FormGroup>
      <FormGroup label="백업 디렉터리" fieldId="vm-backup-dir"><TextInput id="vm-backup-dir" value={directory} onChange={(_, value) => setDirectory(value)} /></FormGroup>
      {action === 'restore' && <><Alert isInline variant="warning" title="선택한 백업으로 현재 클라우드센터 가상머신을 복원합니다. 현재 데이터가 변경됩니다." />
        <FormGroup label="복원할 백업 파일 경로" isRequired fieldId="vm-backup-file"><TextInput id="vm-backup-file" value={file} onChange={(_, value) => setFile(value)} /></FormGroup></>}
      {schedule && <>
        <FormGroup label="반복 주기" fieldId="vm-backup-repeat"><select id="vm-backup-repeat" value={repeat} onChange={(event) => setRepeat(event.target.value)}><option value="daily">매일</option><option value="monthly">매월</option></select></FormGroup>
        <FormGroup label="실행 시간" fieldId="vm-backup-time"><TextInput id="vm-backup-time" type="time" value={time} onChange={(_, value) => setTime(value)} /></FormGroup>
        {repeat === 'monthly' && <FormGroup label="실행 일" fieldId="vm-backup-day"><TextInput id="vm-backup-day" type="number" min={1} max={28} value={day} onChange={(_, value) => setDay(value)} /></FormGroup>}
        {action === 'schedule-delete' && <FormGroup label="보관 기간(개월)" fieldId="vm-backup-retain"><TextInput id="vm-backup-retain" type="number" min={1} value={retain} onChange={(_, value) => setRetain(value)} /></FormGroup>}
      </>}
      {action === 'sync' && <FormGroup label="동기화" fieldId="vm-backup-sync"><select id="vm-backup-sync" value={mode} onChange={(event) => setMode(event.target.value)}><option value="start">시작</option><option value="stop">중지</option></select></FormGroup>}
      {!readonly && <Checkbox id="vm-backup-confirm" label="작업 내용을 확인했으며 실행에 동의합니다." isChecked={confirmed} onChange={(_, value) => setConfirmed(value)} />}
      {error && <Alert isInline variant="danger" title={error} />}
      {output && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '25rem', overflow: 'auto' }}>{output}</pre>}
    </Form></ModalBody>
    <ModalFooter><Button onClick={run} isLoading={busy} isDisabled={busy || (!readonly && !confirmed) || (action === 'restore' && !file)}>실행</Button><Button variant="link" isDisabled={busy} onClick={onClose}>닫기</Button></ModalFooter>
  </Modal>;
}
