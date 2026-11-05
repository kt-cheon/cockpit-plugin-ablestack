import React from 'react';
import cockpit from '../platform/cockpit';
import { Alert, Button, Checkbox, Form, FormGroup, Modal, ModalBody, ModalFooter, ModalHeader, TextInput } from '@patternfly/react-core';
import { requestCubeApi } from '../services/api/client';
import TaskProgress from '../components/common/TaskProgress';

const ACTIONS = { instantBackup: '즉시 백업', regularBackup: '정기 백업 설정', deleteOldBackup: '오래된 백업 정리 설정', checkBackup: '예약 조회', deactiveBackup: '예약 해제' };
export default function DbBackupModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [action, setAction] = React.useState('instantBackup');
  const [directory, setDirectory] = React.useState('/home/db_backup');
  const [repeat, setRepeat] = React.useState('daily');
  const [time, setTime] = React.useState('02:00');
  const [day, setDay] = React.useState('0');
  const [months, setMonths] = React.useState('1');
  const [retain, setRetain] = React.useState('30');
  const [option, setOption] = React.useState('r');
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [result, setResult] = React.useState('');
  const [download, setDownload] = React.useState('');
  const schedule = ['regularBackup', 'deleteOldBackup'].includes(action);
  const run = async () => {
    setBusy(true); setError(''); setResult(''); setDownload('');
    try {
      const response = await requestCubeApi<{code: number; val: unknown}>('/api/v1/cube/db/dump', {
        method: 'POST', body: { action, path: directory, repeat, timeone: time,
          timetwo: repeat === 'monthly' ? months + '-' + day : day, delete: '+' + retain, checkOption: option }, maxTimeSeconds: 1800,
      });
      if (Number(response.code) !== 200) throw new Error(String(response.val));
      setResult(typeof response.val === 'string' ? response.val : JSON.stringify(response.val, null, 2));
      if (action === 'instantBackup' && typeof response.val === 'string' && response.val.endsWith('.sql')) {
        const handle = cockpit.file(response.val);
        try {
          const contents = await handle.read();
          setDownload(URL.createObjectURL(new Blob([contents], { type: 'application/sql' })));
        } finally { handle.close(); }
      }
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  React.useEffect(() => () => { if (download) URL.revokeObjectURL(download); }, [download]);
  return <Modal isOpen={isOpen} onClose={() => !busy && onClose()} variant="medium" aria-label="Mold DB 백업 관리">
    <ModalHeader title="Mold DB 백업 관리" /><ModalBody><TaskProgress /><Form>
      <FormGroup label="작업" fieldId="db-backup-action"><select id="db-backup-action" value={action} onChange={(event) => { setAction(event.target.value); setConfirmed(false); }}>
        {Object.entries(ACTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormGroup>
      <FormGroup label="백업 디렉터리" fieldId="db-backup-path"><TextInput id="db-backup-path" value={directory} onChange={(_, value) => setDirectory(value)} /></FormGroup>
      {schedule && <>
        <FormGroup label="반복 주기" fieldId="db-backup-repeat"><select id="db-backup-repeat" value={repeat} onChange={(event) => { setRepeat(event.target.value); setDay(event.target.value === 'monthly' ? '1' : '0'); }}>
          <option value="no">한 번</option><option value="hourly">매시간</option><option value="daily">매일</option><option value="weekly">매주</option><option value="monthly">월별</option></select></FormGroup>
        <FormGroup label="시간" fieldId="db-backup-time"><TextInput id="db-backup-time" type="time" value={time} onChange={(_, value) => setTime(value)} /></FormGroup>
        {repeat === 'weekly' && <FormGroup label="요일 (0: 일요일 ~ 6: 토요일)" fieldId="db-backup-weekday"><TextInput id="db-backup-weekday" type="number" min={0} max={6} value={day} onChange={(_, value) => setDay(value)} /></FormGroup>}
        {repeat === 'monthly' && <>
          <FormGroup label="개월 간격" fieldId="db-backup-months"><TextInput id="db-backup-months" type="number" min={1} max={12} value={months} onChange={(_, value) => setMonths(value)} /></FormGroup>
          <FormGroup label="실행 일 (1~28)" fieldId="db-backup-day"><TextInput id="db-backup-day" type="number" min={1} max={28} value={day} onChange={(_, value) => setDay(value)} /></FormGroup>
        </>}
        {action === 'deleteOldBackup' && <FormGroup label="보관 기간(일)" fieldId="db-backup-retain"><TextInput id="db-backup-retain" type="number" min={1} value={retain} onChange={(_, value) => setRetain(value)} /></FormGroup>}
      </>}
      {['checkBackup', 'deactiveBackup'].includes(action) && <FormGroup label="예약 종류" fieldId="db-backup-kind"><select id="db-backup-kind" value={option} onChange={(event) => setOption(event.target.value)}><option value="r">정기 백업</option><option value="d">오래된 백업 정리</option></select></FormGroup>}
      {action !== 'checkBackup' && <Checkbox id="db-backup-confirm" label="선택한 백업 작업 실행에 동의합니다." isChecked={confirmed} onChange={(_, value) => setConfirmed(value)} />}
      {error && <Alert isInline variant="danger" title={error} />}
      {result && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{result}</pre>}
      {download && <a href={download} download={result.split('/').pop()}>DB 백업 파일 다운로드</a>}
    </Form></ModalBody><ModalFooter><Button isLoading={busy} isDisabled={busy || (action !== 'checkBackup' && !confirmed) || !directory || (schedule && !time) || (repeat === 'monthly' && Number(day) < 1)} onClick={run}>실행</Button><Button variant="link" isDisabled={busy} onClick={onClose}>닫기</Button></ModalFooter>
  </Modal>;
}
