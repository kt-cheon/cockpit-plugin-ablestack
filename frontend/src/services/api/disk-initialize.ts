import { requestCubeApi } from "./client";

export const DISK_ERASE_CONFIRMATION = "확인했습니다";
export interface DiskInitializationTarget {
  path: string;
  identity: string;
  label: string;
  can_initialize: boolean;
  reason: string;
  state: string;
}
export interface DiskInitializationResult {
  path: string;
  status: "completed" | "failed";
  message: string;
}

export async function fetchDiskInitializationInventory(): Promise<{hostname:string; disks:DiskInitializationTarget[]}> {
  const response = await requestCubeApi<{code:number; hostname:string; disks:DiskInitializationTarget[]; val?:string}>("/api/v1/cube/disk/initialize");
  if (Number(response.code) !== 200 || !Array.isArray(response.disks)) {
    throw new Error(response.val || "디스크 초기화 목록을 조회하지 못했습니다.");
  }
  return response;
}

export async function initializeDisks(devices:DiskInitializationTarget[], confirmation:string) {
  if (confirmation !== DISK_ERASE_CONFIRMATION) throw new Error("확인 문구를 정확히 입력하세요.");
  const response = await requestCubeApi<{code:number; success:boolean; results:DiskInitializationResult[]; val?:string}>(
    "/api/v1/cube/disk/initialize", {method:"POST",body:{confirmation, devices:devices.map(({path,identity})=>({path,identity}))}});
  if (Number(response.code) !== 200 || !Array.isArray(response.results)) {
    throw new Error(response.val || "디스크 초기화 결과를 확인하지 못했습니다.");
  }
  return response;
}
