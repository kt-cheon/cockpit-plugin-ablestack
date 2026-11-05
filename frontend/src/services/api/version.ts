import { requestCubeApi } from "./client.ts";

interface VersionResponse {
  code?: number | string;
  os_version?: string;
  kernel_version?: string;
  cockpit_version?: string;
  mold_version?: string;
  glue_version?: string;
  message?: string;
}

export interface VersionInfo {
  osVersion: string;
  kernelVersion: string;
  cockpitVersion: string;
  moldVersion: string;
  glueVersion: string;
}

function normalizeString(value: unknown): string {
    return typeof value === "string" || typeof value === "number"
        ? String(value).trim()
        : "";
}

function isSuccessCode(code: number | string | undefined): boolean {
    return code === undefined || String(code) === "200";
}

export async function fetchVersionInfo(): Promise<VersionInfo> {
    const parsed = await requestCubeApi<VersionResponse>("/api/v1/version");

    if (!isSuccessCode(parsed.code)) {
        throw new Error(normalizeString(parsed.message) || "버전 정보를 확인할 수 없습니다.");
    }

    return {
        osVersion: normalizeString(parsed.os_version),
        kernelVersion: normalizeString(parsed.kernel_version),
        cockpitVersion: normalizeString(parsed.cockpit_version),
        moldVersion: normalizeString(parsed.mold_version),
        glueVersion: normalizeString(parsed.glue_version),
    };
}
