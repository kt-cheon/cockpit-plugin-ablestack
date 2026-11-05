import React from "react";

import {
    Button,
    Card,
    CardBody,
    CardHeader,
    CardTitle,
    Content,
    Label,
    Modal,
    ModalBody,
    ModalFooter,
    ModalHeader,
    Spinner,
} from "@patternfly/react-core";
import {
    CheckCircleIcon,
    ExclamationTriangleIcon,
    InfoCircleIcon,
} from "@patternfly/react-icons";

import { useStatusPolling } from "../hooks/useStatusPolling.ts";
import {
    DEPLOY_STATUS_FALLBACK,
    fetchDeployRunJobs,
    fetchDeployStatus,
    type DeployRunJob,
    type DeployRunStepResult,
    type DeployStatusData,
    type DeployStatusWarning,
} from "../services/api/deploy-status.ts";
import {
    fetchLicenseStatus,
    type LicenseStatus,
} from "../services/api/license.ts";
import { fetchVersionInfo } from "../services/api/version.ts";

interface DeploymentOverviewProps {
  onAction: (action: string) => void;
  onOpenDeployRun: () => void;
  onStatusChange?: (status: DeployStatusData) => void;
  mode?: "ribbon" | "flow";
}

interface StageItem {
  id: string;
  label: string;
}

const LICENSE_STAGE = "license_register";
const STORAGE_CENTER_CONFIGURE_STAGE = "storage_center_configure";
const STORAGE_CENTER_CONNECT_STAGE = "storage_center_connect";
const STORAGE_CLUSTER_CONFIGURE_STAGE = "storage_cluster_configure";
const HCI_SHARED_FILE_CONFIGURE_STAGE = "hci_shared_file_configure";
const CLOUD_CENTER_CONFIGURE_STAGE = "cloud_center_configure";
const CLOUD_CENTER_CONNECT_STAGE = "cloud_center_connect";
const MONITORING_CENTER_CONFIGURE_STAGE = "monitoring_center_configure";
const MONITORING_CENTER_CONNECT_STAGE = "monitoring_center_connect";
const SECURITY_PATCH_STAGE = "security_patch";
const PRODUCT_FLOW_PENDING_STAGE = "product_flow_pending";
const VERSION_UPDATE_ACTION = "ablestack_update";
const SECURITY_EVIDENCE_ACTION = "security_evidence";
const SECURITY_PATCH_WARNING_KEY = "security_patch_required";
const STORAGE_CENTER_PRODUCT_TYPES = new Set([
    "powerflex",
    "ablestack-hci",
    "ablestack-hci-filesystem",
]);
const CONNECTION_ACTIONS = new Set([
    "open_storage_center",
    "open_cloud_center",
    "open_monitoring_center",
]);
const ALWAYS_AVAILABLE_ACTIONS = [
    "download_config_file",
    "manage_license",
];
const MANAGEMENT_ACTIONS = new Set([
    ...ALWAYS_AVAILABLE_ACTIONS,
    VERSION_UPDATE_ACTION,
    SECURITY_EVIDENCE_ACTION,
]);

const PRODUCT_LABELS: Record<string, string> = {
    "powerflex": "PowerFlex",
    "ablestack-hci": "ABLESTACK-HCI",
    "ablestack-hci-filesystem": "ABLESTACK-HCI Filesystem",
    "ablestack-vm": "ABLESTACK-VM",
    "ablestack-standalone": "ABLESTACK Standalone",
};

const STAGE_LABELS: Record<string, string> = {
    [LICENSE_STAGE]: "라이선스 등록",
    cluster_prepare: "클러스터 구성 준비",
    storage_vm_deploy: "스토리지 VM 배포",
    storage_vm_configure: "스토리지 VM 구성",
    [STORAGE_CENTER_CONFIGURE_STAGE]: "스토리지센터 구성",
    [STORAGE_CENTER_CONNECT_STAGE]: "스토리지센터 연결",
    [STORAGE_CLUSTER_CONFIGURE_STAGE]: "스토리지 클러스터 상세 구성",
    [HCI_SHARED_FILE_CONFIGURE_STAGE]: "RBD/GFS 구성",
    gfs_storage_configure: "GFS 스토리지 구성",
    local_storage_configure: "로컬 스토리지 구성",
    cloud_vm_deploy: "클라우드 VM 배포",
    cloud_vm_configure: "클라우드 VM 구성",
    [CLOUD_CENTER_CONFIGURE_STAGE]: "클라우드센터 구성",
    [CLOUD_CENTER_CONNECT_STAGE]: "클라우드센터 연결",
    cloud_cluster_configure: "클라우드 PCS 구성",
    cloud_resource_configure: "클라우드 리소스 구성",
    monitoring_configure: "모니터링센터 구성",
    [MONITORING_CENTER_CONFIGURE_STAGE]: "모니터링센터 구성",
    [MONITORING_CENTER_CONNECT_STAGE]: "모니터링센터 연결",
    [SECURITY_PATCH_STAGE]: "취약점 조치",
    ready: "배포 완료",
    [PRODUCT_FLOW_PENDING_STAGE]: "제품 타입 선택 후 흐름 표시",
    unsupported_cluster_type: "지원하지 않는 구성",
};

const MESSAGE_LABELS: Record<string, string> = {
    cluster_config_required: "클러스터 구성 준비가 필요합니다.",
    storage_vm_not_deployed: "스토리지센터 VM 배포가 필요합니다.",
    storage_vm_not_configured: "스토리지센터 구성이 필요합니다.",
    storage_cluster_not_configured: "스토리지 클러스터 상세 구성이 필요합니다.",
    hci_shared_file_not_configured: "RBD/GFS 구성이 필요합니다.",
    gfs_storage_not_configured: "GFS 스토리지 구성이 필요합니다.",
    local_storage_not_configured: "로컬 스토리지 구성이 필요합니다.",
    cloud_vm_not_deployed: "클라우드센터 VM 배포가 필요합니다.",
    cloud_vm_not_configured: "클라우드센터 구성이 필요합니다.",
    cloud_cluster_not_configured: "클라우드센터 PCS 클러스터 구성이 필요합니다.",
    cloud_resource_not_configured: "클라우드센터 리소스 구성이 필요합니다.",
    monitoring_not_configured: "모니터링센터 구성이 필요합니다.",
    ready: "배포 단계가 완료되었습니다.",
    product_flow_pending: "제품 타입을 선택하면 제품별 설치 흐름이 표시됩니다.",
    unsupported_cluster_type: "지원하지 않는 클러스터 타입입니다.",
    deploy_status_unavailable: "배포 상태를 확인할 수 없습니다.",
};

