import { requestCubeApi } from "./client.ts";

export interface MoldBootstrapForm {
  adminUsername: string;
  adminPassword: string;
  adminDomain: string;
  zoneName: string;
  dns1: string;
  dns2: string;
  internalDns1: string;
  internalDns2: string;
  guestCidr: string;
  domain: string;
  physicalNetworkName: string;
  networkSpeed: string;
  podName: string;
  podGateway: string;
  podNetmask: string;
  podStartIp: string;
  podEndIp: string;
  publicGateway: string;
  publicNetmask: string;
  publicStartIp: string;
  publicEndIp: string;
  clusterName: string;
  primaryStorageUrl: string;
  primaryStorageProvider: string;
}

export interface MoldBootstrapPlanStep {
  name: string;
  command: string;
  verifyCommand: string;
  resultKey: string;
  requiredInputs: string[];
  missingInputs: string[];
  notes: string[];
}

export interface MoldBootstrapPlan {
  ready: boolean;
  steps: MoldBootstrapPlanStep[];
  missingInputs: string[];
  notes: string[];
}

export interface MoldBootstrapJobStep {
  name: string;
  command: string;
  verifyCommand: string;
  status: string;
  message: string;
}

export interface MoldBootstrapJob {
  jobId: string;
  status: string;
  currentStep: string;
  message: string;
  steps: MoldBootstrapJobStep[];
}

interface MoldResponse {
  code?: number | string;
  message?: string;
  val?: unknown;
}

interface MoldBootstrapStartResponse {
  code?: number | string;
  job_id?: string;
  status?: string;
  message?: string;
  steps?: unknown;
}

interface MoldBootstrapJobResponse {
  code?: number | string;
  message?: string;
  job?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
    return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
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
    return code === undefined || String(code) === "200" || String(code) === "202";
}

function responseMessage(response: { message?: string; val?: unknown }, fallback: string): string {
    if (typeof response.message === "string" && response.message.trim()) {
        return response.message;
    }

    if (typeof response.val === "string" && response.val.trim()) {
        return response.val;
    }

    return fallback;
}

function normalizePlanStep(value: unknown): MoldBootstrapPlanStep | null {
    if (!isRecord(value)) {
        return null;
    }

    return {
        name: normalizeString(value.name),
        command: normalizeString(value.command),
        verifyCommand: normalizeString(readAlias(value, ["verifyCommand", "verify_command"])),
        resultKey: normalizeString(readAlias(value, ["resultKey", "result_key"])),
        requiredInputs: normalizeStringArray(readAlias(value, ["requiredInputs", "required_inputs"])),
        missingInputs: normalizeStringArray(readAlias(value, ["missingInputs", "missing_inputs"])),
        notes: normalizeStringArray(value.notes),
    };
}

function normalizePlan(value: unknown): MoldBootstrapPlan {
    const source = isRecord(value) ? value : {};

    return {
        ready: source.ready === true || normalizeString(source.ready).toLowerCase() === "true",
        steps: Array.isArray(source.steps)
            ? source.steps.map(normalizePlanStep).filter((item): item is MoldBootstrapPlanStep => Boolean(item))
            : [],
        missingInputs: normalizeStringArray(readAlias(source, ["missingInputs", "missing_inputs"])),
        notes: normalizeStringArray(source.notes),
    };
}

function normalizeJobStep(value: unknown): MoldBootstrapJobStep | null {
    if (!isRecord(value)) {
        return null;
    }

    return {
        name: normalizeString(value.name),
        command: normalizeString(value.command),
        verifyCommand: normalizeString(readAlias(value, ["verifyCommand", "verify_command"])),
        status: normalizeString(value.status),
        message: normalizeString(value.message),
    };
}

function normalizeJob(value: unknown): MoldBootstrapJob {
    const source = isRecord(value) ? value : {};

    return {
        jobId: normalizeString(readAlias(source, ["jobId", "job_id"])),
        status: normalizeString(source.status),
        currentStep: normalizeString(readAlias(source, ["currentStep", "current_step"])),
        message: normalizeString(source.message),
        steps: Array.isArray(source.steps)
            ? source.steps.map(normalizeJobStep).filter((item): item is MoldBootstrapJobStep => Boolean(item))
            : [],
    };
}

