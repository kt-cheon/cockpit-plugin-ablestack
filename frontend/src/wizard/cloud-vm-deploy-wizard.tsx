import React from "react";
import TaskProgress from "../components/common/TaskProgress";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Wizard,
  WizardStep,
  Title,
  Content,
  Form,
  FormGroup,
  Radio,
  Checkbox,
  TextInput,
  TextArea,
  FormSelect,
  FormSelectOption,
  Button,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Alert,
} from "@patternfly/react-core";
import { InfoCircleIcon } from "@patternfly/react-icons";

import ValidationErrorModal from "../components/common/ValidationErrorModal";
import WizardStepStatusLabel, { wizardStatusRowClass } from "../components/common/WizardStepStatus";
import { fetchClusterConfigProfile } from "../services/api/cluster-config";
import {
  checkClusterHealth,
  initializeCCVM,
  createCCVMCloudInit,
  createCCVM,
  startAndRegisterCCVMLicense,
} from "../services/api/cloud-vm-deploy";
import { fetchNicInventory } from "../services/api/inventory";
import { fetchCurrentHostname } from "../services/host";
import { selectionPrompt } from "../utils/selection";
import "./cloud-vm-deploy-wizard.scss";
import {
  duplicateMessage,
  getIpFromCidr,
  isIntegerInRange,
  isIpv4,
  isHostname,
  optionalIpv4,
  requireHostname,
  requireIpv4Cidr,
} from "./validation";

type HostsFileMode = "existing" | "new";
type ClusterType = "powerflex" | "ablestack-hci" | "ablestack-vm" | "ablestack-standalone" | "ablestack-hci-filesystem";
type InventoryLoadState = "idle" | "loading" | "success" | "error";
type CloudVmDeployPhase = "idle" | "running" | "success" | "error";
type CloudVmDeployStep = "health" | "initialize" | "cloudinit" | "xml" | "setup";
type CloudVmDeployStepStatus = "pending" | "running" | "succeeded" | "failed";

const INITIAL_DEPLOY_STEP_STATES: Record<CloudVmDeployStep, CloudVmDeployStepStatus> = {
  health: "pending",
  initialize: "pending",
  cloudinit: "pending",
  xml: "pending",
  setup: "pending",
};

interface SelectOption {
  value: string;
  label: string;
}

interface ClusterHostRow {
  hostName: string;
  hostIp: string;
  scvmMgmtIp: string;
  hostPnIp: string;
  scvmPnIp: string;
  hostCnIp: string;
}

interface CloudVmDeployWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  clusterType?: ClusterType;
  onCompleted?: () => void;
}

const DEFAULT_HOSTS: ClusterHostRow[] = [
  {
    hostName: "",
    hostIp: "",
    scvmMgmtIp: "",
    hostPnIp: "",
    scvmPnIp: "",
    hostCnIp: "",
  }
];

const ROOT_DISK = "500 GiB (THIN Provisioning)";

const CPU_OPTIONS: SelectOption[] = [
  { value: "8", label: "8 vCore" },
  { value: "16", label: "16 vCore" },
];

const MEMORY_OPTIONS: SelectOption[] = [
  { value: "16", label: "16 GiB" },
  { value: "32", label: "32 GiB" },
  { value: "64", label: "64 GiB" },
];

