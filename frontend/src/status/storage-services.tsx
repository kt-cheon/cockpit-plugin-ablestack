import React from 'react';
import { selectionPrompt } from '../utils/selection';
import { Alert, Button, Card, CardBody, CardTitle, Checkbox, Form, FormGroup, Modal, ModalBody, ModalFooter, ModalHeader, PageSection, Spinner, TextArea, TextInput, Title } from '@patternfly/react-core';
import { requestCubeApi } from '../services/api/client';
import StorageClusterStatus from '../cards/storage-cluster-status';
import TaskProgress from '../components/common/TaskProgress';
import LicenseManagementModal from './license-management-modal';
import ConfigFileDownloadModal from './config-file-download-modal';
import './status.scss';

interface Field { name: string; label: string; required: boolean; type: string; options: string[] | null; default: string }
interface Action { id: string; label: string; method: string; fields: Field[] }
interface Service { id: string; title: string; actions: Action[] }
type Row = Record<string, unknown>;

const LABELS: Record<string, string> = {
  name: '이름', id: 'ID', service_name: '서비스 이름', cluster_id: '클러스터 ID', hosts: '호스트',
  hostname: '호스트명', ip_address: 'IP 주소', status: '상태', port: '포트', username: '사용자',
  bucket_name: '버킷', display_name: '표시 이름', size: '크기', path: '경로', pool_name: '풀',
  image_name: '디스크 이미지', iqn_id: 'IQN', subsystem_nqn_id: 'NQN', placement: '배치',
  export_id: 'Export ID', pseudo: '공유 경로', access_type: '접근 방식',
};
const text = (value: unknown): string => value === null || value === undefined ? '' :
  typeof value === 'object' ? JSON.stringify(value) : String(value);
const rows = (value: unknown): Row[] => {
  if (typeof value === 'string') {
    try { return rows(JSON.parse(value)); } catch { return [{ status: value }]; }
  }
  if (Array.isArray(value)) return value.map((row) => typeof row === 'object' && row !== null ? row as Row : { name: row });
  if (value && typeof value === 'object') {
    const record = value as Row;
    if ('code' in record && record.val !== undefined) return rows(record.val);
    for (const key of ['data', 'val', 'items', 'services', 'exports', 'users', 'buckets', 'targets']) {
      if (Array.isArray(record[key])) return rows(record[key]);
    }
    return [record];
  }
  return value === null || value === undefined ? [] : [{ status: value }];
};
const defaults = (action?: Action) => Object.fromEntries((action?.fields || []).map((field) => [field.name, field.default]));
const execute = (service: string, action: string, values: Record<string, string> = {}) =>
  requestCubeApi<{code: number; val: unknown}>('/api/v1/cube/glue/service', {
    method: 'POST', body: { service, action, values }, maxTimeSeconds: 14400,
  });

