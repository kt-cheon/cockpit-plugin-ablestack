import { requestCubeApi } from "./client";

export type StorageClusterMaintenanceAction = "set" | "unset";

export interface StorageClusterStatusData {
  clusterStatus: string;
  diskStatus: string;
  gatewayStatus: string;
  daemonStatus: string;
  storagePools: string;
  storageCapacity: string;
  storageTotalCapacity: string;
  storageUsableCapacity: string;
  storageAvailableCapacity: string;
  storageUsedCapacity: string;
  storageUsagePercentage: string;
  maintenanceStatus: boolean;
  healthChecks: StorageClusterHealthCheck[];
}

export interface StorageClusterHealthCheck {
  name: string;
  severity: string;
  summary: string;
  count?: string;
  details: string[];
}

interface GlueHealthCheckSummary {
  message?: string;
  count?: number | string;
}

interface GlueHealthCheckDetail {
  message?: string;
}

interface GlueHealthCheckResponse {
  severity?: string;
  summary?: GlueHealthCheckSummary;
  detail?: Array<GlueHealthCheckDetail | string>;
}

interface GlueHealthChecksResponse {
  [checkName: string]: GlueHealthCheckResponse | undefined;
  MON_DOWN?: GlueHealthCheckResponse;
}

interface GlueClusterStatusResponse {
  cluster_status?: string;
  osd?: number | string;
  osd_up?: number | string;
  mon_gw1?: number | string;
  mon_gw2?: string[] | string;
  mgr?: string;
  mgr_cnt?: number | string;
  pools?: number | string;
  avail?: string;
  size?: string;
  total?: string;
  total_capacity?: string;
  raw_total?: string;
  usable_total?: string;
  usable_total_capacity?: string;
  usable?: string;
  usable_capacity?: string;
  used?: string;
  usage_percentage?: string;
  replica_size?: number | string;
  replication_size?: number | string;
  pool_size?: number | string;
  rbd_replica_size?: number | string;
  total_bytes?: number | string;
  total_capacity_bytes?: number | string;
  total_avail_bytes?: number | string;
  usable_total_bytes?: number | string;
  usable_bytes?: number | string;
  usable_capacity_bytes?: number | string;
  maintenance_status?: boolean;
  json_raw?: {
    quorum_names?: string[] | string;
    monmap?: {
      mons?: Array<{
        name?: string;
      }>;
    };
    health?: {
      status?: string;
      checks?: GlueHealthChecksResponse;
    };
  };
}

interface GlueClusterUpdateResponse {
  code?: number | string;
  val?: unknown;
  message?: string;
  error?: string;
  retname?: string;
}

interface GlueConfigUpdateResponse {
  code?: number | string;
  val?: unknown;
  message?: string;
  error?: string;
  retname?: string;
}

interface StorageCenterUrlResponse {
  code?: number | string;
  val?: {
    storageCenter?: string;
  };
  message?: string;
  error?: string;
}

const GLUE_CLUSTER_MAINTENANCE_ACTION = {
  set: "set_noout",
  unset: "unset_noout",
} as const;

export const STORAGE_CLUSTER_STATUS_FALLBACK: StorageClusterStatusData = {
  clusterStatus: "N/A",
  diskStatus: "N/A",
  gatewayStatus: "N/A",
  daemonStatus: "N/A",
  storagePools: "N/A",
  storageCapacity: "N/A",
  storageTotalCapacity: "N/A",
  storageUsableCapacity: "N/A",
  storageAvailableCapacity: "N/A",
  storageUsedCapacity: "N/A",
  storageUsagePercentage: "N/A",
  maintenanceStatus: false,
  healthChecks: [],
};

const BINARY_SIZE_UNITS: Record<string, number> = {
  B: 1,
  K: 1024,
  KB: 1024,
  KIB: 1024,
  M: 1024 ** 2,
  MB: 1024 ** 2,
  MIB: 1024 ** 2,
  G: 1024 ** 3,
  GB: 1024 ** 3,
  GIB: 1024 ** 3,
  T: 1024 ** 4,
  TB: 1024 ** 4,
  TIB: 1024 ** 4,
  P: 1024 ** 5,
  PB: 1024 ** 5,
  PIB: 1024 ** 5,
};

const DEFAULT_STORAGE_REPLICA_SIZE = 2;

function normalizeValue(value: number | string | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalizedValue = String(value).trim();

  return normalizedValue && normalizedValue !== "N/A" ? normalizedValue : null;
}

