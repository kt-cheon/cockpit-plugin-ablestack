import { requestCubeApi } from "./client.ts";

interface CubeActionResponse {
  code?: number | string;
  message?: string;
  error?: string;
  val?: unknown;
}

export interface CCVMCloudInitRequest {
  mgmt_ip?: string;
  mgmt_gw?: string;
  dns?: string;
  sn_nic?: string;
  sn_ip?: string;
  sn_prefix?: number;
  sn_gw?: string;
  sn_dns?: string;
}

export interface CCVMXMLRequest {
  cpu: number;
  memory: number;
  gfs_mount_point?: string;
  management_network_bridge: string;
  service_network_bridge?: string;
}

function actionMessage(response: CubeActionResponse, fallback: string): string {
    if (typeof response.error === "string" && response.error.trim()) return response.error;
    if (typeof response.message === "string" && response.message.trim()) return response.message;
    if (typeof response.val === "string" && response.val.trim()) return response.val;
    return fallback;
}

function assertActionSuccess(response: CubeActionResponse, fallback: string): void {
    if (response.code === undefined || ["200", "202"].includes(String(response.code))) return;
    throw new Error(actionMessage(response, fallback));
}

export async function checkClusterHealth(option: "host" | "host,scvm"): Promise<void> {
    const response = await requestCubeApi<CubeActionResponse>(
        `/api/v1/cube/cluster/health?option=${encodeURIComponent(option)}`,
        { maxTimeSeconds: 60 }
    );
    assertActionSuccess(response, "클러스터 Health Check에 실패했습니다.");
}

export async function initializeCCVM(): Promise<void> {
    const response = await requestCubeApi<CubeActionResponse>("/api/v1/cube/ccvm/lifecycle", {
        method: "POST",
        body: { action: "initialize" },
        maxTimeSeconds: 300,
    });
    assertActionSuccess(response, "클라우드센터 초기화에 실패했습니다.");
}

export async function createCCVMCloudInit(request: CCVMCloudInitRequest): Promise<void> {
    const response = await requestCubeApi<CubeActionResponse>("/api/v1/cube/cloudinit/ccvm/generate", {
        method: "POST",
        body: request,
        maxTimeSeconds: 300,
    });
    assertActionSuccess(response, "CCVM cloud-init ISO 생성에 실패했습니다.");
}

export async function createCCVM(request: CCVMXMLRequest): Promise<void> {
    const response = await requestCubeApi<CubeActionResponse>("/api/v1/cube/ccvm/create", {
        method: "POST",
        body: request,
        maxTimeSeconds: 1800,
    });
    assertActionSuccess(response, "CCVM 생성에 실패했습니다.");
}

export async function startCCVM(): Promise<void> {
    const response = await requestCubeApi<CubeActionResponse>("/api/v1/cube/ccvm/lifecycle", {
        method: "POST",
        body: { action: "start" },
        maxTimeSeconds: 1800,
    });
    assertActionSuccess(response, "클라우드센터 가상머신 배포에 실패했습니다.");
}

export async function startAndRegisterCCVMLicense(): Promise<void> {
    await startCCVM();

    const response = await requestCubeApi<CubeActionResponse>("/api/v1/cube/license/apply", {
        method: "POST",
        body: {
            action: "register",
            roles: ["ccvm"],
            wait_for_ready: true,
        },
        maxTimeSeconds: 1800,
    });
    assertActionSuccess(response, "클라우드센터 가상머신 라이선스 등록에 실패했습니다.");
}

export async function bootstrapCCVM(): Promise<void> {
    const response = await requestCubeApi<CubeActionResponse>("/api/v1/cube/ccvm/bootstrap", {
        method: "POST",
        body: { run_script: true },
        maxTimeSeconds: 7800,
    });
    assertActionSuccess(response, "클라우드센터 가상머신 상세 설정에 실패했습니다.");
}
