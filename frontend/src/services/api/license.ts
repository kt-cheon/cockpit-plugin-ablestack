import { requestCubeApi } from "./client";

import { markLicenseStatusComplete } from "./system-config.ts";

export type LicenseStatusKind = "loading" | "active" | "inactive" | "missing" | "error";

export interface LicenseStatus {
  kind: LicenseStatusKind;
  issued?: string;
  expired?: string;
  message?: string;
}

interface LicenseStatusValue {
  status?: string;
  issued?: string;
  expired?: string;
}

interface LicenseResponse {
  code?: number | string;
  val?: LicenseStatusValue | string;
  message?: string;
}

function isSuccessCode(code: unknown): boolean {
    return String(code) === "200";
}

function isMissingCode(code: unknown): boolean {
    return String(code) === "404";
}

function responseMessage(response: LicenseResponse, fallback: string): string {
    if (typeof response.val === "string" && response.val.trim()) {
        return response.val;
    }

    if (typeof response.message === "string" && response.message.trim()) {
        return response.message;
    }

    return fallback;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";

    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });

    return window.btoa(binary);
}

function readFileAsBase64(file: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            if (!(reader.result instanceof ArrayBuffer)) {
                reject(new Error("라이선스 파일을 읽을 수 없습니다."));
                return;
            }

            resolve(arrayBufferToBase64(reader.result));
        };
        reader.onerror = () => reject(reader.error ?? new Error("라이선스 파일을 읽을 수 없습니다."));
        reader.readAsArrayBuffer(file);
    });
}

async function requestLicenseApi(body: Record<string, unknown>, _useAuth: boolean): Promise<LicenseResponse> {
    return requestCubeApi<LicenseResponse>("/api/v1/cube/license", { method: "POST", body });
}

export async function fetchLicenseStatus(): Promise<LicenseStatus> {
    const response = await requestLicenseApi({ action: "status" }, false);

    if (isMissingCode(response.code)) {
        return { kind: "missing" };
    }

    if (!isSuccessCode(response.code) || typeof response.val !== "object" || response.val === null) {
        return {
            kind: "error",
            message: responseMessage(response, "라이선스 상태 확인 중 오류가 발생했습니다."),
        };
    }

    const status = response.val.status;

    if (status === "active") {
        return {
            kind: "active",
            issued: response.val.issued,
            expired: response.val.expired,
        };
    }

    if (status === "inactive") {
        return {
            kind: "inactive",
            issued: response.val.issued,
            expired: response.val.expired,
        };
    }

    return {
        kind: "error",
        message: `알 수 없는 라이선스 상태입니다: ${status ?? "N/A"}`,
    };
}

export async function registerLicenseFile(
    file: File,
    useAuth: boolean
): Promise<void> {
    const licenseContent = await readFileAsBase64(file);
    const response = await requestLicenseApi(
        {
            action: "register",
            license_content: licenseContent,
            original_filename: file.name,
        },
        useAuth
    );

    if (!isSuccessCode(response.code)) {
        throw new Error(responseMessage(response, "라이선스 등록에 실패했습니다."));
    }

    await markLicenseStatusComplete();
}