const ACTION_LABELS: Record<string, string> = {
    manage_license: "라이선스 관리",
    download_config_file: "설정파일 다운로드",
    prepare_cluster_config: "클러스터 구성 준비",
    deploy_storage_vm: "스토리지 VM 배포",
    configure_storage_vm: "스토리지센터 구성",
    open_storage_center: "스토리지센터 연결",
    configure_storage_cluster: "스토리지 클러스터 상세 구성",
    configure_hci_shared_file: "RBD/GFS 구성",
    configure_gfs_storage: "GFS 스토리지 구성",
    configure_local_storage: "로컬 스토리지 구성",
    deploy_cloud_vm: "클라우드 VM 구성",
    configure_cloud_vm: "클라우드센터 구성",
    configure_cloud_cluster: "클라우드 PCS 구성",
    configure_cloud_resource: "클라우드 리소스 구성",
    configure_monitoring: "모니터링센터 구성",
    open_cloud_center: "클라우드센터 연결",
    open_monitoring_center: "모니터링센터 연결",
    run_security_patch: "취약점 조치",
    [SECURITY_EVIDENCE_ACTION]: "보안 증적",
    [VERSION_UPDATE_ACTION]: "ABLESTACK 업데이트",
};

const ACTION_STAGE: Record<string, string> = {
    manage_license: LICENSE_STAGE,
    download_config_file: "cluster_prepare",
    prepare_cluster_config: "cluster_prepare",
    deploy_storage_vm: "storage_vm_configure",
    configure_storage_vm: STORAGE_CENTER_CONFIGURE_STAGE,
    open_storage_center: STORAGE_CENTER_CONNECT_STAGE,
    configure_storage_cluster: STORAGE_CLUSTER_CONFIGURE_STAGE,
    configure_hci_shared_file: HCI_SHARED_FILE_CONFIGURE_STAGE,
    configure_gfs_storage: "gfs_storage_configure",
    configure_local_storage: "local_storage_configure",
    deploy_cloud_vm: "cloud_vm_configure",
    configure_cloud_vm: CLOUD_CENTER_CONFIGURE_STAGE,
    configure_cloud_cluster: CLOUD_CENTER_CONFIGURE_STAGE,
    configure_cloud_resource: CLOUD_CENTER_CONFIGURE_STAGE,
    configure_monitoring: MONITORING_CENTER_CONFIGURE_STAGE,
    open_cloud_center: CLOUD_CENTER_CONNECT_STAGE,
    open_monitoring_center: MONITORING_CENTER_CONNECT_STAGE,
    run_security_patch: SECURITY_PATCH_STAGE,
};

const FLOW_STAGE_ACTIONS: Record<string, string[]> = {
    [LICENSE_STAGE]: ["manage_license"],
    cluster_prepare: ["prepare_cluster_config", "download_config_file"],
    storage_vm_configure: ["deploy_storage_vm", "configure_storage_vm", "download_config_file"],
    [STORAGE_CENTER_CONFIGURE_STAGE]: ["configure_storage_vm"],
    [STORAGE_CLUSTER_CONFIGURE_STAGE]: ["configure_storage_cluster"],
    [STORAGE_CENTER_CONNECT_STAGE]: ["open_storage_center"],
    [HCI_SHARED_FILE_CONFIGURE_STAGE]: ["configure_hci_shared_file"],
    gfs_storage_configure: ["configure_gfs_storage", "download_config_file"],
    local_storage_configure: ["configure_local_storage", "download_config_file"],
    cloud_vm_configure: ["deploy_cloud_vm", "download_config_file"],
    [CLOUD_CENTER_CONFIGURE_STAGE]: ["configure_cloud_cluster", "configure_cloud_resource"],
    [CLOUD_CENTER_CONNECT_STAGE]: ["open_cloud_center"],
    [MONITORING_CENTER_CONFIGURE_STAGE]: ["configure_monitoring"],
    [MONITORING_CENTER_CONNECT_STAGE]: ["open_monitoring_center"],
    [SECURITY_PATCH_STAGE]: ["run_security_patch"],
};

const FLOW_STAGE_PRIMARY_ACTIONS: Record<string, string[]> = {
    [LICENSE_STAGE]: ["manage_license"],
    cluster_prepare: ["prepare_cluster_config"],
    storage_vm_configure: ["deploy_storage_vm"],
    [STORAGE_CENTER_CONFIGURE_STAGE]: ["configure_storage_vm"],
    [STORAGE_CLUSTER_CONFIGURE_STAGE]: ["configure_storage_cluster"],
    [HCI_SHARED_FILE_CONFIGURE_STAGE]: ["configure_hci_shared_file"],
    gfs_storage_configure: ["configure_gfs_storage"],
    local_storage_configure: ["configure_local_storage"],
    cloud_vm_configure: ["deploy_cloud_vm"],
    [CLOUD_CENTER_CONFIGURE_STAGE]: ["configure_cloud_vm"],
    [MONITORING_CENTER_CONFIGURE_STAGE]: ["configure_monitoring"],
    [SECURITY_PATCH_STAGE]: ["run_security_patch"],
};

const STAGE_CLICK_ACTION: Record<string, string> = {
    [LICENSE_STAGE]: "manage_license",
    cluster_prepare: "prepare_cluster_config",
    storage_vm_configure: "configure_storage_vm",
    [STORAGE_CENTER_CONFIGURE_STAGE]: "configure_storage_vm",
    [STORAGE_CLUSTER_CONFIGURE_STAGE]: "configure_storage_cluster",
    [STORAGE_CENTER_CONNECT_STAGE]: "open_storage_center",
    [HCI_SHARED_FILE_CONFIGURE_STAGE]: "configure_hci_shared_file",
    gfs_storage_configure: "configure_gfs_storage",
    local_storage_configure: "configure_local_storage",
    cloud_vm_configure: "deploy_cloud_vm",
    [CLOUD_CENTER_CONFIGURE_STAGE]: "configure_cloud_vm",
    [CLOUD_CENTER_CONNECT_STAGE]: "open_cloud_center",
    [MONITORING_CENTER_CONFIGURE_STAGE]: "configure_monitoring",
    [MONITORING_CENTER_CONNECT_STAGE]: "open_monitoring_center",
};

const DEPLOY_RUN_STEP_LABELS: Record<string, string> = {
    license_apply: "라이선스 배포",
    cluster_apply: "클러스터 구성 적용",
    scvm_prepare: "스토리지 VM 준비",
    scvm_bootstrap: "스토리지 VM 후처리",
    storage_prepare: "GFS/RBD 구성 준비",
    local_prepare: "로컬 스토리지 준비",
    ccvm_prepare: "클라우드 VM 준비",
    ccvm_bootstrap: "클라우드 VM 후처리",
    system_profile: "시스템 프로필 반영",
};

