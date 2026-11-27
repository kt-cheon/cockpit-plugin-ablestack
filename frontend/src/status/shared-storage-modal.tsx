import React from 'react';
import { Alert, Button, Form, FormGroup, Modal, ModalBody, ModalFooter, ModalHeader, TextInput } from '@patternfly/react-core';
import { requestCubeApi } from '../services/api/client';

export default function SharedStorageModal({ isOpen, onClose, onReady }: { isOpen: boolean; onClose: () => void; onReady: () => void }) {
  const [size, setSize] = React.useState('512');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const create = async () => {
    setBusy(true); setError('');
    try {
      await requestCubeApi('/api/v1/cube/rbd/manage', { method: 'POST', body: { action: 'create-rbd-image', size: Number(size) }, maxTimeSeconds: 1800 });
      onReady();
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  return <Modal isOpen={isOpen} onClose={() => !busy && onClose()} variant="small" aria-label="HCI 공유 파일 구성">
    <ModalHeader title="HCI 공유 파일 구성" />
    <ModalBody><Form>
      <p>Glue 공유 디스크를 생성한 뒤 GFS 구성 마법사에서 디스크와 IPMI를 설정합니다.</p>
      <FormGroup label="공유 디스크 크기(GiB)" fieldId="shared-disk-size"><TextInput id="shared-disk-size" type="number" min={1} value={size} onChange={(_, value) => setSize(value)} /></FormGroup>
      {error && <Alert isInline variant="danger" title={error} />}
    </Form></ModalBody>
    <ModalFooter><Button isLoading={busy} isDisabled={busy || !Number.isInteger(Number(size)) || Number(size) < 1} onClick={create}>공유 디스크 생성 후 계속</Button>
      <Button variant="secondary" isDisabled={busy} onClick={onReady}>기존 공유 디스크로 계속</Button><Button variant="link" isDisabled={busy} onClick={onClose}>취소</Button></ModalFooter>
  </Modal>;
}
