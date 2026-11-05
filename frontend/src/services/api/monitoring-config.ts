import { requestCubeApi } from "./client.ts";
type MonitoringClusterType =
  | "powerflex"
    | "ablestack-hci"
  | "ablestack-vm"
  | "ablestack-standalone"
  | "ablestack-hci-filesystem";

export interface MonitoringConfigStep {
  name: string;
  status: string;
  code: number;
  message?: string;
  output?: string;
}

export interface MonitoringServiceStatus {
  name: string;
  active: boolean;
  enabled: boolean;
}

interface MonitoringActionResponse {
  code?: number | string;
  message?: string;
  error?: string;
  val?: unknown;
  steps?: MonitoringConfigStep[];
  services?: MonitoringServiceStatus[];
  system_profile?: unknown[];
}

export interface MonitoringConfigurePayload {
  ccvm: string[];
  cube: string[];
  scvm: string[];
  smtp: {
    enabled: boolean;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
  };
}

function responseMessage(response: MonitoringActionResponse, fallback: string): string {
    if (typeof response.error === "string" && response.error.trim()) return response.error;
    if (typeof response.message === "string" && response.message.trim()) return response.message;
    if (typeof response.val === "string" && response.val.trim()) return response.val;
    return fallback;
}

function assertSuccess(response: MonitoringActionResponse, fallback: string): void {
    if (response.code === undefined || String(response.code) === "200") return;
    throw new Error(responseMessage(response, fallback));
}

export async function checkMonitoringTargetHealth(clusterType: MonitoringClusterType): Promise<void> {
    const option = clusterType === "powerflex" || clusterType === "ablestack-hci" || clusterType === "ablestack-hci-filesystem"
        ? "host,scvm,ccvm"
        : "host,ccvm";
    const response = await requestCubeApi<MonitoringActionResponse>(
        `/api/v1/cube/cluster/health?option=${encodeURIComponent(option)}`,
        { maxTimeSeconds: 60 }
    );

    assertSuccess(response, "모니터링 대상 네트워크 연결 확인에 실패했습니다.");
}

export async function configureMonitoring(
    payload: MonitoringConfigurePayload
): Promise<MonitoringActionResponse> {
    const response = await requestCubeApi<MonitoringActionResponse>(
        "/api/v1/cube/ccvm/monitoring/config",
        {
            method: "POST",
            body: {
                action: "configure",
                ...payload,
            },
            maxTimeSeconds: 900,
        }
    );

    assertSuccess(response, "Wall 모니터링 구성에 실패했습니다.");
    return response;
}

export async function updateMonitoringTargets(): Promise<MonitoringActionResponse> {
    const response = await requestCubeApi<MonitoringActionResponse>(
        "/api/v1/cube/ccvm/monitoring/config",
        {
            method: "POST",
            body: { action: "update" },
            maxTimeSeconds: 900,
        }
    );

    assertSuccess(response, "모니터링 대상 IP 설정에 실패했습니다.");
    return response;
}
