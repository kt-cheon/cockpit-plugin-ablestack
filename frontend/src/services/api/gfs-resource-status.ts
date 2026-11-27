import { requestCubeApi } from "./client";

export interface GfsResourceStatusData {
  fenceDeviceStatus: string;
  fenceDeviceDetail: string;
  lockDeviceStatus: string;
  lockDeviceDetails: string[];
  gfsDeviceStatus: string;
  gfsDeviceDetails: string[];
  footerMessage: string;
  footerColor: string;
}

interface GfsResourceItem {
  active?: string;
  blocked?: string;
  failed?: string;
  id?: string;
  maintenance?: string;
  managed?: string;
  node_name?: string;
  role?: string;
}

interface GfsResourceStatusResponse {
  code?: number;
  val?: {
    resources?: {
      fence_resources?: GfsResourceItem[];
      glue_locking_resources?: GfsResourceItem[];
      gfs_mount_resources?: GfsResourceItem[];
      glue_gfs_resources?: GfsResourceItem[];
    };
  };
  message?: string;
}

export const GFS_RESOURCE_STATUS_FALLBACK: GfsResourceStatusData = {
  fenceDeviceStatus: "HEALTH_ERR",
  fenceDeviceDetail: "N/A",
  lockDeviceStatus: "HEALTH_ERR",
  lockDeviceDetails: ["N/A"],
  gfsDeviceStatus: "HEALTH_ERR",
  gfsDeviceDetails: ["N/A"],
  footerMessage: "GFS 리소스가 구성되지 않았습니다.",
  footerColor: "#c9190b",
};

function isTrue(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

function resourceRole(resource: GfsResourceItem): string {
  return resource.role ?? "N/A";
}

function isResourceStarted(resource: GfsResourceItem): boolean {
  return isTrue(resource.active) && resourceRole(resource).toLowerCase() === "started";
}

function isResourceWarning(resource: GfsResourceItem): boolean {
  return (
    !isResourceStarted(resource) ||
    isTrue(resource.maintenance) ||
    resource.managed?.toLowerCase() === "false"
  );
}

function resourceHealth(resources: GfsResourceItem[]): string {
  if (resources.length === 0) {
    return "HEALTH_ERR";
  }

  if (resources.some((resource) => isTrue(resource.failed) || isTrue(resource.blocked))) {
    return "HEALTH_ERR";
  }

  if (resources.some(isResourceWarning)) {
    return "HEALTH_WARN";
  }

  return "HEALTH_OK";
}

function uniqueValues(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function roleSummary(resources: GfsResourceItem[]): string {
  if (resources.length === 0) {
    return "N/A";
  }

  const grouped = new Map<string, string[]>();

  for (const resource of resources) {
    const role = resourceRole(resource);
    grouped.set(role, [
      ...(grouped.get(role) ?? []),
      resource.node_name ?? "N/A",
    ]);
  }

  return Array.from(grouped.entries())
    .map(([role, nodes]) => `${role} (${uniqueValues(nodes).join(", ") || "N/A"})`)
    .join(" / ");
}

function groupedRoleSummaries(resources: GfsResourceItem[]): string[] {
  const grouped = new Map<string, GfsResourceItem[]>();

  for (const resource of resources) {
    const id = resource.id ?? "N/A";
    grouped.set(id, [...(grouped.get(id) ?? []), resource]);
  }

  if (grouped.size === 0) {
    return ["N/A"];
  }

  return Array.from(grouped.entries()).map(([id, items]) => `${id} : ${roleSummary(items)}`);
}

function hasHealthyStatus(statuses: string[]): boolean {
  return statuses.every((status) => status === "HEALTH_OK");
}

function hasErrorStatus(statuses: string[]): boolean {
  return statuses.some((status) => status === "HEALTH_ERR");
}

function mapGfsResourceStatus(
  val: NonNullable<GfsResourceStatusResponse["val"]>
): GfsResourceStatusData {
  const fenceResources = val.resources?.fence_resources ?? [];
  const lockingResources = val.resources?.glue_locking_resources ?? [];
  const gfsResources = val.resources?.gfs_mount_resources
    ?? val.resources?.glue_gfs_resources
    ?? [];
  const statuses = [
    resourceHealth(fenceResources),
    resourceHealth(lockingResources),
    resourceHealth(gfsResources),
  ];
  const isHealthy = hasHealthyStatus(statuses);
  const isNotConfigured = fenceResources.length === 0
    || lockingResources.length === 0
    || gfsResources.length === 0;

  return {
    fenceDeviceStatus: statuses[0],
    fenceDeviceDetail: roleSummary(fenceResources),
    lockDeviceStatus: statuses[1],
    lockDeviceDetails: groupedRoleSummaries(lockingResources),
    gfsDeviceStatus: statuses[2],
    gfsDeviceDetails: groupedRoleSummaries(gfsResources),
    footerMessage: isNotConfigured
      ? "GFS 리소스가 구성되지 않았습니다."
      : isHealthy
      ? "GFS 리소스가 구성되었습니다."
      : hasErrorStatus(statuses)
        ? "GFS 리소스에 오류가 있습니다."
        : "GFS 리소스 상태를 확인해 주세요.",
    footerColor: `var(--pf-t--global--text--color--status--${isHealthy ? 'success' : hasErrorStatus(statuses) ? 'danger' : 'warning'}--default)`,
  };
}

export async function fetchGfsResourceStatus(): Promise<GfsResourceStatusData> {
  const parsed = await requestCubeApi<GfsResourceStatusResponse>(
    "/api/v1/cube/gfs/resource/status"
  );

  if (String(parsed.code) !== "200" || !parsed.val) {
    return GFS_RESOURCE_STATUS_FALLBACK;
  }

  return mapGfsResourceStatus(parsed.val);
}
