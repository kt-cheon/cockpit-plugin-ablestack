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
  TextInput,
  Button,
  Checkbox,
  Alert,
  Label,
  Spinner,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
} from "@patternfly/react-core";
import { InfoCircleIcon, AngleRightIcon, ExclamationTriangleIcon } from "@patternfly/react-icons";

import ValidationErrorModal from "../components/common/ValidationErrorModal";
import WizardStepStatusLabel, { wizardStatusRowClass } from "../components/common/WizardStepStatus";
import { fetchClusterConfigProfile } from "../services/api/cluster-config";
import {
  configureGfsStonith,
  createGfsStorage,
  initGfsPcsCluster,
  setGfsPcsAlert,
  type GfsManageStonithDevice,
} from "../services/api/gfs-manage";
import { fetchDiskInventory, type DiskInventoryOption } from "../services/api/inventory";
import { markGfsConfigureComplete } from "../services/api/system-config";
import {
  formatMultipathSyncAction,
  MultipathSyncError,
  runMultipathSync,
  type MultipathSyncAction,
  type MultipathSyncResult,
} from "../services/api/multipath-sync";
import "./gfs-storage-configure-wizard.scss";
import { isIpv4 } from "./validation";

type DeployPhase = "idle" | "running" | "done" | "error";
type ExternalSyncMode = "duplication" | "single" | "skip";
type ExternalSyncPhase = "idle" | "running" | "success" | "error";
type IpmiMode = "common" | "individual";
type InventoryLoadState = "idle" | "loading" | "success" | "error";
type DeployStepId = "pcs" | "stonith" | "gfs" | "alert" | "profile";
type DeployStepStatus = "pending" | "running" | "succeeded" | "failed";

interface MonitoringHostIpmi {
  hostName: string;
  ip: string;
  username: string;
  password: string;
}

interface GfsStorageConfigureWizardModalProps {
  diskInventoryAction?: 'gfs' | 'rbd';
  isOpen: boolean;
  onClose: () => void;
  onCompleted?: () => void;
}

