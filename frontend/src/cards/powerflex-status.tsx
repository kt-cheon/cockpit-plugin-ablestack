import React from 'react';
import { Alert, Button, Card, CardBody, CardFooter, CardTitle, Checkbox, Form, FormGroup, Modal, ModalBody, ModalFooter, ModalHeader, TextInput } from '@patternfly/react-core';
import { requestCubeApi } from '../services/api/client';
import { fetchNicInventory, type InventorySelectOption } from '../services/api/inventory';
import { useStatusPolling } from '../hooks/useStatusPolling';
import './status-card.scss';

const FALLBACK = { code: 0, val: {} as Record<string, unknown> };
const fetchStatus = () => requestCubeApi<typeof FALLBACK>('/api/v1/cube/powerflex/status');
const FIELDS: Array<[string, string, string]> = [
  ['cpu', 'CPU(vCore)', '8'], ['memory', '메모리(GiB)', '16'], ['mgmt_ip', 'PFMP 관리 IP', ''],
  ['mgmt_prefix', '관리 NIC CIDR', '24'], ['mgmt_gw', '관리 Gateway', ''], ['dns', 'DNS', ''],
  ['mgmt_pool', '관리 IP 대역 시작 주소(5개 연속)', ''], ['data1_pool', '스토리지 IP 대역 시작 주소(5개 연속)', ''],
  ['data2_pool', '복제 IP 대역 시작 주소(5개 연속)', ''],
];
export default function PowerflexStatus() {
  const [error, setError] = React.useState('');
  const { data, refresh } = useStatusPolling({ fetcher: fetchStatus, fallback: FALLBACK, onError: (error) => setError(String(error)) });
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<Record<string, string>>(Object.fromEntries(FIELDS.map(([key, _, value]) => [key, value])));
  const [bridges, setBridges] = React.useState<InventorySelectOption[]>([]);
  const [bridge, setBridge] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [action, setAction] = React.useState('deploy');
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (open) fetchNicInventory().then((inventory) => setBridges(inventory.bridges)).catch((error) => setError(String(error))); }, [open]);
  const run = async () => {
    setBusy(true); setError('');
    try {
      await requestCubeApi('/api/v1/cube/powerflex/manage', { method: 'POST', maxTimeSeconds: 14400,
        body: { action, ...values, management_network_bridge: bridge, username, password } });
      setOpen(false); refresh();
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  return <>
    <Card className="ct-status-card"><CardTitle>PowerFlex·PFMP 상태</CardTitle><CardBody>
      {error && <Alert isInline variant="warning" title={error} />}
      {Object.entries(data.val || {}).map(([key, value]) => <p key={key}><strong>{key}</strong>: {typeof value === 'object' ? JSON.stringify(value) : String(value)}</p>)}
      <Button onClick={() => setOpen(true)}>PowerFlex·PFMP 관리</Button>
    </CardBody><CardFooter>{Number(data.code) === 200 ? '상태 조회가 완료되었습니다.' : '상태를 확인하고 있습니다.'}</CardFooter></Card>
    <Modal isOpen={open} onClose={() => !busy && setOpen(false)} variant="medium" aria-label="PowerFlex·PFMP 관리">
      <ModalHeader title="PowerFlex·PFMP 관리" /><ModalBody><Form>
        <FormGroup label="작업" fieldId="powerflex-action"><select id="powerflex-action" value={action} onChange={(event) => { setAction(event.target.value); setConfirmed(false); }}>
          <option value="deploy">PFMP 가상머신 배포</option><option value="install">PFMP 구성</option>
          <option value="remove">PFMP 제거</option><option value="reset">PFMP 초기화</option><option value="add-user">PowerFlex 사용자 등록</option>
        </select></FormGroup>
        {action === 'deploy' && <>
          {FIELDS.map(([key, label]) => <FormGroup key={key} label={label} fieldId={'pfmp-' + key}><TextInput id={'pfmp-' + key} value={values[key]} onChange={(_, value) => setValues((prev) => ({ ...prev, [key]: value }))} /></FormGroup>)}
          <FormGroup label="관리 NIC Bridge" fieldId="pfmp-bridge"><select id="pfmp-bridge" value={bridge} onChange={(event) => setBridge(event.target.value)}>{bridges.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></FormGroup>
        </>}
        {action === 'add-user' && <>
          <FormGroup label="사용자 이름" fieldId="powerflex-user"><TextInput id="powerflex-user" value={username} onChange={(_, value) => setUsername(value)} /></FormGroup>
          <FormGroup label="비밀번호" fieldId="powerflex-password"><TextInput id="powerflex-password" type="password" value={password} onChange={(_, value) => setPassword(value)} /></FormGroup>
        </>}
        <Checkbox id="powerflex-confirm" label="선택한 작업을 실행하겠습니다." isChecked={confirmed} onChange={(_, value) => setConfirmed(value)} />
      </Form></ModalBody><ModalFooter><Button isLoading={busy} isDisabled={busy || !confirmed} onClick={run}>실행</Button><Button variant="link" isDisabled={busy} onClick={() => setOpen(false)}>취소</Button></ModalFooter>
    </Modal>
  </>;
}