function normalizeNumber(value: number | string | undefined): number | null {
  const normalizedValue = normalizeValue(value);

  if (!normalizedValue) {
    return null;
  }

  const numberValue = Number(normalizedValue);

  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeStringList(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }

  const normalizedValue = normalizeValue(value);

  return normalizedValue
    ? normalizedValue.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
}

function parseBinarySizeBytes(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/(-?\d+(?:\.\d+)?)\s*([kmgtp]?i?b?|b)\b/i);

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2].toUpperCase();
  const multiplier = BINARY_SIZE_UNITS[unit];

  if (!Number.isFinite(amount) || !multiplier) {
    return null;
  }

  return amount * multiplier;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "N/A";
  }

  const units = [
    { label: "PiB", value: 1024 ** 5 },
    { label: "TiB", value: 1024 ** 4 },
    { label: "GiB", value: 1024 ** 3 },
    { label: "MiB", value: 1024 ** 2 },
    { label: "KiB", value: 1024 },
  ];
  const selectedUnit = units.find((unit) => bytes >= unit.value) ?? units[units.length - 1];
  const unitValue = bytes / selectedUnit.value;
  const precision = unitValue >= 100 ? 1 : 2;
  const formattedValue = unitValue
    .toFixed(precision)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*[1-9])0+$/, "$1");

  return `${formattedValue} ${selectedUnit.label}`;
}

function normalizeBytesNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const bytes = Number(value);

  return Number.isFinite(bytes) ? bytes : null;
}

function normalizeBytesValue(value: unknown): string | null {
  const bytes = normalizeBytesNumber(value);

  return bytes !== null ? formatBytes(bytes) : null;
}

function readCapacityValue(
  response: GlueClusterStatusResponse,
  textKeys: string[],
  byteKeys: string[]
): string | null {
  const record = response as Record<string, unknown>;

  for (const key of textKeys) {
    const normalizedValue = normalizeValue(record[key] as string | number | undefined);

    if (normalizedValue) {
      return normalizedValue;
    }
  }

  for (const key of byteKeys) {
    const normalizedValue = normalizeBytesValue(record[key]);

    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return null;
}

function readCapacityBytes(
  response: GlueClusterStatusResponse,
  textKeys: string[],
  byteKeys: string[]
): number | null {
  const record = response as Record<string, unknown>;

  for (const key of byteKeys) {
    const normalizedValue = normalizeBytesNumber(record[key]);

    if (normalizedValue !== null) {
      return normalizedValue;
    }
  }

  for (const key of textKeys) {
    const parsedValue = parseBinarySizeBytes(
      normalizeValue(record[key] as string | number | undefined)
    );

    if (parsedValue !== null) {
      return parsedValue;
    }
  }

  return null;
}

function storageRawTotalBytes(response: GlueClusterStatusResponse): number | null {
  const explicitTotalBytes = readCapacityBytes(
    response,
    ["total", "total_capacity", "raw_total", "size"],
    ["total_bytes", "total_capacity_bytes"]
  );

  if (explicitTotalBytes !== null) {
    return explicitTotalBytes;
  }

  const availableBytes = parseBinarySizeBytes(normalizeValue(response.avail));
  const usedBytes = parseBinarySizeBytes(normalizeValue(response.used));

  return availableBytes !== null && usedBytes !== null
    ? availableBytes + usedBytes
    : null;
}

function storageReplicaSize(response: GlueClusterStatusResponse): number {
  const record = response as Record<string, unknown>;
  const rawValue = [
    "replica_size",
    "replication_size",
    "pool_size",
    "rbd_replica_size",
  ]
    .map((key) => Number(record[key]))
    .find((value) => Number.isFinite(value) && value > 0);

  return rawValue ?? DEFAULT_STORAGE_REPLICA_SIZE;
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values));
}

function formatDiskStatus(response: GlueClusterStatusResponse): string {
  const osd = normalizeValue(response.osd);
  const osdUp = normalizeValue(response.osd_up);

  return osd && osdUp
    ? `전체 ${osd}개의 디스크 중 ${osdUp}개 작동 중`
    : "N/A";
}

function getAllGatewayNodes(response: GlueClusterStatusResponse): string[] {
  return uniqueValues(
    response.json_raw?.monmap?.mons
      ?.map((monitor) => monitor.name?.trim())
      .filter((name): name is string => Boolean(name)) ?? []
  );
}

function formatMissingQuorumStatus(
  gatewayCount: number,
  quorumNodes: string[],
  allGatewayNodes: string[]
): string {
  const quorumNodeSet = new Set(quorumNodes);
  const missingQuorumNodes = allGatewayNodes.filter((node) => !quorumNodeSet.has(node));

  if (missingQuorumNodes.length > 0) {
    return ` / quorum 누락 : ${missingQuorumNodes.join(", ")}`;
  }

  const missingQuorumCount = gatewayCount - quorumNodes.length;

  return missingQuorumCount > 0
    ? ` / quorum 누락 : ${missingQuorumCount}개`
    : "";
}

