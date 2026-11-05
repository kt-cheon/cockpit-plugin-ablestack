import cockpit from '../../platform/cockpit';
import { getPreviewCubeApiResponse } from './preview';

export interface CubeApiRequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  connectTimeoutSeconds?: number;
  maxTimeSeconds?: number;
}

// Adapt React service contracts to the existing tools. Sensitive payloads travel on stdin.
export async function requestCubeApi<T>(path: string, options: CubeApiRequestOptions = {}): Promise<T> {
  const preview = getPreviewCubeApiResponse<T>(path, options);
  if (preview !== undefined) return preview;
  const invoke = async (request: unknown) => {
    const process = cockpit.spawn(['python3', '/usr/share/cockpit/ablestack/python/react_bridge/bridge.py'], { err: 'message' });
    process.input(JSON.stringify(request));
    const response = JSON.parse(await process);
    if (response.bridge_error) throw new Error(response.message || '작업을 완료하지 못했습니다.');
    return response;
  };
  const response = await invoke({ path, method: options.method || 'GET', body: options.body || {} });
  if (!response.bridge_job) return response as T;
  const deadline = Date.now() + (options.maxTimeSeconds || 21600) * 1000;
  while (Date.now() < deadline) {
    const { job } = await invoke({ path: '/api/v1/cube/_tasks/' + response.bridge_job, method: 'GET' });
    if (job.status === 'succeeded') return job.result as T;
    if (job.status === 'failed') throw new Error(job.message || '작업에 실패했습니다.');
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  throw new Error('작업 결과를 기다리는 시간이 초과되었습니다. 진행 로그에서 서버 작업 상태를 확인해 주세요.');
}