const STAGE_DESCRIPTIONS: Record<string, string> = {
    [LICENSE_STAGE]: "라이선스 API로 등록한 뒤 systemProfile.license.status 값을 갱신합니다.",
    cluster_prepare: "클러스터 구성 파일과 호스트 상태를 확인하고 cluster apply를 준비합니다.",
    storage_vm_configure: "SCVM cloud-init, XML, lifecycle API 흐름으로 스토리지 VM을 준비합니다.",
    [STORAGE_CENTER_CONFIGURE_STAGE]: "SCVM bootstrap을 실행해 스토리지센터 초기 구성을 완료합니다.",
    [STORAGE_CENTER_CONNECT_STAGE]: "API가 반환한 Storage Center URL로 접속해 구성을 이어갑니다.",
    [STORAGE_CLUSTER_CONFIGURE_STAGE]: "SCVM host 등록 상태를 확인하고 OSD 등록, rbd pool 구성을 진행합니다.",
    [HCI_SHARED_FILE_CONFIGURE_STAGE]: "RBD image 생성, 물리 host rbd map, GFS API 흐름으로 HCI Filesystem 구성을 진행합니다.",
    gfs_storage_configure: "GFS disk/resource 상태를 확인하고 필요한 GFS 구성을 진행합니다.",
    local_storage_configure: "local manage API 또는 올인원 Job으로 로컬 스토리지 구성을 진행합니다.",
    cloud_vm_configure: "CCVM cloud-init, XML, lifecycle setup 흐름으로 클라우드 VM을 준비합니다.",
    [CLOUD_CENTER_CONFIGURE_STAGE]: "Cloud Center 초기 구성 후 bootstrap.ccvm 완료 플래그를 반영합니다.",
    [CLOUD_CENTER_CONNECT_STAGE]: "API가 반환한 Cloud Center URL로 접속합니다.",
    [MONITORING_CENTER_CONFIGURE_STAGE]: "Wall Center URL에서 모니터링 구성을 완료하고 bootstrap.wall을 반영합니다.",
    [MONITORING_CENTER_CONNECT_STAGE]: "API가 반환한 Monitoring Center URL로 접속합니다.",
    [SECURITY_PATCH_STAGE]: "security patch API를 실행하고 security_patch.status 값을 반영합니다.",
    [PRODUCT_FLOW_PENDING_STAGE]: "클러스터 구성 준비 단계에서 제품 타입을 선택하면 HCI, VM, Standalone 흐름으로 전환됩니다.",
};

const JOB_STATUS_LABELS: Record<string, string> = {
    queued: "대기",
    running: "실행중",
    succeeded: "성공",
    failed: "실패",
};

const STEP_STATUS_LABELS: Record<string, string> = {
    pending: "대기",
    running: "실행중",
    succeeded: "성공",
    failed: "실패",
    skipped: "건너뜀",
};

const HCI_STAGES: StageItem[] = [
    { id: LICENSE_STAGE, label: STAGE_LABELS[LICENSE_STAGE] },
    { id: "cluster_prepare", label: STAGE_LABELS.cluster_prepare },
    { id: "storage_vm_configure", label: STAGE_LABELS.storage_vm_configure },
    { id: STORAGE_CENTER_CONFIGURE_STAGE, label: STAGE_LABELS[STORAGE_CENTER_CONFIGURE_STAGE] },
    { id: STORAGE_CLUSTER_CONFIGURE_STAGE, label: STAGE_LABELS[STORAGE_CLUSTER_CONFIGURE_STAGE] },
    { id: "cloud_vm_configure", label: STAGE_LABELS.cloud_vm_configure },
    { id: CLOUD_CENTER_CONFIGURE_STAGE, label: STAGE_LABELS[CLOUD_CENTER_CONFIGURE_STAGE] },
    { id: MONITORING_CENTER_CONFIGURE_STAGE, label: STAGE_LABELS[MONITORING_CENTER_CONFIGURE_STAGE] },
];

const HCI_FILESYSTEM_STAGES: StageItem[] = [
    ...HCI_STAGES.slice(0, 5),
    { id: HCI_SHARED_FILE_CONFIGURE_STAGE, label: STAGE_LABELS[HCI_SHARED_FILE_CONFIGURE_STAGE] },
    ...HCI_STAGES.slice(5),
];

const VM_STAGES: StageItem[] = [
    { id: LICENSE_STAGE, label: STAGE_LABELS[LICENSE_STAGE] },
    { id: "cluster_prepare", label: STAGE_LABELS.cluster_prepare },
    { id: "gfs_storage_configure", label: STAGE_LABELS.gfs_storage_configure },
    { id: "cloud_vm_configure", label: STAGE_LABELS.cloud_vm_configure },
    { id: CLOUD_CENTER_CONFIGURE_STAGE, label: STAGE_LABELS[CLOUD_CENTER_CONFIGURE_STAGE] },
    { id: MONITORING_CENTER_CONFIGURE_STAGE, label: STAGE_LABELS[MONITORING_CENTER_CONFIGURE_STAGE] },
];

const STANDALONE_STAGES: StageItem[] = [
    { id: LICENSE_STAGE, label: STAGE_LABELS[LICENSE_STAGE] },
    { id: "cluster_prepare", label: STAGE_LABELS.cluster_prepare },
    { id: "local_storage_configure", label: STAGE_LABELS.local_storage_configure },
    { id: "cloud_vm_configure", label: STAGE_LABELS.cloud_vm_configure },
    { id: CLOUD_CENTER_CONFIGURE_STAGE, label: STAGE_LABELS[CLOUD_CENTER_CONFIGURE_STAGE] },
    { id: MONITORING_CENTER_CONFIGURE_STAGE, label: STAGE_LABELS[MONITORING_CENTER_CONFIGURE_STAGE] },
];

export function stageItemsFor(osType: string): StageItem[] {
    switch (osType) {
    case "powerflex":
    case "ablestack-hci":
        return HCI_STAGES;
    case "ablestack-hci-filesystem":
        return HCI_FILESYSTEM_STAGES;
    case "ablestack-vm":
        return VM_STAGES;
    case "ablestack-standalone":
        return STANDALONE_STAGES;
    default:
        return [
            { id: LICENSE_STAGE, label: STAGE_LABELS[LICENSE_STAGE] },
            { id: "cluster_prepare", label: STAGE_LABELS.cluster_prepare },
            { id: PRODUCT_FLOW_PENDING_STAGE, label: STAGE_LABELS[PRODUCT_FLOW_PENDING_STAGE] },
        ];
    }
}

function isTrueStatus(value: string): boolean {
    return value.toLowerCase() === "true";
}

function isRunningStatus(value: string): boolean {
    return value.toUpperCase() === "RUNNING" || value.toLowerCase() === "running";
}

function isHealthyStatus(value: string): boolean {
    const normalized = value.toUpperCase();

    return normalized === "HEALTH_OK" || normalized === "HEALTH_WARN";
}

