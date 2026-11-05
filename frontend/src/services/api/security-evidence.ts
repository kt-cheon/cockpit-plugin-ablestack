
import { requestCubeApi } from "./client.ts";
import { isPreviewMode } from "./preview.ts";

export interface SecurityEvidenceRequest {
  targets?: string[];
  hosts?: string[];
  items?: string;
  sshPort?: number;
  timeout?: number;
  maxOutputLines?: number;
}

export interface SecurityEvidenceMetadata {
  path: string;
  filename: string;
  size: number;
  generatedAt: string;
  hosts: number;
  collectedHosts: string[];
  requestedHosts: number;
  requestedTargets: string[];
  clusterType: string;
  targetGroups: string[];
  items: number;
  slides: number;
  collectorStatus: number;
  collectorWarning: string;
  runDirectory: string;
  downloadAvailable: boolean;
}

interface SecurityEvidenceResponse {
  code?: number | string;
  val?: unknown;
  message?: string;
}

function joinUrl(baseUrl: string, path: string): string {
    return `${baseUrl}/${path.replace(/^\/+/, "")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
    return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function normalizeNumber(value: unknown, fallback = 0): number {
    const numberValue = Number(value);

    return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeBoolean(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.toLowerCase() === "true";

    return false;
}

function normalizeStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map(normalizeString).filter(Boolean)
        : [];
}

function readAlias(source: Record<string, unknown>, keys: string[]): unknown {
    for (const key of keys) {
        if (source[key] !== undefined) {
            return source[key];
        }
    }

    return undefined;
}

function isSuccessCode(code: unknown): boolean {
    return code === undefined || String(code) === "200";
}

function responseMessage(response: SecurityEvidenceResponse, fallback: string): string {
    if (typeof response.message === "string" && response.message.trim()) {
        return response.message;
    }

    if (typeof response.val === "string" && response.val.trim()) {
        return response.val;
    }

    return fallback;
}

function normalizeMetadata(value: unknown): SecurityEvidenceMetadata {
    const source = isRecord(value) ? value : {};

    return {
        path: normalizeString(source.path),
        filename: normalizeString(source.filename) || "security-evidence.zip",
        size: normalizeNumber(source.size),
        generatedAt: normalizeString(readAlias(source, ["generatedAt", "generated_at"])),
        hosts: normalizeNumber(source.hosts),
        collectedHosts: normalizeStringArray(readAlias(source, ["collectedHosts", "collected_hosts"])),
        requestedHosts: normalizeNumber(readAlias(source, ["requestedHosts", "requested_hosts"])),
        requestedTargets: normalizeStringArray(readAlias(source, ["requestedTargets", "requested_targets"])),
        clusterType: normalizeString(readAlias(source, ["clusterType", "cluster_type"])),
        targetGroups: normalizeStringArray(readAlias(source, ["targetGroups", "target_groups"])),
        items: normalizeNumber(source.items),
        slides: normalizeNumber(source.slides),
        collectorStatus: normalizeNumber(readAlias(source, ["collectorStatus", "collector_status"])),
        collectorWarning: normalizeString(readAlias(source, ["collectorWarning", "collector_warning"])),
        runDirectory: normalizeString(readAlias(source, ["runDirectory", "run_directory"])),
        downloadAvailable: normalizeBoolean(readAlias(source, ["downloadAvailable", "download_available"])),
    };
}

export async function fetchLatestSecurityEvidence(): Promise<SecurityEvidenceMetadata | null> {
    const parsed = await requestCubeApi<SecurityEvidenceResponse>(
        "/api/v1/cube/security/evidence"
    );

    if (String(parsed.code) === "404") {
        return null;
    }

    if (!isSuccessCode(parsed.code)) {
        throw new Error(responseMessage(parsed, "보안 증적 정보를 확인할 수 없습니다."));
    }

    return normalizeMetadata(parsed.val);
}

export async function generateSecurityEvidence({
    targets = ["all"],
    hosts,
    items = "all",
    sshPort,
    timeout = 120,
    maxOutputLines = 400,
}: SecurityEvidenceRequest = {}): Promise<SecurityEvidenceMetadata> {
    const parsed = await requestCubeApi<SecurityEvidenceResponse>(
        "/api/v1/cube/security/evidence",
        {
            method: "POST",
            body: {
                targets,
                ...(hosts && hosts.length > 0 ? { hosts } : {}),
                items,
                ...(sshPort && sshPort > 0 ? { ssh_port: sshPort } : {}),
                timeout,
                max_output_lines: maxOutputLines,
            },
            maxTimeSeconds: 7200,
        }
    );

    if (!isSuccessCode(parsed.code)) {
        throw new Error(responseMessage(parsed, "보안 증적 생성에 실패했습니다."));
    }

    return normalizeMetadata(parsed.val);
}

export async function downloadSecurityEvidenceZip(): Promise<string> {
    if (isPreviewMode()) return "data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==";
    const response = await requestCubeApi<{ content: string }>("/api/v1/cube/security/evidence/download");
    return "data:application/zip;base64," + response.content;
}
