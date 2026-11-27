import { requestCubeApi } from "./client.ts";

interface VersionResponse {
  code?: number | string;
  os_version?: string;
  kernel_version?: string;
  cockpit_version?: string;
  mold_version?: string;
  glue_version?: string;
  message?: string;
  errors?: { os_version?: string; kernel_version?: string; mold_version?: string };
}

export interface VersionInfo {
  osVersion: string;
  osVersionError?: string;
  kernelVersion: string;
  kernelVersionError?: string;
  cockpitVersion: string;
  moldVersion: string;
  moldVersionError?: string;
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
        osVersionError: normalizeString(parsed.errors?.os_version),
        kernelVersion: normalizeString(parsed.kernel_version),
        kernelVersionError: normalizeString(parsed.errors?.kernel_version),
        cockpitVersion: normalizeString(parsed.cockpit_version),
        moldVersion: normalizeString(parsed.mold_version),
        moldVersionError: normalizeString(parsed.errors?.mold_version),
        glueVersion: normalizeString(parsed.glue_version),
    };
}