function formatGatewayStatus(response: GlueClusterStatusResponse): string {
  const gatewayCount = normalizeNumber(response.mon_gw1);
  const responseQuorumNodes = normalizeStringList(response.mon_gw2);
  const quorumNodes = uniqueValues(
    responseQuorumNodes.length > 0
      ? responseQuorumNodes
      : normalizeStringList(response.json_raw?.quorum_names)
  );

  if (gatewayCount === null || quorumNodes.length === 0) {
    return "N/A";
  }

  const monDownCount =
    normalizeNumber(response.json_raw?.health?.checks?.MON_DOWN?.summary?.count) ?? 0;
  const activeGatewayCount = Math.max(gatewayCount - monDownCount, 0);

  return [
    `RBD GW ${activeGatewayCount}개 실행 중`,
    `${gatewayCount}개 제공 중 (quorum : ${quorumNodes.join(", ")}${formatMissingQuorumStatus(
      gatewayCount,
      quorumNodes,
      getAllGatewayNodes(response)
    )})`,
  ].join(" / ");
}

function formatDaemonStatus(response: GlueClusterStatusResponse): string {
  const manager = normalizeValue(response.mgr);
  const managerCount = normalizeValue(response.mgr_cnt);

  return manager && managerCount
    ? `${manager} (전체 ${managerCount}개 실행중)`
    : "N/A";
}

function formatStoragePools(pools: number | string | undefined): string {
  const poolCount = normalizeValue(pools);

  return poolCount ? `${poolCount} pools` : "N/A";
}

function formatUsagePercentage(usagePercentage: string | undefined): string | null {
  const normalizedUsagePercentage = normalizeValue(usagePercentage);

  if (!normalizedUsagePercentage) {
    return null;
  }

  return normalizedUsagePercentage.includes("%")
    ? normalizedUsagePercentage
    : `${normalizedUsagePercentage} %`;
}

function formatStorageCapacity(response: GlueClusterStatusResponse): string {
  const total = formatStorageTotalCapacity(response);
  const available = formatStorageUsableCapacity(response);
  const used = formatStorageUsedCapacity(response);
  const usagePercentage = formatUsagePercentage(response.usage_percentage);

  return total && available && used && usagePercentage
    ? `전체 ${total} 중 ${used} 사용 중 (Usable ${available} / 사용률 ${usagePercentage})`
    : "N/A";
}

function formatStorageTotalCapacity(response: GlueClusterStatusResponse): string {
  const explicitTotal = readCapacityValue(
    response,
    ["total", "total_capacity", "raw_total", "size"],
    ["total_bytes", "total_capacity_bytes"]
  );

  if (explicitTotal) {
    return explicitTotal;
  }

  const totalBytes = storageRawTotalBytes(response);

  return totalBytes !== null
    ? formatBytes(totalBytes)
    : "N/A";
}

function formatStorageUsableCapacity(response: GlueClusterStatusResponse): string {
  const explicitUsable = readCapacityValue(
    response,
    ["usable_total", "usable_total_capacity", "usable", "usable_capacity"],
    ["usable_total_bytes", "usable_bytes", "usable_capacity_bytes"]
  );

  if (explicitUsable) {
    return explicitUsable;
  }

  const totalBytes = storageRawTotalBytes(response);
  const replicaSize = storageReplicaSize(response);

  return totalBytes !== null
    ? `${formatBytes(totalBytes / replicaSize)} (${replicaSize}복제 기준)`
    : "N/A";
}

function formatStorageUsedCapacity(response: GlueClusterStatusResponse): string {
  const usedBytes = parseBinarySizeBytes(normalizeValue(response.used));

  if (usedBytes === null) {
    return "N/A";
  }

  return formatBytes(usedBytes / storageReplicaSize(response));
}

function formatStorageAvailableCapacity(response: GlueClusterStatusResponse): string {
  const availableBytes = parseBinarySizeBytes(normalizeValue(response.avail));

  if (availableBytes === null) {
    return "N/A";
  }

  return formatBytes(availableBytes / storageReplicaSize(response));
}

function formatHealthCheckDetail(detail: GlueHealthCheckDetail | string): string | null {
  if (typeof detail === "string") {
    const normalizedDetail = detail.trim();

    return normalizedDetail || null;
  }

  return normalizeValue(detail.message);
}

