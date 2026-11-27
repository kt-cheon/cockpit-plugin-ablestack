import { requestCubeApi } from "./client";

export interface GfsDiskMountInfo {
  mountPath: string;
  status: string;
  devices: string;
  multipaths: string;
  uuid: string;
  physicalVolume: string;
  volumeGroup: string;
  diskSize: string;
  totalCapacity: string;
  usedCapacity: string;
  availableCapacity: string;
  usagePercentage: string;
  resourceStatus: string[];
}

export interface GfsDiskStatusData {
  mode: string;
  mountPath: string;
  mountDetails: GfsDiskMountInfo[];
  footerMessage: string;
  footerColor: string;
}

interface GfsDiskBlockDevice {
  lvm?: string;
  mountpoint?: string;
  size?: string;
  disk_size?: string;
  total?: string;
  total_capacity?: string;
  capacity?: string;
  used?: string;
  used_capacity?: string;
  used_size?: string;
  available?: string;
  available_capacity?: string;
  avail?: string;
  avail_capacity?: string;
  free?: string;
  free_capacity?: string;
  usage_percentage?: string;
  use_percent?: string;
  usagePercent?: string;
  used_percentage?: string;
  used_percent?: string;
  use_rate?: string;
  usage_rate?: string;
  multipaths?: string[];
  devices?: string[];
  disk_id?: string[];
}

interface GfsDiskStatusResponse {
  code?: number | string;
  val?: {
    mode?: string;
    blockdevices?: GfsDiskBlockDevice[];
    message?: string;
  };
  message?: string;
}

interface GfsResourceItem {
  id?: string;
  node_name?: string;
  role?: string;
}

interface GfsResourceStatusResponse {
  code?: number | string;
  val?: {
    resources?: {
      glue_gfs_resources?: GfsResourceItem[];
    };
  };
}

export const GFS_DISK_STATUS_FALLBACK: GfsDiskStatusData = {
  mode: "N/A",
  mountPath: "",
  mountDetails: [],
  footerMessage: "GFS 디스크 상태 정보를 확인할 수 없습니다.",
  footerColor: "#f0ab00",
};

const GFS_DISK_STATUS_UNCONFIGURED: GfsDiskStatusData = {
  mode: "N/A",
  mountPath: "",
  mountDetails: [],
  footerMessage: "GFS 디스크가 생성되지 않았습니다.",
  footerColor: "#c9190b",
};

function isSuccessCode(code: number | string | undefined): boolean {
  return Number(code) === 200;
}

function formatMode(mode: string | undefined): string {
  switch (mode?.toLowerCase()) {
  case "multi":
    return "다중 모드";
  case "single":
    return "단일 모드";
  default:
    return mode?.trim() || "N/A";
  }
}

function formatList(values: string[] | undefined): string {
  const normalizedValues = values
    ?.map((value) => value.trim())
    .filter(Boolean) ?? [];

  return normalizedValues.length > 0 ? normalizedValues.join(", ") : "N/A";
}

function formatFirstListValue(values: string[] | undefined): string {
  return values
    ?.map((value) => value.trim())
    .find(Boolean) ?? "N/A";
}

function formatSize(size: string | undefined): string {
  const normalizedSize = size?.trim();

  if (!normalizedSize) {
    return "N/A";
  }

  if (/^\d+(?:\.\d+)?\s*[kmgtpe]$/i.test(normalizedSize)) {
    return `${normalizedSize}B`;
  }

  return normalizedSize;
}

function firstKnownValue(...values: Array<string | undefined>): string | undefined {
  return values
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value) && value.toUpperCase() !== "N/A");
}

function formatPercent(value: string | undefined): string {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return "N/A";
  }

  const numericMatch = normalizedValue.match(/^(\d+(?:\.\d+)?)$/);

  if (numericMatch) {
    return `${numericMatch[1]}%`;
  }

  return normalizedValue;
}

function parseSizeBytes(value: string | undefined): number | null {
  const normalizedValue = value?.trim();

  if (!normalizedValue || normalizedValue.toUpperCase() === "N/A") {
    return null;
  }

  const match = normalizedValue.match(/^(\d+(?:\.\d+)?)\s*([kmgtpe]?i?b?|bytes?)$/i);

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase().replace(/bytes?/, "b");
  const normalizedUnit = unit === "" || unit === "b" ? "b" : unit;
  const multipliers: Record<string, number> = {
    b: 1,
    k: 1024,
    kb: 1024,
    kib: 1024,
    m: 1024 ** 2,
    mb: 1024 ** 2,
    mib: 1024 ** 2,
    g: 1024 ** 3,
    gb: 1024 ** 3,
    gib: 1024 ** 3,
    t: 1024 ** 4,
    tb: 1024 ** 4,
    tib: 1024 ** 4,
    p: 1024 ** 5,
    pb: 1024 ** 5,
    pib: 1024 ** 5,
    e: 1024 ** 6,
    eb: 1024 ** 6,
    eib: 1024 ** 6,
  };
  const multiplier = multipliers[normalizedUnit];

  if (!Number.isFinite(amount) || !multiplier) {
    return null;
  }

  return amount * multiplier;
}

