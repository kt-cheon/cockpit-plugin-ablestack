import React from "react";
import TaskProgress from "../components/common/TaskProgress";

import {
    Alert,
    Button,
    Card,
    CardBody,
    CardHeader,
    CardTitle,
    Checkbox,
    Content,
    Form,
    FormGroup,
    FormSelect,
    FormSelectOption,
    Label,
    Modal,
    ModalBody,
    ModalFooter,
    ModalHeader,
    Spinner,
    TextInput,
} from "@patternfly/react-core";

import {
    fetchDeployUrl,
    fetchDeployRunJobs,
    startDeployRun,
    type DeployRunJob,
    type DeployRunStepResult,
    type DeployStatusData,
} from "../services/api/deploy-status.ts";
import { fetchDiskInventory, fetchNicInventory, type DiskInventoryOption, type InventorySelectOption } from "../services/api/inventory";

interface AllInOneControlModalProps {
  isOpen: boolean;
  onClose: () => void;
  deployStatus: DeployStatusData;
  onStarted: (message: string) => void;
  onCompleted?: () => void;
}

type ProductType =
  | "ablestack-vm"
  | "ablestack-hci"
  | "ablestack-hci-filesystem"
  | "ablestack-standalone";

type RunPhase = "idle" | "running" | "success" | "error";
type UiStepState = "done" | "current" | "pending" | "failed";
type InventoryLoadState = "idle" | "loading" | "success" | "error";

interface HostRow {
  index: string;
  hostname: string;
  ablecube: string;
  storageIp?: string;
  scvmMngt?: string;
  ablecubePn?: string;
  scvm?: string;
  scvmCn?: string;
}

interface FlowStep {
  id: string;
  label: string;
  description: string;
  deploySteps: string[];
}

interface RestartRecommendation {
  index: number;
  summary: string;
  detail: string;
  isComplete: boolean;
}

const PRODUCT_OPTIONS: Array<{ value: ProductType; label: string }> = [
    { value: "ablestack-vm", label: "ABLESTACK-VM" },
    { value: "ablestack-hci", label: "ABLESTACK-HCI" },
    { value: "ablestack-hci-filesystem", label: "ABLESTACK-HCI Filesystem" },
    { value: "ablestack-standalone", label: "ABLESTACK Standalone" },
];

const EMPTY_BRIDGE_OPTIONS: InventorySelectOption[] = [
    { value: "", label: "선택하십시오" },
];

const optionValueAt = (options: InventorySelectOption[], index: number) =>
    options.filter((option) => option.value)[index]?.value || "";

const PRODUCT_SET = new Set<string>(PRODUCT_OPTIONS.map((option) => option.value));

const DEFAULT_HOSTS = "1,ablecube1,,,,,,";

const STEP_STATUS_LABELS: Record<string, string> = {
    pending: "대기",
    running: "진행 중",
    succeeded: "성공",
    failed: "실패",
    skipped: "건너뜀",
};

function isProductType(value: string): value is ProductType {
    return PRODUCT_SET.has(value);
}

function initialProductType(status: DeployStatusData): ProductType {
    return isProductType(status.osType) ? status.osType : "ablestack-vm";
}

