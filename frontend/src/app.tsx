import React from "react";
import { Alert, Button, Page, Spinner } from "@patternfly/react-core";
import StatusPage from "./status/status";
import StorageServices from "./status/storage-services";
import { requestCubeApi } from "./services/api/client";

// 전체 콘텐츠를 채우도록 설정
export default function App() {
  const [context, setContext] = React.useState<{role: string; hostname: string} | null>(null);
  const [error, setError] = React.useState('');
  const load = React.useCallback(() => {
    setError('');
    requestCubeApi<{role: string; hostname: string}>('/api/v1/cube/system/context').then(setContext).catch((error) => setError(String(error)));
  }, []);
  React.useEffect(load, [load]);
  return (
    <Page className="pf-m-no-sidebar">
      {error ? <Alert variant="danger" title="호스트 정보를 확인하지 못했습니다.">{error}<Button variant="link" onClick={load}>다시 시도</Button></Alert>
        : !context ? <Spinner aria-label="호스트 정보 확인 중" />
        : context.role === 'scvm' ? <StorageServices hostname={context.hostname} /> : <StatusPage />}
    </Page>
  );
}