function deriveUsagePercentage(used: string | undefined, total: string | undefined, available: string | undefined): string {
  const usedBytes = parseSizeBytes(used);
  const totalBytes = parseSizeBytes(total);

  if (usedBytes !== null && totalBytes !== null && totalBytes > 0) {
    return `${Math.round((usedBytes / totalBytes) * 100)}%`;
  }

  const availableBytes = parseSizeBytes(available);

  if (usedBytes !== null && availableBytes !== null && usedBytes + availableBytes > 0) {
    return `${Math.round((usedBytes / (usedBytes + availableBytes)) * 100)}%`;
  }

  return "N/A";
}

function uniqueValues(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function mountResourceId(mountPath: string): string {
  const mountPathSegments = mountPath.split("/").filter(Boolean);

  return mountPathSegments[mountPathSegments.length - 1] ?? mountPath;
}

function groupedResourceStatus(resources: GfsResourceItem[]): string[] {
  if (resources.length === 0) {
    return ["N/A"];
  }

  const grouped = new Map<string, string[]>();

  for (const resource of resources) {
    const role = resource.role ?? "N/A";
    grouped.set(role, [
      ...(grouped.get(role) ?? []),
      resource.node_name ?? "N/A",
    ]);
  }

  return Array.from(grouped.entries()).map(([role, nodes]) => (
    `${role} ( ${uniqueValues(nodes).join(", ") || "N/A"} )`
  ));
}

async function fetchGfsResourceStatusMap(): Promise<Map<string, string[]>> {
  const parsed = await requestCubeApi<GfsResourceStatusResponse>(
    "/api/v1/cube/gfs/resource/status"
  );
  const resources = isSuccessCode(parsed.code)
    ? parsed.val?.resources?.glue_gfs_resources ?? []
    : [];
  const grouped = new Map<string, GfsResourceItem[]>();

  for (const resource of resources) {
    const id = resource.id ?? "N/A";
    grouped.set(id, [...(grouped.get(id) ?? []), resource]);
  }

  const statusMap = new Map<string, string[]>();

  for (const [id, items] of grouped.entries()) {
    const statuses = groupedResourceStatus(items);
    statusMap.set(id, statuses);
    statusMap.set(mountResourceId(id), statuses);
  }

  return statusMap;
}

function mapBlockDevice(
  blockDevice: GfsDiskBlockDevice,
  resourceStatusMap: Map<string, string[]>
): GfsDiskMountInfo {
  const lvm = blockDevice.lvm?.trim() || "N/A";
  const mountPath = blockDevice.mountpoint?.trim() || "N/A";
  const totalCapacity = formatSize(firstKnownValue(
    blockDevice.total,
    blockDevice.total_capacity,
    blockDevice.capacity,
    blockDevice.disk_size,
    blockDevice.size
  ));
  const usedCapacity = formatSize(firstKnownValue(
    blockDevice.used,
    blockDevice.used_capacity,
    blockDevice.used_size
  ));
  const availableCapacity = formatSize(firstKnownValue(
    blockDevice.available,
    blockDevice.available_capacity,
    blockDevice.avail,
    blockDevice.avail_capacity,
    blockDevice.free,
    blockDevice.free_capacity
  ));
  const usagePercentage = formatPercent(firstKnownValue(
    blockDevice.usage_percentage,
    blockDevice.use_percent,
    blockDevice.usagePercent,
    blockDevice.used_percentage,
    blockDevice.used_percent,
    blockDevice.use_rate,
    blockDevice.usage_rate
  ));

  return {
    mountPath,
    status: "Health OK",
    devices: formatList(blockDevice.devices),
    multipaths: formatList(blockDevice.multipaths),
    uuid: formatFirstListValue(blockDevice.disk_id),
    physicalVolume: lvm,
    volumeGroup: lvm,
    diskSize: totalCapacity,
    totalCapacity,
    usedCapacity,
    availableCapacity,
    usagePercentage: usagePercentage !== "N/A"
      ? usagePercentage
      : deriveUsagePercentage(usedCapacity, totalCapacity, availableCapacity),
    resourceStatus: resourceStatusMap.get(mountResourceId(mountPath)) ?? ["N/A"],
  };
}

function mapGfsDiskStatus(
  val: NonNullable<GfsDiskStatusResponse["val"]>,
  resourceStatusMap: Map<string, string[]>
): GfsDiskStatusData {
  const mountDetails = (val.blockdevices ?? []).map((blockDevice) => (
    mapBlockDevice(blockDevice, resourceStatusMap)
  ));

  if (mountDetails.length === 0) {
    return GFS_DISK_STATUS_UNCONFIGURED;
  }

  return {
    mode: formatMode(val.mode),
    mountPath: mountDetails.map((mountInfo) => mountInfo.mountPath).join(", "),
    mountDetails,
    footerMessage: "GFS 디스크가 생성되었습니다.",
    footerColor: "var(--pf-t--global--text--color--status--success--default)",
  };
}

export async function fetchGfsDiskStatus(): Promise<GfsDiskStatusData> {
  const [parsed, resourceStatusMap] = await Promise.all([
    requestCubeApi<GfsDiskStatusResponse>("/api/v1/cube/gfs/disk/status"),
    fetchGfsResourceStatusMap().catch(() => new Map<string, string[]>()),
  ]);

  if (parsed.code !== undefined && !isSuccessCode(parsed.code)) {
    return GFS_DISK_STATUS_UNCONFIGURED;
  }

  if (!parsed.val) {
    throw new Error(parsed.message ?? "Invalid GFS disk status response");
  }

  return mapGfsDiskStatus(parsed.val, resourceStatusMap);
}
