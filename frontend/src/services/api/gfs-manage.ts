import { requestCubeApi } from "./client.ts";

export const GFS_STRIPE_SIZES_KIB = [64, 128, 256, 512] as const;
export type GfsStripeSizeKib = typeof GFS_STRIPE_SIZES_KIB[number];

export type GfsManageAction =
  | "get-gfs-settings"
  | "set-gfs-settings"
  | "init-pcs-cluster"
  | "create-gfs"
  | "configure-stonith"
  | "check-ipmi"
  | "set-alert";

export interface GfsManageStonithDevice {
  ipaddr: string;
  ipport?: string;
  login: string;
  passwd: string;
  host?: string;
  hostname?: string;
}

export interface GfsManageTargetResult {
  step?: string;
  hostname: string;
  target: string;
  code: number;
  message: string;
  val?: unknown;
}

export interface GfsManageResult {
  code: number;
  message: string;
  action: string;
  target: string;
  val?: unknown;
  results: GfsManageTargetResult[];
}

interface GfsManageResponse {
  code?: number | string;
  message?: string;
  action?: string;
  target?: string;
  val?: unknown;
  results?: unknown;
}

export class GfsManageError extends Error {
    result: GfsManageResult | null;

    constructor(message: string, result: GfsManageResult | null = null) {
        super(message);
        this.name = "GfsManageError";
        this.result = result;
    }
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

function normalizeTargetResult(value: unknown): GfsManageTargetResult | null {
    if (!isRecord(value)) {
        return null;
    }

    return {
        step: normalizeString(value.step) || undefined,
        hostname: normalizeString(value.hostname),
        target: normalizeString(value.target),
        code: normalizeNumber(value.code),
        message: normalizeString(value.message),
        val: value.val,
    };
}

function normalizeTargetResults(value: unknown): GfsManageTargetResult[] {
    return Array.isArray(value)
        ? value.map(normalizeTargetResult).filter((item): item is GfsManageTargetResult => Boolean(item))
        : [];
}

function normalizeResponse(response: GfsManageResponse): GfsManageResult {
    return {
        code: normalizeNumber(response.code),
        message: normalizeString(response.message),
        action: normalizeString(response.action),
        target: normalizeString(response.target),
        val: response.val,
        results: normalizeTargetResults(response.results),
    };
}

function resultMessage(result: GfsManageResult, fallback: string): string {
    if (result.message) {
        return result.message;
    }

    const failedTarget = result.results.find((target) => target.code !== 200);

    if (failedTarget?.message) {
        return failedTarget.hostname
            ? `${failedTarget.hostname}: ${failedTarget.message}`
            : failedTarget.message;
    }

    if (typeof result.val === "string" && result.val.trim()) {
        return result.val;
    }

    return fallback;
}

async function runGfsManage(
    action: GfsManageAction,
    body: Record<string, unknown>,
    fallbackMessage: string
): Promise<GfsManageResult> {
    const parsed = await requestCubeApi<GfsManageResponse>(
        "/api/v1/cube/gfs/manage",
        {
            method: "POST",
            body: {
                action,
                ...body,
            },
            maxTimeSeconds: 900,
        }
    );
    const result = normalizeResponse(parsed);

    if (result.code !== 200) {
        throw new GfsManageError(resultMessage(result, fallbackMessage), result);
    }

    return result;
}

export function initGfsPcsCluster(disks: string[]): Promise<GfsManageResult> {
    return runGfsManage(
        "init-pcs-cluster",
        {
            disks,
            cluster_name: "cloudcenter_cluster",
            cluster_user: "hacluster",
            cluster_password: "password",
            vg_name: "vg_glue",
            lv_name: "lv_glue",
            volume_groups: [{ vg_name: "vg_glue", lv_name: "lv_glue" }],
        },
        "GFS PCS 클러스터 초기화에 실패했습니다."
    );
}

export function configureGfsStonith(stonith: GfsManageStonithDevice[]): Promise<GfsManageResult> {
    return runGfsManage(
        "configure-stonith",
        { stonith },
        "GFS IPMI STONITH 구성에 실패했습니다."
    );
}

function stripeSizeFromResult(result: GfsManageResult): GfsStripeSizeKib {
    const value = isRecord(result.val) ? Number(result.val.stripe_size_kib) : NaN;
    if (!GFS_STRIPE_SIZES_KIB.some((size) => size === value)) {
        throw new Error("GFS Stripe 크기 설정을 확인할 수 없습니다.");
    }
    return value as GfsStripeSizeKib;
}

export async function fetchGfsStripeSize(): Promise<GfsStripeSizeKib> {
    return stripeSizeFromResult(await runGfsManage("get-gfs-settings", {}, "GFS Stripe 설정을 불러오지 못했습니다."));
}

export async function saveGfsStripeSize(stripeSizeKib: GfsStripeSizeKib): Promise<GfsStripeSizeKib> {
    return stripeSizeFromResult(await runGfsManage("set-gfs-settings", { stripe_size_kib: stripeSizeKib }, "GFS Stripe 설정 저장에 실패했습니다."));
}

export function createGfsStorage(disks: string[], stripeSizeKib: GfsStripeSizeKib = 128): Promise<GfsManageResult> {
    return runGfsManage(
        "create-gfs",
        {
            disks,
            stripe_size_kib: stripeSizeKib,
            cluster_name: "cloudcenter_cluster",
            vg_name: "vg_glue",
            lv_name: "lv_glue",
            gfs_name: "glue-gfs",
            mount_point: "/mnt/glue-gfs",
        },
        "GFS2 파일시스템과 PCS 리소스 생성에 실패했습니다."
    );
}

export function setGfsPcsAlert(): Promise<GfsManageResult> {
    return runGfsManage(
        "set-alert",
        {},
        "GFS PCS 알림 구성을 적용하지 못했습니다."
    );
}