function isStageDone(stage: string, status: DeployStatusData): boolean {
    const raw = status.raw;

    switch (stage) {
    case LICENSE_STAGE:
        return isTrueStatus(raw.licenseStatus);
    case "cluster_prepare":
        return isTrueStatus(raw.clusterConfigStatus);
    case "storage_vm_deploy":
        return isRunningStatus(raw.storageVmStatus);
    case "storage_vm_configure":
        return isRunningStatus(raw.storageVmStatus);
    case STORAGE_CENTER_CONFIGURE_STAGE:
    case STORAGE_CENTER_CONNECT_STAGE:
        return isTrueStatus(raw.storageVmBootstrapStatus);
    case STORAGE_CLUSTER_CONFIGURE_STAGE:
        return isHealthyStatus(raw.storageClusterStatus);
    case HCI_SHARED_FILE_CONFIGURE_STAGE:
    case "gfs_storage_configure":
        return isTrueStatus(raw.gfsConfigureStatus);
    case "local_storage_configure":
        return isTrueStatus(raw.localConfigureStatus);
    case "cloud_vm_deploy":
        return isRunningStatus(raw.cloudVmStatus);
    case "cloud_vm_configure":
        return isRunningStatus(raw.cloudVmStatus);
    case CLOUD_CENTER_CONFIGURE_STAGE:
    case CLOUD_CENTER_CONNECT_STAGE:
        return isTrueStatus(raw.cloudVmBootstrapStatus);
    case "cloud_cluster_configure":
    case "cloud_resource_configure":
        return raw.cloudClusterStatus.toUpperCase() === "HEALTH_OK";
    case MONITORING_CENTER_CONFIGURE_STAGE:
    case MONITORING_CENTER_CONNECT_STAGE:
    case "monitoring_configure":
        return isTrueStatus(raw.monitoringStatus);
    case SECURITY_PATCH_STAGE:
        return isTrueStatus(raw.securityPatchStatus);
    case PRODUCT_FLOW_PENDING_STAGE:
        return false;
    case "ready":
        return status.stage === "ready";
    default:
        return false;
    }
}

export function effectiveCurrentStage(status: DeployStatusData): string {
    const stages = stageItemsFor(status.osType);
    const firstIncomplete = stages.find((item) => !isStageDone(item.id, status));

    if (firstIncomplete) {
        return firstIncomplete.id;
    }

    return stages[stages.length - 1]?.id ?? status.stage;
}

function stepState(
    item: StageItem,
    index: number,
    currentIndex: number,
    currentStage: string,
    status: DeployStatusData
): "done" | "current" | "pending" {
    if (isStageDone(item.id, status)) {
        return "done";
    }

    if (item.id === currentStage) {
        return "current";
    }

    if (currentIndex > index) {
        return "done";
    }

    return "pending";
}

function labelColorForStatus(value: string): "green" | "orange" | "red" | "grey" | "blue" {
    const normalized = value.toUpperCase();

    if (!value || normalized === "UNKNOWN") {
        return "orange";
    }

    if (
        normalized === "TRUE" ||
    normalized === "RUNNING" ||
    normalized === "HEALTH_OK" ||
    normalized === "SUCCEEDED"
    ) {
        return "green";
    }

    if (normalized === "HEALTH_WARN" || normalized === "PENDING" || normalized === "QUEUED") {
        return "orange";
    }

    if (
        normalized === "FALSE" ||
    normalized === "HEALTH_ERR" ||
    normalized === "HEALTH_ERR1" ||
    normalized === "HEALTH_ERR2" ||
    normalized === "FAILED"
    ) {
        return "red";
    }

    if (normalized === "NOT_APPLICABLE" || normalized === "SKIPPED") {
        return "grey";
    }

    return "blue";
}

function labelTextForStatus(value: string): string {
    const normalized = value.toUpperCase();

    switch (normalized) {
    case "TRUE":
        return "완료";
    case "FALSE":
        return "미완료";
    case "RUNNING":
        return "실행중";
    case "HEALTH_OK":
        return "정상";
    case "HEALTH_WARN":
        return "주의";
    case "HEALTH_ERR":
        return "오류";
    case "HEALTH_ERR1":
        return "클러스터 미구성";
    case "HEALTH_ERR2":
        return "리소스 미구성";
    case "UNKNOWN":
        return "확인 필요";
    case "NOT_APPLICABLE":
        return "해당 없음";
    default:
        return value || "N/A";
    }
}

function licenseStatusLabel(value: string): string {
    if (!value) {
        return "확인 불가";
    }

    if (isTrueStatus(value)) {
        return "정상";
    }

    if (value.toUpperCase() === "UNKNOWN") {
        return "확인 필요";
    }

    if (value.toUpperCase() === "FALSE") {
        return "확인 필요";
    }

    return labelTextForStatus(value);
}

function licenseInfoStatusLabel(status: LicenseStatus): string {
    switch (status.kind) {
    case "active":
        return "정상";
    case "inactive":
        return "만료";
    case "missing":
        return "미등록";
    case "error":
        return "확인 실패";
    case "loading":
    default:
        return "확인 중";
    }
}

function jobStatusColor(status: string): "green" | "orange" | "red" | "grey" | "blue" {
    switch (status) {
    case "succeeded":
        return "green";
    case "failed":
        return "red";
    case "queued":
    case "running":
        return "orange";
    default:
        return "grey";
    }
}

