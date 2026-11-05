import { requestCubeApi } from "./client";

export interface CloudClusterStatusData {
  clusterStatus: string;
  nodeStatus: string;
  resourceStatus: string;
  executionNode: string;
  currentDc: string;
  onlineNodes: string[];
  offlineNodes: string[];
}

interface CloudClusterNode {
  host?: string;
  online?: string;
  is_dc?: string;
  resources_running?: string;
  standby?: string;
  maintenance?: string;
  pending?: string;
  unclean?: string;
  shutdown?: string;
  expected_up?: string;
}

interface PcsStatusResponse {
  code?: number;
  val?: {
    clustered_host?: string[];
    nodes?: CloudClusterNode[];
    started?: string;
    role?: string;
    active?: string;
    blocked?: string;
    failed?: string;
  };
  message?: string;
}

interface CloudClusterActionResponse {
  code?: number | string;
  message?: string;
  val?: unknown;
}

export type CloudCenterVmLifecycleAction = "start" | "stop";
export type CloudClusterPcsAction = "move" | "cleanup";

export const CLOUD_CLUSTER_STATUS_FALLBACK: CloudClusterStatusData = {
  clusterStatus: "N/A",
  nodeStatus: "N/A",
  resourceStatus: "N/A",
  executionNode: "N/A",
  currentDc: "N/A",
  onlineNodes: [],
  offlineNodes: [],
};

function isTrue(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

function isOfflineNode(node: CloudClusterNode): boolean {
  return node.online?.toLowerCase() === "false";
}

function clusterNodes(val: NonNullable<PcsStatusResponse["val"]>): CloudClusterNode[] {
  if (val.nodes?.length) {
    return val.nodes;
  }

  return (val.clustered_host ?? []).map((host) => ({ host, online: "true" }));
}

function formatClusterStatus(val: NonNullable<PcsStatusResponse["val"]>): string {
  if (isTrue(val.failed) || isTrue(val.blocked)) {
    return "HEALTH_ERR";
  }

  if (clusterNodes(val).some(isOfflineNode)) {
    return "HEALTH_WARN";
  }

  if (val.role?.toLowerCase() !== "started") {
    return "HEALTH_WARN";
  }

  return "HEALTH_OK";
}

function nodeHosts(nodes: CloudClusterNode[]): string[] {
  return nodes.map((node) => node.host).filter((host): host is string => Boolean(host));
}

function formatNodeStatus(onlineNodes: string[], offlineNodes: string[]): string {
  if (onlineNodes.length === 0 && offlineNodes.length === 0) {
    return "N/A";
  }

  return `Online (${onlineNodes.join(", ") || "-"}) | Offline (${offlineNodes.join(", ") || "-"})`;
}

function formatResourceStatus(val: NonNullable<PcsStatusResponse["val"]>): string {
  if (isTrue(val.failed)) {
    return "실패";
  }

  if (isTrue(val.blocked)) {
    return "차단";
  }

  if (!isTrue(val.active)) {
    return "중지";
  }

  if (val.role?.toLowerCase() === "started") {
    return "실행중";
  }

  return val.role ?? "N/A";
}

function mapPcsStatus(val: NonNullable<PcsStatusResponse["val"]>): CloudClusterStatusData {
  const nodes = clusterNodes(val);
  const onlineNodes = nodeHosts(nodes.filter((node) => !isOfflineNode(node)));
  const offlineNodes = nodeHosts(nodes.filter(isOfflineNode));
  const currentDc = nodes.find((node) => isTrue(node.is_dc))?.host ?? "N/A";

  return {
    clusterStatus: formatClusterStatus(val),
    nodeStatus: formatNodeStatus(onlineNodes, offlineNodes),
    resourceStatus: formatResourceStatus(val),
    executionNode: val.started ?? "N/A",
    currentDc,
    onlineNodes,
    offlineNodes,
  };
}

function actionResponseMessage(
  response: CloudClusterActionResponse,
  fallback: string
): string {
  if (typeof response.message === "string" && response.message.trim()) {
    return response.message.trim();
  }

  if (typeof response.val === "string" && response.val.trim()) {
    return response.val.trim();
  }

  return fallback;
}

function assertActionSucceeded(
  response: CloudClusterActionResponse,
  fallback: string
): string {
  if (String(response.code ?? "") !== "200") {
    throw new Error(actionResponseMessage(response, fallback));
  }

  return actionResponseMessage(response, "요청이 완료되었습니다.");
}

export async function fetchCloudClusterStatus(): Promise<CloudClusterStatusData> {
  const response = await requestCubeApi<{ code: number; val?: {
    health: string; online_nodes: string[]; offline_nodes: string[];
    ccvm_running_node: string; current_dc: string; resource_started: boolean; message: string;
  }}>("/api/v1/cube/infrastructure/status");
  if (Number(response.code) !== 200 || !response.val) throw new Error("인프라 클러스터 상태를 확인하지 못했습니다.");
  const val = response.val;
  return {
    clusterStatus: val.health === 'ok' ? 'HEALTH_OK' : val.health === 'warn' ? 'HEALTH_WARN' : 'HEALTH_ERR',
    nodeStatus: `Online (${val.online_nodes.join(', ') || 'N/A'})` + (val.offline_nodes.length ? ` / Offline (${val.offline_nodes.join(', ')})` : ''),
    resourceStatus: val.resource_started ? '실행중' : '정지',
    executionNode: val.ccvm_running_node || 'N/A', currentDc: val.current_dc || 'N/A',
    onlineNodes: val.online_nodes, offlineNodes: val.offline_nodes,
  };
}

export async function controlCloudCenterVm(
  action: CloudCenterVmLifecycleAction
): Promise<string> {
  const parsed = await requestCubeApi<CloudClusterActionResponse>(
    "/api/v1/cube/ccvm/lifecycle",
    {
      method: "POST",
      body: { action },
      maxTimeSeconds: 180,
    }
  );

  return assertActionSucceeded(parsed, "클라우드센터VM 제어에 실패했습니다.");
}

export async function controlCloudClusterPcs(
  action: CloudClusterPcsAction,
  target?: string
): Promise<string> {
  const parsed = await requestCubeApi<CloudClusterActionResponse>(
    "/api/v1/cube/pcs/control",
    {
      method: "POST",
      body: {
        action,
        ...(action === "move" && target ? { target } : {}),
      },
      maxTimeSeconds: 120,
    }
  );

  return assertActionSucceeded(parsed, "클라우드센터 클러스터 제어에 실패했습니다.");
}

export async function updateCloudCenterMonitoringConfig(): Promise<string> {
  const parsed = await requestCubeApi<CloudClusterActionResponse>(
    "/api/v1/cube/ccvm/monitoring/config",
    {
      method: "POST",
      body: { action: "update" },
      maxTimeSeconds: 900,
    }
  );

  return assertActionSucceeded(parsed, "모니터링센터 수집 정보 업데이트에 실패했습니다.");
}
