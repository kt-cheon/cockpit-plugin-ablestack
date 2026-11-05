import { requestCubeApi } from "./client";
import { formatKibToBinaryUnit } from "./units";

export interface CloudVmStatusData {
  vmStatus: string;
  moldServiceStatus: string;
  moldDbStatus: string;
  cpu: string;
  memory: string;
  rootDiskSize: string;
  secondaryDiskSize: string;
  manageNicType: string;
  manageNicIp: string;
  manageNicPrefix: string;
  manageNicGw: string;
  manageNicDns: string;
}

interface CcvmStatusResponse {
  code?: number;
  data?: Record<string, unknown>;
  message?: string;
}

export const CLOUD_VM_STATUS_FALLBACK: CloudVmStatusData = {
  vmStatus: "N/A",
  moldServiceStatus: "N/A",
  moldDbStatus: "N/A",
  cpu: "N/A",
  memory: "N/A",
  rootDiskSize: "N/A",
  secondaryDiskSize: "N/A",
  manageNicType: "N/A",
  manageNicIp: "N/A",
  manageNicPrefix: "N/A",
  manageNicGw: "N/A",
  manageNicDns: "N/A",
};

function readString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return null;
}

function readFirstString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = readString(data, key);

    if (value) {
      return value;
    }
  }

  return null;
}

function normalizeVmStatus(status: string | null): string {
  const normalized = status?.toLowerCase();

  if (normalized === "running") {
    return "running";
  }

  if (
    normalized === "shutoff" ||
    normalized === "shut off" ||
    normalized === "stopped"
  ) {
    return "shutOff";
  }

  return status ?? "N/A";
}

function formatCpu(cpu: string | null): string {
  if (!cpu) {
    return "N/A";
  }

  return /^\d+$/.test(cpu) ? `${cpu} vCore` : cpu;
}

function formatMemory(data: Record<string, unknown>): string {
  const maxMemory = formatKibToBinaryUnit(readString(data, "Max memory"));
  const usedMemory = formatKibToBinaryUnit(readString(data, "Used memory"));

  return maxMemory ?? usedMemory ?? "N/A";
}

function formatServiceStatus(status: string | null): string {
  switch (status?.toLowerCase()) {
  case "active":
  case "running":
    return "실행중";
  case "inactive":
  case "stopped":
  case "shutoff":
  case "shut off":
    return "중지";
  case "failed":
    return "실패";
  case "activating":
    return "시작중";
  case "deactivating":
    return "중지중";
  default:
    return status ?? "N/A";
  }
}

function formatDisk(
  data: Record<string, unknown>,
  capacityKey: string,
  allocatedKey: string,
  availableKey: string,
  usageRateKey: string
): string {
  const capacity = readString(data, capacityKey);
  const allocated = readString(data, allocatedKey);
  const available = readString(data, availableKey);
  const usageRate = readString(data, usageRateKey);
  const details = [
    allocated ? `사용 ${allocated}` : null,
    available ? `사용가능 ${available}` : null,
    usageRate ? `사용률 ${usageRate}` : null,
  ].filter(Boolean);

  if (capacity && details.length > 0) {
    return `${capacity} (${details.join(" / ")})`;
  }

  return capacity ?? "N/A";
}

function formatNicType(data: Record<string, unknown>): string {
  const nicType = readString(data, "nictype");
  const nicBridge = readString(data, "nicbridge");

  if (nicType && nicBridge) {
    return `NIC Type : ${nicType} (Parent : ${nicBridge})`;
  }

  if (nicType) {
    return `NIC Type : ${nicType}`;
  }

  if (nicBridge) {
    return `Parent : ${nicBridge}`;
  }

  return "N/A";
}

function prefixValue(label: string, value: string | null): string {
  return value ? `${label} : ${value}` : "N/A";
}

function mapCcvmStatus(data: Record<string, unknown>): CloudVmStatusData {
  return {
    vmStatus: normalizeVmStatus(readString(data, "State")),
    moldServiceStatus:
      formatServiceStatus(readFirstString(data, ["MOLD_SERVICE_STATUE", "MOLD_SERVICE_STATUS"])),
    moldDbStatus:
      formatServiceStatus(readFirstString(data, ["MOLD_DB_STATUE", "MOLD_DB_STATUS"])),
    cpu: formatCpu(readString(data, "CPU(s)")),
    memory: formatMemory(data),
    rootDiskSize: formatDisk(data, "DISK_CAP", "DISK_ALLOC", "DISK_PHY", "DISK_USAGE_RATE"),
    secondaryDiskSize: formatDisk(
      data,
      "SECOND_DISK_CAP",
      "SECOND_DISK_ALLOC",
      "SECOND_DISK_PHY",
      "SECOND_DISK_USAGE_RATE"
    ),
    manageNicType: formatNicType(data),
    manageNicIp: prefixValue("IP", readString(data, "ip")),
    manageNicPrefix: prefixValue("PREFIX", readString(data, "prefix")),
    manageNicGw: prefixValue("GW", readString(data, "GW")),
    manageNicDns: prefixValue("DNS", readString(data, "DNS")),
  };
}

export async function fetchCloudVmStatus(): Promise<CloudVmStatusData> {
  const parsed = await requestCubeApi<CcvmStatusResponse>("/api/v1/cube/ccvm/status");

  if (parsed.code !== 200 || !parsed.data) {
    throw new Error(parsed.message ?? "Invalid CCVM status response");
  }

  return mapCcvmStatus(parsed.data);
}
