import React from 'react';
import { Alert, Button, Spinner } from '@patternfly/react-core';
import { requestCubeApi } from '../../services/api/client';

export default function RegistrationDownloads({ refreshKey = 0 }: { refreshKey?: number }) {
  const [files, setFiles] = React.useState<Array<{ filename: string; content: string }>>([]);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const load = React.useCallback(() => {
    setLoading(true);
    requestCubeApi<{files: typeof files}>('/api/v1/cube/downloads', { method: 'POST', body: { kind: 'registrations' } })
      .then((response) => { setFiles(response.files); setError(''); })
      .catch((error) => setError(String(error))).finally(() => setLoading(false));
  }, [refreshKey]);
  React.useEffect(load, [load]);
  return <div>
    <strong>호스트 통신 등록 파일</strong>
    {loading && <Spinner size="sm" aria-label="등록 파일 조회 중" />}
    {error && <Alert isInline variant="warning" title={error}><Button variant="link" onClick={load}>다시 조회</Button></Alert>}
    {files.map((file) => <p key={file.filename}><a download={file.filename} href={'data:application/json;charset=utf-8,' + encodeURIComponent(file.content)}>{file.filename} 다운로드</a></p>)}
    {!loading && !error && files.length === 0 && <p>현재 호스트에서 다운로드할 수 있는 등록 파일이 없습니다.</p>}
  </div>;
}
