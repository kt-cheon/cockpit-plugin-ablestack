import { requestCubeApi } from "./client.ts";

export type DeployUrlOption = "storageCenter" | "cloudCenter" | "wallCenter";

export interface DeployStatusRaw {
  licenseStatus: string;
  clusterConfigStatus: string;
  storageVmStatus: string;
  storageVmBootstrapStatus: string;
  storageClusterStatus: string;
  cloudClusterStatus: string;
  cloudVmStatus: string;
  cloudVmBootstrapStatus: string;
  monitoringStatus: string;
  gfsConfigureStatus: string;
  localConfigureStatus: string;
  securityPatchStatus: string;
}

export interface DeployStatusWarning {
  key: string;
  message: string;
}

export interface DeployPollingTarget {
  enabled: boolean;
  reason: string;
}

export interface DeployPollingPolicy {
  storageVm: DeployPollingTarget;
  storageCluster: DeployPollingTarget;
  gfsResource: DeployPollingTarget;
  gfsDisk: DeployPollingTarget;
  cloudVm: DeployPollingTarget;
  cloudCluster: DeployPollingTarget;
  mold: DeployPollingTarget;
}

export interface DeployStatusData {
  osType: string;
  stage: string;
  stageOrder: number;
  severity: string;
  messageKey: string;
  availableActions: string[];
  warnings: DeployStatusWarning[];
  raw: DeployStatusRaw;
  polling: DeployPollingPolicy;
  checkedAt: string;
}

interface DeployPollingTargetResponse {
  enabled?: boolean;
  reason?: string;
}

interface DeployPollingPolicyResponse {
  storage_vm?: DeployPollingTargetResponse;
  storage_cluster?: DeployPollingTargetResponse;
  gfs_resource?: DeployPollingTargetResponse;
  gfs_disk?: DeployPollingTargetResponse;
  cloud_vm?: DeployPollingTargetResponse;
  cloud_cluster?: DeployPollingTargetResponse;
  mold?: DeployPollingTargetResponse;
}

interface DeployStatusRawResponse {
  license_status?: string;
  ccfg_status?: string;
  scvm_status?: string;
  scvm_bootstrap_status?: string;
  sc_status?: string;
  cc_status?: string;
  ccvm_status?: string;
  ccvm_bootstrap_status?: string;
  wall_monitoring_status?: string;
  gfs_configure?: string;
  local_configure?: string;
  security_patch?: string;
}

interface DeployStatusDataResponse {
  os_type?: string;
  stage?: string;
  stage_order?: number;
  severity?: string;
  message_key?: string;
  available_actions?: string[];
  warnings?: Array<{
    key?: string;
    message?: string;
  }>;
  raw?: DeployStatusRawResponse;
  polling?: DeployPollingPolicyResponse;
  checked_at?: string;
}

interface DeployStatusResponse {
  code?: number | string;
  data?: DeployStatusDataResponse;
  message?: string;
}

export interface DeployRunStepResult {
  name: string;
  status: string;
  message: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  output?: unknown;
}

export interface DeployRunJob {
  jobId: string;
  status: string;
  mode: string;
  osType: string;
  currentStep: string;
  message: string;
  createdAt: string;
  startedAt: string;
  finishedAt: string;
  steps: DeployRunStepResult[];
}

interface DeployRunStepResultResponse {
  name?: string;
  status?: string;
  message?: string;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  output?: unknown;
}

interface DeployRunJobResponseData {
  job_id?: string;
  status?: string;
  mode?: string;
  os_type?: string;
  current_step?: string;
  message?: string;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
  steps?: DeployRunStepResultResponse[];
}

interface DeployRunJobListResponse {
  code?: number | string;
  jobs?: DeployRunJobResponseData[];
  message?: string;
}

interface DeployRunStartResponse {
  code?: number | string;
  job_id?: string;
  status?: string;
  message?: string;
  steps?: DeployRunStepResultResponse[];
}

interface DeployUrlResponse {
  code?: number | string;
  val?: Partial<Record<DeployUrlOption, string>>;
  message?: string;
  error?: string;
}