function formatHealthChecks(
  checks: GlueHealthChecksResponse | undefined
): StorageClusterHealthCheck[] {
  if (!checks) {
    return [];
  }

  return Object.entries(checks)
    .map(([name, check]) => {
      if (!check) {
        return null;
      }

      const summary = normalizeValue(check.summary?.message) ?? "N/A";
      const count = normalizeValue(check.summary?.count);
      const severity = normalizeValue(check.severity) ?? "N/A";
      const details = check.detail
        ?.map(formatHealthCheckDetail)
        .filter((detail): detail is string => Boolean(detail)) ?? [];

      return {
        name,
        severity,
        summary,
        ...(count ? { count } : {}),
        details,
      };
    })
    .filter((check): check is StorageClusterHealthCheck => Boolean(check));
}

function mapGlueClusterStatus(response: GlueClusterStatusResponse): StorageClusterStatusData {
  return {
    clusterStatus: response.cluster_status ?? response.json_raw?.health?.status ?? "N/A",
    diskStatus: formatDiskStatus(response),
    gatewayStatus: formatGatewayStatus(response),
    daemonStatus: formatDaemonStatus(response),
    storagePools: formatStoragePools(response.pools),
    storageCapacity: formatStorageCapacity(response),
    storageTotalCapacity: formatStorageTotalCapacity(response),
    storageUsableCapacity: formatStorageUsableCapacity(response),
    storageAvailableCapacity: formatStorageAvailableCapacity(response),
    storageUsedCapacity: formatStorageUsedCapacity(response),
    storageUsagePercentage: formatUsagePercentage(response.usage_percentage) ?? "N/A",
    maintenanceStatus: response.maintenance_status ?? false,
    healthChecks: formatHealthChecks(response.json_raw?.health?.checks),
  };
}

export async function fetchStorageClusterStatus(): Promise<StorageClusterStatusData> {
  const parsed = await requestCubeApi<GlueClusterStatusResponse>(
    "/api/v1/cube/gluecluster/status"
  );

  return mapGlueClusterStatus(parsed);
}

function getGlueClusterUpdateError(response: GlueClusterUpdateResponse): string {
  if (typeof response.error === "string" && response.error.trim()) {
    return response.error;
  }

  if (typeof response.message === "string" && response.message.trim()) {
    return response.message;
  }

  if (typeof response.val === "string" && response.val.trim()) {
    return response.val;
  }

  return "스토리지 클러스터 유지보수 모드 변경 요청에 실패했습니다.";
}

function getApiErrorMessage(response: {
  error?: string;
  message?: string;
  val?: unknown;
}, fallbackMessage: string): string {
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

export async function updateStorageClusterMaintenanceMode(
  mode: StorageClusterMaintenanceAction
): Promise<GlueClusterUpdateResponse> {
  const parsed = await requestCubeApi<GlueClusterUpdateResponse>(
    "/api/v1/cube/gluecluster/update",
    {
      method: "POST",
      body: {
        action: GLUE_CLUSTER_MAINTENANCE_ACTION[mode],
      },
    }
  );

  if (parsed.code !== undefined && String(parsed.code) !== "200") {
    throw new Error(getGlueClusterUpdateError(parsed));
  }

  return parsed;
}

export async function updateGlueConfigAllHosts(): Promise<GlueConfigUpdateResponse> {
  const parsed = await requestCubeApi<GlueConfigUpdateResponse>(
    "/api/v1/cube/glue/config/update",
    {
      method: "POST",
      body: {
        action: "update",
      },
    }
  );

  if (parsed.code !== undefined && String(parsed.code) !== "200") {
    throw new Error(getApiErrorMessage(
      parsed,
      "전체 호스트 Glue 설정 업데이트에 실패했습니다."
    ));
  }

  return parsed;
}

export async function fetchStorageCenterUrl(): Promise<string> {
  const parsed = await requestCubeApi<StorageCenterUrlResponse>(
    "/api/v1/cube/url?option=storageCenter"
  );

  if (parsed.code !== undefined && String(parsed.code) !== "200") {
    throw new Error(getApiErrorMessage(
      parsed,
      "스토리지센터 연결 주소 조회에 실패했습니다."
    ));
  }

  const storageCenterUrl = normalizeValue(parsed.val?.storageCenter);

  if (!storageCenterUrl) {
    throw new Error("스토리지센터 연결 주소가 응답에 없습니다.");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(storageCenterUrl);
  } catch {
    throw new Error("스토리지센터 연결 주소 형식이 올바르지 않습니다.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("스토리지센터 연결 주소 형식이 올바르지 않습니다.");
  }

  return parsedUrl.href;
}