export default function GfsStorageConfigureWizardModal({
  diskInventoryAction = 'gfs',
  isOpen,
  onClose,
  onCompleted,
}: GfsStorageConfigureWizardModalProps) {
  const [externalSyncMode, setExternalSyncMode] = React.useState<ExternalSyncMode>("duplication");
  const [selectedDisks, setSelectedDisks] = React.useState<string[]>([]);
  const [ipmiMode, setIpmiMode] = React.useState<IpmiMode>("common");
  const [ipmiCommonUser, setIpmiCommonUser] = React.useState("");
  const [ipmiCommonPass, setIpmiCommonPass] = React.useState("");
  const [ipmiHosts, setIpmiHosts] = React.useState<MonitoringHostIpmi[]>([]);
  const [gfsDiskOptions, setGfsDiskOptions] = React.useState<DiskInventoryOption[]>([]);
  const [diskLoadState, setDiskLoadState] = React.useState<InventoryLoadState>("idle");
  const [diskLoadError, setDiskLoadError] = React.useState("");
  const [clusterLoadState, setClusterLoadState] = React.useState<InventoryLoadState>("idle");
  const [clusterLoadError, setClusterLoadError] = React.useState("");

  const [reviewOpen, setReviewOpen] = React.useState({
    external: true,
    disk: true,
    ipmi: true,
  });
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = React.useState(false);
  const [validationMessage, setValidationMessage] = React.useState("");
  const [externalSyncCompleted, setExternalSyncCompleted] = React.useState(false);
  const [externalSyncPhase, setExternalSyncPhase] = React.useState<ExternalSyncPhase>("idle");
  const [externalSyncMessage, setExternalSyncMessage] = React.useState("");
  const [externalSyncResult, setExternalSyncResult] = React.useState<MultipathSyncResult | null>(null);
  const [deployPhase, setDeployPhase] = React.useState<DeployPhase>("idle");
  const [deployMessage, setDeployMessage] = React.useState("");
  const [deploySteps, setDeploySteps] = React.useState<Record<DeployStepId, DeployStepStatus>>({
    pcs: "pending",
    stonith: "pending",
    gfs: "pending",
    alert: "pending",
    profile: "pending",
  });
  const [disableNav, setDisableNav] = React.useState(false);

  const nextStepRef = React.useRef<null | (() => void)>(null);

  const resetState = React.useCallback(() => {
    setExternalSyncMode("duplication");
    setSelectedDisks([]);
    setIpmiMode("common");
    setIpmiCommonUser("");
    setIpmiCommonPass("");
    setIpmiHosts([]);
    setGfsDiskOptions([]);
    setDiskLoadState("idle");
    setDiskLoadError("");
    setClusterLoadState("idle");
    setClusterLoadError("");
    setReviewOpen({ external: true, disk: true, ipmi: true });
    setConfirmOpen(false);
    setCancelConfirmOpen(false);
    setValidationMessage("");
    setExternalSyncCompleted(false);
    setExternalSyncPhase("idle");
    setExternalSyncMessage("");
    setExternalSyncResult(null);
    setDeployPhase("idle");
    setDeployMessage("");
    setDeploySteps({ pcs: "pending", stonith: "pending", gfs: "pending", alert: "pending", profile: "pending" });
    setDisableNav(false);
  }, []);

  const handleClose = () => {
    onClose();
    resetState();
  };

  const requestClose = () => {
    if (deployPhase === "done") {
      handleClose();
      return;
    }
    setCancelConfirmOpen(true);
  };

  React.useEffect(() => {
    if (!isOpen) return;

    let isActive = true;

    setDiskLoadState("loading");
    setDiskLoadError("");
    fetchDiskInventory(diskInventoryAction)
      .then((options) => {
        console.log("disk options:", options);
        if (!isActive) return;
        setGfsDiskOptions(options);
        setSelectedDisks((prev) => prev.filter((diskId) => (
          options.some((disk) => disk.value === diskId && !disk.inUse)
        )));
        setDiskLoadState("success");
      })
      .catch((error) => {
        if (!isActive) return;
        setGfsDiskOptions([]);
        setSelectedDisks([]);
        setDiskLoadState("error");
        setDiskLoadError(error instanceof Error ? error.message : "GFS 디스크 목록을 불러오지 못했습니다.");
      });

    setClusterLoadState("loading");
    setClusterLoadError("");
    fetchClusterConfigProfile()
      .then((profile) => {
        if (!isActive) return;

        const hosts = profile.hosts
          .map((host, index) => ({
            hostName: host.hostname || `host-${host.index || index + 1}`,
            ip: "",
            username: "",
            password: "",
          }))
          .filter((host) => host.hostName);

        setIpmiHosts((prev) => hosts.map((host) => {
          const existing = prev.find((item) => item.hostName === host.hostName);
          return existing ? { ...host, ...existing, hostName: host.hostName } : host;
        }));
        setClusterLoadState("success");
      })
      .catch((error) => {
        if (!isActive) return;
        setIpmiHosts([]);
        setClusterLoadState("error");
        setClusterLoadError(error instanceof Error ? error.message : "cluster.json 정보를 불러오지 못했습니다.");
      });

    return () => {
      isActive = false;
    };
  }, [isOpen, diskInventoryAction]);

  const externalSyncLabel =
    externalSyncMode === "duplication"
      ? "이중화"
      : externalSyncMode === "single"
        ? "단중화"
        : "건너뛰기";
  const externalSyncAction: MultipathSyncAction | null =
    externalSyncMode === "duplication"
      ? "sync"
      : externalSyncMode === "single"
        ? "rescan"
        : null;
  const isExternalSyncRunning = externalSyncPhase === "running";
  const externalSyncStatus = externalSyncMode === "skip"
    ? "skipped"
    : externalSyncPhase === "success"
      ? "succeeded"
      : externalSyncPhase === "error"
        ? "failed"
        : externalSyncPhase === "running"
          ? "running"
          : "pending";
  const externalSyncStatusText =
    externalSyncMode === "skip"
      ? "건너뜀"
      : externalSyncPhase === "success"
        ? "완료"
        : externalSyncPhase === "error"
          ? "실패"
          : externalSyncPhase === "running"
            ? "진행 중"
            : "대기";

  const updateIpmiHost = (index: number, patch: Partial<MonitoringHostIpmi>) => {
    setIpmiHosts((prev) => prev.map((host, hostIndex) => (
      hostIndex === index ? { ...host, ...patch } : host
    )));
  };

  const validateGfsStorage = () => {
    if (!externalSyncMode) {
      return "외부 스토리지 동기화 여부를 선택해주세요.";
    }

    if (selectedDisks.length === 0) {
      return "GFS 디스크를 선택해주세요.";
    }

    if (diskLoadState === "error") {
      return `GFS 디스크 정보를 확인해주세요. ${diskLoadError}`;
    }

    if (clusterLoadState === "error") {
      return `cluster.json 정보를 확인해주세요. ${clusterLoadError}`;
    }

    if (ipmiHosts.length === 0) {
      return "cluster.json의 호스트 정보를 확인해주세요.";
    }

    const missingIpmi = ipmiHosts.find((host) => !host.ip.trim());
    if (missingIpmi) {
      return `${missingIpmi.hostName} IPMI IP를 입력해주세요.`;
    }

    const invalidIpmi = ipmiHosts.find((host) => !isIpv4(host.ip));
    if (invalidIpmi) {
      return `${invalidIpmi.hostName} IPMI IP 형식을 확인해주세요.`;
    }

    if (ipmiMode === "common") {
      if (!ipmiCommonUser.trim()) return "IPMI 아이디를 입력해주세요.";
      if (!ipmiCommonPass.trim()) return "IPMI 비밀번호를 입력해주세요.";
      return "";
    }

    const missingCredential = ipmiHosts.find((host) => !host.username.trim() || !host.password.trim());
    if (missingCredential) {
      return `${missingCredential.hostName} IPMI 아이디와 비밀번호를 입력해주세요.`;
    }

    return "";
  };

  const resetExternalSyncExecution = () => {
    setExternalSyncCompleted(false);
    setExternalSyncPhase("idle");
    setExternalSyncMessage("");
    setExternalSyncResult(null);
  };

  const executeExternalStorageSync = async () => {
    if (!externalSyncAction) {
      return;
    }

    const actionLabel = formatMultipathSyncAction(externalSyncAction);

    setExternalSyncCompleted(false);
    setExternalSyncPhase("running");
    setExternalSyncMessage(`${actionLabel}을 실행하고 있습니다. 호스트 수와 스토리지 상태에 따라 시간이 걸릴 수 있습니다.`);
    setExternalSyncResult(null);

    try {
      const result = await runMultipathSync(externalSyncAction);

      setExternalSyncResult(result);
      setExternalSyncCompleted(true);
      setExternalSyncPhase("success");
      setExternalSyncMessage(`${actionLabel}이 완료되었습니다. 다음 단계로 진행할 수 있습니다.`);
    } catch (error) {
      const result = error instanceof MultipathSyncError ? error.result : null;

      console.error("multipath sync API error:", error);
      setExternalSyncResult(result);
      setExternalSyncCompleted(false);
      setExternalSyncPhase("error");
      setExternalSyncMessage(
        error instanceof Error
          ? error.message
          : `${actionLabel}에 실패했습니다.`
      );
    }
  };

  const setDeployStep = (step: DeployStepId, status: DeployStepStatus) => {
    setDeploySteps((prev) => ({ ...prev, [step]: status }));
  };

  const stonithDevices = (): GfsManageStonithDevice[] => ipmiHosts.map((host) => ({
    ipaddr: host.ip.trim(),
    ipport: "623",
    login: ipmiMode === "common" ? ipmiCommonUser.trim() : host.username.trim(),
    passwd: ipmiMode === "common" ? ipmiCommonPass : host.password,
    hostname: host.hostName,
  }));

  const executeDeploy = async () => {
    setDeployMessage("GFS PCS 초기화를 시작하고 있습니다.");
    setDeploySteps({ pcs: "running", stonith: "pending", gfs: "pending", alert: "pending", profile: "pending" });

    try {
      await initGfsPcsCluster(selectedDisks);
      setDeployStep("pcs", "succeeded");
      setDeployStep("stonith", "running");
      setDeployMessage("IPMI STONITH 구성을 적용하고 있습니다.");

      await configureGfsStonith(stonithDevices());
      setDeployStep("stonith", "succeeded");
      setDeployStep("gfs", "running");
      setDeployMessage("PCS locking 안정화를 확인하고 GFS2 리소스를 생성하고 있습니다.");

      await createGfsStorage(selectedDisks);
      setDeployStep("gfs", "succeeded");
      setDeployStep("alert", "running");
      setDeployMessage("PCS 알림 구성을 적용하고 있습니다.");

      await setGfsPcsAlert();
      setDeployStep("alert", "succeeded");
      setDeployStep("profile", "running");
      setDeployMessage("전체 호스트의 GFS 구성 완료 상태를 반영하고 있습니다.");

      await markGfsConfigureComplete();
      setDeployStep("profile", "succeeded");
      setDeployPhase("done");
      setDisableNav(false);
      setDeployMessage("PCS 클러스터와 IPMI STONITH 및 GFS 디스크 구성이 완료되었습니다.");
      onCompleted?.();
    } catch (error) {
      setDeployPhase("error");
      setDisableNav(false);
      setDeployMessage(error instanceof Error ? error.message : "GFS 구성 작업 실행에 실패했습니다.");
      setDeploySteps((prev) => {
        const next = { ...prev };
        (Object.keys(next) as DeployStepId[]).forEach((step) => {
          if (next[step] === "running") {
            next[step] = "failed";
          }
        });
        return next;
      });
    }
  };

  const startDeploy = () => {
    const message = validateGfsStorage();
    if (message) {
      setValidationMessage(message);
      setConfirmOpen(false);
      return;
    }

    setValidationMessage("");
    setConfirmOpen(false);
    setDeployPhase("running");
    setDisableNav(true);
    setDeployMessage("");
    setDeploySteps({ pcs: "pending", stonith: "pending", gfs: "pending", alert: "pending", profile: "pending" });
    nextStepRef.current?.();
    void executeDeploy();
  };

  const diskLabel = (diskId: string) => gfsDiskOptions.find((disk) => disk.value === diskId)?.label || diskId;
  const wizardFooter = (
    activeStep: any,
    goToNextStep: (event?: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>,
    goToPrevStep: (event?: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>
  ) => {
    if (!activeStep) return null;
    const stepId = String(activeStep.id);
    const isFirst = stepId === "gfs-overview";
    const isReview = stepId === "gfs-review";
    const isDeploy = stepId === "gfs-deploy";
    const isFinish = stepId === "gfs-finish";
    const isExternalSync = stepId === "gfs-external-storage-sync";
    const isExternalSyncRequired = isExternalSync && Boolean(externalSyncAction) && !externalSyncCompleted;

    if (isReview) {
      nextStepRef.current = goToNextStep;
    }

    const handlePrimary = () => {
      if (isReview) {
        setConfirmOpen(true);
        return;
      }
      if (isDeploy) {
        if (deployPhase === "error") {
          setConfirmOpen(true);
          return;
        }
        if (deployPhase !== "done") {
          return;
        }
        goToNextStep();
        return;
      }
      if (isFinish) {
        handleClose();
        return;
      }
      goToNextStep();
    };

    const primaryLabel = isReview
      ? "구성"
      : isDeploy
        ? deployPhase === "done"
          ? "완료"
          : deployPhase === "error"
            ? "다시 구성"
            : "구성 중"
      : isFinish
        ? "닫기"
        : "다음";
    const primaryDisabled = isExternalSyncRequired ||
      isExternalSyncRunning ||
      (isDeploy && deployPhase !== "done" && deployPhase !== "error");

    return (
      <div className="ct-gfs-storage-wizard__footer">
        <Button variant="primary" onClick={handlePrimary} isDisabled={primaryDisabled}>
          {primaryLabel}
        </Button>
        {!isFirst && !isDeploy && !isFinish && (
          <Button variant="secondary" onClick={goToPrevStep}>
            이전
          </Button>
        )}
        {!isDeploy && !isFinish && (
          <Button variant="link" onClick={requestClose}>
            취소
          </Button>
        )}
      </div>
    );
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        // onClose={handleClose}
        variant="large"
        aria-label="GFS 스토리지 구성 마법사"
        className="ct-gfs-storage-wizard__modal"
      >
        <Wizard
          onClose={requestClose}
          onSave={handleClose}
          width="100%"
          navAriaLabel="GFS 스토리지 구성 단계"
          isVisitRequired
          className={[
            "ct-gfs-storage-wizard",
            disableNav ? "ct-gfs-storage-wizard--nav-locked" : "",
            deployPhase !== "idle" ? "ct-wizard--execution-visible" : "",
            deployPhase === "done" ? "ct-wizard--complete-visible" : "",
          ].join(" ")}
          footer={wizardFooter}
          onStepChange={(_event, currentStep) => {
            const stepId = String(currentStep.id);
            if (stepId === "gfs-deploy") {
              setDisableNav(true);
              return;
            }
            setDisableNav(false);
          }}
          header={
            <div className="ct-gfs-storage-wizard__header">
              <div>
                <Title headingLevel="h1" size="2xl" className="ct-gfs-storage-wizard__title">
                  GFS 스토리지 구성 마법사
                </Title>
                <Content className="ct-gfs-storage-wizard__subtitle">
                  <Content component="p">
                    GFS 스토리지를 모든 호스트에 구성하기 위해, 스토리지 배포를 단계별로 체계적으로 진행합니다.
                  </Content>
                </Content>
              </div>
              <button
                type="button"
                className="ct-gfs-storage-wizard__close"
                aria-label="Close"
                onClick={requestClose}
              >
                ×
              </button>
            </div>
          }
        >
          <WizardStep name="개요" id="gfs-overview">
            <div className="ct-gfs-storage-wizard__content">
              <Content>
                <Content component="p">
                  GFS 스토리지 구성 마법사는 클러스터 환경에서 GFS 스토리지를 모든 호스트에 일관되게 구성하고, 운영에 필요한
                  설정을 자동으로 적용하는 도구입니다. GFS 스토리지를 배포하기 위해서는 다음의 정보가 필요합니다.
                </Content>
                <Content component="ul">
                  <Content component="li">SAN 스토리지에서 클러스터 환경의 디스크 할당 및 WWN 정보</Content>
                  <Content component="li">클러스터 환경의 GFS 스토리지 디스크 연결</Content>
                  <Content component="li">호스트별 원격 관리(IPMI) 정보</Content>
                </Content>
                <Content component="p">
                  필요한 정보를 먼저 준비하십시오. 정보가 준비되었다면 "다음" 버튼을 눌러 GFS 스토리지 구성을 시작합니다.
                </Content>
              </Content>
            </div>
          </WizardStep>

          <WizardStep name="외부 스토리지 동기화" id="gfs-external-storage-sync">
            <div className="ct-gfs-storage-wizard__content">
              <Content component="p">
                GFS 스토리지를 배포하기 전에, 클러스터 환경에 연결된 외부 스토리지 정보를 먼저 동기화합니다. 동기화된
                디스크 정보는 GFS 클러스터 환경에서 이중화된 공유 디스크로 사용됩니다.
              </Content>
              <div className="ct-gfs-storage-wizard__warn">
                <ExclamationTriangleIcon className="ct-gfs-storage-wizard__warn-icon" aria-hidden="true" />
                외부 스토리지 정보를 동기화하려면, FC 카드 또는 iSCSI 카드가 물리적으로 이중화 구성이 되어 있어야 합니다.
              </div>
              <Form className="ct-gfs-storage-wizard__section ct-gfs-storage-wizard__form-horizontal" isHorizontal>
                <FormGroup label="외부 스토리지 동기화 방식" isRequired fieldId="gfs-external-sync-mode">
                  <div>
                    <div className="ct-gfs-storage-wizard__choice-grid ct-gfs-storage-wizard__choice-grid--three">
                      <Radio
                        id="gfs-external-duplication"
                        name="gfs-external-sync"
                        label="이중화"
                        isChecked={externalSyncMode === "duplication"}
                        isDisabled={isExternalSyncRunning}
                        onChange={() => {
                          setExternalSyncMode("duplication");
                          resetExternalSyncExecution();
                        }}
                      />
                      <Radio
                        id="gfs-external-single"
                        name="gfs-external-sync"
                        label="단중화"
                        isChecked={externalSyncMode === "single"}
                        isDisabled={isExternalSyncRunning}
                        onChange={() => {
                          setExternalSyncMode("single");
                          resetExternalSyncExecution();
                        }}
                      />
                      <Radio
                        id="gfs-external-skip"
                        name="gfs-external-sync"
                        label="건너뛰기"
                        isChecked={externalSyncMode === "skip"}
                        isDisabled={isExternalSyncRunning}
                        onChange={() => {
                          setExternalSyncMode("skip");
                          resetExternalSyncExecution();
                        }}
                      />
                    </div>
                    <div className="ct-gfs-storage-wizard__helper-text">
                      이중화는 multipath 동기화, 단중화는 디스크 재검색을 실행한 후 다음 단계로 진행합니다.
                    </div>
                  </div>
                </FormGroup>
                <FormGroup label="외부 스토리지 동기화" fieldId="gfs-external-sync-action">
                  <div className="ct-gfs-storage-wizard__external-sync-action">
                    <Button
                      variant="secondary"
                      isDisabled={!externalSyncAction || isExternalSyncRunning}
                      onClick={() => void executeExternalStorageSync()}
                    >
                      {isExternalSyncRunning
                        ? "동기화 실행 중"
                        : externalSyncAction
                        ? `${formatMultipathSyncAction(externalSyncAction)} 실행`
                        : "동기화 건너뜀"}
                    </Button>
                    <div className="ct-gfs-storage-wizard__external-sync-status" aria-live="polite">
                      <WizardStepStatusLabel
                        status={externalSyncStatus}
                        ariaLabel="외부 스토리지 동기화 진행 중"
                      />
                    </div>
                  </div>
                  {externalSyncMessage && (
                    <Alert
                      isInline
                      variant={externalSyncPhase === "error" ? "danger" : externalSyncPhase === "success" ? "success" : "info"}
                      title={externalSyncMessage}
                      className="ct-gfs-storage-wizard__sync-message"
                    />
                  )}
                  {externalSyncResult && (
                    <div className="ct-gfs-storage-wizard__sync-result">
                      {(externalSyncResult.results.length > 0 ? externalSyncResult.results : [{
                        hostname: "",
                        target: externalSyncResult.target || "local",
                        code: externalSyncResult.code,
                        message: externalSyncResult.message,
                        steps: externalSyncResult.steps,
                      }]).map((target, index) => (
                        <div
                          key={`${target.hostname || target.target}-${index}`}
                          className="ct-gfs-storage-wizard__sync-target"
                        >
                          <div className="ct-gfs-storage-wizard__sync-target-main">
                            <strong>{target.hostname || target.target}</strong>
                            <Label color={target.code === 200 ? "green" : "red"}>
                              {target.code === 200 ? "성공" : "실패"}
                            </Label>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </FormGroup>
              </Form>
              <Alert
                isInline
                title="외부 스토리지 동기화 참고사항"
                variant="info"
                customIcon={<InfoCircleIcon />}
                className="ct-gfs-storage-wizard__info"
              >
                <Content component="p">
                  외부 스토리지를 동기화하기 전에, 클러스터 내 각 호스트에 외부 스토리지 디스크가 정상적으로 할당되어 있는지
                  반드시 확인해야 합니다.
                </Content>
                <Content component="p">
                  이중화 구성이 완료된 후 GFS 디스크를 재구성하는 경우, 멀티패스 구성이 이미 완료되어 있는지 확인하십시오.
                  구성이 완료되어 있다면 "건너뛰기" 옵션을 선택한 후 다음 단계로 진행해 주시기 바랍니다.
                </Content>
              </Alert>
            </div>
          </WizardStep>

          <WizardStep
            name="GFS 디스크 구성"
            id="gfs-disk-configure"
            isDisabled={Boolean(externalSyncAction) && !externalSyncCompleted}
          >
            <div className="ct-gfs-storage-wizard__content">
              <Content component="p">
                GFS용 디스크로 관리할 "클러스터에 연결된 iSCSI 또는 FC 디스크"를 선택해야 합니다.
              </Content>
              <Form className="ct-gfs-storage-wizard__section ct-gfs-storage-wizard__form-horizontal" isHorizontal>
                <FormGroup label="GFS용 디스크 구성 대상 장치" isRequired fieldId="gfs-disk-list">
                  {diskLoadState === "loading" ? (
                    <div className="ct-gfs-storage-wizard__loading">
                      <Spinner size="sm" aria-label="GFS 디스크 목록 확인 중" />
                      <span>GFS 디스크 목록을 불러오는 중입니다.</span>
                    </div>
                  ) : diskLoadState === "error" ? (
                    <Alert
                      isInline
                      variant="danger"
                      title="GFS 디스크 목록을 불러오지 못했습니다."
                      className="ct-gfs-storage-wizard__inline-alert"
                    >
                      {diskLoadError}
                    </Alert>
                  ) : gfsDiskOptions.length === 0 ? (
                    <Alert
                      isInline
                      variant="warning"
                      title="GFS 디스크 후보가 없습니다."
                      className="ct-gfs-storage-wizard__inline-alert"
                    >
                      외부 스토리지 동기화를 먼저 실행했는지 확인한 후 다시 시도하십시오.
                    </Alert>
                  ) : (
                    <div className="ct-gfs-storage-wizard__disk-list" role="table" aria-label="GFS 디스크 목록">
                      <div className="ct-gfs-storage-wizard__disk-row ct-gfs-storage-wizard__disk-row--head" role="row">
                        <span role="columnheader">선택</span>
                        <span role="columnheader">디스크 이름</span>
                        <span role="columnheader">UUID</span>
                        <span role="columnheader">사이즈</span>
                        <span role="columnheader">상태</span>
                      </div>
                      {gfsDiskOptions.map((disk) => (
                        <label
                          key={disk.value}
                          className={`ct-gfs-storage-wizard__disk-row${disk.inUse ? " ct-disk-table__row--disabled" : ""}`}
                          role="row"
                        >
                          <span role="cell">
                            <Checkbox
                              id={`gfs-disk-${disk.value.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                              aria-label={`${disk.name || disk.value} 선택`}
                              isChecked={selectedDisks.includes(disk.value)}
                              isDisabled={disk.inUse}
                              onChange={(_event, checked) => {
                                setSelectedDisks((prev) =>
                                  checked ? [...prev, disk.value] : prev.filter((item) => item !== disk.value)
                                );
                              }}
                            />
                          </span>
                          <strong role="cell">{disk.device || "-"}</strong>
                          <span role="cell">{disk.uuid || "-"}</span>
                          <span role="cell">{disk.size || "-"}</span>
                          <span role="cell">
                            {disk.inUse ? "사용 중 (파티션 존재)" : disk.state || "-"}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </FormGroup>
              </Form>
              <Alert
                isInline
                title="GFS용 디스크 자원 구성 시 참고사항"
                variant="info"
                customIcon={<InfoCircleIcon />}
                className="ct-gfs-storage-wizard__info"
              >
                <Content component="p">
                  GFS 파일 시스템은 Linux 커널 파일 시스템 인터페이스(VFS 레이어)와 직접 연결 시키는 원시적 파일 시스템입니다.
                </Content>
                <Content component="p">
                  사용할 GFS용 디스크가 알맞는지 종류, 사이즈 및 경로(WWN)를 잘 확인하시기 바랍니다.
                </Content>
              </Alert>
            </div>
          </WizardStep>

          <WizardStep
            name="IPMI 정보"
            id="gfs-ipmi"
            isDisabled={Boolean(externalSyncAction) && !externalSyncCompleted}
          >
            <div className="ct-gfs-storage-wizard__content">
              <Content component="p">
                클러스터를 구성하기 위한 각 호스트의 IPMI 정보를 설정합니다. 아래의 항목에 값을 입력하십시오.
              </Content>
              {clusterLoadState === "loading" && (
                <div className="ct-gfs-storage-wizard__loading">
                  <Spinner size="sm" aria-label="클러스터 호스트 정보 확인 중" />
                  <span>cluster.json의 호스트 정보를 불러오는 중입니다.</span>
                </div>
              )}
              {clusterLoadState === "error" && (
                <Alert
                  isInline
                  variant="danger"
                  title="cluster.json 호스트 정보를 불러오지 못했습니다."
                  className="ct-gfs-storage-wizard__inline-alert"
                >
                  {clusterLoadError}
                </Alert>
              )}
              <Form className="ct-gfs-storage-wizard__section ct-gfs-storage-wizard__form-horizontal" isHorizontal>
                <FormGroup label="IPMI 구성 준비" isRequired fieldId="gfs-ipmi-mode">
                  <div className="ct-gfs-storage-wizard__choice-grid ct-gfs-storage-wizard__choice-grid--two">
                    <Radio
                      id="gfs-ipmi-common"
                      name="gfs-ipmi-mode"
                      label="공통 자격 증명"
                      isChecked={ipmiMode === "common"}
                      onChange={() => setIpmiMode("common")}
                    />
                    <Radio
                      id="gfs-ipmi-individual"
                      name="gfs-ipmi-mode"
                      label="개별 자격 증명"
                      isChecked={ipmiMode === "individual"}
                      onChange={() => setIpmiMode("individual")}
                    />
                  </div>
                </FormGroup>
              </Form>

              {ipmiMode === "common" ? (
                <Form className="ct-gfs-storage-wizard__section ct-gfs-storage-wizard__form-horizontal" isHorizontal>
                  {ipmiHosts.map((host, index) => (
                    <FormGroup
                      key={`gfs-ipmi-common-${host.hostName}`}
                      label={`${host.hostName} IPMI IP`}
                      isRequired
                      fieldId={`gfs-ipmi-common-ip-${index}`}
                    >
                      <TextInput
                        id={`gfs-ipmi-common-ip-${index}`}
                        value={host.ip}
                        placeholder="xxx.xxx.xxx.xxx 형식으로 입력"
                        onChange={(_event, value) => updateIpmiHost(index, { ip: String(value) })}
                      />
                    </FormGroup>
                  ))}
                  <FormGroup label="공통 사용자" isRequired fieldId="gfs-ipmi-common-user">
                    <TextInput
                      id="gfs-ipmi-common-user"
                      value={ipmiCommonUser}
                      onChange={(_event, value) => setIpmiCommonUser(String(value))}
                    />
                  </FormGroup>
                  <FormGroup label="공통 비밀번호" isRequired fieldId="gfs-ipmi-common-pass">
                    <TextInput
                      id="gfs-ipmi-common-pass"
                      type="password"
                      value={ipmiCommonPass}
                      onChange={(_event, value) => setIpmiCommonPass(String(value))}
                    />
                  </FormGroup>
                </Form>
              ) : (
                <Form className="ct-gfs-storage-wizard__section ct-gfs-storage-wizard__ipmi-host-list">
                  {ipmiHosts.map((host, index) => (
                    <section className="ct-gfs-storage-wizard__ipmi-host" key={`gfs-ipmi-individual-${host.hostName}`}>
                      <h3 className="ct-gfs-storage-wizard__ipmi-host-title">{host.hostName}</h3>
                      <div className="ct-gfs-storage-wizard__ipmi-host-fields">
                        <FormGroup label="IPMI IP" isRequired fieldId={`gfs-ipmi-ip-${index}`}>
                          <TextInput
                            id={`gfs-ipmi-ip-${index}`}
                            value={host.ip}
                            placeholder="xxx.xxx.xxx.xxx 형식으로 입력"
                            onChange={(_event, value) => updateIpmiHost(index, { ip: String(value) })}
                          />
                        </FormGroup>
                        <FormGroup label="사용자" isRequired fieldId={`gfs-ipmi-user-${index}`}>
                          <TextInput
                            id={`gfs-ipmi-user-${index}`}
                            value={host.username}
                            placeholder="아이디를 입력하세요."
                            onChange={(_event, value) => updateIpmiHost(index, { username: String(value) })}
                          />
                        </FormGroup>
                        <FormGroup label="비밀번호" isRequired fieldId={`gfs-ipmi-pass-${index}`}>
                          <TextInput
                            id={`gfs-ipmi-pass-${index}`}
                            type="password"
                            value={host.password}
                            placeholder="비밀번호를 입력하세요."
                            onChange={(_event, value) => updateIpmiHost(index, { password: String(value) })}
                          />
                        </FormGroup>
                      </div>
                    </section>
                  ))}
                </Form>
              )}
            </div>
          </WizardStep>

          <WizardStep
            name="설정확인"
            id="gfs-review"
            isDisabled={Boolean(externalSyncAction) && !externalSyncCompleted}
          >
            <div className="ct-gfs-storage-wizard__content">
              <Content>
                <Content component="p">
                  GFS 스토리지 구성을 위해 입력한 설정 정보는 다음과 같습니다. 입력한 정보를 수정하고자 하는 경우, 해당 탭으로
                  이동하여 정보를 수정하십시오.
                </Content>
                <Content component="p">모든 정보를 확인한 후 "배포"를 시작합니다.</Content>
              </Content>
              <div className="ct-gfs-storage-wizard__review-accordion">
                <div className="ct-gfs-storage-wizard__review-section">
                  <button
                    type="button"
                    className="ct-gfs-storage-wizard__review-header"
                    onClick={() => setReviewOpen((prev) => ({ ...prev, external: !prev.external }))}
                  >
                    <span>외부 스토리지 동기화</span>
                    <span className={reviewOpen.external ? "ct-gfs-chevron ct-gfs-chevron--open" : "ct-gfs-chevron"}>
                      <AngleRightIcon aria-hidden="true" />
                    </span>
                  </button>
                  {reviewOpen.external && (
                    <div className="ct-gfs-storage-wizard__review-body">
                      <DescriptionList isHorizontal className="ct-gfs-storage-wizard__review-detail">
                        <DescriptionListGroup>
                          <DescriptionListTerm>외부 스토리지 동기화 방식</DescriptionListTerm>
                          <DescriptionListDescription>{externalSyncLabel}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>동기화 상태</DescriptionListTerm>
                          <DescriptionListDescription>{externalSyncStatusText}</DescriptionListDescription>
                        </DescriptionListGroup>
                      </DescriptionList>
                    </div>
                  )}
                </div>

                <div className="ct-gfs-storage-wizard__review-section">
                  <button
                    type="button"
                    className="ct-gfs-storage-wizard__review-header"
                    onClick={() => setReviewOpen((prev) => ({ ...prev, disk: !prev.disk }))}
                  >
                    <span>GFS 디스크 구성</span>
                    <span className={reviewOpen.disk ? "ct-gfs-chevron ct-gfs-chevron--open" : "ct-gfs-chevron"}>
                      <AngleRightIcon aria-hidden="true" />
                    </span>
                  </button>
                  {reviewOpen.disk && (
                    <div className="ct-gfs-storage-wizard__review-body">
                      <DescriptionList isHorizontal className="ct-gfs-storage-wizard__review-detail">
                        <DescriptionListGroup>
                          <DescriptionListTerm>GFS 디스크</DescriptionListTerm>
                          <DescriptionListDescription>
                            {selectedDisks.length === 0
                              ? "미선택"
                              : selectedDisks
                                  .map((diskId) => diskLabel(diskId))
                                  .join(", ")}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      </DescriptionList>
                    </div>
                  )}
                </div>

                <div className="ct-gfs-storage-wizard__review-section">
                  <button
                    type="button"
                    className="ct-gfs-storage-wizard__review-header"
                    onClick={() => setReviewOpen((prev) => ({ ...prev, ipmi: !prev.ipmi }))}
                  >
                    <span>IPMI 정보</span>
                    <span className={reviewOpen.ipmi ? "ct-gfs-chevron ct-gfs-chevron--open" : "ct-gfs-chevron"}>
                      <AngleRightIcon aria-hidden="true" />
                    </span>
                  </button>
                  {reviewOpen.ipmi && (
                    <div className="ct-gfs-storage-wizard__review-body">
                      <DescriptionList isHorizontal className="ct-gfs-storage-wizard__review-detail">
                        <DescriptionListGroup>
                          <DescriptionListTerm>IPMI 구성</DescriptionListTerm>
                          <DescriptionListDescription>{ipmiMode === "common" ? "공통 자격 증명" : "개별 자격 증명"}</DescriptionListDescription>
                        </DescriptionListGroup>
                        {ipmiMode === "common" ? (
                          <>
                            <DescriptionListGroup>
                              <DescriptionListTerm>공통 사용자</DescriptionListTerm>
                              <DescriptionListDescription>{ipmiCommonUser || "미입력"}</DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                              <DescriptionListTerm>공통 비밀번호</DescriptionListTerm>
                              <DescriptionListDescription>{ipmiCommonPass ? "●●●●●●" : "미입력"}</DescriptionListDescription>
                            </DescriptionListGroup>
                          </>
                        ) : null}
                        <DescriptionListGroup>
                          <DescriptionListTerm>호스트 IPMI</DescriptionListTerm>
                          <DescriptionListDescription>
                            {ipmiHosts.map((host) => (
                              <div key={`review-ipmi-${host.hostName}`}>
                                {host.hostName}: {host.ip || "미입력"}
                              </div>
                            ))}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      </DescriptionList>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </WizardStep>

          <WizardStep name="구성" id="gfs-deploy">
            <div className="ct-gfs-storage-wizard__content">
            <TaskProgress />
              <Content component="p" className="ct-gfs-storage-wizard__deploy-title">
                모든 호스트를 대상으로 PCS 클러스터를 초기화하고, IPMI 기반 STONITH와 GFS 디스크 리소스를 구성합니다.
              </Content>
              <div className="ct-gfs-storage-wizard__status-list">
                <div className={wizardStatusRowClass(deploySteps.pcs)}>
                  <WizardStepStatusLabel status={deploySteps.pcs} ariaLabel="PCS 클러스터 초기화 진행 중" />
                  <span className="ct-wizard-status-row__text">PCS 클러스터 초기화 및 GFS 디스크 준비</span>
                </div>
                <div className={wizardStatusRowClass(deploySteps.stonith)}>
                  <WizardStepStatusLabel status={deploySteps.stonith} ariaLabel="IPMI STONITH 리소스 구성 진행 중" />
                  <span className="ct-wizard-status-row__text">IPMI STONITH 리소스 구성</span>
                </div>
                <div className={wizardStatusRowClass(deploySteps.gfs)}>
                  <WizardStepStatusLabel status={deploySteps.gfs} ariaLabel="GFS2 리소스 생성 진행 중" />
                  <span className="ct-wizard-status-row__text">Shared VG/LV, GFS2 및 Filesystem clone 리소스 생성</span>
                </div>
                <div className={wizardStatusRowClass(deploySteps.alert)}>
                  <WizardStepStatusLabel status={deploySteps.alert} ariaLabel="PCS 알림 파일 및 alert 구성 진행 중" />
                  <span className="ct-wizard-status-row__text">PCS 알림 파일 및 alert 구성</span>
                </div>
                <div className={wizardStatusRowClass(deploySteps.profile)}>
                  <WizardStepStatusLabel status={deploySteps.profile} ariaLabel="전체 호스트 GFS 설정 적용 진행 중" />
                  <span className="ct-wizard-status-row__text">전체 호스트 GFS 설정 적용</span>
                </div>
              </div>
              {deployMessage && (
                <Alert
                  isInline
                  variant={deployPhase === "error" ? "danger" : deployPhase === "done" ? "success" : "info"}
                  title={deployMessage}
                  className="ct-gfs-storage-wizard__inline-alert ct-gfs-storage-wizard__deploy-message"
                />
              )}
            </div>
          </WizardStep>

          <WizardStep name="완료" id="gfs-finish">
            <div className="ct-gfs-storage-wizard__content">
              <Content component="p">
                GFS 스토리지 구성을 완료하였습니다. 아래 내용을 참고하여 GFS 디스크와 PCS가 정상적으로 설정되어 작동하는지
                확인한 후, 다음 단계로 진행하시기 바랍니다.
              </Content>
              <Content component="p" className="ct-gfs-storage-wizard__section">
                모든 호스트에 GFS 구성이 완료 되었는지 확인합니다.
                <br />
                확인 명령어: <code>lsblk</code>, <code>lvs</code>, <code>vgs</code>, <code>pvs</code>
              </Content>
              <Content component="p">
                선택한 하나의 호스트에서 PCS 설정이 올바르게 완료되었는지 확인합니다.
                <br />
                확인 명령어: <code>pcs status</code>
              </Content>
              <Content component="p" className="ct-gfs-storage-wizard__section">
                확인 결과 이상이 없다면, 클라우드센터 VM 배포를 진행해 주세요. 마법사를 종료하려면 화면 상단의 닫기 버튼을
                클릭하십시오.
              </Content>
            </div>
          </WizardStep>
        </Wizard>
      </Modal>

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        aria-label="GFS 스토리지 구성 진행"
        variant="small"
      >
        <ModalHeader title="GFS 스토리지 구성 진행" />
        <ModalBody>
          <Content component="p">GFS 스토리지 구성을 진행하시겠습니까?</Content>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={startDeploy}>
            실행
          </Button>
          <Button variant="link" onClick={() => setConfirmOpen(false)}>
            아니요
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={cancelConfirmOpen}
        onClose={() => setCancelConfirmOpen(false)}
        aria-label="GFS 스토리지 구성 취소"
        variant="small"
      >
        <ModalHeader title="GFS 스토리지 구성 취소" />
        <ModalBody>
          <Content component="p">
            GFS 스토리지 구성을 취소하시겠습니까? 입력된 데이터는 초기화 됩니다.
          </Content>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={handleClose}>
            실행
          </Button>
          <Button variant="link" onClick={() => setCancelConfirmOpen(false)}>
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
