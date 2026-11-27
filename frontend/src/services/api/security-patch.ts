import { requestCubeApi } from "./client.ts";

export interface SecurityPatchRunOptions {
  targets: string[];
  sshUser: string;
  sshPort: number;
  dryRun: boolean;
  addHost?: boolean;
  portChangeOnly?: boolean;
  newPort?: number;
}

interface SecurityPatchResponse {
  code?: number | string;
  message?: string;
  retname?: string;
  val?: {
    summary?: {
      message?: string;
      total?: number;
      success?: number;
      failed?: number;
      dryRun?: boolean;
    };
    targets?: Array<{
      targetKind?: string;
      scriptPath?: string;
    }>;
  } | string;
}

export interface SecurityPatchResult {
  message: string;
  total?: number;
  success?: number;
  failed?: number;
  dryRun?: boolean;
  targetKinds: string[];
  scriptPaths: string[];
}

function isSuccessCode(code: number | string | undefined): boolean {
    return code === undefined || String(code) === "200";
}

function responseMessage(response: SecurityPatchResponse, fallback: string): string {
    if (typeof response.message === "string" && response.message.trim()) {
        return response.message;
    }

    if (typeof response.val === "string" && response.val.trim()) {
        return response.val;
    }

    if (typeof response.val === "object" && typeof response.val?.summary?.message === "string" && response.val.summary.message.trim()) {
        return response.val.summary.message;
    }

    return fallback;
}

function mapResult(response: SecurityPatchResponse): SecurityPatchResult {
    const summary = typeof response.val === "object" ? response.val?.summary : undefined;
    const targets = typeof response.val === "object" && Array.isArray(response.val?.targets)
        ? response.val.targets
        : [];

    return {
        message: responseMessage(response, "취약점 조치 요청이 완료되었습니다."),
        total: summary?.total,
        success: summary?.success,
        failed: summary?.failed,
        dryRun: summary?.dryRun,
        targetKinds: Array.from(new Set(targets
                .map((target) => target.targetKind?.trim())
                .filter((value): value is string => Boolean(value)))),
        scriptPaths: Array.from(new Set(targets
                .map((target) => target.scriptPath?.trim())
                .filter((value): value is string => Boolean(value)))),
    };
}

export async function runSecurityPatch({
    targets,
    sshUser,
    sshPort,
    dryRun,
    addHost,
    portChangeOnly = false,
    newPort,
}: SecurityPatchRunOptions): Promise<SecurityPatchResult> {
    const parsed = await requestCubeApi<SecurityPatchResponse>(
        "/api/v1/cube/security/patch",
        {
            method: "POST",
            maxTimeSeconds: 1800,
            body: {
                targets,
                ssh_user: sshUser,
                ssh_port: sshPort,
                dry_run: dryRun,
                add_host: Boolean(addHost),
                port_change: portChangeOnly,
                ...(newPort !== undefined ? { new_port: newPort } : {}),
            },
        }
    );

    if (!isSuccessCode(parsed.code)) {
        throw new Error(responseMessage(parsed, "취약점 조치 실행에 실패했습니다."));
    }

    return mapResult(parsed);
}

export async function markSecurityPatchComplete(): Promise<SecurityPatchResult> {
    const parsed = await requestCubeApi<SecurityPatchResponse>(
        "/api/v1/cube/security/patch",
        {
            method: "POST",
            body: {
                update_json_file: true,
                local: false,
            },
        }
    );

    if (!isSuccessCode(parsed.code)) {
        throw new Error(responseMessage(parsed, "취약점 조치 완료 상태 반영에 실패했습니다."));
    }

    return mapResult(parsed);
}