function bootstrapPayload(form: MoldBootstrapForm): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        auth: {
            username: form.adminUsername.trim() || "admin",
            password: form.adminPassword,
            domain: form.adminDomain.trim() || "/",
            response: "json",
        },
        zone: {
            name: form.zoneName.trim() || "Zone",
            dns1: form.dns1.trim(),
            dns2: form.dns2.trim(),
            internaldns1: form.internalDns1.trim(),
            internaldns2: form.internalDns2.trim(),
            networktype: "Advanced",
            guestcidraddress: form.guestCidr.trim(),
            domain: form.domain.trim(),
            localstorageenabled: "false",
            securitygroupenabled: "false",
        },
        physical_network: {
            name: form.physicalNetworkName.trim() || "Physicalnetwork",
            broadcastdomainrange: "Zone",
            isolationmethods: "VLAN",
            networkspeed: form.networkSpeed.trim(),
            tags: "guest",
        },
        pod: {
            name: form.podName.trim() || "Pod",
            gateway: form.podGateway.trim(),
            netmask: form.podNetmask.trim(),
            startip: form.podStartIp.trim(),
            endip: form.podEndIp.trim(),
        },
        public_ip: {
            gateway: form.publicGateway.trim(),
            netmask: form.publicNetmask.trim(),
            startip: form.publicStartIp.trim(),
            endip: form.publicEndIp.trim(),
        },
        cluster: {
            name: form.clusterName.trim() || "Cluster",
            clustertype: "CloudManaged",
            hypervisor: "KVM",
            arch: "x86_64",
        },
        primary_storage: {
            url: form.primaryStorageUrl.trim(),
            provider: form.primaryStorageProvider.trim() || "DefaultPrimary",
        },
    };

    return payload;
}

export function defaultMoldBootstrapForm(): MoldBootstrapForm {
    return {
        adminUsername: "admin",
        adminPassword: "password",
        adminDomain: "/",
        zoneName: "Zone",
        dns1: "8.8.8.8",
        dns2: "",
        internalDns1: "8.8.8.8",
        internalDns2: "",
        guestCidr: "10.1.1.0/24",
        domain: "",
        physicalNetworkName: "Physicalnetwork",
        networkSpeed: "10G",
        podName: "Pod",
        podGateway: "",
        podNetmask: "",
        podStartIp: "",
        podEndIp: "",
        publicGateway: "",
        publicNetmask: "",
        publicStartIp: "",
        publicEndIp: "",
        clusterName: "Cluster",
        primaryStorageUrl: "",
        primaryStorageProvider: "DefaultPrimary",
    };
}

export async function fetchMoldBootstrapPlan(form: MoldBootstrapForm): Promise<MoldBootstrapPlan> {
    const parsed = await requestCubeApi<MoldResponse>(
        "/api/v1/mold/bootstrap/plan",
        {
            method: "POST",
            body: bootstrapPayload(form),
            maxTimeSeconds: 60,
        }
    );

    if (!isSuccessCode(parsed.code)) {
        throw new Error(responseMessage(parsed, "클라우드 리소스 구성 계획 확인에 실패했습니다."));
    }

    return normalizePlan(parsed.val);
}

export async function startMoldBootstrap(form: MoldBootstrapForm): Promise<MoldBootstrapJob> {
    const parsed = await requestCubeApi<MoldBootstrapStartResponse>(
        "/api/v1/mold/bootstrap",
        {
            method: "POST",
            body: bootstrapPayload(form),
            maxTimeSeconds: 60,
        }
    );

    if (!isSuccessCode(parsed.code) || !parsed.job_id) {
        throw new Error(responseMessage(parsed, "클라우드 리소스 구성 Job 시작에 실패했습니다."));
    }

    return normalizeJob({
        job_id: parsed.job_id,
        status: parsed.status,
        message: parsed.message,
        steps: parsed.steps,
    });
}

export async function fetchMoldBootstrapJob(jobId: string): Promise<MoldBootstrapJob> {
    const parsed = await requestCubeApi<MoldBootstrapJobResponse>(
        `/api/v1/mold/jobs/${encodeURIComponent(jobId)}`
    );

    if (!isSuccessCode(parsed.code)) {
        throw new Error(responseMessage(parsed, "클라우드 리소스 구성 Job 조회에 실패했습니다."));
    }

    return normalizeJob(parsed.job);
}