const EMPTY_BRIDGE_OPTIONS: SelectOption[] = [
  { value: "", label: selectionPrompt("Bridge") },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function CloudVmDeployWizardModal({
  isOpen,
  onClose,
  clusterType = "ablestack-hci",
  onCompleted,
}: CloudVmDeployWizardModalProps) {
  const [clusterSensitivity, setClusterSensitivity] = React.useState("5");
  const [cpu, setCpu] = React.useState("8");
  const [memory, setMemory] = React.useState("16");
  const [mgmtBridge, setMgmtBridge] = React.useState("");
  const [svcEnabled, setSvcEnabled] = React.useState(false);
  const [svcBridge, setSvcBridge] = React.useState("");
  const [bridgeOptions, setBridgeOptions] = React.useState<SelectOption[]>(EMPTY_BRIDGE_OPTIONS);
  const [nicLoadState, setNicLoadState] = React.useState<InventoryLoadState>("idle");
  const [nicLoadError, setNicLoadError] = React.useState("");

  const hostsFileMode: HostsFileMode = "existing";
  const [currentHostname, setCurrentHostname] = React.useState("");
  const [hostCount, setHostCount] = React.useState(3);
  const [hosts, setHosts] = React.useState<ClusterHostRow[]>(DEFAULT_HOSTS);
  const [clusterConfigLoadError, setClusterConfigLoadError] = React.useState("");
  const [clusterConfigLoaded, setClusterConfigLoaded] = React.useState(false);

  const [ccvmHostname, setCcvmHostname] = React.useState("ccvm");
  const [mgmtIp, setMgmtIp] = React.useState(""); // 10.10.1.10/16
  const [mgmtGateway, setMgmtGateway] = React.useState("");
  const [mgmtDns, setMgmtDns] = React.useState("");
  const [svcIp, setSvcIp] = React.useState("");
  const [svcGateway, setSvcGateway] = React.useState("");
  const [svcDns, setSvcDns] = React.useState("");

  const [reviewOpen, setReviewOpen] = React.useState({
    appliance: true,
    additional: true,
  });
  const [disableNav, setDisableNav] = React.useState(false);
  const [showDeployConfirm, setShowDeployConfirm] = React.useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = React.useState(false);
  const [isDeployStarted, setIsDeployStarted] = React.useState(false);
  const [isDeployFinished, setIsDeployFinished] = React.useState(false);
  const [deployPhase, setDeployPhase] = React.useState<CloudVmDeployPhase>("idle");
  const [deployMessage, setDeployMessage] = React.useState("");
  const [deployStepStates, setDeployStepStates] = React.useState(INITIAL_DEPLOY_STEP_STATES);
  const [validationMessage, setValidationMessage] = React.useState("");
  const deployNextStepRef = React.useRef<(() => void) | null>(null);
  const isVmClusterType = clusterType === "ablestack-vm";
  const isHciClusterType = clusterType === "powerflex" || clusterType === "ablestack-hci" || clusterType === "ablestack-hci-filesystem";
  const cloudVmDeploySteps: Array<{ id: CloudVmDeployStep; label: string }> = [
    {
      id: "health",
      label: isHciClusterType
        ? "호스트 및 SCVM 상태 체크"
        : "호스트 상태 체크",
    },
    { id: "initialize", label: "클라우드센터 초기화" },
    { id: "cloudinit", label: "cloudinit.iso 생성" },
    { id: "xml", label: "클라우드센터 가상머신 생성" },
    { id: "setup", label: "클라우드센터 가상머신 상세 설정 및 시작" },
  ];

  const applyCurrentHostname = React.useCallback((hostname: string) => {
    if (!hostname) return;
    setCurrentHostname(hostname);
  }, []);

  const resetState = React.useCallback(() => {
    setClusterSensitivity("5");
    setCpu("8");
    setMemory("16");
    setMgmtBridge("");
    setSvcEnabled(false);
    setSvcBridge("");
    setBridgeOptions(EMPTY_BRIDGE_OPTIONS);
    setNicLoadState("idle");
    setNicLoadError("");
    setHostCount(3);
    setHosts(DEFAULT_HOSTS);
    setClusterConfigLoadError("");
    setClusterConfigLoaded(false);
    setCurrentHostname("");
    setCcvmHostname("ccvm");
    setMgmtIp(""); // 10.10.1.10/16
    setMgmtGateway("");
    setMgmtDns("");
    setSvcIp("");
    setSvcGateway("");
    setSvcDns("");
    setReviewOpen({ appliance: true, additional: true });
    setDisableNav(false);
    setShowDeployConfirm(false);
    setShowCancelConfirm(false);
    setIsDeployStarted(false);
    setIsDeployFinished(false);
    setDeployPhase("idle");
    setDeployMessage("");
    setDeployStepStates(INITIAL_DEPLOY_STEP_STATES);
    setValidationMessage("");
    fetchCurrentHostname()
      .then(applyCurrentHostname)
      .catch(() => undefined);
  }, [applyCurrentHostname]);

  const handleClose = () => {
    onClose();
    resetState();
  };

  const requestClose = () => {
    if (isDeployFinished || deployPhase === "success") {
      handleClose();
      return;
    }
    setShowCancelConfirm(true);
  };

  React.useEffect(() => {
    if (!isOpen) return;

    fetchCurrentHostname()
      .then(applyCurrentHostname)
      .catch(() => undefined);
  }, [applyCurrentHostname, isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;

    let isActive = true;

    setNicLoadState("loading");
    setNicLoadError("");

    fetchNicInventory()
      .then((inventory) => {
        if (!isActive) return;
        setBridgeOptions(inventory.bridges.length > 0 ? inventory.bridges : EMPTY_BRIDGE_OPTIONS);
        setNicLoadState("success");
      })
      .catch((error) => {
        if (!isActive) return;
        setBridgeOptions(EMPTY_BRIDGE_OPTIONS);
        setMgmtBridge("");
        setSvcBridge("");
        setNicLoadState("error");
        setNicLoadError(error instanceof Error ? error.message : "NIC 목록을 불러오지 못했습니다.");
      });

    return () => {
      isActive = false;
    };
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen || nicLoadState !== "success") return;
    setSvcBridge((prev) => bridgeOptions.some((option) => option.value === prev && option.value !== mgmtBridge)
      ? prev : "");
  }, [bridgeOptions, isOpen, mgmtBridge, nicLoadState]);

  React.useEffect(() => {
    if (!isOpen || hostsFileMode !== "existing") return;

    let isActive = true;
    setClusterConfigLoadError("");
    setClusterConfigLoaded(false);

    fetchClusterConfigProfile()
      .then((profile) => {
        if (!isActive) return;

        const profileHosts = profile.hosts
          .map((host) => ({
            hostName: host.hostname,
            hostIp: host.ablecube,
            scvmMgmtIp: host.scvmMngt,
            hostPnIp: host.ablecubePn,
            scvmPnIp: host.scvm,
            hostCnIp: host.scvmCn,
          }))
          .filter((host) => host.hostName || host.hostIp);

        if (profileHosts.length > 0) {
          setHosts(profileHosts);
          setHostCount(Math.max(1, profileHosts.length));
        }
        setCcvmHostname("ccvm");
        if (profile.ccvmIp) {
          setMgmtIp(
            profile.managementCidr
              ? `${profile.ccvmIp}/${profile.managementCidr}`
              : profile.ccvmIp
          );
        }
        if (profile.managementGateway) setMgmtGateway(profile.managementGateway);
        if (profile.managementDns) setMgmtDns(profile.managementDns);
        setClusterConfigLoaded(profileHosts.length > 0);
      })
      .catch((error) => {
        if (!isActive) return;
        setClusterConfigLoadError(
          error instanceof Error ? error.message : "cluster.json 정보를 불러오지 못했습니다."
        );
      });

    return () => {
      isActive = false;
    };
  }, [hostsFileMode, isOpen]);

  const updateHostCount = (nextCount: number) => {
    const safeCount = Math.max(3, Math.min(99, nextCount));
    setHostCount(safeCount);
    setHosts((prev) => {
      if (safeCount === prev.length) return prev;
      if (safeCount < prev.length) return prev.slice(0, safeCount);
      const extras = Array.from({ length: safeCount - prev.length }, (_, idx) => ({
        hostName: `ablecube${prev.length + idx + 21}`,
        hostIp: "",
        scvmMgmtIp: "",
        hostPnIp: "",
        scvmPnIp: "",
        hostCnIp: "",
      }));
      return [...prev, ...extras];
    });
  };

  const updateHost = (index: number, key: keyof ClusterHostRow, value: string) => {
    setHosts((prev) => prev.map((host, hostIndex) => (
      hostIndex === index ? { ...host, [key]: value } : host
    )));
  };

  const getOptionLabel = (options: SelectOption[], value: string) =>
    options.find((option) => option.value === value)?.label || value || "미입력";

  const selectedResourceLabel = (options: SelectOption[], value: string) =>
    options.find((option) => option.value === value)?.label || "미선택";

  const buildHostsPreview = () => {
    const lines: string[] = [];
    if (mgmtIp.split("/")[0]) {
      lines.push(`${mgmtIp.split("/")[0]} ccvm-mngt ccvm`);
    }
    hosts.slice(0, hostCount).forEach((row, index) => {
      const hostAlias = row.hostName === currentHostname ? "\tablecube" : "";
      const hostIndex = index + 1;
      if (row.hostIp) {
        lines.push(`${row.hostIp}\t${row.hostName}${hostAlias}`);
      }
      if (isHciClusterType) {
        if (row.scvmMgmtIp) {
          lines.push(`${row.scvmMgmtIp}\tscvm${hostIndex}-mngt${row.hostName === currentHostname ? "\tscvm-mngt" : ""}`);
        }
        if (row.hostPnIp) {
          lines.push(`${row.hostPnIp}\tpn-ablecube${hostIndex}${row.hostName === currentHostname ? "\tpn-ablecube" : ""}`);
        }
        if (row.scvmPnIp) {
          lines.push(`${row.scvmPnIp}\tscvm${hostIndex}${row.hostName === currentHostname ? "\tscvm" : ""}`);
        }
        if (row.hostCnIp) {
          lines.push(`${row.hostCnIp}\tcn-scvm${hostIndex}${row.hostName === currentHostname ? "\tcn-scvm" : ""}`);
        }
      }
    });
    return lines.join("\n");
  };

  const networkConfigLabel = svcEnabled ? "관리네트워크, 서비스네트워크" : "관리네트워크";

  const validateCloudVmDeploy = () => {
    const sensitivity = Number(clusterSensitivity);
    const profileRows = hosts.slice(0, hostCount);

    if (hostsFileMode === "existing" && clusterConfigLoadError) {
      return `cluster.json 정보를 확인해주세요. ${clusterConfigLoadError}`;
    }
    if (isVmClusterType && (!Number.isFinite(sensitivity) || !isIntegerInRange(clusterSensitivity, 5, 300))) {
      return "클러스터 민감도는 5~300초 범위로 입력해야 합니다.";
    }
    if (!cpu) return "CPU를 선택해주세요.";
    if (!memory) return "Memory를 선택해주세요.";
    if (nicLoadState === "error") return `NIC 정보를 확인해주세요. ${nicLoadError}`;
    if (!mgmtBridge) return "관리네트워크 Bridge를 선택해주세요.";
    if (svcEnabled && !svcBridge) return "서비스네트워크 Bridge를 선택해주세요.";

    for (let index = 0; index < profileRows.length; index += 1) {
      const row = profileRows[index];
      const hostLabel = `${index + 1}번 호스트`;
      if (hostsFileMode === "existing") {
        if (!row.hostName || !row.hostIp) {
          return "cluster.json의 호스트 정보를 확인해주세요.";
        }
        if (!isHostname(row.hostName)) return `${hostLabel} 호스트명 입력 형식을 확인해주세요.`;
        if (!isIpv4(row.hostIp)) return `${hostLabel} 호스트 IP 형식을 확인해주세요.`;
        if (isHciClusterType && !row.scvmMgmtIp) return `${hostLabel} SCVM MNGT IP 정보를 확인해주세요.`;
        if (isHciClusterType && !row.hostPnIp) return `${hostLabel} 호스트 PN IP 정보를 확인해주세요.`;
        if (isHciClusterType && !row.scvmPnIp) return `${hostLabel} SCVM PN IP 정보를 확인해주세요.`;
        if (isHciClusterType && !row.hostCnIp) return `${hostLabel} SCVM CN IP 정보를 확인해주세요.`;
        if (isHciClusterType && !isIpv4(row.scvmMgmtIp)) return `${hostLabel} SCVM MNGT IP 형식을 확인해주세요.`;
        if (isHciClusterType && !isIpv4(row.hostPnIp)) return `${hostLabel} 호스트 PN IP 형식을 확인해주세요.`;
        if (isHciClusterType && !isIpv4(row.scvmPnIp)) return `${hostLabel} SCVM PN IP 형식을 확인해주세요.`;
        if (isHciClusterType && !isIpv4(row.hostCnIp)) return `${hostLabel} SCVM CN IP 형식을 확인해주세요.`;
        continue;
      }
      if (!row.hostName || !row.hostIp) {
        return "클러스터 구성 프로파일의 호스트명/IP 정보를 확인해주세요.";
      }
      if (!isHostname(row.hostName)) return `${hostLabel} 호스트명 입력 형식을 확인해주세요.`;
      if (!isIpv4(row.hostIp)) return `${hostLabel} 호스트 IP 형식을 확인해주세요.`;
      if (isHciClusterType && (!row.scvmMgmtIp || !row.hostPnIp || !row.scvmPnIp || !row.hostCnIp)) {
        return "HCI 클러스터 구성 프로파일의 SCVM 및 PN/CN IP 정보를 확인해주세요.";
      }
      if (isHciClusterType && !isIpv4(row.scvmMgmtIp)) return `${hostLabel} SCVM MNGT IP 형식을 확인해주세요.`;
      if (isHciClusterType && !isIpv4(row.hostPnIp)) return `${hostLabel} 호스트 PN IP 형식을 확인해주세요.`;
      if (isHciClusterType && !isIpv4(row.scvmPnIp)) return `${hostLabel} SCVM PN IP 형식을 확인해주세요.`;
      if (isHciClusterType && !isIpv4(row.hostCnIp)) return `${hostLabel} SCVM CN IP 형식을 확인해주세요.`;
    }

    const hostNameMessage = requireHostname(ccvmHostname, "클라우드센터 가상머신의 호스트명");
    if (hostNameMessage) return hostNameMessage;
    const mgmtIpMessage = requireIpv4Cidr(mgmtIp, "관리 NIC IP");
    if (mgmtIpMessage) return mgmtIpMessage;
    const mgmtGatewayMessage = optionalIpv4(mgmtGateway, "관리 NIC Gateway");
    if (mgmtGatewayMessage) return mgmtGatewayMessage;
    const mgmtDnsMessage = optionalIpv4(mgmtDns, "관리 NIC DNS");
    if (mgmtDnsMessage) return mgmtDnsMessage;

    if (svcEnabled) {
      const svcIpMessage = requireIpv4Cidr(svcIp, "서비스 NIC IP");
      if (svcIpMessage) return svcIpMessage;
      if (!isIpv4(svcGateway)) return "서비스 NIC Gateway 형식을 확인해주세요.";
      const svcDnsMessage = optionalIpv4(svcDns, "서비스 NIC DNS");
      if (svcDnsMessage) return svcDnsMessage;
    }

    const duplicateProfileIpMessage = duplicateMessage(
      [
        ...profileRows.flatMap((row) => isHciClusterType
          ? [row.hostIp, row.scvmMgmtIp, row.hostPnIp, row.scvmPnIp, row.hostCnIp]
          : [row.hostIp]),
        getIpFromCidr(mgmtIp),
        svcEnabled ? getIpFromCidr(svcIp) : "",
      ],
      "중복된 IP가 존재합니다."
    );
    if (duplicateProfileIpMessage) return duplicateProfileIpMessage;
    return "";
  };

  const completeDeploy = () => {
    setDeployPhase("success");
    setDeployMessage("클라우드센터 가상머신 배포가 완료되었습니다.");
    setDisableNav(false);
    onCompleted?.();
  };

  const updateDeployStep = (step: CloudVmDeployStep, status: CloudVmDeployStepStatus) => {
    setDeployStepStates((current) => ({ ...current, [step]: status }));
  };

  const runDeployStep = async (step: CloudVmDeployStep, operation: () => Promise<void>) => {
    updateDeployStep(step, "running");
    try {
      await operation();
      updateDeployStep(step, "succeeded");
    } catch (error) {
      updateDeployStep(step, "failed");
      throw error;
    }
  };

  const startCloudVmDeploy = async () => {
    const validationError = validateCloudVmDeploy();
    if (validationError) {
      setValidationMessage(validationError);
      setShowDeployConfirm(false);
      return;
    }

    setValidationMessage("");
    setShowDeployConfirm(false);
    setIsDeployStarted(true);
    setDisableNav(true);
    setDeployPhase("running");
    setDeployMessage("클라우드센터 가상머신 배포를 시작하고 있습니다.");
    setDeployStepStates(INITIAL_DEPLOY_STEP_STATES);
    deployNextStepRef.current?.();

    try {
      await runDeployStep("health", () => checkClusterHealth(isHciClusterType ? "host,scvm" : "host"));
      await runDeployStep("initialize", initializeCCVM);
      await runDeployStep("cloudinit", () => createCCVMCloudInit({
        mgmt_ip: mgmtIp, mgmt_gw: mgmtGateway, dns: mgmtDns,
        ...(svcEnabled ? {
            sn_nic: svcBridge,
            sn_ip: getIpFromCidr(svcIp),
            sn_prefix: Number(svcIp.split("/")[1]),
            sn_gw: svcGateway,
            ...(svcDns ? { sn_dns: svcDns } : {}),
          } : {}),
      }));
      await runDeployStep("xml", () => createCCVM({
        cpu: Number(cpu),
        memory: Number(memory),
        ...(isVmClusterType ? { gfs_mount_point: "/mnt/glue-gfs" } : {}),
        management_network_bridge: mgmtBridge,
        ...(svcEnabled ? { service_network_bridge: svcBridge } : {}),
      }));
      await runDeployStep("setup", startAndRegisterCCVMLicense);
      completeDeploy();
    } catch (error) {
      setDeployPhase("error");
      setDisableNav(false);
      setDeployMessage(`클라우드센터 가상머신 배포에 실패했습니다: ${errorMessage(error)}`);
    }
  };

  const wizardFooter = (
    activeStep: any,
    goToNextStep: (event?: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>,
    goToPrevStep: (event?: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>,
    close: (event?: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>
  ) => {
    if (!activeStep) return null;
    const stepId = String(activeStep.id);
    const isFirst = stepId === "cloud-vm-overview";
    const isReview = stepId === "cloud-vm-review";
    const isDeploy = stepId === "cloud-vm-deploy";
    const isFinish = stepId === "cloud-vm-finish";

    if (isDeploy) {
      return (
        <div className="ct-cloud-vm-wizard__footer">
          <Button
            variant="primary"
            isDisabled={deployPhase === "idle" || deployPhase === "running"}
            onClick={() => {
              if (deployPhase === "error") {
                void startCloudVmDeploy();
                return;
              }
              setIsDeployFinished(true);
              goToNextStep();
            }}
          >
            {deployPhase === "error" ? "다시 구성" : "완료"}
          </Button>
        </div>
      );
    }

    return (
      <div className="ct-cloud-vm-wizard__footer">
        {!isFinish && (
          <Button
            variant="primary"
            onClick={() => {
              if (isReview) {
                deployNextStepRef.current = goToNextStep;
                setShowDeployConfirm(true);
                return;
              }
              goToNextStep();
            }}
          >
            {isReview ? "구성" : "다음"}
          </Button>
        )}
        {!isFirst && !isFinish && (
          <Button variant="secondary" onClick={goToPrevStep}>
            이전
          </Button>
        )}
        {!isFinish && (
          <Button variant="link" onClick={() => setShowCancelConfirm(true)}>
            취소
          </Button>
        )}
        {isFinish && (
          <Button variant="primary" onClick={handleClose}>
            닫기
          </Button>
        )}
      </div>
    );
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        variant="large"
        aria-label="클라우드센터 가상머신 배포 마법사"
        className="ct-cloud-vm-wizard__modal"
      >
        <Wizard
          onClose={requestClose}
          onSave={handleClose}
          width="100%"
          navAriaLabel="클라우드센터 가상머신 배포 단계"
          isVisitRequired
          className={[
              "ct-cloud-vm-wizard",
              disableNav ? "ct-cloud-vm-wizard--nav-locked" : "",
              isDeployStarted ? "ct-wizard--execution-visible" : "",
              isDeployFinished ? "ct-wizard--complete-visible" : "",
          ].join(" ")}
          footer={wizardFooter}
          onStepChange={(_event, currentStep) => {
            const stepId = String(currentStep.id);
            setDisableNav(stepId === "cloud-vm-deploy" || stepId === "cloud-vm-finish");
          }}
          header={
            <div className="ct-cloud-vm-wizard__header">
              <div>
                <Title headingLevel="h1" size="2xl" className="ct-cloud-vm-wizard__title">
                  ABLESTACK 클라우드센터 VM 배포 마법사
                </Title>
                <Content className="ct-cloud-vm-wizard__subtitle">
                  <Content component="p">
                    ABLESTACK 클러스터에 클라우드센터를 실행하는 가상머신 어플라이언스를 배포합니다.
                  </Content>
                </Content>
              </div>
              <button
                type="button"
                className="ct-cloud-vm-wizard__close"
                aria-label="Close"
                onClick={requestClose}
              >
                ×
              </button>
            </div>
          }
        >
          <WizardStep name="개요" id="cloud-vm-overview">
            <div className="ct-cloud-vm-wizard__content">
              <Content>
                <Content component="p">
                  클라우드센터 VM을 배포하기 위해 필요한 정보를 다음과 같이 마법사를 통해 입력받습니다.
                </Content>
                <Content component="ul">
                  <Content component="li">클라우드센터 VM의 HA 구성은 호스트 PN IP 정보를 기준으로 자동 적용됩니다.</Content>
                  <Content component="li">클라우드센터 VM의 CPU, Memory, Disk, Network에 대한 정보</Content>
                  <Content component="li">가상머신의 호스트명 등의 네트워크 정보</Content>
                  <Content component="li">호스트 및 가상머신 네트워크 연결을 위한 구성 정보</Content>
                </Content>
                <Content component="p">
                  필요한 정보를 먼저 준비하십시오. 정보가 준비되었다면 "다음" 버튼을 눌러 클라우드센터 VM 배포를 시작합니다.
                </Content>
              </Content>
            </div>
          </WizardStep>

          <WizardStep
            name="클라우드센터 VM 설정"
            id="cloud-vm-appliance"
            steps={[
              ...(isVmClusterType ? [
                <WizardStep name="클러스터 민감도" id="cloud-vm-cluster-sync-mechanism" key="cloud-vm-cluster-sync-mechanism">
                  <div className="ct-cloud-vm-wizard__content">
                    <Content>
                      <Content component="p">
                        <strong>클라우드센터 VM</strong>에서 클러스터 노드 간 동기화는 중요한 역할을 합니다.
                        이를 통해 통신의 순서와 타이밍을 제어하고, 리더 노드를 결정하며, 장애 복구를 지원합니다.
                      </Content>
                      <Content component="ul">
                        <Content component="li">통신 순서 제어: 다수 노드가 동시에 데이터를 전송할 때 데이터 충돌을 방지합니다.</Content>
                        <Content component="li">타이밍 동기화: 각 노드는 Token을 통해 동기화된 시간 기준으로 작업을 수행합니다.</Content>
                        <Content component="li">장애 복구: Token 전달 상태를 기반으로 장애를 감지하고 복구를 시도합니다.</Content>
                      </Content>
                    </Content>
                    <Form className="ct-cloud-vm-wizard__section ct-cloud-vm-wizard__form-horizontal" isHorizontal>
                      <FormGroup label="클러스터 민감도(초)" isRequired fieldId="cloud-vm-sensitivity">
                        <div className="ct-cloud-vm-wizard__sensitivity-field">
                          <TextInput
                            id="cloud-vm-sensitivity"
                            className="ct-cloud-vm-wizard__sensitivity-input"
                            type="number"
                            min="5"
                            max="300"
                            value={clusterSensitivity}
                            onChange={(_event, value) => setClusterSensitivity(String(value))}
                          />
                        </div>
                      </FormGroup>
                    </Form>
                    <Alert
                      isInline
                      title="클러스터 민감도 설정 시 참고사항"
                      variant="info"
                      customIcon={<InfoCircleIcon />}
                      className="ct-cloud-vm-wizard__info"
                    >
                      <Content component="p">
                        안정적인 클러스터 동작을 위해서는 최소 5초에서 최대 5분(300초)의 시간 범위 내에서 네트워크 품질을 유지하는 것이 권장됩니다.
                      </Content>
                      <Content component="p">
                        클러스터 환경의 규모나 복잡성에 따라 Token 전파 시간과 장애 복구 시간이 달라질 수 있습니다.
                      </Content>
                    </Alert>
                  </div>
                </WizardStep>,
              ] : []),
              <WizardStep name="컴퓨트" id="cloud-vm-compute" key="cloud-vm-compute">
                <div className="ct-cloud-vm-wizard__content">
                  <Content>
                    <Content component="p">
                      클라우드센터 VM의 CPU 및 Memory, ROOT Disk 등의 정보를 설정합니다.
                      아래의 항목에 적합한 값을 선택하여 입력하십시오.
                    </Content>
                  </Content>
                  <Form className="ct-cloud-vm-wizard__section ct-cloud-vm-wizard__form-horizontal" isHorizontal>
                    <FormGroup label="CPU" isRequired fieldId="cloud-vm-cpu">
                      <FormSelect id="cloud-vm-cpu" value={cpu} onChange={(_event, value) => setCpu(String(value))}>
                        {CPU_OPTIONS.map((option) => (
                          <FormSelectOption key={option.value} value={option.value} label={option.label} />
                        ))}
                      </FormSelect>
                    </FormGroup>
                    <FormGroup label="Memory" isRequired fieldId="cloud-vm-memory">
                      <FormSelect
                        id="cloud-vm-memory"
                        value={memory}
                        onChange={(_event, value) => setMemory(String(value))}
                      >
                        {MEMORY_OPTIONS.map((option) => (
                          <FormSelectOption key={option.value} value={option.value} label={option.label} />
                        ))}
                      </FormSelect>
                    </FormGroup>
                    <FormGroup label="ROOT Disk" fieldId="cloud-vm-root-disk">
                      <TextInput id="cloud-vm-root-disk" value={ROOT_DISK} readOnly />
                    </FormGroup>
                  </Form>
                  <Alert
                    isInline
                    title="컴퓨트 자원 구성 시 참고사항"
                    variant="info"
                    customIcon={<InfoCircleIcon />}
                    className="ct-cloud-vm-wizard__info"
                  >
                    <Content component="p">
                      클라우드센터 VM의 Compute 자원은 클라우드센터가 관리해야 할 호스트의 수에 따라 탄력적으로 선택합니다.
                    </Content>
                    <Content component="p">
                      가상머신이 컨트롤 할 호스트의 수가 10개 미만이면 8 vCore를, 그 이상이면 16 vCore를 선택하십시오.
                      메모리는 컨트롤할 호스트의 수가 10개 미만이면 16 GiB를, 10 ~ 20개 이면 32 GiB를, 21개 이상이면 64 GiB를 선택해야 합니다.
                    </Content>
                    <Content component="p">
                      ROOT Disk는 Thin Provisioning 방식으로 제공됩니다.
                    </Content>
                  </Alert>
                </div>
              </WizardStep>,
              <WizardStep name="네트워크" id="cloud-vm-network" key="cloud-vm-network">
                <div className="ct-cloud-vm-wizard__content">
                  <Content>
                    <Content component="p">
                      클라우드센터 VM이 사용할 관리 네트워크용 NIC 정보를 설정합니다.
                      아래의 항목에 적합한 값을 선택하여 입력하십시오.
                    </Content>
                  </Content>
                  {nicLoadState === "loading" && (
                    <Alert
                      isInline
                      variant="info"
                      title="NIC 목록을 불러오는 중입니다."
                      className="ct-cloud-vm-wizard__info"
                    />
                  )}
                  {nicLoadState === "error" && (
                    <Alert
                      isInline
                      variant="danger"
                      title="NIC 목록을 불러오지 못했습니다."
                      className="ct-cloud-vm-wizard__info"
                    >
                      {nicLoadError}
                    </Alert>
                  )}
                  <Form className="ct-cloud-vm-wizard__section ct-cloud-vm-wizard__form-horizontal" isHorizontal>
                    <FormGroup label="네트워크 구성" isRequired fieldId="cloud-vm-network-config">
                      <div className="ct-cloud-vm-wizard__stacked-checks">
                        <Checkbox
                          id="cloud-vm-mgmt-enabled"
                          label="관리네트워크"
                          isChecked
                          isDisabled
                        />
                        <Checkbox
                          id="cloud-vm-svc-enabled"
                          label="서비스네트워크"
                          isChecked={svcEnabled}
                          onChange={(_event, checked) => setSvcEnabled(checked)}
                        />
                      </div>
                    </FormGroup>
                    <FormGroup label="관리네트워크" isRequired fieldId="cloud-vm-mgmt-bridge">
                      <FormSelect
                        id="cloud-vm-mgmt-bridge"
                        value={mgmtBridge}
                        onChange={(_event, value) => setMgmtBridge(String(value))}
                      >
                        {bridgeOptions.map((option) => (
                          <FormSelectOption key={option.value} value={option.value} label={option.value ? option.label : selectionPrompt("관리네트워크 Bridge")} />
                        ))}
                      </FormSelect>
                    </FormGroup>
                    <FormGroup label="서비스네트워크" isRequired fieldId="cloud-vm-svc-bridge">
                      <FormSelect
                        id="cloud-vm-svc-bridge"
                        value={svcBridge}
                        onChange={(_event, value) => setSvcBridge(String(value))}
                        isDisabled={!svcEnabled}
                      >
                        {bridgeOptions.filter((option) => !option.value || option.value !== mgmtBridge).map((option) => (
                          <FormSelectOption key={option.value} value={option.value} label={option.value ? option.label : selectionPrompt("서비스네트워크 Bridge")} />
                        ))}
                      </FormSelect>
                    </FormGroup>
                  </Form>
                  <Alert
                    isInline
                    title="네트워크 구성 시 참고사항"
                    variant="info"
                    customIcon={<InfoCircleIcon />}
                    className="ct-cloud-vm-wizard__info"
                  >
                    <Content component="p">
                      클라우드센터에 접근하고자 하는 네트워크 위치에 따라 가상머신에 할당할 네트워크와 네트워크의 상위 브릿지를 선택합니다.
                      관리네트워크는 호스트를 관리하기 위해 필수적인 네트워크이며 기본 선택되어 있고, 선택 여부를 변경할 수 없습니다.
                    </Content>
                    <Content component="p">
                      가상머신에 네트워크를 할당하기 전에 반드시 상위 브릿지를 먼저 생성해야 합니다.
                    </Content>
                  </Alert>
                </div>
              </WizardStep>,
            ]}
          />

          <WizardStep name="추가 네트워크 정보" id="cloud-vm-additional">
            <div className="ct-cloud-vm-wizard__content">
              <Content>
                <Content component="p">
                  클라우드센터 VM에 호스트명 등의 부가적인 네트워크 정보를 설정합니다. 아래의 항목에 값을 입력하십시오.
                </Content>
              </Content>
              <Form className="ct-cloud-vm-wizard__section ct-cloud-vm-wizard__form-horizontal" isHorizontal>
                <FormGroup label="클러스터 구성 파일" isRequired fieldId="cloud-vm-hosts-file">
                  <div className="ct-cloud-vm-wizard__inline">
                    <Radio
                      id="cloud-vm-hosts-file-existing"
                      name="cloud-vm-hosts-file"
                      label="해당 호스트 파일 사용"
                      isChecked
                      isDisabled
                    />
                    <Radio
                      id="cloud-vm-hosts-file-new"
                      name="cloud-vm-hosts-file"
                      label="신규 생성"
                      isChecked={false}
                      isDisabled
                    />
                  </div>
                </FormGroup>
                <FormGroup label="현재 호스트" isRequired fieldId="cloud-vm-current-host">
                  <TextInput id="cloud-vm-current-host" value={currentHostname} readOnly />
                </FormGroup>
                <FormGroup label="클러스터 구성 호스트 수" isRequired fieldId="cloud-vm-host-count">
                  <div className="ct-cloud-vm-wizard__stepper">
                    <Button
                      variant="control"
                      isDisabled={hostsFileMode === "existing"}
                      onClick={() => updateHostCount(hostCount - 1)}
                      aria-label="Minus"
                    >
                      -
                    </Button>
                    <div className="ct-cloud-vm-wizard__stepper-value">{hostCount}</div>
                    <Button
                      variant="control"
                      isDisabled={hostsFileMode === "existing"}
                      onClick={() => updateHostCount(hostCount + 1)}
                      aria-label="Plus"
                    >
                      +
                    </Button>
                    <span className="ct-cloud-vm-wizard__stepper-unit">대</span>
                  </div>
                </FormGroup>

                {hostsFileMode === "existing" && (
                  <Alert
                    isInline
                    title={
                      clusterConfigLoadError
                        ? "cluster.json 정보를 불러오지 못했습니다."
                        : clusterConfigLoaded
                          ? "cluster.json의 호스트 정보를 자동으로 적용했습니다."
                          : "cluster.json 정보를 불러오는 중입니다."
                    }
                    variant={clusterConfigLoadError ? "warning" : "info"}
                    className="ct-cloud-vm-wizard__info"
                  />
                )}
              </Form>

              <div className="ct-cloud-vm-wizard__table-wrap">
                <div className="ct-cloud-vm-wizard__table-title">클러스터 구성 프로파일</div>
                <table className="ct-cloud-vm-wizard__table">
                  <thead>
                    <tr>
                      <th>순번</th>
                      <th>호스트명</th>
                      <th>호스트 IP</th>
                      {isHciClusterType && (
                        <>
                          <th>SCVM<br />MNGT IP</th>
                          <th>호스트 PN IP</th>
                          <th>SCVM PN IP</th>
                          <th>SCVM CN IP</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {hosts.slice(0, hostCount).map((row, idx) => (
                      <tr key={`cloud-vm-host-row-${idx}`}>
                        <td>{idx + 1}</td>
                        <td>
                          <TextInput
                            aria-label={`호스트명 ${idx + 1}`}
                            value={row.hostName}
                            isDisabled={hostsFileMode === "existing"}
                            onChange={(_event, value) => updateHost(idx, "hostName", value)}
                          />
                        </td>
                        <td>
                          <TextInput
                            aria-label={`호스트 IP ${idx + 1}`}
                            value={row.hostIp}
                            isDisabled={hostsFileMode === "existing"}
                            onChange={(_event, value) => updateHost(idx, "hostIp", value)}
                          />
                        </td>
                        {isHciClusterType && (
                          <>
                            <td>
                              <TextInput
                                aria-label={`SCVM MNGT IP ${idx + 1}`}
                                value={row.scvmMgmtIp}
                                isDisabled={hostsFileMode === "existing"}
                                onChange={(_event, value) => updateHost(idx, "scvmMgmtIp", value)}
                              />
                            </td>
                            <td>
                              <TextInput
                                aria-label={`호스트 PN IP ${idx + 1}`}
                                value={row.hostPnIp}
                                isDisabled={hostsFileMode === "existing"}
                                onChange={(_event, value) => updateHost(idx, "hostPnIp", value)}
                              />
                            </td>
                            <td>
                              <TextInput
                                aria-label={`SCVM PN IP ${idx + 1}`}
                                value={row.scvmPnIp}
                                isDisabled={hostsFileMode === "existing"}
                                onChange={(_event, value) => updateHost(idx, "scvmPnIp", value)}
                              />
                            </td>
                            <td>
                              <TextInput
                                aria-label={`SCVM CN IP ${idx + 1}`}
                                value={row.hostCnIp}
                                isDisabled={hostsFileMode === "existing"}
                                onChange={(_event, value) => updateHost(idx, "hostCnIp", value)}
                              />
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Form className="ct-cloud-vm-wizard__section ct-cloud-vm-wizard__form-horizontal" isHorizontal>
                <FormGroup label="호스트명(CCVM)" isRequired fieldId="cloud-vm-hostname">
                  <TextInput
                    id="cloud-vm-hostname"
                    value={ccvmHostname}
                    isDisabled={hostsFileMode === "existing"}
                    onChange={(_event, value) => setCcvmHostname(value)}
                  />
                </FormGroup>
                <FormGroup label="관리 NIC IP" isRequired fieldId="cloud-vm-mgmt-ip">
                  <TextInput
                    id="cloud-vm-mgmt-ip"
                    value={mgmtIp}
                    placeholder="xxx.xxx.xxx.xxx/xx 형식으로 입력"
                    isDisabled={hostsFileMode === "existing"}
                    onChange={(_event, value) => setMgmtIp(value)}
                  />
                </FormGroup>
                <FormGroup label="관리 NIC Gateway" fieldId="cloud-vm-mgmt-gw">
                  <TextInput
                    id="cloud-vm-mgmt-gw"
                    value={mgmtGateway}
                    placeholder="xxx.xxx.xxx.xxx 형식으로 입력"
                    isDisabled={hostsFileMode === "existing"}
                    onChange={(_event, value) => setMgmtGateway(value)}
                  />
                </FormGroup>
                <FormGroup label="관리 NIC DNS" fieldId="cloud-vm-mgmt-dns">
                  <TextInput
                    id="cloud-vm-mgmt-dns"
                    value={mgmtDns}
                    placeholder="xxx.xxx.xxx.xxx 형식으로 입력"
                    isDisabled={hostsFileMode === "existing"}
                    onChange={(_event, value) => setMgmtDns(value)}
                  />
                </FormGroup>
                <FormGroup label="서비스 NIC IP" fieldId="cloud-vm-svc-ip">
                  <TextInput
                    id="cloud-vm-svc-ip"
                    value={svcIp}
                    placeholder="xxx.xxx.xxx.xxx/xx 형식으로 입력"
                    onChange={(_event, value) => setSvcIp(value)}
                    isDisabled={!svcEnabled}
                  />
                </FormGroup>
                <FormGroup label="서비스 NIC Gateway" fieldId="cloud-vm-svc-gw">
                  <TextInput
                    id="cloud-vm-svc-gw"
                    value={svcGateway}
                    placeholder="xxx.xxx.xxx.xxx 형식으로 입력"
                    onChange={(_event, value) => setSvcGateway(value)}
                    isDisabled={!svcEnabled}
                  />
                </FormGroup>
                <FormGroup label="서비스 NIC DNS" fieldId="cloud-vm-svc-dns">
                  <TextInput
                    id="cloud-vm-svc-dns"
                    value={svcDns}
                    placeholder="xxx.xxx.xxx.xxx 형식으로 입력"
                    onChange={(_event, value) => setSvcDns(value)}
                    isDisabled={!svcEnabled}
                  />
                </FormGroup>
              </Form>
            </div>
          </WizardStep>

          <WizardStep name="설정확인" id="cloud-vm-review">
            <div className="ct-cloud-vm-wizard__content">
              <Content>
                <Content component="p">
                  클라우드센터 VM의 배포를 위해 입력한 설정 정보는 다음과 같습니다.
                  입력한 정보를 수정하고자 하는 경우, 해당 탭으로 이동하여 정보를 수정하십시오.
                </Content>
                <Content component="p">모든 정보를 확인한 후 "배포"를 시작합니다.</Content>
              </Content>

              <div className="ct-cloud-vm-wizard__review-accordion">
                <div className="ct-cloud-vm-wizard__review-section">
                  <button
                    type="button"
                    className="ct-cloud-vm-wizard__review-header"
                    onClick={() => setReviewOpen((prev) => ({ ...prev, appliance: !prev.appliance }))}
                  >
                    <span>클라우드센터 VM 설정</span>
                    <span className={reviewOpen.appliance ? "ct-cloud-chevron ct-cloud-chevron--open" : "ct-cloud-chevron"}>
                      ▾
                    </span>
                  </button>
                  {reviewOpen.appliance && (
                    <div className="ct-cloud-vm-wizard__review-body">
                      <DescriptionList isCompact className="ct-cloud-vm-wizard__review-detail">
                        {isVmClusterType && (
                          <DescriptionListGroup>
                            <DescriptionListTerm>클러스터 민감도</DescriptionListTerm>
                            <DescriptionListDescription>{clusterSensitivity} 초</DescriptionListDescription>
                          </DescriptionListGroup>
                        )}
                        <DescriptionListGroup>
                          <DescriptionListTerm>CPU</DescriptionListTerm>
                          <DescriptionListDescription>{selectedResourceLabel(CPU_OPTIONS, cpu)}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>Memory</DescriptionListTerm>
                          <DescriptionListDescription>{selectedResourceLabel(MEMORY_OPTIONS, memory)}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>ROOT Disk Size</DescriptionListTerm>
                          <DescriptionListDescription>{ROOT_DISK}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>네트워크 구성</DescriptionListTerm>
                          <DescriptionListDescription>{networkConfigLabel}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>관리용 Bridge</DescriptionListTerm>
                          <DescriptionListDescription>
                            관리 네트워크 : {getOptionLabel(bridgeOptions, mgmtBridge)}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>서비스용 Bridge</DescriptionListTerm>
                          <DescriptionListDescription>
                            {svcEnabled ? getOptionLabel(bridgeOptions, svcBridge) : "N/A"}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      </DescriptionList>
                    </div>
                  )}
                </div>

                <div className="ct-cloud-vm-wizard__review-section">
                  <button
                    type="button"
                    className="ct-cloud-vm-wizard__review-header"
                    onClick={() => setReviewOpen((prev) => ({ ...prev, additional: !prev.additional }))}
                  >
                    <span>추가 네트워크 정보</span>
                    <span className={reviewOpen.additional ? "ct-cloud-chevron ct-cloud-chevron--open" : "ct-cloud-chevron"}>
                      ▾
                    </span>
                  </button>
                  {reviewOpen.additional && (
                    <div className="ct-cloud-vm-wizard__review-body">
                      <DescriptionList isCompact className="ct-cloud-vm-wizard__review-detail">
                        <DescriptionListGroup>
                          <DescriptionListTerm>클러스터 구성 준비</DescriptionListTerm>
                          <DescriptionListDescription>
                            해당 호스트 파일 사용
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>클러스터 구성 프로파일</DescriptionListTerm>
                          <DescriptionListDescription>
                            <TextArea
                              aria-label="클러스터 구성 프로파일 미리보기"
                              readOnly
                              value={buildHostsPreview()}
                              rows={6}
                              className="ct-cloud-vm-wizard__review-textarea"
                            />
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>호스트명(CCVM)</DescriptionListTerm>
                          <DescriptionListDescription>{ccvmHostname}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>관리 NIC 정보</DescriptionListTerm>
                          <DescriptionListDescription>
                            IP Addr : {mgmtIp || "미입력"}
                            <br />
                            Gateway : {mgmtGateway || "미입력"}
                            <br />
                            DNS : {mgmtDns || "미입력"}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>서비스 NIC 정보</DescriptionListTerm>
                          <DescriptionListDescription>
                            IP Addr : {svcEnabled ? svcIp || "미입력" : "N/A"}
                            <br />
                            Gateway : {svcEnabled ? svcGateway || "미입력" : "N/A"}
                            <br />
                            DNS : {svcEnabled ? svcDns || "미입력" : "N/A"}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      </DescriptionList>
                    </div>
                  )}
                </div>

              </div>
            </div>
          </WizardStep>

          <WizardStep name="구성" id="cloud-vm-deploy">
            <div className="ct-cloud-vm-wizard__content">
            <TaskProgress />
              <Content component="p" className="ct-cloud-vm-wizard__deploy-title">
                {deployPhase === "success"
                  ? "클라우드센터 가상머신 배포가 완료되었습니다."
                  : deployPhase === "error"
                    ? "클라우드센터 가상머신 배포 중 오류가 발생했습니다."
                    : "클라우드센터 가상머신 배포를 실행하고 있습니다."}
              </Content>
              {deployMessage && (
                <Alert
                  isInline
                  variant={deployPhase === "error" ? "danger" : deployPhase === "success" ? "success" : "info"}
                  title={deployMessage}
                />
              )}
              <div className="ct-cloud-vm-wizard__status-list">
                {cloudVmDeploySteps.map(({ id, label }) => {
                  const status = deployStepStates[id];

                  return (
                    <div key={id} className={wizardStatusRowClass(status)}>
                      <WizardStepStatusLabel status={status} ariaLabel={`${label} 진행 중`} />
                      <span className="ct-wizard-status-row__text">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </WizardStep>

          <WizardStep name="완료" id="cloud-vm-finish">
            <div className="ct-cloud-vm-wizard__content">
              <Content>
                <Content component="p">
                  클라우드센터 VM의 배포를 완료했습니다. 가상머신이 배포되면 다음의 작업을 수행해야 합니다.
                </Content>
                <Content component="ul">
                  <Content component="li">클라우드센터 VM의 웹관리콘솔에 접속</Content>
                  <Content component="li">ABLESTACK에 대한 클라우드 Zone 구성</Content>
                  <Content component="li">가상머신 생성을 위한 각종 정책 준비</Content>
                </Content>
                <Content component="p">위의 모든 작업은 클라우드센터 VM의 웹 관리콘솔을 이용해 진행합니다.</Content>
              </Content>
            </div>
          </WizardStep>
        </Wizard>
      </Modal>
      <Modal
        isOpen={showDeployConfirm}
        variant="small"
        aria-label="클라우드센터 가상머신 배포 진행 확인"
        onClose={() => setShowDeployConfirm(false)}
      >
        <ModalHeader title="클라우드센터 가상머신 배포 진행" />
        <ModalBody>
          <Content component="p">클라우드센터 가상머신 배포를 진행하시겠습니까?</Content>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={() => void startCloudVmDeploy()}>
            실행
          </Button>
          <Button variant="link" onClick={() => setShowDeployConfirm(false)}>
            아니요
          </Button>
        </ModalFooter>
      </Modal>
      <Modal
        isOpen={showCancelConfirm}
        variant="small"
        aria-label="클라우드센터 가상머신 배포 취소 확인"
        onClose={() => setShowCancelConfirm(false)}
      >
        <ModalHeader title="클라우드센터 가상머신 배포 취소" />
        <ModalBody>
          <Content component="p">
            클라우드센터 가상머신 배포를 취소하시겠습니까? 입력된 데이터는 초기화 됩니다.
          </Content>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={handleClose}>
            실행
          </Button>
          <Button variant="link" onClick={() => setShowCancelConfirm(false)}>
            아니요
          </Button>
        </ModalFooter>
      </Modal>
      <ValidationErrorModal
        isOpen={Boolean(validationMessage)}
        message={validationMessage}
        onClose={() => setValidationMessage("")}
      />
    </>
  );
}
