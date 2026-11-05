import { requestCubeApi } from "./client";

type ApiRecord = Record<string, unknown>;

export interface ClvmDisk {
  vgName: string;
  pvName: string;
  pvSize: string;
  uuid: string;
  pathMode: string;
  diskId: string;
}

export interface GfsHost {
  hostname: string;
  address: string;
}

export interface HostRemoveStep {
  name: string;
  status: "pending" | "running" | "succeeded" | "failed";
  message?: string;
}

export interface HostRemoveJob {
  job_id: string;
  hostname: string;
  cluster_type: string;
  status: "queued" | "running" | "succeeded" | "failed";
  current_step?: string;
  message?: string;
  steps: HostRemoveStep[];
}

const HOST_REMOVE_STEP_LABELS: Record<string, string> = {
  precheck: "호스트 API 상태 확인",
  remove_mold_host: "Mold 호스트 유지보수 전환 및 제거",
  remove_pcs_node: "PCS/GFS 노드 및 펜싱 장치 제거",
  remove_ceph_host: "Glue 호스트 및 OSD 제거",
  delete_scvm: "스토리지 가상머신 제거",
  update_cluster_files: "전체 노드 cluster.json 및 hosts 갱신",
  update_monitoring: "Wall 모니터링 대상 갱신",
  final_verify: "호스트 제거 결과 확인",
};

function isRecord(value: unknown): value is ApiRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function valueOf(response: ApiRecord): unknown {
  return response.val ?? response.data;
}

function ensureSuccess(response: ApiRecord, fallback: string): ApiRecord {
  if (Number(response.code) !== 200) {
    throw new Error(text(response.message) || text(response.error) || fallback);
  }
  return response;
}

async function post(path: string, body: ApiRecord, fallback: string, maxTimeSeconds = 900): Promise<ApiRecord> {
  const response = await requestCubeApi<ApiRecord>(path, {
    method: "POST",
    body,
    maxTimeSeconds,
  });
  return ensureSuccess(response, fallback);
}

export function updateCloudVmResources(cpu: string, memory: string): Promise<ApiRecord> {
  return post("/api/v1/cube/ccvm/edit", { cpu, memory }, "클라우드센터VM 자원변경에 실패했습니다.");
}

export function resizeCloudVmSecondary(addSize: number): Promise<ApiRecord> {
  return post(
    "/api/v1/cube/ccvm/secondary/resize",
    { add_size: addSize },
    "Mold 세컨더리 용량 추가에 실패했습니다."
  );
}

export function controlCloudVmService(serviceName: "mold.service" | "mysqld", action: string): Promise<ApiRecord> {
  return post(
    "/api/v1/cube/ccvm/service/control",
    { service_name: serviceName, action },
    "클라우드센터VM 서비스 제어에 실패했습니다."
  );
}

export function runCloudVmSnapshot(action: "backup" | "rollback", snapName?: string): Promise<ApiRecord> {
  return post(
    "/api/v1/cube/ccvm/snap",
    { action, ...(snapName ? { snap_name: snapName } : {}) },
    "클라우드센터VM 스냅샷 작업에 실패했습니다."
  );
}

export async function listCloudVmSnapshots(): Promise<string[]> {
  const response = await post("/api/v1/cube/ccvm/snap", { action: "list" }, "스냅샷 목록 조회에 실패했습니다.");
  const rows = Array.isArray(valueOf(response)) ? valueOf(response) as unknown[] : [];
  return rows.map((row) => isRecord(row) ? text(row.name ?? row.snap_name) : text(row)).filter(Boolean);
}

export function runCloudVmDbBackup(action: string): Promise<ApiRecord> {
  const schedule = action === "regularBackup"
    ? { repeat: "daily", timeone: "02:00" }
    : action === "deleteOldBackup"
      ? { repeat: "daily", timeone: "03:00", delete: "30" }
      : {};
  return post("/api/v1/cube/db/dump", { action, ...schedule }, "Mold DB 백업 작업에 실패했습니다.");
}

export function controlStorageVm(action: "start" | "stop" | "delete"): Promise<ApiRecord> {
  return post("/api/v1/cube/scvm/lifecycle", { action }, "스토리지센터VM 제어에 실패했습니다.");
}

export function updateStorageVmResources(cpu: string, memory: string): Promise<ApiRecord> {
  return post(
    "/api/v1/cube/scvm/lifecycle",
    { action: "resource", cpu: Number(cpu), memory: Number(memory) },
    "스토리지센터VM 자원변경에 실패했습니다."
  );
}