function formatDateTime(value: string): string {
    if (!value) {
        return "N/A";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

function rawStatusRows(status: DeployStatusData) {
    const raw = status.raw;

    return [
        { label: "라이선스", value: raw.licenseStatus },
        { label: "클러스터 구성", value: raw.clusterConfigStatus },
        { label: "스토리지 VM", value: raw.storageVmStatus },
        { label: "스토리지 VM 구성", value: raw.storageVmBootstrapStatus },
        { label: "스토리지 클러스터", value: raw.storageClusterStatus },
        { label: "GFS 구성", value: raw.gfsConfigureStatus },
        { label: "로컬 스토리지", value: raw.localConfigureStatus },
        { label: "클라우드 VM", value: raw.cloudVmStatus },
        { label: "클라우드 VM 구성", value: raw.cloudVmBootstrapStatus },
        { label: "클라우드 PCS", value: raw.cloudClusterStatus },
        { label: "모니터링", value: raw.monitoringStatus },
        { label: "취약점 조치", value: raw.securityPatchStatus },
    ].filter((row) => row.value !== "");
}

function flowWarnings(status: DeployStatusData): DeployStatusWarning[] {
    return status.warnings.filter((warning) => warning.key !== SECURITY_PATCH_WARNING_KEY);
}

function securityPatchAction(status: DeployStatusData, isFlowComplete: boolean): string[] {
    const isSecurityPatchIncomplete = status.raw.securityPatchStatus !== "" &&
        !isTrueStatus(status.raw.securityPatchStatus);

    if (
        status.availableActions.includes("run_security_patch") ||
        (isFlowComplete && isSecurityPatchIncomplete)
    ) {
        return ["run_security_patch"];
    }

    return [];
}

function managementActionsFor(isFlowComplete: boolean): string[] {
    return isFlowComplete
        ? [...ALWAYS_AVAILABLE_ACTIONS, SECURITY_EVIDENCE_ACTION, VERSION_UPDATE_ACTION]
        : ALWAYS_AVAILABLE_ACTIONS;
}

function connectionActions(status: DeployStatusData): string[] {
    const actions: string[] = [];

    if (
        STORAGE_CENTER_PRODUCT_TYPES.has(status.osType) &&
        isStageDone(STORAGE_CENTER_CONFIGURE_STAGE, status)
    ) {
        actions.push("open_storage_center");
    }

    if (isStageDone(CLOUD_CENTER_CONFIGURE_STAGE, status)) {
        actions.push("open_cloud_center");
    }

    if (isStageDone(MONITORING_CENTER_CONFIGURE_STAGE, status)) {
        actions.push("open_monitoring_center");
    }

    return actions;
}

function visibleActions(status: DeployStatusData, currentStage: string): string[] {
    const isLicenseActionRequired = currentStage === LICENSE_STAGE ||
        (status.raw.licenseStatus && !isTrueStatus(status.raw.licenseStatus));
    const fallbackActions: string[] = [];

    if (
        currentStage === STORAGE_CENTER_CONFIGURE_STAGE &&
        isRunningStatus(status.raw.storageVmStatus) &&
        !isTrueStatus(status.raw.storageVmBootstrapStatus)
    ) {
        fallbackActions.push("configure_storage_vm");
    }

    if (
        currentStage === STORAGE_CLUSTER_CONFIGURE_STAGE &&
        STORAGE_CENTER_PRODUCT_TYPES.has(status.osType) &&
        isStageDone(STORAGE_CENTER_CONFIGURE_STAGE, status) &&
        !isStageDone(STORAGE_CLUSTER_CONFIGURE_STAGE, status)
    ) {
        fallbackActions.push("configure_storage_cluster");
    }

    if (
        currentStage === HCI_SHARED_FILE_CONFIGURE_STAGE &&
        status.osType === "ablestack-hci-filesystem" &&
        isStageDone(STORAGE_CLUSTER_CONFIGURE_STAGE, status) &&
        !isStageDone(HCI_SHARED_FILE_CONFIGURE_STAGE, status)
    ) {
        fallbackActions.push("configure_hci_shared_file");
    }

    if (
        currentStage === CLOUD_CENTER_CONFIGURE_STAGE &&
        isRunningStatus(status.raw.cloudVmStatus) &&
        !isTrueStatus(status.raw.cloudVmBootstrapStatus)
    ) {
        fallbackActions.push("configure_cloud_vm");
    }

    const actions = isLicenseActionRequired
        ? ["manage_license"]
        : [
            ...(!isStageDone(currentStage, status)
                ? (FLOW_STAGE_PRIMARY_ACTIONS[currentStage] ?? [])
                : []),
            ...status.availableActions.filter((action) => ACTION_STAGE[action] === currentStage),
            ...(FLOW_STAGE_ACTIONS[currentStage] ?? []).filter((action) =>
                status.availableActions.includes(action)),
            ...fallbackActions,
        ];

    return Array.from(new Set(actions));
}

function actionClassName(action: string): string {
    if (CONNECTION_ACTIONS.has(action)) {
        return "ct-deploy-ribbon__action ct-deploy-ribbon__action--connection";
    }

    if (MANAGEMENT_ACTIONS.has(action)) {
        return "ct-deploy-ribbon__action ct-deploy-ribbon__action--management";
    }

    if (action === "run_security_patch") {
        return "ct-deploy-ribbon__action ct-deploy-ribbon__action--security";
    }

    return "ct-deploy-ribbon__action ct-deploy-ribbon__action--workflow";
}

function stageClickAction(stage: string, state: "done" | "current" | "pending"): string {
    if (state === "pending") {
        return "";
    }

    return STAGE_CLICK_ACTION[stage] ?? "";
}

function ribbonMessage(isFlowComplete: boolean, currentStageLabel: string, data: DeployStatusData): string {
    if (isFlowComplete && data.warnings.length === 0) {
        return "ABLESTACK 클라우드센터 VM 배포되었으며 모니터링센터 구성이 완료되었습니다. 가상어플라이언스 상태가 정상입니다.";
    }

    if (isFlowComplete) {
        return "ABLESTACK 가상어플라이언스 구성이 완료되었으며 추가 확인이 필요한 운영 항목이 있습니다.";
    }

    if (!data.osType && currentStageLabel !== STAGE_LABELS[LICENSE_STAGE]) {
        return "제품 타입을 선택하면 제품별 설치 흐름과 다음 단계가 표시됩니다.";
    }

    return `${currentStageLabel} 단계 확인이 필요합니다.`;
}

function LiveStatusBadge() {
    return (
        <span className="ct-deploy-live" aria-label="실시간 상태 확인">
            <span className="ct-deploy-live__dot" aria-hidden="true" />
            실시간
        </span>
    );
}

function stepLabel(status: "done" | "current" | "pending") {
    switch (status) {
    case "done":
        return (
            <span className="ct-stage-status ct-stage-status--done">
                완료
            </span>
        );
    case "current":
        return (
            <span className="ct-stage-status ct-stage-status--current">
                진행 필요
            </span>
        );
    default:
        return <span className="ct-stage-status ct-stage-status--pending">대기</span>;
    }
}

function renderJobStep(step: DeployRunStepResult) {
    return (
        <span key={`${step.name}-${step.status}`} className="ct-deploy-overview__job-step">
            <Label color={jobStatusColor(step.status)}>
                {STEP_STATUS_LABELS[step.status] ?? (step.status || "N/A")}
            </Label>
            <span>
                {DEPLOY_RUN_STEP_LABELS[step.name] ??
                    STAGE_LABELS[step.name] ??
                    ACTION_LABELS[step.name] ??
                    step.name}
            </span>
        </span>
    );
}

function StatusPlaceholder({
    title,
    message,
    compact = false,
}: {
    title: string;
    message: string;
    compact?: boolean;
}) {
    return (
        <div
          className={[
              "ct-deploy-overview__placeholder",
              compact ? "ct-deploy-overview__placeholder--compact" : "",
          ].join(" ")}
        >
            <InfoCircleIcon aria-hidden="true" />
            <div>
                <strong>{title}</strong>
                <span>{message}</span>
            </div>
        </div>
    );
}

export default function DeploymentOverview({
    onAction,
    onOpenDeployRun,
    onStatusChange,
    mode = "flow",
}: DeploymentOverviewProps) {
    const [statusError, setStatusError] = React.useState("");
    const [jobs, setJobs] = React.useState<DeployRunJob[]>([]);
    const [jobsError, setJobsError] = React.useState("");
    const [osVersion, setOsVersion] = React.useState("확인 중");
    const [isManagementActionsOpen, setIsManagementActionsOpen] = React.useState(false);
    const [isLicenseInfoOpen, setIsLicenseInfoOpen] = React.useState(false);
    const [licenseInfo, setLicenseInfo] = React.useState<LicenseStatus>({ kind: "loading" });

    const handleStatusSuccess = React.useCallback((nextStatus: DeployStatusData) => {
        setStatusError("");
        onStatusChange?.(nextStatus);
    }, [onStatusChange]);

    const handleStatusError = React.useCallback((error: unknown) => {
        setStatusError(error instanceof Error ? error.message : String(error));
    }, []);

    const { data, isCollecting, hasResolved } = useStatusPolling({
        fetcher: fetchDeployStatus,
        fallback: DEPLOY_STATUS_FALLBACK,
        retainPreviousOnError: true,
        onSuccess: handleStatusSuccess,
        onError: handleStatusError,
    });

    const loadJobs = React.useCallback(() => {
        fetchDeployRunJobs()
                .then((nextJobs) => {
                    setJobs(nextJobs);
                    setJobsError("");
                })
                .catch((error) => {
                    setJobs([]);
                    setJobsError(error instanceof Error ? error.message : String(error));
                });
    }, []);

    React.useEffect(() => {
        loadJobs();
        const intervalId = window.setInterval(loadJobs, 10000);

        return () => window.clearInterval(intervalId);
    }, [loadJobs]);

    React.useEffect(() => {
        let isMounted = true;

        const loadVersion = () => {
            fetchVersionInfo()
                    .then((version) => {
                        if (!isMounted) return;
                        setOsVersion(version.osVersion || "확인 불가");
                    })
                    .catch(() => {
                        if (!isMounted) return;
                        setOsVersion("확인 불가");
                    });
        };

        loadVersion();
        const intervalId = window.setInterval(loadVersion, 60000);

        return () => {
            isMounted = false;
            window.clearInterval(intervalId);
        };
    }, []);

    const openLicenseInfo = () => {
        setIsLicenseInfoOpen(true);
        setLicenseInfo({ kind: "loading" });

        fetchLicenseStatus()
                .then(setLicenseInfo)
                .catch((error) => {
                    setLicenseInfo({
                        kind: "error",
                        message: error instanceof Error ? error.message : String(error),
                    });
                });
    };

    const closeLicenseInfo = () => {
        setIsLicenseInfoOpen(false);
    };

    const isInitialStatusLoading = !hasResolved && !statusError;
    const isStatusUnavailable = data.messageKey === "deploy_status_unavailable" &&
        !data.checkedAt &&
        !data.osType;
    const useStatusPlaceholder = isInitialStatusLoading || isStatusUnavailable;
    const stages = useStatusPlaceholder ? [] : stageItemsFor(data.osType);
    const currentStage = useStatusPlaceholder ? "" : effectiveCurrentStage(data);
    const currentIndex = stages.findIndex((item) => item.id === currentStage);
    const currentStageLabel = useStatusPlaceholder
        ? (isInitialStatusLoading ? "배포 상태 확인 중" : "배포 상태 확인 불가")
        : STAGE_LABELS[currentStage] ?? currentStage;
    const currentStageDescription = useStatusPlaceholder
        ? "서버에서 현재 제품 구성과 배포 상태를 확인하고 있습니다."
        : STAGE_DESCRIPTIONS[currentStage] ?? "현재 단계의 진행 상태를 확인합니다.";
    const isFlowComplete = stages.length > 0 && stages.every((item) => isStageDone(item.id, data));
    const blockingWarnings = flowWarnings(data);
    const message = useStatusPlaceholder
        ? (isInitialStatusLoading ? "배포 상태를 확인하고 있습니다." : "배포 상태 정보를 확인할 수 없습니다.")
        : isFlowComplete
            ? (MESSAGE_LABELS[data.messageKey] ?? data.messageKey)
            : `${currentStageLabel} 단계 확인이 필요합니다.`;
    const summaryMessage = useStatusPlaceholder
        ? (isInitialStatusLoading
            ? "현재 배포 상태를 불러오는 중입니다. 확인된 상태를 받기 전까지 이전 단계로 이동하지 않습니다."
            : "배포 상태를 확인할 수 없습니다. 호스트 연결 상태를 확인해 주세요.")
        : ribbonMessage(
            isFlowComplete,
            currentStageLabel,
            { ...data, warnings: blockingWarnings }
        );
    const productLabel = useStatusPlaceholder
        ? "확인 중"
        : PRODUCT_LABELS[data.osType] ?? (data.osType || "클러스터 타입 미정");
    const actions = useStatusPlaceholder
        ? ALWAYS_AVAILABLE_ACTIONS
        : Array.from(new Set([
            ...connectionActions(data),
            ...visibleActions(data, currentStage).filter((action) =>
                !CONNECTION_ACTIONS.has(action) && !MANAGEMENT_ACTIONS.has(action)),
            ...securityPatchAction(data, isFlowComplete),
            ...managementActionsFor(isFlowComplete),
        ]));
    const ribbonConnectionActions = useStatusPlaceholder ? [] : connectionActions(data);
    const ribbonPrimaryActions = useStatusPlaceholder
        ? []
        : Array.from(new Set([
            ...visibleActions(data, currentStage).filter((action) =>
                !CONNECTION_ACTIONS.has(action) && !MANAGEMENT_ACTIONS.has(action)),
            ...securityPatchAction(data, isFlowComplete),
        ]));
    const ribbonManagementActions = managementActionsFor(isFlowComplete);
    const checkedAtLabel = useStatusPlaceholder ? "확인 중" : formatDateTime(data.checkedAt);
    const osVersionLabel = useStatusPlaceholder ? "확인 중" : osVersion;
    const licenseLabel = useStatusPlaceholder ? "확인 중" : licenseStatusLabel(data.raw.licenseStatus);
    const isPreProductFlow = !useStatusPlaceholder && (!data.osType ||
        currentStage === LICENSE_STAGE ||
        currentStage === "cluster_prepare" ||
        currentStage === PRODUCT_FLOW_PENDING_STAGE);
    const isLicenseReady = data.raw.licenseStatus.toLowerCase() === "true";
    const showDeployRunControl = !useStatusPlaceholder && isLicenseReady &&
        !isStageDone(MONITORING_CENTER_CONNECT_STAGE, data);

    if (mode === "ribbon") {
        return (
            <Card
              className={[
                  "ct-deploy-ribbon",
                  isFlowComplete && blockingWarnings.length === 0
                      ? "ct-deploy-ribbon--success"
                      : "ct-deploy-ribbon--attention",
                  isPreProductFlow ? "ct-deploy-ribbon--pre-product" : "",
              ].join(" ")}
            >
                <CardBody className="ct-deploy-ribbon__body">
                    <div className="ct-deploy-ribbon__layout">
                        <div className="ct-deploy-ribbon__main">
                            <div className="ct-deploy-ribbon__copy">
                                <div className="ct-deploy-ribbon__title-row">
                                    <InfoCircleIcon aria-hidden="true" />
                                    <strong>ABLESTACK 가상어플라이언스 상태</strong>
                                    {isCollecting && <LiveStatusBadge />}
                                </div>
                                <h1>{currentStageLabel}</h1>
                                <Content component="p">{summaryMessage}</Content>
                            </div>

                            <div className="ct-deploy-ribbon__meta">
                                <div>
                                    <span>제품 타입</span>
                                    <strong>{productLabel}</strong>
                                </div>
                                <div>
                                    <span>OS 버전</span>
                                    <strong>{osVersionLabel}</strong>
                                </div>
                                <div>
                                    <span>라이선스 상태</span>
                                    <div className="ct-deploy-ribbon__meta-value-row">
                                        <strong>{licenseLabel}</strong>
                                        <button
                                          type="button"
                                          className="ct-deploy-ribbon__meta-check"
                                          onClick={openLicenseInfo}
                                        >
                                            확인
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <span>확인 시각</span>
                                    <strong>{checkedAtLabel}</strong>
                                </div>
                            </div>

                            {statusError && (
                                <div className="ct-deploy-ribbon__error">
                                    <ExclamationTriangleIcon aria-hidden="true" />
                                    <span>{statusError}</span>
                                </div>
                            )}

                            {ribbonConnectionActions.length > 0 && (
                                <div className="ct-deploy-ribbon__connection-zone ct-deploy-ribbon__connection-zone--main">
                                    <span>관리 콘솔</span>
                                    <div className="ct-deploy-ribbon__actions ct-deploy-ribbon__actions--connection">
                                        {ribbonConnectionActions.map((action) => (
                                            <Button
                                              key={action}
                                              variant="secondary"
                                              className={actionClassName(action)}
                                              onClick={() => onAction(action)}
                                            >
                                                {ACTION_LABELS[action] ?? action}
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="ct-deploy-ribbon__flow-panel">
                            <div className="ct-deploy-overview__section-title">제품 흐름</div>
                            <div className="ct-deploy-ribbon__flow-content">
                                {useStatusPlaceholder
                                    ? (
                                        <StatusPlaceholder
                                          title={currentStageLabel}
                                          message={summaryMessage}
                                        />
                                    )
                                    : (
                                        <div className="ct-deploy-ribbon__stage-list">
                                            {stages.map((item, index) => {
                                                const state = stepState(item, index, currentIndex, currentStage, data);
                                                const clickAction = stageClickAction(item.id, state);

                                                return (
                                                    <button
                                                      key={item.id}
                                                      type="button"
                                                      className={[
                                                          "ct-deploy-ribbon__stage",
                                                          `ct-deploy-ribbon__stage--${state}`,
                                                          clickAction ? "ct-deploy-ribbon__stage--clickable" : "",
                                                      ].join(" ")}
                                                      onClick={() => clickAction && onAction(clickAction)}
                                                      disabled={!clickAction}
                                                    >
                                                        <span>{index + 1}</span>
                                                        <strong>{item.label}</strong>
                                                        {stepLabel(state)}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                            </div>
                            <div className="ct-deploy-ribbon__workflow-zone">
                                <span>단계 작업</span>
                                <div className="ct-deploy-ribbon__workflow-controls">
                                    <div className="ct-deploy-ribbon__actions ct-deploy-ribbon__actions--primary">
                                        {ribbonPrimaryActions.length === 0 && !showDeployRunControl && ribbonManagementActions.length === 0
                                            ? (
                                                <span className="ct-deploy-overview__muted">
                                                    {useStatusPlaceholder
                                                        ? "상태 확인 후 가능한 작업이 표시됩니다."
                                                        : "현재 단계에서 표시할 작업이 없습니다."}
                                                </span>
                                            )
                                            : ribbonPrimaryActions.map((action) => (
                                                <Button
                                                  key={action}
                                                  variant="secondary"
                                                  className={actionClassName(action)}
                                                  onClick={() => onAction(action)}
                                                >
                                                    {ACTION_LABELS[action] ?? action}
                                                </Button>
                                            ))}
                                        {showDeployRunControl && (
                                            <Button
                                              variant="secondary"
                                              className="ct-deploy-ribbon__action ct-deploy-ribbon__action--workflow"
                                              onClick={onOpenDeployRun}
                                            >
                                                올인원 제어
                                            </Button>
                                        )}
                                    </div>
                                    {ribbonManagementActions.length > 0 && (
                                        <div className="ct-deploy-ribbon__utility-menu">
                                            <Button
                                              variant="secondary"
                                              className="ct-deploy-ribbon__action ct-deploy-ribbon__action--utility"
                                              aria-expanded={isManagementActionsOpen}
                                              onClick={() => setIsManagementActionsOpen((current) => !current)}
                                            >
                                                <span className="ct-deploy-ribbon__utility-label">
                                                    관리 도구
                                                    <span
                                                      className={[
                                                          "ct-deploy-ribbon__utility-chevron",
                                                          isManagementActionsOpen ? "ct-deploy-ribbon__utility-chevron--open" : "",
                                                      ].join(" ")}
                                                      aria-hidden="true"
                                                    />
                                                </span>
                                            </Button>
                                            <div
                                              className={[
                                                  "ct-deploy-ribbon__utility-panel",
                                                  isManagementActionsOpen ? "ct-deploy-ribbon__utility-panel--open" : "",
                                              ].join(" ")}
                                              aria-hidden={!isManagementActionsOpen}
                                            >
                                                {ribbonManagementActions.map((action) => (
                                                    <Button
                                                      key={action}
                                                      variant="secondary"
                                                      className={actionClassName(action)}
                                                      isDisabled={!isManagementActionsOpen}
                                                      onClick={() => {
                                                          setIsManagementActionsOpen(false);
                                                          onAction(action);
                                                      }}
                                                    >
                                                        {ACTION_LABELS[action] ?? action}
                                                    </Button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </CardBody>
                <Modal
                  isOpen={isLicenseInfoOpen}
                  onClose={closeLicenseInfo}
                  variant="small"
                  aria-label="라이선스 상태 정보"
                  className="ct-license-info-modal"
                >
                    <ModalHeader title="라이선스 상태 정보" />
                    <ModalBody>
                        {licenseInfo.kind === "loading" ? (
                            <div className="ct-license-info-modal__loading">
                                <Spinner size="sm" aria-label="라이선스 정보 확인 중" />
                                <span>라이선스 정보를 확인하는 중입니다.</span>
                            </div>
                        ) : (
                            <div className="ct-license-info-modal__content">
                                <div>
                                    <span>상태</span>
                                    <strong>{licenseInfoStatusLabel(licenseInfo)}</strong>
                                </div>
                                <div>
                                    <span>시작일</span>
                                    <strong>{licenseInfo.issued || "-"}</strong>
                                </div>
                                <div>
                                    <span>만료일</span>
                                    <strong>{licenseInfo.expired || "-"}</strong>
                                </div>
                                {licenseInfo.kind === "error" && (
                                    <p className="ct-license-info-modal__message">
                                        {licenseInfo.message || "라이선스 정보를 확인할 수 없습니다."}
                                    </p>
                                )}
                                {licenseInfo.kind === "missing" && (
                                    <p className="ct-license-info-modal__message">
                                        등록된 라이선스가 없습니다.
                                    </p>
                                )}
                            </div>
                        )}
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="primary" onClick={closeLicenseInfo}>
                            확인
                        </Button>
                    </ModalFooter>
                </Modal>
            </Card>
        );
    }

    return (
        <Card className="ct-deploy-overview">
            <CardHeader className="ct-deploy-overview__header">
                <div>
                    <CardTitle>ABLESTACK 배포 진행 현황</CardTitle>
                    <Content component="p" className="ct-deploy-overview__subtitle">
                        {message}
                    </Content>
                </div>
                <div className="ct-deploy-overview__summary">
                    <Label color={isFlowComplete && data.severity === "success" ? "green" : "orange"}>
                        {isFlowComplete && data.severity === "success" ? "정상" : "확인 필요"}
                    </Label>
                    {isCollecting && <LiveStatusBadge />}
                </div>
            </CardHeader>

            <CardBody>
                <div className="ct-deploy-overview__meta">
                    <div>
                        <span>제품 타입</span>
                        <strong>{productLabel}</strong>
                    </div>
                    <div>
                        <span>현재 단계</span>
                        <strong>{currentStageLabel}</strong>
                    </div>
                    <div>
                        <span>확인 시각</span>
                        <strong>{formatDateTime(data.checkedAt)}</strong>
                    </div>
                </div>

                {statusError && (
                    <div className="ct-deploy-overview__error">
                        <ExclamationTriangleIcon aria-hidden="true" />
                        <span>{statusError}</span>
                    </div>
                )}

                <div className="ct-deploy-overview__flow">
                    <div className="ct-deploy-overview__flow-list">
                        <div className="ct-deploy-overview__section-title">제품 흐름</div>
                        {useStatusPlaceholder
                            ? (
                                <StatusPlaceholder
                                  title={currentStageLabel}
                                  message={summaryMessage}
                                  compact
                                />
                            )
                            : (
                                <div className="ct-deploy-overview__stage-list">
                                    {stages.map((item, index) => {
                                        const state = stepState(item, index, currentIndex, currentStage, data);
                                        const clickAction = stageClickAction(item.id, state);

                                        return (
                                            <button
                                              key={item.id}
                                              type="button"
                                              className={`ct-deploy-overview__stage ct-deploy-overview__stage--${state}`}
                                              onClick={() => clickAction && onAction(clickAction)}
                                              disabled={!clickAction}
                                            >
                                                <div className="ct-deploy-overview__stage-marker">{index + 1}</div>
                                                <div className="ct-deploy-overview__stage-body">
                                                    <span>{item.label}</span>
                                                    {stepLabel(state)}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                    </div>

                    <div className="ct-deploy-overview__current-panel">
                        <span className="ct-deploy-overview__current-eyebrow">현재 단계</span>
                        <h2>{currentStageLabel}</h2>
                        <Content component="p">{currentStageDescription}</Content>
                        <div className="ct-deploy-overview__action-row">
                            {actions.length === 0
                                ? (
                                    <span className="ct-deploy-overview__muted">
                                        {useStatusPlaceholder
                                            ? "상태 확인 후 가능한 작업이 표시됩니다."
                                            : "현재 단계에서 표시할 작업이 없습니다."}
                                    </span>
                                )
                                : actions.map((action) => (
                                    <Button
                                      key={action}
                                      variant="primary"
                                      onClick={() => onAction(action)}
                                    >
                                        {ACTION_LABELS[action] ?? action}
                                    </Button>
                                ))}
                            {showDeployRunControl && (
                                <Button variant="secondary" onClick={onOpenDeployRun}>
                                    올인원 단계 입력
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="ct-deploy-overview__details">
                    <div className="ct-deploy-overview__raw">
                        <div className="ct-deploy-overview__section-title">상태 스냅샷</div>
                        <div className="ct-deploy-overview__raw-grid">
                            {rawStatusRows(data).map((row) => (
                                <div key={row.label} className="ct-deploy-overview__raw-item">
                                    <span>{row.label}</span>
                                    <Label color={labelColorForStatus(row.value)}>
                                        {labelTextForStatus(row.value)}
                                    </Label>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="ct-deploy-overview__jobs">
                        <div className="ct-deploy-overview__section-title">
                            최근 올인원 Job
                            <Button variant="link" onClick={loadJobs}>
                                새로고침
                            </Button>
                        </div>
                        {jobsError && (
                            <div className="ct-deploy-overview__error ct-deploy-overview__error--compact">
                                <InfoCircleIcon aria-hidden="true" />
                                <span>{jobsError}</span>
                            </div>
                        )}
                        {!jobsError && jobs.length === 0 && (
                            <span className="ct-deploy-overview__muted">최근 실행된 Job이 없습니다.</span>
                        )}
                        {!jobsError && jobs.slice(0, 3).map((job) => (
                            <div key={job.jobId} className="ct-deploy-overview__job">
                                <div className="ct-deploy-overview__job-header">
                                    <Label color={jobStatusColor(job.status)}>
                                        {JOB_STATUS_LABELS[job.status] ?? (job.status || "N/A")}
                                    </Label>
                                    <strong>{job.jobId || "N/A"}</strong>
                                </div>
                                <div className="ct-deploy-overview__job-meta">
                                    <span>{formatDateTime(job.createdAt)}</span>
                                    {job.currentStep && <span>현재: {job.currentStep}</span>}
                                </div>
                                <div className="ct-deploy-overview__job-steps">
                                    {job.steps.length > 0
                                        ? job.steps.map(renderJobStep)
                                        : <span className="ct-deploy-overview__muted">step 정보가 없습니다.</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {data.warnings.length > 0 && (
                    <div className="ct-deploy-overview__warnings">
                        {data.warnings.map((warning) => (
                            <div key={warning.key}>
                                <ExclamationTriangleIcon aria-hidden="true" />
                                <span>{warning.message || warning.key}</span>
                            </div>
                        ))}
                    </div>
                )}
            </CardBody>
        </Card>
    );
}
