import { requestCubeApi } from "./client.ts";

export type VersionUpdateType = "all" | "mold";

export interface VersionUpdateInfo {
  mountPath: string;
  copyPath: string;
  currentOsVersion: string;
  currentMoldVersion: string;
  targetOsVersion: string;
  targetMoldVersion: string;
  updateType: VersionUpdateType;
  updateLabel: string;
  updateScript: string;
  workUpdateScript: string;
}

export interface VersionUpdateRunResult extends VersionUpdateInfo {
  message: string;
  stdout: string;
  stderr: string;
}

interface VersionUpdateResponse {
  code?: number | string;
  val?: unknown;
  retname?: string;
  message?: string;
  action?: string;
}

interface VersionUpdateInfoResponse {
  mount_path?: string;
  copy_path?: string;
  current_os_version?: string;
  current_mold_version?: string;
  target_os_version?: string;
  target_mold_version?: string;
  current_ablestack_version?: string;
  target_ablestack_version?: string;
  update_type?: string;
  update_label?: string;
  update_script?: string;
  work_update_script?: string;
  message?: string;
  stdout?: string;
  stderr?: string;
}

function normalizeString(value: unknown): string {
    return typeof value === "string" || typeof value === "number"
        ? String(value).trim()
        : "";
}

function isSuccessCode(code: number | string | undefined): boolean {
    return code === undefined || String(code) === "200";
}

function responseMessage(response: VersionUpdateResponse, fallback: string): string {
    const message = normalizeString(response.message);

    if (message) {
        return message;
    }

    const val = response.val;

    if (typeof val === "string" && val.trim()) {
        return val.trim();
    }

    if (typeof val === "object" && val !== null && "message" in val) {
        const valMessage = normalizeString((val as { message?: unknown }).message);

        if (valMessage) {
            return valMessage;
        }
    }

    return fallback;
}

function infoValue(response: VersionUpdateResponse): VersionUpdateInfoResponse {
    const value = response.val;

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        return value as VersionUpdateInfoResponse;
    }

    return {};
}

function normalizeUpdateType(value: unknown): VersionUpdateType {
    return normalizeString(value).toLowerCase() === "mold" ? "mold" : "all";
}

function normalizeVersionInfo(response: VersionUpdateResponse): VersionUpdateInfo {
    const val = infoValue(response);
    const updateType = normalizeUpdateType(val.update_type);

    return {
        mountPath: normalizeString(val.mount_path),
        copyPath: normalizeString(val.copy_path),
        currentOsVersion: normalizeString(val.current_os_version) ||
            normalizeString(val.current_ablestack_version),
        currentMoldVersion: normalizeString(val.current_mold_version),
        targetOsVersion: normalizeString(val.target_os_version) ||
            normalizeString(val.target_ablestack_version),
        targetMoldVersion: normalizeString(val.target_mold_version),
        updateType,
        updateLabel: normalizeString(val.update_label) ||
            (updateType === "mold" ? "Mold 업데이트" : "전체 업데이트"),
        updateScript: normalizeString(val.update_script),
        workUpdateScript: normalizeString(val.work_update_script),
    };
}

function normalizeRunResult(response: VersionUpdateResponse): VersionUpdateRunResult {
    const val = infoValue(response);
    const info = normalizeVersionInfo(response);

    return {
        ...info,
        message: responseMessage(response, "ABLESTACK 업데이트 실행이 완료되었습니다."),
        stdout: normalizeString(val.stdout),
        stderr: normalizeString(val.stderr),
    };
}

function assertSuccess(response: VersionUpdateResponse, fallback: string) {
    if (!isSuccessCode(response.code)) {
        throw new Error(responseMessage(response, fallback));
    }
}

export async function fetchVersionUpdateInfo(
    mountPath: string,
    updateType: VersionUpdateType
): Promise<VersionUpdateInfo> {
    const parsed = await requestCubeApi<VersionUpdateResponse>(
        "/api/v1/cube/version/update",
        {
            method: "POST",
            connectTimeoutSeconds: 10,
            maxTimeSeconds: 30,
            body: {
                action: "info",
                mount_path: mountPath,
                update_type: updateType,
            },
        }
    );

    assertSuccess(parsed, "업데이트 버전 정보를 확인할 수 없습니다.");

    return normalizeVersionInfo(parsed);
}

export async function runVersionUpdate(
    mountPath: string,
    updateType: VersionUpdateType
): Promise<VersionUpdateRunResult> {
    const parsed = await requestCubeApi<VersionUpdateResponse>(
        "/api/v1/cube/version/update",
        {
            method: "POST",
            connectTimeoutSeconds: 10,
            maxTimeSeconds: 21630,
            body: {
                action: "run",
                mount_path: mountPath,
                update_type: updateType,
            },
        }
    );

    assertSuccess(parsed, "ABLESTACK 업데이트 실행에 실패했습니다.");

    return normalizeRunResult(parsed);
}
