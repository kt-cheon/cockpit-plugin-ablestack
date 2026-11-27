import { requestCubeApi } from "./client";

export interface HbaWwnInfo {
  hostname: string;
  target: string;
  wwn: string[];
}

interface HbaManageResponse {
  code?: number | string;
  val?: unknown;
  message?: string;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function normalizeWwnList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const normalizedValue = normalizeString(value);

    return normalizedValue ? [normalizedValue] : [];
  }

  return Array.from(new Set(
    value.map(normalizeString).filter(Boolean)
  ));
}

function getApiErrorMessage(response: HbaManageResponse): string {
  if (typeof response.error === "string" && response.error.trim()) {
    return response.error;
  }

  if (typeof response.message === "string" && response.message.trim()) {
    return response.message;
  }

  return "HBA WWN 목록 조회에 실패했습니다.";
}

function mapHbaWwnInfo(value: unknown): HbaWwnInfo | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    hostname: normalizeString(value.hostname) || "N/A",
    target: normalizeString(value.target) || "N/A",
    wwn: normalizeWwnList(value.wwn),
  };
}

export async function fetchHbaWwnList(): Promise<HbaWwnInfo[]> {
  const parsed = await requestCubeApi<HbaManageResponse>(
    "/api/v1/cube/hba/manage",
    {
      method: "POST",
      body: {
        action: "list-hba-wwn",
      },
    }
  );

  if (parsed.code !== undefined && String(parsed.code) !== "200") {
    throw new Error(getApiErrorMessage(parsed));
  }

  if (!Array.isArray(parsed.val)) {
    throw new Error("HBA WWN 목록 조회 응답 형식이 올바르지 않습니다.");
  }

  return parsed.val
    .map(mapHbaWwnInfo)
    .filter((item): item is HbaWwnInfo => Boolean(item));
}
