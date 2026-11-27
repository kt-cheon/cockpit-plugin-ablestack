import { requestCubeApi } from "./client";

export interface ClusterConfigHost {
  index: string;
  hostname: string;
  ablecube: string;
  scvmMngt: string;
  ablecubePn: string;
  scvm: string;
  scvmCn: string;
}

export interface ClusterConfigProfile {
  type: string;
	hostType: string;
  ccvmIp: string;
  managementCidr: string;
  managementGateway: string;
  managementDns: string;
  iscsiStorage: boolean;
  hosts: ClusterConfigHost[];
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function unwrapClusterConfig(value: unknown): RecordValue {
  const parsed = parseMaybeJson(value);

  if (!isRecord(parsed)) return {};

  if (isRecord(parsed.clusterConfig)) return parsed.clusterConfig;
  if (parsed.data !== undefined) return unwrapClusterConfig(parsed.data);
  if (parsed.val !== undefined) return unwrapClusterConfig(parsed.val);

  return parsed;
}

function unwrapClusterDocument(value: unknown): RecordValue {
  const parsed = parseMaybeJson(value);
  if (isRecord(parsed)) {
    const config = parsed.clusterConfig;
    if (isRecord(config)) {
      if (!readString(config, ["type"]) || !Array.isArray(config.hosts) || config.hosts.length === 0) {
        throw new Error("저장된 클러스터 구성 파일에 클러스터 종류 또는 호스트 정보가 없습니다.");
      }
      return parsed;
    }
    if (parsed.val !== undefined) return unwrapClusterDocument(parsed.val);
    if (parsed.data !== undefined) return unwrapClusterDocument(parsed.data);
  }
  throw new Error("저장된 클러스터 구성 프로파일을 읽을 수 없습니다.");
}

// Download the saved document, including custom fields outside clusterConfig.
export async function fetchClusterConfigDocument(): Promise<RecordValue> {
  return unwrapClusterDocument(await requestCubeApi<unknown>("/api/v1/cube/cluster/config"));
}

function readString(source: RecordValue, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }

  return "";
}

function readBoolean(source: RecordValue, keys: string[]): boolean {
  return keys.some((key) => String(source[key] ?? "").trim().toLowerCase() === "true");
}

function normalizeHost(host: unknown, index: number): ClusterConfigHost {
  const row = isRecord(host) ? host : {};

  return {
    index: readString(row, ["index"]) || String(index + 1),
    hostname: readString(row, ["hostname", "hostName", "name"]),
    ablecube: readString(row, ["ablecube", "hostIp", "ip"]),
    scvmMngt: readString(row, ["scvmMngt", "scvmMgmt", "scvmMgmtIp"]),
    ablecubePn: readString(row, ["ablecubePn", "hostPn", "hostPnIp", "storageIp"]),
    scvm: readString(row, ["scvm", "scvmPn", "scvmPnIp"]),
    scvmCn: readString(row, ["scvmCn", "scvmCnIp", "hostCn", "hostCnIp"]),
  };
}

export async function fetchClusterConfigProfile(): Promise<ClusterConfigProfile> {
  const raw = await requestCubeApi<unknown>("/api/v1/cube/cluster/config");
  const config = unwrapClusterConfig(raw);
  const ccvm = isRecord(config.ccvm) ? config.ccvm : {};
  const mngtNic = isRecord(config.mngtNic) ? config.mngtNic : {};
  const rawHosts = Array.isArray(config.hosts) ? config.hosts : [];

  return {
    type: readString(config, ["type"]),
	hostType: readString(config, ["hostType", "host_type"]),
    ccvmIp: readString(ccvm, ["ip"]),
    managementCidr: readString(mngtNic, ["cidr"]),
    managementGateway: readString(mngtNic, ["gw", "gateway"]),
    managementDns: readString(mngtNic, ["dns"]),
    iscsiStorage: readBoolean(config, [
        "storage_network",
        "storageNetwork",
        "iscsi_storage",
        "iscsiStorage",
    ]),
    hosts: rawHosts.map(normalizeHost),
  };
}