export async function listClvmDisks(): Promise<ClvmDisk[]> {
  const response = await post("/api/v1/cube/clvm/manage", { action: "list-clvm" }, "CLVM 목록 조회에 실패했습니다.");
  const rows = Array.isArray(valueOf(response)) ? valueOf(response) as unknown[] : [];
  return rows.filter(isRecord).map((row) => ({
    vgName: text(row.vg_name),
    pvName: text(row.pv_name),
    pvSize: text(row.pv_size),
    uuid: text(row.uuid) || text(row.wwn),
    pathMode: text(row.path_mode) || "single",
    diskId: text(row.disk_id),
  })).filter((row) => row.vgName && row.pvName);
}

export function createClvmDisks(disks: string[]): Promise<ApiRecord> {
  return post("/api/v1/cube/clvm/manage", { action: "create-clvm", disks }, "CLVM 디스크 추가에 실패했습니다.");
}

export function deleteClvmDisks(disks: ClvmDisk[]): Promise<ApiRecord> {
  return post("/api/v1/cube/clvm/manage", {
    action: "delete-clvm",
    vg_names: disks.map((disk) => disk.vgName),
    pv_names: disks.map((disk) => disk.pvName),
    disks: disks.map((disk) => disk.diskId).filter((disk) => disk && disk !== "N/A"),
  }, "CLVM 디스크 삭제에 실패했습니다.");
}

export async function listGfsHosts(): Promise<GfsHost[]> {
  const response = await post("/api/v1/cube/gfs/manage", { action: "check-host" }, "GFS 호스트 조회에 실패했습니다.");
  const rows = Array.isArray(valueOf(response)) ? valueOf(response) as unknown[] : [];
  return rows.filter(isRecord).map((row) => ({
    hostname: text(row.hostname ?? row.name),
    address: text(row.ablecube ?? row.target ?? row.ip),
  })).filter((row) => row.hostname);
}

export async function removeClusterHost(
  hostname: string,
  onProgress?: (message: string, job: HostRemoveJob) => void
): Promise<HostRemoveJob> {
  const started = await requestCubeApi<ApiRecord>("/api/v1/cube/hosts/remove", {
    method: "POST",
    body: { hostname },
    maxTimeSeconds: 60,
  });
  if (Number(started.code) !== 202) {
    throw new Error(text(started.message) || "호스트 제거 Job 시작에 실패했습니다.");
  }
  const jobId = text(started.job_id);
  if (!jobId) {
    throw new Error("호스트 제거 Job ID를 받지 못했습니다.");
  }

  for (;;) {
    const response = await requestCubeApi<ApiRecord>(`/api/v1/cube/hosts/remove/jobs/${encodeURIComponent(jobId)}`, {
      method: "GET",
      maxTimeSeconds: 60,
    });
    if (Number(response.code) !== 200 || !isRecord(response.job)) {
      throw new Error(text(response.message) || "호스트 제거 Job 조회에 실패했습니다.");
    }
    const job = response.job as unknown as HostRemoveJob;
    const currentLabel = HOST_REMOVE_STEP_LABELS[job.current_step ?? ""] ?? job.current_step ?? "호스트 제거 준비";
    onProgress?.(`${currentLabel} 단계가 진행 중입니다.`, job);
    if (job.status === "succeeded") {
      return job;
    }
    if (job.status === "failed") {
      const failedStep = job.steps?.find((step) => step.status === "failed");
      throw new Error(failedStep?.message || job.message || `${currentLabel} 단계에서 호스트 제거에 실패했습니다.`);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
}

export function resetLocalCubeHost(): Promise<ApiRecord> {
  return post("/api/v1/cube/cluster/apply-local", { action: "reset" }, "Cube 호스트 설정 초기화에 실패했습니다.");
}

export function runGfsVolumeAction(
  action: "create-gfs" | "delete-gfs" | "extend" | "add-extend",
  body: ApiRecord
): Promise<ApiRecord> {
  return post("/api/v1/cube/gfs/manage", { action, ...body }, "GFS 디스크 작업에 실패했습니다.");
}

export function runAutoShutdownStep(action: "check_mount" | "stop_scvms" | "shutdown_hosts"): Promise<ApiRecord> {
  return post("/api/v1/cube/auto-shutdown", { action }, "전체 시스템 종료 절차에 실패했습니다.", 300);
}