export const DEPLOY_STATUS_FALLBACK: DeployStatusData = {
    osType: "",
    stage: "cluster_prepare",
    stageOrder: 0,
    severity: "warning",
    messageKey: "deploy_status_unavailable",
    availableActions: [],
    warnings: [],
    raw: {
        licenseStatus: "",
        clusterConfigStatus: "",
        storageVmStatus: "",
        storageVmBootstrapStatus: "",
        storageClusterStatus: "",
        cloudClusterStatus: "",
        cloudVmStatus: "",
        cloudVmBootstrapStatus: "",
        monitoringStatus: "",
        gfsConfigureStatus: "",
        localConfigureStatus: "",
        securityPatchStatus: "",
    },
    polling: {
        storageVm: { enabled: false, reason: "배포 상태 확인 전" },
        storageCluster: { enabled: false, reason: "배포 상태 확인 전" },
        gfsResource: { enabled: false, reason: "배포 상태 확인 전" },
        gfsDisk: { enabled: false, reason: "배포 상태 확인 전" },
        cloudVm: { enabled: false, reason: "배포 상태 확인 전" },
        cloudCluster: { enabled: false, reason: "배포 상태 확인 전" },
        mold: { enabled: false, reason: "배포 상태 확인 전" },
    },
    checkedAt: "",
};

export const LICENSE_REQUIRED_DEPLOY_STATUS: DeployStatusData = {
    osType: "",
    stage: "license_register",
    stageOrder: 1,
    severity: "warning",
    messageKey: "license_required",
    availableActions: ["manage_license"],
    warnings: [],
    raw: {
        ...DEPLOY_STATUS_FALLBACK.raw,
        licenseStatus: "false",
    },
    polling: DEPLOY_STATUS_FALLBACK.polling,
    checkedAt: new Date().toISOString(),
};

function isSuccessCode(code: number | string | undefined): boolean {
    return code === undefined || String(code) === "200" || String(code) === "202";
}

function normalizeString(value: unknown): string {
    return typeof value === "string" || typeof value === "number"
        ? String(value).trim()
        : "";
}

function normalizeNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getApiErrorMessage(
    response: { error?: string; message?: string; val?: unknown },
    fallbackMessage: string
): string {
    if (typeof response.error === "string" && response.error.trim()) {
        return response.error;
    }

    if (typeof response.message === "string" && response.message.trim()) {
        return response.message;
    }

    if (typeof response.val === "string" && response.val.trim()) {
        return response.val;
    }

    return fallbackMessage;
}

function isLicenseRequiredError(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

    return (
        message.includes("active license required") ||
        message.includes("registered license not found") ||
        message.includes("license required") ||
        message.includes("라이센스") ||
        message.includes("라이선스")
    );
}

function mapRawStatus(raw: DeployStatusRawResponse | undefined): DeployStatusRaw {
    return {
        licenseStatus: normalizeString(raw?.license_status),
        clusterConfigStatus: normalizeString(raw?.ccfg_status),
        storageVmStatus: normalizeString(raw?.scvm_status),
        storageVmBootstrapStatus: normalizeString(raw?.scvm_bootstrap_status),
        storageClusterStatus: normalizeString(raw?.sc_status),
        cloudClusterStatus: normalizeString(raw?.cc_status),
        cloudVmStatus: normalizeString(raw?.ccvm_status),
        cloudVmBootstrapStatus: normalizeString(raw?.ccvm_bootstrap_status),
        monitoringStatus: normalizeString(raw?.wall_monitoring_status),
        gfsConfigureStatus: normalizeString(raw?.gfs_configure),
        localConfigureStatus: normalizeString(raw?.local_configure),
        securityPatchStatus: normalizeString(raw?.security_patch),
    };
}

function mapPollingTarget(
    target: DeployPollingTargetResponse | undefined,
    fallbackReason: string
): DeployPollingTarget {
    return {
        enabled: target?.enabled === true,
        reason: normalizeString(target?.reason) || fallbackReason,
    };
}

function mapPollingPolicy(policy: DeployPollingPolicyResponse | undefined): DeployPollingPolicy {
    const fallbackReason = "배포 선행 조건이 완료되지 않았습니다.";

    return {
        storageVm: mapPollingTarget(policy?.storage_vm, fallbackReason),
        storageCluster: mapPollingTarget(policy?.storage_cluster, fallbackReason),
        gfsResource: mapPollingTarget(policy?.gfs_resource, fallbackReason),
        gfsDisk: mapPollingTarget(policy?.gfs_disk, fallbackReason),
        cloudVm: mapPollingTarget(policy?.cloud_vm, fallbackReason),
        cloudCluster: mapPollingTarget(policy?.cloud_cluster, fallbackReason),
        mold: mapPollingTarget(policy?.mold, fallbackReason),
    };
}