function ServicePanel({ service }: { service: Service }) {
  const [actionId, setActionId] = React.useState('list');
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [entries, setEntries] = React.useState<Row[]>([]);
  const [selected, setSelected] = React.useState<Row | null>(null);
  const [filter, setFilter] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [confirmed, setConfirmed] = React.useState(false);
  const [detail, setDetail] = React.useState<Row | null>(null);
  const action = service.actions.find((item) => item.id === actionId)!;
  const refresh = React.useCallback(async () => {
    setBusy(true); setError('');
    try { setEntries(rows((await execute(service.id, 'list')).val)); }
    catch (error) { setError(String(error)); } finally { setBusy(false); }
  }, [service.id]);
  React.useEffect(() => { refresh(); }, [refresh]);
  React.useEffect(() => {
    let active = true;
    const timer = window.setInterval(() => {
      if (!busy) execute(service.id, 'list').then((response) => { if (active && actionId === 'list') setEntries(rows(response.val)); }).catch(() => undefined);
    }, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [service.id, busy, actionId]);
  const chooseAction = (id: string) => {
    const operation = service.actions.find((item) => item.id === id)!;
    const initial = defaults(operation);
    if (selected) {
      for (const field of operation.fields) {
        const aliases: Record<string, string[]> = {
          name: ['name', 'vol_name', 'service_name'], vol_name: ['vol_name', 'name'],
          service_id: ['service_name', 'service_id'], username: ['username', 'uid', 'user_id'],
          cluster_id: ['cluster_id', 'name'], new_iqn_id: ['iqn_id'],
        };
        const key = [field.name, ...(aliases[field.name] || [])].find((key) => selected[key] !== undefined);
        if (key) initial[field.name] = Array.isArray(selected[key]) ? (selected[key] as unknown[]).map(text).join('\n') : text(selected[key]);
        if (field.name === 'hosts' && (selected.placement as Row)?.hosts) initial.hosts = ((selected.placement as Row).hosts as string[]).join('\n');
      }
    }
    setActionId(id); setValues(initial); setConfirmed(false); setError(''); setNotice('');
  };
  const submit = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await execute(service.id, action.id, values);
      if (action.method === 'GET') setEntries(rows(response.val));
      else {
        setNotice(action.label + ' 작업이 완료되었습니다.');
        setSelected(null); setActionId('list'); setValues({}); setConfirmed(false);
        setEntries(rows((await execute(service.id, 'list')).val));
      }
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  const columns = Array.from(new Set(entries.flatMap(Object.keys))).filter((key) => !/password|secret|token|keys/i.test(key)).slice(0, 12);
  const filtered = entries.filter((row) => Object.values(row).some((value) => text(value).toLowerCase().includes(filter.toLowerCase())));
  const valid = action.fields.every((field) => !field.required || Boolean(values[field.name]?.trim()));
  return <Card><CardTitle><Title headingLevel="h2">{service.title}</Title></CardTitle><CardBody>
    <div className="ct-storage-services__toolbar">
      <Button variant="secondary" onClick={refresh} isDisabled={busy}>목록 새로고침</Button>
      <TextInput aria-label="목록 검색" value={filter} placeholder="목록 검색" onChange={(_, value) => setFilter(value)} />
      {busy && <Spinner size="md" aria-label="스토리지 서비스 작업 중" />}
    </div>
    {error && <Alert isInline variant="danger" title={error} />}
    {notice && <Alert isInline variant="success" title={notice} />}
    <div className="ct-storage-services__table">
      <table aria-label={service.title + ' 목록'}><thead><tr><th>선택</th>{columns.map((key) => <th key={key}>{LABELS[key] || key}</th>)}<th>상세</th></tr></thead>
        <tbody>{filtered.map((row, index) => <tr key={index}>
          <td><input type="radio" name={'row-' + service.id} aria-label={(text(row.name || row.service_name || row.id) || String(index + 1)) + ' 선택'} checked={selected === row} onChange={() => setSelected(row)} /></td>
          {columns.map((key) => <td key={key}>{text(row[key])}</td>)}
          <td><Button variant="link" onClick={() => setDetail(row)}>상세</Button></td>
        </tr>)}</tbody>
      </table>
      {!busy && filtered.length === 0 && <p>표시할 항목이 없습니다.</p>}
    </div>
    <Form className="ct-storage-services__form">
      <FormGroup label="작업 선택" fieldId={'service-action-' + service.id}>
        <select id={'service-action-' + service.id} value={actionId} disabled={busy} onChange={(event) => chooseAction(event.target.value)}>
          {service.actions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </FormGroup>
      {selected && <p>선택한 항목의 정보를 입력란에 불러오려면 작업을 선택하세요.</p>}
      {action.fields.map((field) => <FormGroup key={field.name} label={field.label} isRequired={field.required} fieldId={'field-' + field.name}>
        {field.options ? <select id={'field-' + field.name} value={values[field.name] || ''} disabled={busy} onChange={(event) => setValues((previous) => ({ ...previous, [field.name]: event.target.value }))}>
          <option value="">{selectionPrompt(field.label)}</option>{field.options.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          : field.type === 'multiple' ? <TextArea id={'field-' + field.name} value={values[field.name] || ''} isDisabled={busy} onChange={(_, value) => setValues((previous) => ({ ...previous, [field.name]: value }))} />
          : <TextInput id={'field-' + field.name} type={field.type === 'password' ? 'password' : 'text'} value={values[field.name] || ''} isDisabled={busy} onChange={(_, value) => setValues((previous) => ({ ...previous, [field.name]: value }))} />}
      </FormGroup>)}
      {action.method !== 'GET' && <Checkbox id="service-confirm" label={action.method === 'DELETE' ? '선택한 서비스 또는 데이터가 삭제될 수 있음을 확인했습니다.' : '입력한 설정으로 작업을 실행하겠습니다.'}
        isChecked={confirmed} isDisabled={busy} onChange={(_, value) => setConfirmed(value)} />}
      <Button isLoading={busy} isDisabled={busy || !valid || (action.method !== 'GET' && !confirmed)} onClick={submit}>{action.label}</Button>
    </Form>
    <Modal isOpen={detail !== null} onClose={() => setDetail(null)} variant="large" aria-label="스토리지 항목 상세">
      <ModalHeader title="스토리지 항목 상세" /><ModalBody><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(detail, null, 2)}</pre></ModalBody>
      <ModalFooter><Button variant="link" onClick={() => setDetail(null)}>닫기</Button></ModalFooter>
    </Modal>
  </CardBody></Card>;
}

export default function StorageServices({ hostname }: { hostname: string }) {
  const [catalog, setCatalog] = React.useState<Service[]>([]);
  const [selected, setSelected] = React.useState('');
  const [error, setError] = React.useState('');
  const [license, setLicense] = React.useState(false);
  const [downloads, setDownloads] = React.useState(false);
  React.useEffect(() => {
    requestCubeApi<{services: Service[]}>('/api/v1/cube/glue/catalog').then((response) => setCatalog(response.services)).catch((error) => setError(String(error)));
  }, []);
  const service = catalog.find((item) => item.id === selected);
  return <PageSection hasBodyWrapper={false} className="ct-storage-services">
    <div className="ct-storage-services__header"><Title headingLevel="h1">ABLESTACK <small>{hostname}</small></Title>
      <Button variant="link" onClick={() => setLicense(true)}>라이선스 관리</Button><Button variant="secondary" onClick={() => setDownloads(true)}>설정파일 다운로드</Button>
    </div>
    <TaskProgress />
    {error && <Alert isInline variant="danger" title={error} />}
    <div className="ct-storage-services__layout">
      <nav aria-label="스토리지 서비스 메뉴"><Button variant={selected === '' ? 'primary' : 'link'} onClick={() => setSelected('')}>대시보드</Button>
        {catalog.map((item) => <Button key={item.id} variant={selected === item.id ? 'primary' : 'link'} onClick={() => setSelected(item.id)}>{item.title}</Button>)}
      </nav>
      <div className="ct-storage-services__content">
        {service ? <ServicePanel key={service.id} service={service} /> : <>
          <div className="ct-system-status"><StorageClusterStatus readOnly /></div>
          <Card><CardTitle>스토리지 서비스 관리</CardTitle><CardBody>서비스 메뉴에서 파일시스템, 공유 폴더, 사용자, 타깃과 게이트웨이 가상머신을 관리할 수 있습니다.</CardBody></Card>
        </>}
      </div>
    </div>
    <LicenseManagementModal isOpen={license} onClose={() => setLicense(false)} />
    <ConfigFileDownloadModal isOpen={downloads} onClose={() => setDownloads(false)} />
  </PageSection>;
}