function productLabel(type: ProductType): string {
    return PRODUCT_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

function splitLines(value: string): string[] {
    return value
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
}

function splitList(value: string): string[] {
    return value
            .split(/[\n,]+/)
            .map((item) => item.trim())
            .filter(Boolean);
}

function parseHosts(value: string): HostRow[] {
    return splitLines(value).map((line) => {
        const fields = line.split(",").map((field) => field.trim());

        return {
            index: fields[0] ?? "",
            hostname: fields[1] ?? "",
            ablecube: fields[2] ?? "",
            scvmMngt: fields[3] || undefined,
            ablecubePn: fields[4] || undefined,
            scvm: fields[5] || undefined,
            scvmCn: fields[6] || undefined,
            storageIp: fields[7] || undefined,
        };
    });
}

function serializeHosts(hosts: HostRow[]): string {
    return hosts.map((host) => [
        host.index,
        host.hostname,
        host.ablecube,
        host.scvmMngt ?? "",
        host.ablecubePn ?? "",
        host.scvm ?? "",
        host.scvmCn ?? "",
        host.storageIp ?? "",
    ].join(",")).join("\n");
}

function vmHosts(hostsText: string): string {
    const hosts = parseHosts(hostsText);

    if (hosts.length === 0) {
        return DEFAULT_HOSTS;
    }

    return serializeHosts(hosts.map((host, index) => ({
        ...host,
        index: host.index || String(index + 1),
        hostname: ["", "localhost"].includes(host.hostname)
            ? `ablecube${index + 1}`
            : host.hostname,
    })));
}

function hciHosts(hostsText: string): string {
    const current = parseHosts(hostsText);
    const hosts = Array.from({ length: Math.max(3, current.length) }, (_value, index) => {
        const existing = current[index];
        const defaultHostname = `ablecube${index + 1}`;

        if (!existing) {
            return { index: String(index + 1), hostname: defaultHostname, ablecube: "" };
        }

        return {
            ...existing,
            index: String(index + 1),
            hostname: ["", "localhost", "hostname", "hostname1", "hostname2", "hostname3"].includes(existing.hostname)
                ? defaultHostname
                : existing.hostname,
        };
    });

    return serializeHosts(hosts);
}

function flowStepsFor(productType: ProductType): FlowStep[] {
    const usesStorageCenter = productType === "ablestack-hci" || productType === "ablestack-hci-filesystem";
    const usesHciFilesystem = productType === "ablestack-hci-filesystem";
    const usesExternalGfs = productType === "ablestack-vm";
    const usesLocal = productType === "ablestack-standalone";

    return [
        {
            id: "cluster",
            label: "클러스터 구성 준비",
            description: "클러스터 종류, 클러스터 구성 프로파일, 관리 네트워크와 PCS 대상 정보를 검증합니다.",
            deploySteps: ["cluster_apply"],
        },
        ...(usesStorageCenter
            ? [
                {
                    id: "scvm",
                    label: "스토리지센터 VM 설정",
                    description: "호스트별 SCVM 리소스, 디스크 Passthrough, 네트워크 Bridge 값을 검증합니다.",
                    deploySteps: ["scvm_prepare"],
                },
                {
                    id: "storage_center",
                    label: "스토리지센터 구성",
                    description: "기존 bootstrap 스크립트로 스토리지센터의 초기 구성을 진행합니다.",
                    deploySteps: ["scvm_bootstrap"],
                },
                {
                    id: "storage_cluster",
                    label: "스토리지 클러스터 상세 구성",
                    description: "스토리지센터에서 OSD와 rbd 풀 구성을 완료했는지 확인합니다.",
                    deploySteps: ["storage_verify"],
                }
            ]
            : []),
        ...(usesHciFilesystem
            ? [
                {
                    id: "hci_shared_file",
                    label: "RBD/GFS 구성",
                    description: "rbd image 생성, 각 host rbd map, Global File System mount 구성을 준비합니다.",
                    deploySteps: ["rbd_prepare", "storage_prepare"],
                }
            ]
            : []),
        ...(usesExternalGfs
            ? [
                {
                    id: "gfs_storage",
                    label: "GFS 스토리지 구성",
                    description: "외부 스토리지 기반 GFS 대상 디스크를 선택하고 구성을 준비합니다.",
                    deploySteps: ["storage_prepare"],
                }
            ]
            : []),
        ...(usesLocal
            ? [
                {
                    id: "local_storage",
                    label: "로컬 스토리지 구성",
                    description: "Standalone 로컬 디스크 구성을 검증합니다.",
                    deploySteps: ["local_prepare"],
                }
            ]
            : []),
        {
            id: "ccvm",
            label: "클라우드센터 VM 설정",
            description: "CCVM 리소스, 관리네트워크와 선택적 서비스네트워크 값을 검증합니다.",
            deploySteps: ["ccvm_prepare"],
        },
        {
            id: "cloud_center",
            label: "클라우드센터 구성",
            description: "CCVM bootstrap 실행과 Mold 서비스 준비 상태를 확인합니다.",
            deploySteps: ["ccvm_bootstrap"],
        },
        {
            id: "monitoring_connect",
            label: "모니터링센터 연결",
            description: "입력값을 최종 검증한 뒤 올인원 구성 Job을 시작하고, 완료 후 모니터링센터 연결로 이어갑니다.",
            deploySteps: ["monitoring_prepare", "system_profile"],
        },
    ];
}

function deployOnlyStepsFor(productType: ProductType): string[] {
    const commonHead = ["license_apply", "cluster_apply"];
    const commonTail = ["ccvm_prepare", "ccvm_bootstrap", "monitoring_prepare", "system_profile"];

    switch (productType) {
    case "ablestack-hci":
        return [...commonHead, "scvm_prepare", "scvm_bootstrap", "storage_verify", ...commonTail];
    case "ablestack-hci-filesystem":
        return [...commonHead, "scvm_prepare", "scvm_bootstrap", "storage_verify", "rbd_prepare", "storage_prepare", ...commonTail];
    case "ablestack-standalone":
        return [...commonHead, "local_prepare", ...commonTail];
    case "ablestack-vm":
    default:
        return [...commonHead, "storage_prepare", ...commonTail];
    }
}

function labelForUiStepState(state: UiStepState, phase: RunPhase) {
    switch (state) {
    case "done":
        return <Label color={phase === "idle" ? "teal" : "green"}>{phase === "idle" ? "입력 완료" : "완료"}</Label>;
    case "current":
        return (
            <Label color={phase === "idle" ? "blue" : "orange"}>
                {phase === "idle" ? "입력 중" : "진행 중"}
            </Label>
        );
    case "failed":
        return <Label color="red">실패</Label>;
    default:
        return <Label color="grey">대기</Label>;
    }
}

function colorForJobStatus(status: string) {
    if (status === "failed") return "red";
    if (status === "succeeded") return "green";
    return "blue";
}

function colorForJobStepStatus(status: string) {
    if (status === "failed") return "red";
    if (status === "succeeded") return "green";
    return "grey";
}

function isTrueStatus(value: string): boolean {
    return value.toLowerCase() === "true";
}

function isRunningStatus(value: string): boolean {
    return value.toUpperCase() === "RUNNING" || value.toLowerCase() === "running";
}

function isFlowStepComplete(step: FlowStep, productType: ProductType, status: DeployStatusData): boolean {
    const raw = status.raw;

    switch (step.id) {
    case "cluster":
        return isTrueStatus(raw.clusterConfigStatus);
    case "scvm":
        return isRunningStatus(raw.storageVmStatus);
    case "storage_center":
        return isTrueStatus(raw.storageVmBootstrapStatus);
    case "storage_cluster":
        return raw.storageClusterStatus.toUpperCase() === "HEALTH_OK" ||
            raw.storageClusterStatus.toUpperCase() === "HEALTH_WARN";
    case "hci_shared_file":
    case "gfs_storage":
        return isTrueStatus(raw.gfsConfigureStatus);
    case "local_storage":
        return isTrueStatus(raw.localConfigureStatus);
    case "ccvm":
        return isRunningStatus(raw.cloudVmStatus);
    case "cloud_center":
        return isTrueStatus(raw.cloudVmBootstrapStatus);
    case "monitoring_connect":
        return isTrueStatus(raw.monitoringStatus);
    default:
        return false;
    }
}

function firstFailedFlowStepIndex(flowSteps: FlowStep[], job: DeployRunJob | null): number {
    const failedStep = job?.steps.find((step) => step.status === "failed");

    if (!failedStep) return -1;
    return flowSteps.findIndex((step) => step.deploySteps.includes(failedStep.name));
}

function restartRecommendationFor(
    productType: ProductType,
    status: DeployStatusData,
    job: DeployRunJob | null = null
): RestartRecommendation {
    const flowSteps = flowStepsFor(productType);
    const failedIndex = firstFailedFlowStepIndex(flowSteps, job);

    if (failedIndex >= 0) {
        const failedFlowStep = flowSteps[failedIndex];
        const failedJobStep = job?.steps.find((step) => step.status === "failed");
        const failedMessage = failedJobStep?.message ? ` 실패 메시지: ${failedJobStep.message}` : "";

        return {
            index: failedIndex,
            summary: `${failedFlowStep.label}부터 재시도`,
            detail: `${failedFlowStep.label} 단계에서 Job 실행이 실패했습니다.${failedMessage} 입력값을 확인한 뒤 해당 단계부터 다시 진행하는 것을 권장합니다.`,
            isComplete: false,
        };
    }

    const incompleteIndex = flowSteps.findIndex((step) => !isFlowStepComplete(step, productType, status));

    if (incompleteIndex < 0) {
        const lastIndex = Math.max(flowSteps.length - 1, 0);

        return {
            index: lastIndex,
            summary: "재시작 필요 없음",
            detail: "현재 제품 흐름은 모니터링센터 연결 단계까지 완료된 상태로 판단됩니다.",
            isComplete: true,
        };
    }

    const incompleteStep = flowSteps[incompleteIndex];
    const completedCount = flowSteps.slice(0, incompleteIndex)
            .filter((step) => isFlowStepComplete(step, productType, status))
            .length;

    return {
        index: incompleteIndex,
        summary: `${incompleteStep.label}부터 다시 확인`,
        detail: `현재 제품 흐름에서 ${completedCount}/${flowSteps.length} 단계가 완료된 것으로 판단됩니다. 이전 단계는 상태값 기준으로 완료되어 있으니 ${incompleteStep.label} 단계부터 입력값을 확인하고 이어서 진행하세요.`,
        isComplete: false,
    };
}

function jobStepMap(job: DeployRunJob | null): Record<string, DeployRunStepResult> {
    return Object.fromEntries((job?.steps ?? []).map((step) => [step.name, step]));
}

function stateForFlowStep(
    step: FlowStep,
    index: number,
    activeStep: number,
    phase: RunPhase,
    job: DeployRunJob | null
): UiStepState {
    if (!job || phase === "idle") {
        if (index < activeStep) return "done";
        if (index === activeStep) return "current";
        return "pending";
    }

    const steps = jobStepMap(job);
    const statuses = step.deploySteps
            .map((deployStep) => steps[deployStep]?.status)
            .filter(Boolean);

    if (statuses.includes("failed")) return "failed";
    if (statuses.includes("running") || step.deploySteps.includes(job.currentStep)) return "current";
    if (statuses.length > 0 && statuses.every((status) => status === "succeeded" || status === "skipped")) {
        return "done";
    }
    if (job.status === "succeeded") return "done";

    return "pending";
}

function jobSummary(job: DeployRunJob): string {
    return `Job ${job.jobId || "-"} 시작됨`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export default function AllInOneControlModal({
    isOpen,
    onClose,
    deployStatus,
    onStarted,
    onCompleted,
}: AllInOneControlModalProps) {
    const [activeStep, setActiveStep] = React.useState(0);
    const [productType, setProductType] = React.useState<ProductType>(initialProductType(deployStatus));
    const [ccvmIp, setCcvmIp] = React.useState("");
    const [mngtCidr, setMngtCidr] = React.useState("");
    const [mngtGw, setMngtGw] = React.useState("");
    const [mngtDns, setMngtDns] = React.useState("");
    const [externalTimeServer, setExternalTimeServer] = React.useState("");
    const [iscsiStorage, setIscsiStorage] = React.useState(false);
    const [hostsText, setHostsText] = React.useState(DEFAULT_HOSTS);
    const [scvmCpu, setScvmCpu] = React.useState("8");
    const [scvmMemory, setScvmMemory] = React.useState("32");
    const [scvmDiskType, setScvmDiskType] = React.useState("disk_passthrough");
    const [scvmMgmtBridge, setScvmMgmtBridge] = React.useState("");
    const [scvmStorageMode, setScvmStorageMode] = React.useState("bridge");
    const [scvmServerBridge, setScvmServerBridge] = React.useState("");
    const [scvmReplicationBridge, setScvmReplicationBridge] = React.useState("");
    const [scvmDisksByHost, setScvmDisksByHost] = React.useState<Record<string, string[]>>({});
    const [gfsDisksText, setGfsDisksText] = React.useState("");
    const [gfsDiskOptions, setGfsDiskOptions] = React.useState<DiskInventoryOption[]>([]);
    const [gfsDiskLoadState, setGfsDiskLoadState] = React.useState<InventoryLoadState>("idle");
    const [gfsDiskLoadError, setGfsDiskLoadError] = React.useState("");
    const [gfsMountPoint, setGfsMountPoint] = React.useState("/mnt/glue-gfs");
    const [rbdPoolName, setRbdPoolName] = React.useState("rbd");
    const [rbdImagePrefix, setRbdImagePrefix] = React.useState("gfs");
    const [rbdSizeGiB, setRbdSizeGiB] = React.useState("5000");
    const [ipmiAddresses, setIpmiAddresses] = React.useState<Record<string, string>>({});
    const [ipmiUsername, setIpmiUsername] = React.useState("");
    const [ipmiPassword, setIpmiPassword] = React.useState("");
    const [localDisks, setLocalDisks] = React.useState<string[]>([]);
    const [storageDiskOptions, setStorageDiskOptions] = React.useState<DiskInventoryOption[]>([]);
    const [storageDiskLoadState, setStorageDiskLoadState] = React.useState<InventoryLoadState>("idle");
    const [storageDiskLoadError, setStorageDiskLoadError] = React.useState("");
    const [ccvmCpu, setCcvmCpu] = React.useState("8");
    const [ccvmMemory, setCcvmMemory] = React.useState("32");
    const [ccvmMgmtBridge, setCcvmMgmtBridge] = React.useState("");
    const [ccvmServiceBridge, setCcvmServiceBridge] = React.useState("");
    const [bridgeOptions, setBridgeOptions] = React.useState<InventorySelectOption[]>(EMPTY_BRIDGE_OPTIONS);
    const [nicLoadState, setNicLoadState] = React.useState<InventoryLoadState>("idle");
    const [nicLoadError, setNicLoadError] = React.useState("");
    const [serviceNetworkEnabled, setServiceNetworkEnabled] = React.useState(false);
    const [serviceIp, setServiceIp] = React.useState("");
    const [serviceCidr, setServiceCidr] = React.useState("");
    const [serviceGateway, setServiceGateway] = React.useState("");
    const [pcsNodeIpSource, setPcsNodeIpSource] = React.useState<"ablecube" | "ablecubePn">("ablecubePn");
    const [phase, setPhase] = React.useState<RunPhase>("idle");
    const [message, setMessage] = React.useState("");
    const [connectionNotice, setConnectionNotice] = React.useState("");
    const [runningJob, setRunningJob] = React.useState<DeployRunJob | null>(null);
    const [runningJobId, setRunningJobId] = React.useState("");
    const wasOpenRef = React.useRef(false);

    const isHci = productType === "ablestack-hci" || productType === "ablestack-hci-filesystem";
    const usesHciFilesystem = productType === "ablestack-hci-filesystem";
    const usesExternalGfs = productType === "ablestack-vm";
    const usesLocal = productType === "ablestack-standalone";
    const cloudCenterWaitText = productType === "ablestack-vm"
        ? "Mold 서비스 준비까지 보통 5~10분 정도 걸립니다."
        : "Mold 서비스 준비까지 보통 20분 정도 걸립니다.";
    const flowSteps = flowStepsFor(productType);
    const activeFlowStep = flowSteps[activeStep] ?? flowSteps[0];
    const restartRecommendation = restartRecommendationFor(productType, deployStatus, runningJob);
    const isRunning = phase === "running";
    const isInputPhase = phase === "idle";

    React.useEffect(() => {
        if (!isOpen) {
            wasOpenRef.current = false;
            return;
        }

        if (wasOpenRef.current) return;
        wasOpenRef.current = true;

        const nextProductType = initialProductType(deployStatus);
        const nextRecommendation = restartRecommendationFor(nextProductType, deployStatus);

        setProductType(nextProductType);
        if (nextProductType === "ablestack-vm") {
            setHostsText(vmHosts);
        } else if (nextProductType === "ablestack-hci" || nextProductType === "ablestack-hci-filesystem") {
            setHostsText(hciHosts);
        }
        setActiveStep(nextRecommendation.index);
        setPhase("idle");
        setMessage("");
        setConnectionNotice("");
        setRunningJob(null);
        setRunningJobId("");
    }, [isOpen, deployStatus]);

    React.useEffect(() => {
        if (!isOpen) return;

        let isActive = true;

        setNicLoadState("loading");
        setNicLoadError("");
        fetchNicInventory()
                .then((inventory) => {
                    if (!isActive) return;
                    const nextBridgeOptions = inventory.bridges.length > 0 ? inventory.bridges : EMPTY_BRIDGE_OPTIONS;

                    setBridgeOptions(nextBridgeOptions);
                    setScvmMgmtBridge((prev) => (
                        nextBridgeOptions.some((option) => option.value === prev) ? prev : optionValueAt(nextBridgeOptions, 0)
                    ));
                    setCcvmMgmtBridge((prev) => (
                        nextBridgeOptions.some((option) => option.value === prev) ? prev : optionValueAt(nextBridgeOptions, 0)
                    ));
                    setScvmServerBridge((prev) => (
                        nextBridgeOptions.some((option) => option.value === prev) ? prev : optionValueAt(nextBridgeOptions, 1)
                    ));
                    setScvmReplicationBridge((prev) => (
                        nextBridgeOptions.some((option) => option.value === prev) ? prev : optionValueAt(nextBridgeOptions, 2)
                    ));
                    setNicLoadState("success");
                })
                .catch((error) => {
                    if (!isActive) return;
                    setBridgeOptions(EMPTY_BRIDGE_OPTIONS);
                    setNicLoadState("error");
                    setNicLoadError(errorMessage(error) || "NIC 목록을 불러오지 못했습니다.");
                });

        setGfsDiskLoadState("loading");
        setGfsDiskLoadError("");
        fetchDiskInventory("gfs")
                .then((options) => {
                    if (!isActive) return;
                    setGfsDiskOptions(options);
                    setGfsDisksText((prev) => {
                        const selected = splitList(prev).filter((disk) => (
                            options.some((option) => option.value === disk && !option.inUse)
                        ));

                        if (selected.length > 0) {
                            return selected.join("\n");
                        }

                        return "";
                    });
                    setGfsDiskLoadState("success");
                })
                .catch((error) => {
                    if (!isActive) return;
                    setGfsDiskOptions([]);
                    setGfsDisksText("");
                    setGfsDiskLoadState("error");
                    setGfsDiskLoadError(errorMessage(error) || "GFS 디스크 목록을 불러오지 못했습니다.");
                });

        setStorageDiskLoadState("loading");
        setStorageDiskLoadError("");
        fetchDiskInventory("list")
                .then((options) => {
                    if (!isActive) return;
                    const hasMultipath = options.some((disk) => ["mpath", "multipath"].includes(disk.type.toLowerCase()));
                    const passthroughDisks = options.filter((disk) => {
                        const type = disk.type.toLowerCase();

                        if (hasMultipath && type === "disk") return false;
                        return !type || ["disk", "lun", "mpath", "multipath"].includes(type);
                    });

                    setStorageDiskOptions(passthroughDisks);
                    setStorageDiskLoadState("success");
                })
                .catch((error) => {
                    if (!isActive) return;
                    setStorageDiskOptions([]);
                    setStorageDiskLoadState("error");
                    setStorageDiskLoadError(errorMessage(error) || "스토리지 디스크 목록을 불러오지 못했습니다.");
                });

        return () => {
            isActive = false;
        };
    }, [isOpen]);

    React.useEffect(() => {
        if (!isHci || storageDiskOptions.length === 0) return;

        const availableDisks = storageDiskOptions.map((disk) => disk.value);

        setScvmDisksByHost((previous) => {
            const next = { ...previous };
            let changed = false;

            parseHosts(hostsText).forEach((host) => {
                if (!host.hostname || Object.prototype.hasOwnProperty.call(next, host.hostname)) return;
                next[host.hostname] = availableDisks;
                changed = true;
            });

            return changed ? next : previous;
        });
    }, [hostsText, isHci, storageDiskOptions]);

    React.useEffect(() => {
        if (activeStep > flowSteps.length - 1) {
            setActiveStep(flowSteps.length - 1);
        }
    }, [activeStep, flowSteps.length]);

    React.useEffect(() => {
        if (!runningJobId || phase !== "running") return undefined;

        const refreshJob = () => {
            fetchDeployRunJobs()
                    .then((jobs) => {
                        const nextJob = jobs.find((job) => job.jobId === runningJobId);

                        if (!nextJob) return;
                        setRunningJob(nextJob);
                        if (nextJob.status === "succeeded") {
                            setPhase("success");
                            setMessage(`올인원 구성 Job이 완료되었습니다. ${cloudCenterWaitText}`);
                            onCompleted?.();
                        } else if (nextJob.status === "failed") {
                            setPhase("error");
                            setMessage(nextJob.message || "올인원 구성 Job이 실패했습니다.");
                        }
                    })
                    .catch((error) => {
                        setMessage(`Job 상태 확인에 실패했습니다: ${errorMessage(error)}`);
                    });
        };

        refreshJob();
        const intervalId = window.setInterval(refreshJob, 5000);

        return () => window.clearInterval(intervalId);
    }, [cloudCenterWaitText, onCompleted, phase, runningJobId]);

    const updateProductType = (nextType: ProductType) => {
        setProductType(nextType);
        setActiveStep(restartRecommendationFor(nextType, deployStatus).index);
        if (nextType !== "ablestack-vm") setIscsiStorage(false);
        if (nextType === "ablestack-vm") setHostsText(vmHosts);
        if (nextType === "ablestack-hci" || nextType === "ablestack-hci-filesystem") setHostsText(hciHosts);
    };

    const updateHosts = (nextHosts: HostRow[]) => {
        setHostsText(serializeHosts(nextHosts));
    };

    const updateHost = (index: number, key: keyof HostRow, value: string) => {
        const hosts = parseHosts(hostsText);

        hosts[index] = {
            ...hosts[index],
            [key]: value,
        };
        updateHosts(hosts);
    };

    const addHost = () => {
        const hosts = parseHosts(hostsText);
        const nextIndex = hosts.length + 1;

        updateHosts([
            ...hosts,
            {
                index: String(nextIndex),
                hostname: `ablecube${nextIndex}`,
                ablecube: "",
                scvmMngt: "",
                ablecubePn: "",
                scvm: "",
                scvmCn: "",
                storageIp: "",
            },
        ]);
    };

    const removeHost = () => {
        const minHosts = isHci ? 3 : 1;
        const hosts = parseHosts(hostsText);

        if (hosts.length <= minHosts) return;
        updateHosts(hosts.slice(0, -1));
    };

    const parseSCVMByHost = () => {
        const shared = {
            cpu: Number(scvmCpu) || 8,
            memory: Number(scvmMemory) || 32,
            disk_type: scvmDiskType,
            management_network_bridge: scvmMgmtBridge,
            storage_traffic_network_type: scvmStorageMode,
            server_network_bridge: scvmServerBridge,
            replication_network_bridge: scvmReplicationBridge,
        };
        const out: Record<string, unknown> = {};

        parseHosts(hostsText).forEach((host) => {
            if (!host.hostname) return;
            const disks = scvmDisksByHost[host.hostname] ?? [];

            out[host.hostname] = {
                ...shared,
                ...(scvmDiskType === "raid_passthrough" ? { raid_passthrough_list: disks } : {}),
                ...(scvmDiskType === "lun_passthrough" ? { lun_passthrough_list: disks } : {}),
                ...(scvmDiskType === "disk_passthrough" ? { disk_passthrough_list: disks } : {}),
            };
        });

        return out;
    };

    const buildPayload = async (): Promise<Record<string, unknown>> => {
        const hosts = parseHosts(hostsText).map((host) => (
            isHci
                ? host
                : {
                    index: host.index,
                    hostname: host.hostname,
                    ablecube: host.ablecube,
                    ...(productType === "ablestack-vm" && iscsiStorage
                        ? { ablecubePn: host.storageIp ?? "" }
                        : {}),
                }
        ));
        const payload: Record<string, unknown> = {
            mode: "all",
            enrollment: { source: "new" },
            only: deployOnlyStepsFor(productType),
            cluster: {
                action: "insert",
                option: "hostOnly",
                type: productType,
                ccvm: { ip: ccvmIp.trim() },
                mngtNic: {
                    cidr: mngtCidr.trim(),
                    gw: mngtGw.trim(),
                    dns: mngtDns.trim(),
                },
                external_timeserver: externalTimeServer.trim(),
                storage_network: String(iscsiStorage),
                pcs_cluster_list: usesLocal
                    ? []
                    : hosts.map((host) => (isHci ? host[pcsNodeIpSource] : host.ablecube)).filter(Boolean),
                hosts,
            },
            ccvm_xml: {
                cpu: Number(ccvmCpu) || 8,
                memory: Number(ccvmMemory) || 32,
                management_network_bridge: ccvmMgmtBridge.trim(),
                ...(ccvmServiceBridge.trim() ? { service_network_bridge: ccvmServiceBridge.trim() } : {}),
            },
            ccvm_lifecycle: { action: "setup" },
        };

        if (isHci) {
            payload.scvm_by_host = parseSCVMByHost();
        }

        if (usesExternalGfs) {
            payload.gfs = {
                action: "init-pcs-cluster",
                disks: splitList(gfsDisksText),
                stonith: hosts.map((host) => ({
                    hostname: host.hostname,
                    ipaddr: ipmiAddresses[host.hostname]?.trim() ?? "",
                    ipport: "623",
                    login: ipmiUsername.trim(),
                    passwd: ipmiPassword,
                })),
            };
        }

        if (usesHciFilesystem) {
            payload.gfs = {
                action: "init-pcs-cluster",
                mount_point: gfsMountPoint.trim(),
                stonith: hosts.map((host) => ({
                    hostname: host.hostname,
                    ipaddr: ipmiAddresses[host.hostname]?.trim() ?? "",
                    ipport: "623",
                    login: ipmiUsername.trim(),
                    passwd: ipmiPassword,
                })),
            };
            payload.rbd = {
                action: "create",
                pool_name: rbdPoolName.trim() || "rbd",
                image_prefix: rbdImagePrefix.trim() || "gfs",
                size: Number(rbdSizeGiB) || 0,
                mount_point: gfsMountPoint.trim(),
            };
        }

        if (usesLocal) {
            payload.local = {
                action: "create-local-disk",
                disks: localDisks,
            };
        }

        if (serviceNetworkEnabled) {
            payload.ccvm_cloudinit = {
                ...(ccvmServiceBridge.trim() ? { sn_nic: ccvmServiceBridge.trim() } : {}),
                ...(serviceIp.trim() ? { sn_ip: serviceIp.trim() } : {}),
                ...(serviceCidr.trim() ? { sn_prefix: Number(serviceCidr) } : {}),
                ...(serviceGateway.trim() ? { sn_gw: serviceGateway.trim() } : {}),
            };
        }

        payload.monitoring = { action: "configure" };

        return payload;
    };

    const validateStep = (stepId: string): string => {
        const hosts = parseHosts(hostsText);

        if (stepId === "cluster") {
            if (!ccvmIp.trim()) return "CCVM 관리 IP를 입력해주세요.";
            if (!mngtCidr.trim()) return "관리 NIC CIDR을 입력해주세요.";
            if (hosts.length < (isHci ? 3 : 1)) {
                return isHci ? "HCI 구성은 호스트를 3대 이상 입력해야 합니다." : "호스트를 1대 이상 입력해야 합니다.";
            }
            if (hosts.some((host) => !host.index || !host.hostname || !host.ablecube)) {
                return "클러스터 구성 프로파일에는 순번, 호스트명, 호스트 IP가 모두 필요합니다.";
            }
            if (productType === "ablestack-vm" && iscsiStorage && hosts.some((host) => !host.storageIp)) {
                return "스토리지 네트워크 전용 구성은 호스트별 스토리지 전용 IP가 필요합니다.";
            }
            if (isHci && hosts.some((host) => !host[pcsNodeIpSource])) {
                return pcsNodeIpSource === "ablecube"
                    ? "PCS 노드 주소로 사용할 호스트 IP가 필요합니다."
                    : "PCS 노드 주소로 사용할 호스트 PN IP가 필요합니다.";
            }
        }

        if (stepId === "scvm") {
            if (nicLoadState === "error") return `NIC 정보를 확인해주세요. ${nicLoadError}`;
            if (storageDiskLoadState === "error") return `스토리지 디스크 정보를 확인해주세요. ${storageDiskLoadError}`;
            if (!scvmMgmtBridge.trim()) return "관리 NIC용 Bridge를 선택해주세요.";
            if (hosts.some((host) => (scvmDisksByHost[host.hostname] ?? []).length === 0)) {
                return "모든 호스트의 디스크 구성 대상 장치를 하나 이상 선택해주세요.";
            }
        }

        if (stepId === "gfs_storage") {
            if (gfsDiskLoadState === "error") return `GFS용 디스크 구성 대상 장치를 확인해주세요. ${gfsDiskLoadError}`;
            if (splitList(gfsDisksText).length === 0) return "GFS용 디스크 구성 대상 장치를 선택해주세요.";
            if (hosts.some((host) => !ipmiAddresses[host.hostname]?.trim())) return "모든 호스트의 IPMI IP를 입력해주세요.";
            if (!ipmiUsername.trim() || !ipmiPassword) return "IPMI 아이디와 비밀번호를 입력해주세요.";
        }

        if (stepId === "hci_shared_file") {
            if (!rbdPoolName.trim()) return "RBD pool 이름을 입력해주세요.";
            if (!rbdImagePrefix.trim()) return "RBD image prefix를 입력해주세요.";
            if (!Number.isFinite(Number(rbdSizeGiB)) || Number(rbdSizeGiB) <= 0) return "RBD 총 용량 GiB를 입력해주세요.";
            if (!gfsMountPoint.trim()) return "GFS mount point를 입력해주세요.";
            if (hosts.some((host) => !ipmiAddresses[host.hostname]?.trim())) return "모든 호스트의 IPMI IP를 입력해주세요.";
            if (!ipmiUsername.trim() || !ipmiPassword) return "IPMI 아이디와 비밀번호를 입력해주세요.";
        }

        if (stepId === "local_storage") {
            if (storageDiskLoadState === "error") return `스토리지 디스크 정보를 확인해주세요. ${storageDiskLoadError}`;
            if (usesLocal && localDisks.length === 0) return "로컬 스토리지 대상 디스크를 선택해주세요.";
        }

        if (stepId === "ccvm") {
            if (nicLoadState === "error") return `NIC 정보를 확인해주세요. ${nicLoadError}`;
            if (!ccvmMgmtBridge.trim()) return "관리네트워크를 선택해주세요.";
            if (serviceNetworkEnabled && (!ccvmServiceBridge.trim() || !serviceIp.trim() || !serviceCidr.trim() || !serviceGateway.trim())) {
                return "서비스네트워크는 Bridge, IP, CIDR, Gateway를 모두 입력해주세요.";
            }
            if (serviceNetworkEnabled && (!Number.isFinite(Number(serviceCidr)) || Number(serviceCidr) <= 0)) {
                return "서비스 NIC CIDR은 유효한 prefix 길이로 입력해주세요.";
            }
        }

        return "";
    };

    const validateAll = (): string => {
        for (const step of flowSteps) {
            const stepMessage = validateStep(step.id);

            if (stepMessage) {
                return `${step.label}: ${stepMessage}`;
            }
        }

        return "";
    };

    const selectStep = (index: number) => {
        if (isRunning) return;
        setActiveStep(index);
        setMessage("");
        setConnectionNotice("");
        setPhase("idle");
        setRunningJob(null);
        setRunningJobId("");
    };

    const nextStep = () => {
        const validationMessage = validateStep(activeFlowStep.id);

        if (validationMessage) {
            setMessage(validationMessage);
            setPhase("error");
            return;
        }

        setMessage("");
        setPhase("idle");
        setActiveStep((current) => Math.min(current + 1, flowSteps.length - 1));
    };

    const previousStep = () => {
        if (isRunning) return;
        setMessage("");
        setPhase("idle");
        setActiveStep((current) => Math.max(current - 1, 0));
    };

    const startRun = async () => {
        const validationMessage = validateAll();

        if (validationMessage) {
            setMessage(validationMessage);
            setPhase("error");
            return;
        }

        setPhase("running");
        setMessage("올인원 구성 Job을 시작하고 있습니다.");
        setConnectionNotice("");
        setActiveStep(flowSteps.length - 1);
        setRunningJob(null);
        setRunningJobId("");

        try {
            const payload = await buildPayload();
            const job = await startDeployRun(payload);
            const summary = jobSummary(job);

            setRunningJob(job);
            setRunningJobId(job.jobId);
            setMessage(`${summary}. ${cloudCenterWaitText}`);
            onStarted(summary);
        } catch (error) {
            setPhase("error");
            setMessage(`올인원 구성 Job 시작에 실패했습니다: ${errorMessage(error)}`);
        }
    };

    const closeModal = () => {
        if (isRunning) return;
        onClose();
    };

    const openMonitoringCenter = async () => {
        setConnectionNotice("");
        const centerWindow = window.open("about:blank", "_blank");

        if (!centerWindow) {
            setConnectionNotice("브라우저 팝업 차단을 해제한 후 다시 시도해주세요.");
            return;
        }

        try {
            centerWindow.document.title = "모니터링센터 연결";

            const targetUrl = await fetchDeployUrl("wallCenter");

            centerWindow.opener = null;
            centerWindow.location.href = targetUrl;
        } catch (error) {
            centerWindow.close();
            setConnectionNotice(
                `모니터링센터 연결 주소 조회에 실패했습니다: ${errorMessage(error)}`
            );
        }
    };

    const renderClusterStep = () => {
        const hostRows = parseHosts(hostsText);
        const minHosts = isHci ? 3 : 1;

        return (
            <div className="ct-all-in-one-cluster">
                <Form className="ct-all-in-one-form ct-all-in-one-form--compact ct-all-in-one-product-form" isHorizontal>
                    <FormGroup
                      label="클러스터 종류" isRequired
                      fieldId="all-in-one-product-type"
                    >
                        <FormSelect
                          id="all-in-one-product-type"
                          value={productType}
                          onChange={(_event, value) => updateProductType(value as ProductType)}
                        >
                            {PRODUCT_OPTIONS.map((option) => (
                                <FormSelectOption key={option.value} value={option.value} label={option.label} />
                            ))}
                        </FormSelect>
                    </FormGroup>
                </Form>

                <div className="ct-all-in-one-table-wrap">
                    <div className="ct-all-in-one-field-card__header">
                        <strong>클러스터 구성 프로파일</strong>
                        <div className="ct-all-in-one-host-actions">
                            {productType === "ablestack-vm" && (
                                <Checkbox
                                  id="all-in-one-iscsi-storage"
                                  label="스토리지 네트워크 전용"
                                  isChecked={iscsiStorage}
                                    onChange={(_event, checked) => setIscsiStorage(checked)}
                                />
                            )}
                            {isHci && (
                                <label className="ct-all-in-one-node-ip-source" htmlFor="all-in-one-pcs-node-ip-source">
                                    <span>노드 IP 기준</span>
                                    <FormSelect
                                      id="all-in-one-pcs-node-ip-source"
                                      value={pcsNodeIpSource}
                                      onChange={(_event, value) => setPcsNodeIpSource(value as "ablecube" | "ablecubePn")}
                                    >
                                        <FormSelectOption value="ablecube" label="Ablecube IP (관리망)" />
                                        <FormSelectOption value="ablecubePn" label="HOST PN (HPN)" />
                                    </FormSelect>
                                </label>
                            )}
                            <div className="ct-all-in-one-stepper">
                                <Button
                                  variant="control"
                                  onClick={removeHost}
                                  isDisabled={hostRows.length <= minHosts}
                                  aria-label="호스트 제거"
                                >
                                    -
                                </Button>
                                <div className="ct-all-in-one-stepper__value">{hostRows.length}</div>
                                <Button variant="control" onClick={addHost} aria-label="호스트 추가">+</Button>
                                <span>대</span>
                            </div>
                        </div>
                    </div>
                    {isHci && (
                        <p className="ct-all-in-one-help">PCS 클러스터 노드 주소로 사용할 IP 항목을 선택합니다.</p>
                    )}
                    <table className="ct-all-in-one-table">
                        <thead>
                            <tr>
                                <th>순번</th>
                                <th>호스트명</th>
                                <th>호스트 IP</th>
                                {iscsiStorage && productType === "ablestack-vm" && <th>스토리지 전용 IP</th>}
                                {isHci && <th>SCVM MNGT IP</th>}
                                {isHci && <th>호스트 PN IP</th>}
                                {isHci && <th>SCVM PN IP</th>}
                                {isHci && <th>SCVM CN IP</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {hostRows.map((row, index) => (
                                <tr key={`all-in-one-host-${index}`}>
                                    <td><TextInput aria-label={`호스트 순번 ${index + 1}`} value={row.index} onChange={(_event, value) => updateHost(index, "index", value)} /></td>
                                    <td><TextInput aria-label={`호스트명 ${index + 1}`} value={row.hostname} onChange={(_event, value) => updateHost(index, "hostname", value)} /></td>
                                    <td><TextInput aria-label={`호스트 IP ${index + 1}`} value={row.ablecube} onChange={(_event, value) => updateHost(index, "ablecube", value)} /></td>
                                    {iscsiStorage && productType === "ablestack-vm" && (
                                        <td><TextInput aria-label={`스토리지 전용 IP ${index + 1}`} value={row.storageIp ?? ""} onChange={(_event, value) => updateHost(index, "storageIp", value)} /></td>
                                    )}
                                    {isHci && <td><TextInput aria-label={`SCVM MNGT IP ${index + 1}`} value={row.scvmMngt ?? ""} onChange={(_event, value) => updateHost(index, "scvmMngt", value)} /></td>}
                                    {isHci && <td><TextInput aria-label={`호스트 PN IP ${index + 1}`} value={row.ablecubePn ?? ""} onChange={(_event, value) => updateHost(index, "ablecubePn", value)} /></td>}
                                    {isHci && <td><TextInput aria-label={`SCVM PN IP ${index + 1}`} value={row.scvm ?? ""} onChange={(_event, value) => updateHost(index, "scvm", value)} /></td>}
                                    {isHci && <td><TextInput aria-label={`SCVM CN IP ${index + 1}`} value={row.scvmCn ?? ""} onChange={(_event, value) => updateHost(index, "scvmCn", value)} /></td>}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <Form className="ct-all-in-one-form ct-all-in-one-form--compact ct-all-in-one-cluster-details" isHorizontal>
                    <FormGroup
                      label="CCVM 관리 IP" isRequired
                      fieldId="all-in-one-ccvm-ip"
                    >
                        <TextInput
                          id="all-in-one-ccvm-ip"
                          value={ccvmIp}
                          onChange={(_event, value) => setCcvmIp(value)}
                        />
                    </FormGroup>
                    <FormGroup
                      label="관리 NIC CIDR" isRequired
                      fieldId="all-in-one-mngt-cidr"
                    >
                        <TextInput
                          id="all-in-one-mngt-cidr"
                          value={mngtCidr}
                          onChange={(_event, value) => setMngtCidr(value)}
                        />
                    </FormGroup>
                    <FormGroup label="관리 NIC Gateway" fieldId="all-in-one-mngt-gw">
                        <TextInput
                          id="all-in-one-mngt-gw"
                          value={mngtGw}
                          onChange={(_event, value) => setMngtGw(value)}
                        />
                    </FormGroup>
                    <FormGroup label="관리 NIC DNS" fieldId="all-in-one-mngt-dns">
                        <TextInput
                          id="all-in-one-mngt-dns"
                          value={mngtDns}
                          onChange={(_event, value) => setMngtDns(value)}
                        />
                    </FormGroup>
                    <FormGroup label="외부 시간서버" fieldId="all-in-one-time-server">
                        <TextInput
                          id="all-in-one-time-server"
                          value={externalTimeServer}
                          placeholder="time.google.com"
                          onChange={(_event, value) => setExternalTimeServer(value)}
                        />
                    </FormGroup>
                </Form>
            </div>
        );
    };

    const renderSCVMStep = () => (
        <Form className="ct-all-in-one-form" isHorizontal>
            {nicLoadState === "loading" && (
                <Alert
                  variant="info"
                  isInline
                  title="NIC 목록을 불러오는 중입니다."
                />
            )}
            {nicLoadState === "error" && (
                <Alert
                  variant="danger"
                  isInline
                  title="NIC 목록을 불러오지 못했습니다."
                >
                    {nicLoadError}
                </Alert>
            )}
            <FormGroup
              label="CPU" isRequired
              fieldId="all-in-one-scvm-cpu"
            >
                <FormSelect id="all-in-one-scvm-cpu" value={scvmCpu} onChange={(_event, value) => setScvmCpu(value)}>
                    <FormSelectOption value="8" label="8 vCore" />
                    <FormSelectOption value="16" label="16 vCore" />
                </FormSelect>
            </FormGroup>
            <FormGroup
              label="Memory" isRequired
              fieldId="all-in-one-scvm-memory"
            >
                <FormSelect id="all-in-one-scvm-memory" value={scvmMemory} onChange={(_event, value) => setScvmMemory(value)}>
                    <FormSelectOption value="16" label="16 GiB" />
                    <FormSelectOption value="32" label="32 GiB" />
                    <FormSelectOption value="64" label="64 GiB" />
                </FormSelect>
            </FormGroup>
            <FormGroup
              label="디스크 구성 방식" isRequired
              fieldId="all-in-one-scvm-disk-type"
            >
                <FormSelect
                  id="all-in-one-scvm-disk-type"
                  value={scvmDiskType}
                  onChange={(_event, value) => setScvmDiskType(value)}
                >
                    <FormSelectOption value="disk_passthrough" label="PCI Passthrough" />
                    <FormSelectOption value="lun_passthrough" label="LUN Passthrough" />
                    <FormSelectOption value="raid_passthrough" label="RAID Passthrough" />
                </FormSelect>
            </FormGroup>
            <FormGroup
              label="관리 NIC용 Bridge" isRequired
              fieldId="all-in-one-scvm-mgmt-bridge"
            >
                <FormSelect
                  id="all-in-one-scvm-mgmt-bridge"
                  value={scvmMgmtBridge}
                  onChange={(_event, value) => setScvmMgmtBridge(value)}
                >
                    {bridgeOptions.map((option) => (
                        <FormSelectOption key={option.value} value={option.value} label={option.label} />
                    ))}
                </FormSelect>
            </FormGroup>
            <FormGroup
              label="스토리지 NIC 구성 방식" isRequired
              fieldId="all-in-one-scvm-storage-mode"
            >
                <FormSelect
                  id="all-in-one-scvm-storage-mode"
                  value={scvmStorageMode}
                  onChange={(_event, value) => setScvmStorageMode(value)}
                >
                    <FormSelectOption value="bridge" label="Bridge Network" />
                    <FormSelectOption value="nic_passthrough" label="NIC Passthrough" />
                    <FormSelectOption value="nic_passthrough_bonding" label="NIC Passthrough Bonding" />
                </FormSelect>
            </FormGroup>
            <FormGroup label="서버용 NIC" fieldId="all-in-one-scvm-server-bridge">
                <FormSelect
                  id="all-in-one-scvm-server-bridge"
                  value={scvmServerBridge}
                  onChange={(_event, value) => setScvmServerBridge(value)}
                >
                    {bridgeOptions.map((option) => (
                        <FormSelectOption key={option.value} value={option.value} label={option.label} />
                    ))}
                </FormSelect>
            </FormGroup>
            <FormGroup label="복제용 NIC" fieldId="all-in-one-scvm-repl-bridge">
                <FormSelect
                  id="all-in-one-scvm-repl-bridge"
                  value={scvmReplicationBridge}
                  onChange={(_event, value) => setScvmReplicationBridge(value)}
                >
                    {bridgeOptions.map((option) => (
                        <FormSelectOption key={option.value} value={option.value} label={option.label} />
                    ))}
                </FormSelect>
            </FormGroup>
            <FormGroup
              label="디스크 구성 대상 장치" isRequired
              fieldId="all-in-one-scvm-by-host"
            >
                {storageDiskLoadState === "loading" ? (
                    <Alert variant="info" isInline title="디스크 목록을 불러오는 중입니다." />
                ) : storageDiskLoadState === "error" ? (
                    <Alert variant="danger" isInline title="디스크 목록을 불러오지 못했습니다.">{storageDiskLoadError}</Alert>
                ) : storageDiskOptions.length === 0 ? (
                    <Alert variant="warning" isInline title="선택 가능한 디스크가 없습니다." />
                ) : (
                    <div className="ct-all-in-one-host-disk-list">
                        {parseHosts(hostsText).map((host) => {
                            const selected = scvmDisksByHost[host.hostname] ?? [];

                            return (
                                <div key={`all-in-one-scvm-disks-${host.hostname}`} className="ct-all-in-one-host-disk-list__host">
                                    <strong>{host.hostname || "이름 없는 호스트"}</strong>
                                    {storageDiskOptions.map((disk) => (
                                        <Checkbox
                                          key={`${host.hostname}-${disk.value}`}
                                          id={`all-in-one-scvm-disk-${host.hostname}-${disk.value}`.replace(/[^a-zA-Z0-9_-]/g, "-")}
                                          label={disk.label}
                                          isChecked={selected.includes(disk.value)}
                                          onChange={(_event, checked) => setScvmDisksByHost((previous) => ({
                                              ...previous,
                                              [host.hostname]: checked
                                                  ? Array.from(new Set([...selected, disk.value]))
                                                  : selected.filter((value) => value !== disk.value),
                                          }))}
                                        />
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                )}
                <Content component="p" className="ct-all-in-one-help">감지된 Passthrough 디스크가 호스트별로 자동 선택됩니다. 필요한 디스크만 선택 상태를 조정하세요.</Content>
            </FormGroup>
        </Form>
    );

    const renderStorageCenterStep = () => (
        <div className="ct-all-in-one-static-step">
            <Alert
              variant="info"
              isInline
              title="SCVM bootstrap으로 스토리지센터 초기 구성을 진행합니다."
            >
                현재 호스트의 SCVM에서 기존 구성 스크립트를 실행하고 각 호스트에 완료 상태를 저장합니다.
            </Alert>
            <div className="ct-all-in-one-static-step__grid">
                <div>
                    <span>적용 대상 제품</span>
                    <strong>ABLESTACK-HCI / HCI Filesystem</strong>
                </div>
                <div>
                    <span>실행 Job 단계</span>
                    <strong>scvm_bootstrap</strong>
                </div>
                <div>
                    <span>완료 판단</span>
                    <strong>scvm_bootstrap_status = true</strong>
                </div>
            </div>
        </div>
    );

    const renderStorageClusterStep = () => (
        <div className="ct-all-in-one-static-step">
            <Alert
              variant="info"
              isInline
              title="스토리지 클러스터 상세 구성을 확인합니다."
            >
                스토리지센터 관리 화면에서 OSD와 rbd 풀 구성을 완료한 뒤 검사합니다. 이 검사는 디스크를 초기화하거나 풀을 생성하지 않습니다.
            </Alert>
            <div className="ct-all-in-one-plan-list">
                <div>
                    <strong>1. SCVM host 확인</strong>
                    <span>cluster.json hosts의 SCVM 이름과 Glue host 목록을 비교합니다.</span>
                </div>
                <div>
                    <strong>2. OSD 등록</strong>
                    <span>스토리지센터에서 OSD 등록을 완료했는지 확인합니다.</span>
                </div>
                <div>
                    <strong>3. rbd pool 구성</strong>
                    <span>스토리지센터에서 구성한 rbd 풀이 존재하는지 확인합니다.</span>
                </div>
                <div>
                    <strong>4. 상태 검증</strong>
                    <span>Glue Cluster 상태가 Health OK 또는 Warn인지 확인합니다.</span>
                </div>
            </div>
        </div>
    );

    const selectedGfsDisks = splitList(gfsDisksText);

    const toggleGfsDisk = (diskValue: string, checked: boolean) => {
        const next = checked
            ? Array.from(new Set([...selectedGfsDisks, diskValue]))
            : selectedGfsDisks.filter((disk) => disk !== diskValue);

        setGfsDisksText(next.join("\n"));
    };

    const renderIpmiFields = () => (
        <>
            {parseHosts(hostsText).map((host) => (
                <FormGroup
                  key={`all-in-one-ipmi-${host.hostname}`}
                  label={`${host.hostname || "호스트"} IPMI IP`}
                  isRequired
                  fieldId={`all-in-one-ipmi-${host.index}`}
                >
                    <TextInput
                      id={`all-in-one-ipmi-${host.index}`}
                      value={ipmiAddresses[host.hostname] ?? ""}
                      onChange={(_event, value) => setIpmiAddresses((previous) => ({
                          ...previous,
                          [host.hostname]: value,
                      }))}
                    />
                </FormGroup>
            ))}
            <FormGroup
              label="IPMI 아이디"
              isRequired
              fieldId="all-in-one-ipmi-user"
            >
                <TextInput
                  id="all-in-one-ipmi-user"
                  value={ipmiUsername}
                  onChange={(_event, value) => setIpmiUsername(value)}
                />
            </FormGroup>
            <FormGroup
              label="IPMI 비밀번호"
              isRequired
              fieldId="all-in-one-ipmi-password"
            >
                <TextInput
                  id="all-in-one-ipmi-password"
                  type="password"
                  value={ipmiPassword}
                  onChange={(_event, value) => setIpmiPassword(value)}
                />
            </FormGroup>
        </>
    );

    const renderGfsStorageStep = () => (
        <Form className="ct-all-in-one-form" isHorizontal>
            <FormGroup
              label="GFS용 디스크 구성 대상 장치"
              isRequired
              fieldId="all-in-one-gfs-disks"
            >
                {gfsDiskLoadState === "loading" ? (
                    <Alert
                      variant="info"
                      isInline
                      title="GFS 디스크 목록을 불러오는 중입니다."
                    />
                ) : gfsDiskLoadState === "error" ? (
                    <Alert
                      variant="danger"
                      isInline
                      title="GFS 디스크 목록을 불러오지 못했습니다."
                    >
                        {gfsDiskLoadError}
                    </Alert>
                ) : gfsDiskOptions.length === 0 ? (
                    <Alert
                      variant="warning"
                      isInline
                      title="GFS 디스크 후보가 없습니다."
                    />
                ) : (
                    <div className="ct-all-in-one-choice-list">
                        {gfsDiskOptions.map((disk) => (
                            <Checkbox
                              key={disk.value}
                              id={`all-in-one-gfs-disk-${disk.value.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                              label={disk.label}
                              isChecked={selectedGfsDisks.includes(disk.value)}
                              isDisabled={disk.inUse}
                              onChange={(_event, checked) => toggleGfsDisk(disk.value, checked)}
                            />
                        ))}
                    </div>
                )}
            </FormGroup>
            {renderIpmiFields()}
        </Form>
    );

    const renderHciSharedFileStep = () => (
        <Form className="ct-all-in-one-form" isHorizontal>
            <Alert
              variant="info"
              isInline
              title="HCI Filesystem은 RBD image를 생성한 뒤 각 host에 rbd map을 반영합니다."
            >
                SCVM이 아닌 물리 host를 대상으로 /etc/ceph/rbdmap을 적용하고,
                map된 RBD 장치로 Global File System을 구성합니다.
            </Alert>
            <FormGroup
              label="RBD pool" isRequired
              fieldId="all-in-one-rbd-pool"
            >
                <TextInput
                  id="all-in-one-rbd-pool"
                  isDisabled
                  value={rbdPoolName}
                  onChange={(_event, value) => setRbdPoolName(value)}
                />
            </FormGroup>
            <FormGroup
              label="RBD image prefix" isRequired
              fieldId="all-in-one-rbd-prefix"
            >
                <TextInput
                  id="all-in-one-rbd-prefix"
                  isDisabled
                  value={rbdImagePrefix}
                  onChange={(_event, value) => setRbdImagePrefix(value)}
                />
            </FormGroup>
            <FormGroup
              label="총 용량 GiB" isRequired
              fieldId="all-in-one-rbd-size"
            >
                <TextInput
                  id="all-in-one-rbd-size"
                  value={rbdSizeGiB}
                  onChange={(_event, value) => setRbdSizeGiB(value)}
                />
            </FormGroup>
            <FormGroup
              label="Mount point" isRequired
              fieldId="all-in-one-hci-fs-mount"
            >
                <TextInput
                  id="all-in-one-hci-fs-mount"
                  value={gfsMountPoint}
                  onChange={(_event, value) => setGfsMountPoint(value)}
                />
            </FormGroup>
            {renderIpmiFields()}
        </Form>
    );

    const renderLocalStorageStep = () => (
        <Form className="ct-all-in-one-form" isHorizontal>
            <FormGroup
              label="로컬 디스크" isRequired
              fieldId="all-in-one-local-disks"
            >
                {storageDiskLoadState === "loading" ? (
                    <Alert variant="info" isInline title="스토리지 디스크 목록을 불러오는 중입니다." />
                ) : storageDiskLoadState === "error" ? (
                    <Alert variant="danger" isInline title="스토리지 디스크 목록을 불러오지 못했습니다.">{storageDiskLoadError}</Alert>
                ) : (
                    <div className="ct-all-in-one-choice-list">
                        {storageDiskOptions.map((disk) => (
                            <Checkbox
                              key={disk.value}
                              id={`all-in-one-local-disk-${disk.value.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                              label={disk.label}
                              isChecked={localDisks.includes(disk.value)}
                              onChange={(_event, checked) => setLocalDisks((previous) => (
                                  checked ? Array.from(new Set([...previous, disk.value])) : previous.filter((value) => value !== disk.value)
                              ))}
                            />
                        ))}
                    </div>
                )}
            </FormGroup>
            <Alert
              variant="info" isInline
              title="Standalone은 로컬 디스크 준비 후 CCVM을 구성합니다."
            />
        </Form>
    );

    const renderCCVMStep = () => (
        <Form className="ct-all-in-one-form" isHorizontal>
            {nicLoadState === "loading" && (
                <Alert
                  variant="info"
                  isInline
                  title="NIC 목록을 불러오는 중입니다."
                />
            )}
            {nicLoadState === "error" && (
                <Alert
                  variant="danger"
                  isInline
                  title="NIC 목록을 불러오지 못했습니다."
                >
                    {nicLoadError}
                </Alert>
            )}
            <FormGroup
              label="CPU" isRequired
              fieldId="all-in-one-ccvm-cpu"
            >
                <FormSelect id="all-in-one-ccvm-cpu" value={ccvmCpu} onChange={(_event, value) => setCcvmCpu(value)}>
                    <FormSelectOption value="8" label="8 vCore" />
                    <FormSelectOption value="16" label="16 vCore" />
                </FormSelect>
            </FormGroup>
            <FormGroup
              label="Memory" isRequired
              fieldId="all-in-one-ccvm-memory"
            >
                <FormSelect id="all-in-one-ccvm-memory" value={ccvmMemory} onChange={(_event, value) => setCcvmMemory(value)}>
                    <FormSelectOption value="16" label="16 GiB" />
                    <FormSelectOption value="32" label="32 GiB" />
                    <FormSelectOption value="64" label="64 GiB" />
                </FormSelect>
            </FormGroup>
            <FormGroup
              label="관리네트워크" isRequired
              fieldId="all-in-one-ccvm-mgmt-bridge"
            >
                <FormSelect
                  id="all-in-one-ccvm-mgmt-bridge"
                  value={ccvmMgmtBridge}
                  onChange={(_event, value) => setCcvmMgmtBridge(value)}
                >
                    {bridgeOptions.map((option) => (
                        <FormSelectOption key={option.value} value={option.value} label={option.label} />
                    ))}
                </FormSelect>
            </FormGroup>
            <Checkbox
              id="all-in-one-service-network-enabled"
              label="서비스네트워크"
              isChecked={serviceNetworkEnabled}
              onChange={(_event, checked) => setServiceNetworkEnabled(checked)}
            />
            {serviceNetworkEnabled && (
                <div className="ct-all-in-one-service-network-fields">
                    <FormGroup label="서비스네트워크" isRequired fieldId="all-in-one-ccvm-service-bridge">
                        <FormSelect
                          id="all-in-one-ccvm-service-bridge"
                          value={ccvmServiceBridge}
                          onChange={(_event, value) => setCcvmServiceBridge(value)}
                        >
                            {bridgeOptions.filter((option) => !option.value || option.value !== ccvmMgmtBridge).map((option) => (
                                <FormSelectOption key={option.value} value={option.value} label={option.label} />
                            ))}
                        </FormSelect>
                    </FormGroup>
                    <FormGroup label="서비스 NIC IP" isRequired fieldId="all-in-one-service-ip">
                        <TextInput
                          id="all-in-one-service-ip"
                          value={serviceIp}
                          onChange={(_event, value) => setServiceIp(value)}
                        />
                    </FormGroup>
                    <FormGroup label="서비스 NIC CIDR" isRequired fieldId="all-in-one-service-cidr">
                        <TextInput
                          id="all-in-one-service-cidr"
                          value={serviceCidr}
                          placeholder="예: 16"
                          onChange={(_event, value) => setServiceCidr(value)}
                        />
                    </FormGroup>
                    <FormGroup label="서비스 NIC Gateway" isRequired fieldId="all-in-one-service-gateway">
                        <TextInput
                          id="all-in-one-service-gateway"
                          value={serviceGateway}
                          onChange={(_event, value) => setServiceGateway(value)}
                        />
                    </FormGroup>
                </div>
            )}
            <Alert
              variant="warning" isInline
              title={cloudCenterWaitText}
            />
        </Form>
    );

    const renderReviewStep = () => (
        <div className="ct-all-in-one-review">
            <div className="ct-all-in-one-review__summary">
                <div>
                    <span>클러스터 종류</span>
                    <strong>{productLabel(productType)}</strong>
                </div>
                <div>
                    <span>구성할 호스트 수</span>
                    <strong>{parseHosts(hostsText).length}대</strong>
                </div>
                <div>
                    <span>Mold 준비 예상</span>
                    <strong>{productType === "ablestack-vm" ? "5~10분" : "약 20분"}</strong>
                </div>
                <div>
                    <span>외부 시간서버</span>
                    <strong>{externalTimeServer || "N/A"}</strong>
                </div>
            </div>
            <Alert
              variant="info"
              isInline
              title="입력한 값으로 올인원 구성 Job을 한 번에 시작합니다."
            >
                라이선스 등록이 완료된 상태에서 클러스터 구성, VM 준비, 스토리지 구성, systemProfile 반영이 순서대로 실행됩니다.
                구성 완료 후 모니터링센터 연결 단계로 이어집니다.
            </Alert>
        </div>
    );

    const renderInputPanel = () => {
        switch (activeFlowStep.id) {
        case "cluster":
            return renderClusterStep();
        case "scvm":
            return renderSCVMStep();
        case "storage_center":
            return renderStorageCenterStep();
        case "storage_cluster":
            return renderStorageClusterStep();
        case "hci_shared_file":
            return renderHciSharedFileStep();
        case "gfs_storage":
            return renderGfsStorageStep();
        case "local_storage":
            return renderLocalStorageStep();
        case "ccvm":
            return renderCCVMStep();
        default:
            return renderReviewStep();
        }
    };

    const renderExecutionPanel = () => (
        <div className="ct-all-in-one-execution">
            <Alert
              variant={phase === "error" ? "danger" : phase === "success" ? "success" : "info"}
              isInline
              title={message || "올인원 구성 Job을 실행 중입니다."}
            >
                {phase === "running" && <Spinner size="sm" aria-label="올인원 구성 Job 실행 중" />}
            </Alert>
            {runningJob && (
                <div className="ct-all-in-one-job">
                    <div>
                        <span>Job ID</span>
                        <strong>{runningJob.jobId}</strong>
                    </div>
                    <div>
                        <span>상태</span>
                        <Label color={colorForJobStatus(runningJob.status)}>
                            {runningJob.status || "N/A"}
                        </Label>
                    </div>
                    <div className="ct-all-in-one-job__steps">
                        {runningJob.steps.map((step) => (
                            <span key={step.name}>
                                <Label color={colorForJobStepStatus(step.status)}>
                                    {STEP_STATUS_LABELS[step.status] ?? step.status}
                                </Label>
                                {step.name}
                            </span>
                        ))}
                    </div>
                </div>
            )}
            {connectionNotice && (
                <Alert
                  variant="danger"
                  isInline
                  title={connectionNotice}
                />
            )}
        </div>
    );

    const showExecutionPanel = isRunning || (phase === "success" && Boolean(runningJob));

    return (
        <Modal
          isOpen={isOpen}
          onClose={closeModal}
          variant="large"
          aria-label="올인원 제어"
          className="ct-all-in-one-control-modal"
        >
            <ModalHeader title="올인원 제어" />
            <ModalBody>
                <TaskProgress />
                <Card className="ct-deploy-overview ct-all-in-one-embedded">
                    <CardHeader className="ct-deploy-overview__header">
                        <div>
                            <CardTitle>ABLESTACK 올인원 구성 입력</CardTitle>
                            <Content component="p" className="ct-deploy-overview__subtitle">
                                단계별 입력값을 검증한 뒤 한 번에 실행합니다.
                            </Content>
                        </div>
                        {isRunning && (
                            <div className="ct-deploy-overview__summary">
                                <Spinner size="sm" aria-label="올인원 구성 중" />
                                <Label color="blue">실행 중</Label>
                            </div>
                        )}
                    </CardHeader>
                    <CardBody>
                        <div className="ct-deploy-overview__meta">
                            <div>
                                <span>클러스터 종류</span>
                                <strong>{productLabel(productType)}</strong>
                            </div>
                            <div>
                                <span>{isRunning ? "실행 단계" : "입력 단계"}</span>
                                <strong>{activeFlowStep.label}</strong>
                            </div>
                            <div>
                                <span>Mold 준비 예상</span>
                                <strong>{productType === "ablestack-vm" ? "5~10분" : "약 20분"}</strong>
                            </div>
                            <div>
                                <span>권장 재시작</span>
                                <strong>{restartRecommendation.summary}</strong>
                            </div>
                        </div>

                        <div className="ct-all-in-one-resume">
                            <div>
                                <span>현재 제품 흐름 기준</span>
                                <strong>{restartRecommendation.summary}</strong>
                            </div>
                            {!isRunning && !restartRecommendation.isComplete &&
                                activeStep !== restartRecommendation.index && (
                                    <Button
                                      variant="secondary"
                                      onClick={() => selectStep(restartRecommendation.index)}
                                    >
                                        권장 단계로 이동
                                    </Button>
                            )}
                            <Content component="p">{restartRecommendation.detail}</Content>
                        </div>

                        <div className="ct-deploy-overview__flow ct-all-in-one-flow">
                            <div className="ct-deploy-overview__flow-list">
                                <div className="ct-deploy-overview__section-title">제품 흐름</div>
                                <div className="ct-deploy-overview__stage-list">
                                    {flowSteps.map((step, index) => {
                                        const state = stateForFlowStep(step, index, activeStep, phase, runningJob);

                                        return (
                                            <button
                                              key={step.id}
                                              type="button"
                                              className={[
                                                  "ct-deploy-overview__stage",
                                                  `ct-deploy-overview__stage--${state}`,
                                                  isInputPhase && state === "done"
                                                      ? "ct-deploy-overview__stage--input-done"
                                                      : "",
                                                  "ct-all-in-one-flow__stage",
                                              ].join(" ")}
                                              onClick={() => selectStep(index)}
                                              disabled={isRunning}
                                            >
                                                <div className="ct-deploy-overview__stage-marker">{index + 1}</div>
                                                <div className="ct-deploy-overview__stage-body">
                                                    <span>{step.label}</span>
                                                    {labelForUiStepState(state, phase)}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="ct-deploy-overview__current-panel ct-all-in-one-input-panel">
                                <span className="ct-deploy-overview__current-eyebrow">
                                    {isRunning ? "실행 상태" : "현재 입력"}
                                </span>
                                <h2>{isRunning ? "올인원 구성 중" : activeFlowStep.label}</h2>
                                <Content component="p">{activeFlowStep.description}</Content>
                                {showExecutionPanel
                                    ? renderExecutionPanel()
                                    : renderInputPanel()}
                                {message && !isRunning && !(phase === "success" && runningJob) && (
                                    <Alert
                                      className="ct-all-in-one-message"
                                      isInline
                                      variant={phase === "error" ? "danger" : "success"}
                                      title={message}
                                    />
                                )}
                                {!isRunning && (
                                    <div className="ct-deploy-overview__action-row">
                                        {phase === "success" && runningJob
                                            ? (
                                                <>
                                                    <Button variant="primary" onClick={openMonitoringCenter}>
                                                        모니터링센터 연결
                                                    </Button>
                                                    <Button variant="secondary" onClick={closeModal}>
                                                        완료
                                                    </Button>
                                                </>
                                            )
                                            : (
                                                <>
                                                    <Button
                                                      variant="secondary"
                                                      onClick={previousStep}
                                                      isDisabled={activeStep === 0}
                                                    >
                                                        이전
                                                    </Button>
                                                    {activeStep < flowSteps.length - 1
                                                        ? (
                                                            <Button variant="primary" onClick={nextStep}>
                                                                다음
                                                            </Button>
                                                        )
                                                        : (
                                                            <Button variant="primary" onClick={startRun}>
                                                                구성
                                                            </Button>
                                                        )}
                                                </>
                                            )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </CardBody>
                </Card>
            </ModalBody>
            <ModalFooter>
                <Button
                  variant="link" onClick={closeModal}
                  isDisabled={isRunning}
                >
                    닫기
                </Button>
            </ModalFooter>
        </Modal>
    );
}
