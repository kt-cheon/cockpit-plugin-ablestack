import React from 'react';
import { Alert, Button, Checkbox, Form, FormGroup, Modal, ModalBody, ModalFooter, ModalHeader, TextArea } from '@patternfly/react-core';
import { requestCubeApi } from '../services/api/client';
import TaskProgress from '../components/common/TaskProgress';

// Local storage stays a single operation while the all-in-one entry points are suspended.
export default function LocalStorageModal({ isOpen, onClose, onCompleted }: { isOpen: boolean; onClose: () => void; onCompleted: () => void }) {
  const [disks, setDisks] = React.useState('');
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [complete, setComplete] = React.useState(false);
  React.useEffect(() => {
    if (isOpen) { setDisks(''); setConfirmed(false); setError(''); setComplete(false); }
  }, [isOpen]);
  const paths = Array.from(new Set(disks.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean)));
  const valid = paths.length > 0 && paths.every((path) => /^\/dev\/[A-Za-z0-9_./:+-]+$/.test(path));
  const configure = async () => {
    setBusy(true); setError('');
    try {
      const result = await requestCubeApi<{code: number; val?: unknown}>('/api/v1/cube/local/manage', {
        method: 'POST', body: {action: 'create-local-disk', disks: paths}, maxTimeSeconds: 3600,
      });
      if (Number(result.code) !== 200) throw new Error(String(result.val || '로컬 스토리지 구성에 실패했습니다.'));
      setComplete(true); onCompleted();
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  return <Modal isOpen={isOpen} onClose={() => !busy && onClose()} variant="medium" aria-label="로컬 스토리지 구성">
    <ModalHeader title="로컬 스토리지 구성" /><ModalBody><TaskProgress />
      {complete ? <Alert isInline variant="success" title="로컬 스토리지 구성이 완료되었습니다." /> : <Form>
        <Alert isInline variant="warning" title="선택한 디스크의 데이터가 삭제됩니다. OS가 설치된 디스크와 사용 중인 디스크는 지정하지 마세요." />
        <FormGroup label="스토리지용 디스크 경로 (한 줄에 하나)" fieldId="local-storage-disks" isRequired>
          <TextArea id="local-storage-disks" value={disks} isDisabled={busy} placeholder="/dev/disk/by-id/…" onChange={(_, value) => { setDisks(value); setConfirmed(false); }} />
        </FormGroup>
        <Checkbox id="local-storage-confirm" label="입력한 스토리지용 디스크와 데이터 삭제 내용을 확인했습니다." isChecked={confirmed} isDisabled={busy} onChange={(_, value) => setConfirmed(value)} />
        {error && <Alert isInline variant="danger" title={error} />}
      </Form>}
    </ModalBody><ModalFooter>
      {!complete && <Button isLoading={busy} isDisabled={busy || !valid || !confirmed} onClick={configure}>구성</Button>}
      <Button variant="link" isDisabled={busy} onClick={onClose}>{complete ? '닫기' : '취소'}</Button>
    </ModalFooter>
  </Modal>;
}
