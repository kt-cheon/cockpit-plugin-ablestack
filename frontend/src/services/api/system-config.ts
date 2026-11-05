import { requestCubeApi } from "./client.ts";

interface SystemConfigResponse {
  code?: number | string;
  val?: unknown;
  message?: string;
}

export interface SystemConfigUpdateOptions {
  depth1: string;
  depth2: string;
  value?: string;
  option?: "all";
}

function isSuccessCode(code: number | string | undefined): boolean {
    return code === undefined || String(code) === "200";
}

function responseMessage(response: SystemConfigResponse, fallback: string): string {
    if (typeof response.message === "string" && response.message.trim()) {
        return response.message;
    }

    if (typeof response.val === "string" && response.val.trim()) {
        return response.val;
    }

    return fallback;
}

export async function updateSystemConfigFlag({
    depth1,
    depth2,
    value = "true",
    option,
}: SystemConfigUpdateOptions): Promise<void> {
    const parsed = await requestCubeApi<SystemConfigResponse>(
        "/api/v1/cube/system/config",
        {
            method: "POST",
            body: {
                action: "update",
                depth1,
                depth2,
                value,
                ...(option ? { option } : {}),
            },
        }
    );

    if (!isSuccessCode(parsed.code)) {
        throw new Error(responseMessage(parsed, "시스템 설정 플래그 갱신에 실패했습니다."));
    }
}

export function markLicenseStatusComplete(): Promise<void> {
    return updateSystemConfigFlag({
        depth1: "license",
        depth2: "status",
    });
}

export async function markGfsConfigureComplete(): Promise<void> {
    const parsed = await requestCubeApi<SystemConfigResponse>(
        "/api/v1/cube/system/config",
        {
            method: "POST",
            body: {
                action: "gfs-configure",
                value: "true",
            },
        }
    );

    if (!isSuccessCode(parsed.code)) {
        throw new Error(responseMessage(parsed, "전체 호스트의 GFS 구성 완료 상태 반영에 실패했습니다."));
    }
}
