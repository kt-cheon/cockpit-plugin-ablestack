import { requestCubeApi } from "./client";

export interface StorageVmStatusData {
  vmStatus: string;
  cpu: string;
  memory: string;
  rootDiskSize: string;
  manageNicType: string;
  manageNicIp: string;
  manageNicPrefix: string;
  manageNicGw: string;
  manageNicDns: string;
  storageServerNicType: string;
  storageServerNicIp: string;
  storageReplicationNicType: string;
  storageReplicationNicIp: string;
}

interface ScvmStatusResponse {
  code?: number;
  data?: Record<string, unknown>;
  message?: string;
}

interface CidrAddress {
  ip: string | null;
  prefix: string | null;
}

export const STORAGE_VM_STATUS_FALLBACK: StorageVmStatusData = {
  vmStatus: "N/A",
  cpu: "N/A",
  memory: "N/A",
  rootDiskSize: "N/A",
  manageNicType: "N/A",
  manageNicIp: "N/A",
  manageNicPrefix: "N/A",
  manageNicGw: "N/A",
  manageNicDns: "N/A",
  storageServerNicType: "N/A",
  storageServerNicIp: "N/A",
  storageReplicationNicType: "N/A",
  storageReplicationNicIp: "N/A",
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

function isKnownValue(value: string | null): value is string {
  return Boolean(value && value.toUpperCase() !== "N/A");
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
  if (!isKnownValue(cpu)) {
    return cpu ?? "N/A";
  }

  return /^\d+$/.test(cpu) ? `${cpu} vCore` : cpu;
}

function formatRootDisk(data: Record<string, unknown>): string {
  const capacity = readString(data, "rootDiskSize");
  const available = readString(data, "rootDiskAvail");
  const usageRate = readString(data, "rootDiskUsePer");
  const details = [
    isKnownValue(available) ? `사용가능 ${available}` : null,
    isKnownValue(usageRate) ? `사용률 ${usageRate}` : null,
  ].filter(Boolean);

  if (isKnownValue(capacity) && details.length > 0) {
    return `${capacity} (${details.join(" / ")})`;
  }

  return capacity ?? "N/A";
}

function formatNicType(type: string | null, parent: string | null): string {
  if (isKnownValue(type) && isKnownValue(parent)) {
    return `NIC Type : ${type} (Parent : ${parent})`;
  }

  if (isKnownValue(type)) {
    return `NIC Type : ${type}`;
  }

  if (isKnownValue(parent)) {
    return `Parent : ${parent}`;
  }

  return "N/A";
}

function parseCidrAddress(value: string | null): CidrAddress {
  if (!isKnownValue(value)) {
    return { ip: value, prefix: null };
  }

  const [ip, prefix] = value.split("/");

  return {
    ip: ip || value,
    prefix: prefix || null,
  };
}

function prefixValue(label: string, value: string | null): string {
  return value ? `${label} : ${value}` : "N/A";
}

function mapScvmStatus(data: Record<string, unknown>): StorageVmStatusData {
  const manageNicAddress = parseCidrAddress(readString(data, "manageNicIp"));

  return {
    vmStatus: normalizeVmStatus(readString(data, "scvm_status")),
    cpu: formatCpu(readString(data, "vcpu")),
    memory: readString(data, "memory") ?? "N/A",
    rootDiskSize: formatRootDisk(data),
    manageNicType: formatNicType(
      readString(data, "manageNicType"),
      readString(data, "manageNicParent")
    ),
    manageNicIp: prefixValue("IP", manageNicAddress.ip),
    manageNicPrefix: prefixValue("PREFIX", manageNicAddress.prefix),
    manageNicGw: prefixValue("GW", readString(data, "manageNicGw")),
    manageNicDns: prefixValue("DNS", readString(data, "manageNicDns")),
    storageServerNicType: formatNicType(
      readString(data, "storageServerNicType"),
      readString(data, "storageServerNicParent")
    ),
    storageServerNicIp: prefixValue("IP", readString(data, "storageServerNicIp")),
    storageReplicationNicType: formatNicType(
      readString(data, "storageReplicationNicType"),
      readString(data, "storageReplicationNicParent")
    ),
    storageReplicationNicIp: prefixValue("IP", readString(data, "storageReplicationNicIp")),
  };
}

export async function fetchStorageVmStatus(): Promise<StorageVmStatusData> {
  const parsed = await requestCubeApi<ScvmStatusResponse>("/api/v1/cube/scvm/status");

  if (parsed.code !== 200 || !parsed.data) {
    throw new Error(parsed.message ?? "Invalid SCVM status response");
  }

  return mapScvmStatus(parsed.data);
}