function mapDeployStatus(data: DeployStatusDataResponse): DeployStatusData {
    return {
        osType: normalizeString(data.os_type),
        stage: normalizeString(data.stage) || "cluster_prepare",
        stageOrder: normalizeNumber(data.stage_order),
        severity: normalizeString(data.severity) || "warning",
        messageKey: normalizeString(data.message_key),
        availableActions: Array.isArray(data.available_actions)
            ? data.available_actions.map(normalizeString).filter(Boolean)
            : [],
        warnings: Array.isArray(data.warnings)
            ? data.warnings.map((warning) => ({
                key: normalizeString(warning.key),
                message: normalizeString(warning.message),
            })).filter((warning) => warning.key)
            : [],
        raw: mapRawStatus(data.raw),
        polling: mapPollingPolicy(data.polling),
        checkedAt: normalizeString(data.checked_at),
    };
}

function mapDeployRunStep(step: DeployRunStepResultResponse): DeployRunStepResult {
    return {
        name: normalizeString(step.name),
        status: normalizeString(step.status),
        message: normalizeString(step.message),
        startedAt: normalizeString(step.started_at),
        finishedAt: normalizeString(step.finished_at),
        durationMs: normalizeNumber(step.duration_ms),
        ...(step.output !== undefined ? { output: step.output } : {}),
    };
}

function mapDeployRunJob(job: DeployRunJobResponseData): DeployRunJob {
    return {
        jobId: normalizeString(job.job_id),
        status: normalizeString(job.status),
        mode: normalizeString(job.mode),
        osType: normalizeString(job.os_type),
        currentStep: normalizeString(job.current_step),
        message: normalizeString(job.message),
        createdAt: normalizeString(job.created_at),
        startedAt: normalizeString(job.started_at),
        finishedAt: normalizeString(job.finished_at),
        steps: Array.isArray(job.steps) ? job.steps.map(mapDeployRunStep) : [],
    };
}

export async function fetchDeployStatus(): Promise<DeployStatusData> {
    const parsed = await requestCubeApi<DeployStatusResponse>("/api/v1/cube/deploy/status");

    if (!isSuccessCode(parsed.code) || !parsed.data) {
        throw new Error(parsed.message ?? "배포 상태 응답 형식이 올바르지 않습니다.");
    }

    return mapDeployStatus(parsed.data);
}

export async function fetchDeployRunJobs(): Promise<DeployRunJob[]> {
    let parsed: DeployRunJobListResponse;

    try {
        parsed = await requestCubeApi<DeployRunJobListResponse>(
            "/api/v1/cube/deploy/jobs"
        );
    } catch (error) {
        if (isLicenseRequiredError(error)) {
            return [];
        }

        throw error;
    }

    if (!isSuccessCode(parsed.code) || !Array.isArray(parsed.jobs)) {
        if (isLicenseRequiredError(parsed.message ?? "")) {
            return [];
        }

        throw new Error(parsed.message ?? "올인원 배포 Job 목록 응답 형식이 올바르지 않습니다.");
    }

    return parsed.jobs.map(mapDeployRunJob);
}

export async function startDeployRun(
    payload: Record<string, unknown>
): Promise<DeployRunJob> {
    const parsed = await requestCubeApi<DeployRunStartResponse>(
        "/api/v1/cube/deploy/run",
        {
            method: "POST",
            body: payload,
        }
    );

    if (!isSuccessCode(parsed.code) || !parsed.job_id) {
        throw new Error(parsed.message ?? "올인원 배포 Job 시작 응답 형식이 올바르지 않습니다.");
    }

    return mapDeployRunJob({
        job_id: parsed.job_id,
        status: parsed.status,
        message: parsed.message,
        steps: parsed.steps,
    });
}

export async function fetchDeployUrl(option: DeployUrlOption): Promise<string> {
    const parsed = await requestCubeApi<DeployUrlResponse>(
        `/api/v1/cube/url?option=${encodeURIComponent(option)}`
    );

    if (!isSuccessCode(parsed.code)) {
        throw new Error(getApiErrorMessage(parsed, "연결 주소 조회에 실패했습니다."));
    }

    const targetUrl = normalizeString(parsed.val?.[option]);

    if (!targetUrl) {
        throw new Error("연결 주소가 응답에 없습니다.");
    }

    let parsedUrl: URL;

    try {
        parsedUrl = new URL(targetUrl);
    } catch {
        throw new Error("연결 주소 형식이 올바르지 않습니다.");
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error("연결 주소 형식이 올바르지 않습니다.");
    }

    return parsedUrl.href;
}
