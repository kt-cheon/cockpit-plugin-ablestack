import React from "react";
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
  TextInput,
  Button,
  Checkbox,
  Alert,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
} from "@patternfly/react-core";
import { InfoCircleIcon, AngleRightIcon } from "@patternfly/react-icons";

import ValidationErrorModal from "../components/common/ValidationErrorModal";
import WizardStepStatusLabel, {
  wizardStatusRowClass,
  type WizardStepStatus,
} from "../components/common/WizardStepStatus";
import { fetchClusterConfigProfile } from "../services/api/cluster-config";
import {
  checkMonitoringTargetHealth,
  configureMonitoring,
} from "../services/api/monitoring-config";
import "./monitoring-center-wizard.scss";
import {
  isInteger,
  isIpv4,
  requireEmail,
  requireIpv4,
  requirePort,
} from "./validation";

type ClusterType = "powerflex" | "ablestack-hci" | "ablestack-vm" | "ablestack-standalone" | "ablestack-hci-filesystem";
type DeployPhase = "idle" | "running" | "done" | "error";

interface MonitoringDeploySteps {
  health: WizardStepStatus;
  targets: WizardStepStatus;
  profile: WizardStepStatus;
}

interface MonitoringCenterWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCompleted?: () => void;
  clusterType?: ClusterType;
}

const DEFAULT_HOST_COUNT = 3;
const DEFAULT_CCVM_IP = "";
const DEFAULT_CUBE_HOSTS = [""];
const DEFAULT_SCVM_HOSTS = [""];

const defaultHostCount = (type: ClusterType) =>
  type === "ablestack-vm" || type === "ablestack-standalone" ? 1 : DEFAULT_HOST_COUNT;

const resizeHostList = (values: string[], count: number) =>
  Array.from({ length: count }, (_, index) => values[index] ?? "");

const isClusterType = (value: string): value is ClusterType => [
  "ablestack-hci",
  "ablestack-vm",
  "ablestack-standalone",
  "ablestack-hci-filesystem",
].includes(value);

const fillEmptyHostValues = (current: string[], incoming: string[], count: number) =>
  Array.from({ length: count }, (_, index) => current[index]?.trim() || incoming[index] || "");

const DEFAULT_DEPLOY_STEPS: MonitoringDeploySteps = {
  health: "pending",
  targets: "pending",
  profile: "pending",
};

export default function MonitoringCenterWizardModal({
  isOpen,
  onClose,
  onCompleted,
  clusterType = "ablestack-hci",
}: MonitoringCenterWizardModalProps) {
  const [hostCount, setHostCount] = React.useState(DEFAULT_HOST_COUNT);
  const [ccvmIp, setCcvmIp] = React.useState(DEFAULT_CCVM_IP);
  const [cubeHosts, setCubeHosts] = React.useState<string[]>(DEFAULT_CUBE_HOSTS);
  const [scvmHosts, setScvmHosts] = React.useState<string[]>(DEFAULT_SCVM_HOSTS);
  const [resolvedClusterType, setResolvedClusterType] = React.useState<ClusterType>(clusterType);
  const [clusterConfigLoadState, setClusterConfigLoadState] = React.useState<"idle" | "loading" | "success" | "error">("idle");
  const [clusterConfigLoadError, setClusterConfigLoadError] = React.useState("");

  const [smtpEnabled, setSmtpEnabled] = React.useState(false);
  const [smtpServer, setSmtpServer] = React.useState("");
  const [smtpPort, setSmtpPort] = React.useState("");
  const [smtpEmail, setSmtpEmail] = React.useState("");
  const [smtpPassword, setSmtpPassword] = React.useState("");

  const [reviewOpen, setReviewOpen] = React.useState({
    ip: true,
    smtp: true,
  });
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = React.useState(false);
  const [deployPhase, setDeployPhase] = React.useState<DeployPhase>("idle");
  const [deploySteps, setDeploySteps] = React.useState<MonitoringDeploySteps>(DEFAULT_DEPLOY_STEPS);
  const [deployError, setDeployError] = React.useState("");
  const [disableNav, setDisableNav] = React.useState(false);
  const [validationMessage, setValidationMessage] = React.useState("");

  const nextStepRef = React.useRef<null | (() => void)>(null);
  const isScvmRequired = resolvedClusterType === "ablestack-hci" || resolvedClusterType === "ablestack-hci-filesystem";
  const isStandalone = resolvedClusterType === "ablestack-standalone";
  const monitoringTargetLabel = isScvmRequired
    ? "Cube 호스트, 클라우드센터 VM, 스토리지센터 VM"
    : "Cube 호스트와 클라우드센터 VM";

  const resetState = React.useCallback(() => {
    setHostCount(defaultHostCount(clusterType));
    setCcvmIp(DEFAULT_CCVM_IP);
    setCubeHosts(DEFAULT_CUBE_HOSTS);
    setScvmHosts(DEFAULT_SCVM_HOSTS);
    setResolvedClusterType(clusterType);
    setClusterConfigLoadState("idle");
    setClusterConfigLoadError("");
    setSmtpEnabled(false);
    setSmtpServer("");
    setSmtpPort("");
    setSmtpEmail("");
    setSmtpPassword("");
    setReviewOpen({ ip: true, smtp: true });
    setConfirmOpen(false);
    setCancelConfirmOpen(false);
    setDeployPhase("idle");
    setDeploySteps(DEFAULT_DEPLOY_STEPS);
    setDeployError("");
    setDisableNav(false);
    setValidationMessage("");
  }, [clusterType]);

  React.useEffect(() => {
    if (!isOpen) return;

    let isActive = true;
    setClusterConfigLoadState("loading");
    setClusterConfigLoadError("");

    fetchClusterConfigProfile()
      .then((profile) => {
        if (!isActive) return;

        const normalizedProfileType = profile.type.trim().toLowerCase();
        const profileType = isClusterType(normalizedProfileType) ? normalizedProfileType : clusterType;
        const profileHosts = profileType === "ablestack-standalone" ? profile.hosts.slice(0, 1) : profile.hosts;
        const nextHostCount = profileType === "ablestack-standalone"
          ? 1
          : Math.max(1, profileHosts.length || defaultHostCount(profileType));
        const cubeHostIps = profileHosts.map((host) => host.ablecube);
        const scvmHostIps = profileHosts.map((host) => host.scvmMngt);

        setResolvedClusterType(profileType);
        setHostCount(nextHostCount);
        setCcvmIp((current) => current.trim() || profile.ccvmIp);
        setCubeHosts((current) => fillEmptyHostValues(current, cubeHostIps, nextHostCount));
        setScvmHosts((current) => fillEmptyHostValues(current, scvmHostIps, nextHostCount));
        setClusterConfigLoadState("success");
      })
      .catch((error) => {
        if (!isActive) return;
        setResolvedClusterType(clusterType);
        setClusterConfigLoadState("error");
        setClusterConfigLoadError(
          error instanceof Error ? error.message : "cluster.json 정보를 불러오지 못했습니다."
        );
      });

    return () => {
      isActive = false;
    };
  }, [clusterType, isOpen]);

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

  const updateHostCount = (value: string) => {
    if (isStandalone) {
      setHostCount(1);
      setCubeHosts((current) => resizeHostList(current, 1));
      setScvmHosts((current) => resizeHostList(current, 1));
      return;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      setHostCount(0);
      setCubeHosts([]);
      setScvmHosts([]);
      return;
    }
    const nextCount = Math.max(1, Math.min(99, parsed));
    setHostCount(nextCount);
    setCubeHosts((prev) => resizeHostList(prev, nextCount));
    setScvmHosts((prev) => resizeHostList(prev, nextCount));
  };

  const updateCubeHost = (index: number, value: string) => {
    setCubeHosts((prev) => prev.map((host, hostIndex) => (hostIndex === index ? value : host)));
  };

  const updateScvmHost = (index: number, value: string) => {
    setScvmHosts((prev) => prev.map((host, hostIndex) => (hostIndex === index ? value : host)));
  };

  const handleSmtpEnabledChange = (checked: boolean) => {
    setSmtpEnabled(checked);
    if (!checked) {
      setSmtpServer("");
      setSmtpPort("");
      setSmtpEmail("");
      setSmtpPassword("");
    }
  };

  const validateWallMonitoring = () => {
    if (!hostCount || !Number.isFinite(hostCount) || !isInteger(hostCount)) return "호스트 수를 숫자로 입력해주세요.";

    const ccvmMessage = requireIpv4(ccvmIp, "CCVM 관리 IP");
    if (ccvmMessage) return ccvmMessage;

    for (let index = 0; index < hostCount; index += 1) {
      const cubeHost = cubeHosts[index] ?? "";
      if (!cubeHost) return `Cube${index + 1} 관리 IP를 입력해주세요.`;
      if (!isIpv4(cubeHost)) return `Cube${index + 1} 관리 IP 형식을 확인해주세요.`;
    }

    if (isScvmRequired) {
      for (let index = 0; index < hostCount; index += 1) {
        const scvmHost = scvmHosts[index] ?? "";
        if (!scvmHost) return `SCVM${index + 1} 관리 IP를 입력해주세요.`;
        if (!isIpv4(scvmHost)) return `SCVM${index + 1} 관리 IP 형식을 확인해주세요.`;
      }
    }

    if (smtpEnabled) {
      if (!smtpServer) return "SMTP 서버를 입력해주세요.";
      const portMessage = requirePort(smtpPort, "SMTP 서버 Port");
      if (portMessage) return portMessage;
      const emailMessage = requireEmail(smtpEmail, "관리자 이메일 주소");
      if (emailMessage) return emailMessage;
      if (!smtpPassword) return "이메일 비밀번호를 입력해주세요.";
    }

    return "";
  };

  const executeMonitoringDeploy = async () => {
    const errorMessage = validateWallMonitoring();
    if (errorMessage) {
      setValidationMessage(errorMessage);
      setConfirmOpen(false);
      return;
    }

    setValidationMessage("");
    setConfirmOpen(false);
    setDeployPhase("running");
    setDeploySteps({ health: "running", targets: "pending", profile: "pending" });
    setDeployError("");
    setDisableNav(true);
    const goToDeployStep = nextStepRef.current;
    nextStepRef.current = null;
    goToDeployStep?.();

    try {
      await checkMonitoringTargetHealth(resolvedClusterType);
      setDeploySteps({ health: "succeeded", targets: "running", profile: "pending" });

      await configureMonitoring({
        ccvm: [ccvmIp.trim()],
        cube: cubeHosts.slice(0, hostCount).map((address) => address.trim()),
        scvm: isScvmRequired
          ? scvmHosts.slice(0, hostCount).map((address) => address.trim())
          : [],
        smtp: smtpEnabled
          ? {
            enabled: true,
            host: smtpServer.trim(),
            port: Number(smtpPort),
            user: smtpEmail.trim(),
            password: smtpPassword,
          }
          : { enabled: false },
      });
      setDeploySteps({ health: "succeeded", targets: "succeeded", profile: "succeeded" });
      setDeployPhase("done");
      setDisableNav(false);
      onCompleted?.();
    } catch (error) {
      setDeploySteps((current) => {
        const failedStep = Object.entries(current).find(([, status]) => status === "running")?.[0] as keyof MonitoringDeploySteps | undefined;
        return failedStep ? { ...current, [failedStep]: "failed" } : current;
      });
      setDeployError(error instanceof Error ? error.message : "Wall 모니터링 구성에 실패했습니다.");
      setDeployPhase("error");
      setDisableNav(false);
    }
  };

  const activeDeployStep = deploySteps.health === "running"
    ? 1
    : deploySteps.targets === "running"
      ? 2
      : 3;

  const smtpEnabledLabel = smtpEnabled ? "선택" : "미선택";

  const wizardFooter = (
    activeStep: any,
    goToNextStep: (event?: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>,
    goToPrevStep: (event?: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>,
    close: (event?: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>
  ) => {
    if (!activeStep) return null;
    const stepId = String(activeStep.id);
    const isFirst = stepId === "monitoring-overview";
    const isReview = stepId === "monitoring-review";
    const isDeploy = stepId === "monitoring-deploy";
    const isFinish = stepId === "monitoring-finish";

    if (isReview) {
      nextStepRef.current = goToNextStep;
    }

    if (isDeploy) {
      return (
        <div className="ct-monitoring-center-wizard__footer">
          {deployPhase === "done" && (
            <Button variant="primary" onClick={goToNextStep}>
              완료
            </Button>
          )}
          {deployPhase === "error" && (
            <Button variant="primary" onClick={executeMonitoringDeploy}>
              다시 구성
            </Button>
          )}
          {deployPhase === "running" && (
            <Button variant="primary" isDisabled isLoading>
              구성 중
            </Button>
          )}
        </div>
      );
    }

    return (
      <div className="ct-monitoring-center-wizard__footer">
        {!isFinish && (
          <Button
            variant="primary"
            onClick={() => {
              if (isReview) {
                setConfirmOpen(true);
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
          <Button variant="link" onClick={() => setCancelConfirmOpen(true)}>
            취소
          </Button>
        )}
        {isFinish && (
          <Button variant="primary" onClick={handleClose}>
            완료
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
        aria-label="Wall 모니터링 구성 마법사"
        className="ct-monitoring-center-wizard__modal"
      >
        <Wizard
          onClose={requestClose}
          onSave={handleClose}
          width="100%"
          navAriaLabel="Wall 모니터링 구성 단계"
          isVisitRequired
          className={[
            "ct-monitoring-center-wizard",
            disableNav ? "ct-monitoring-center-wizard--nav-locked" : "",
            deployPhase !== "idle" ? "ct-wizard--execution-visible" : "",
            deployPhase === "done" ? "ct-wizard--complete-visible" : "",
          ].join(" ")}
          footer={wizardFooter}
          onStepChange={(_event, currentStep) => {
            const stepId = String(currentStep.id);
            setDisableNav(stepId === "monitoring-deploy");
          }}
          header={
            <div className="ct-monitoring-center-wizard__header">
              <div>
                <Title headingLevel="h1" size="2xl" className="ct-monitoring-center-wizard__title">
                  Wall 모니터링 구성 마법사
                </Title>
                <Content className="ct-monitoring-center-wizard__subtitle">
                  <Content component="p">클라우드센터 VM에 Wall 모니터링 구성합니다.</Content>
                </Content>
              </div>
              <button
                type="button"
                className="ct-monitoring-center-wizard__close"
                aria-label="Close"
                onClick={requestClose}
              >
                ×
              </button>
            </div>
          }
        >
          <WizardStep name="개요" id="monitoring-overview">
            <div className="ct-monitoring-center-wizard__content">
              <Content>
                <Content component="p">
                  클라우드센터 VM에 Wall 모니터링을 구성하기 위해 필요한 정보를 다음과 같이 마법사를 통해 입력받습니다.
                </Content>
                <Content component="ul">
                  <Content component="li">Wall 모니터링 수집 대상의 IP 정보</Content>
                  <Content component="li">알림 서비스를 위한 SMTP 설정 정보</Content>
                </Content>
                <Content component="p">
                  필요한 정보를 먼저 준비하십시오. 정보가 준비되었다면 "다음" 버튼을 눌러 Wall 모니터링 구성을 시작합니다.
                  <br />( 현재 버전에서는 TLS를 지원하지 않습니다. )
                </Content>
              </Content>
            </div>
          </WizardStep>

          <WizardStep name="모니터링 대상 IP 설정" id="monitoring-ip">
            <div className="ct-monitoring-center-wizard__content">
              <Content>
                <Content component="p">
                  클러스터의 구성 요소인 {monitoringTargetLabel}을 모니터링하기 위해 아래 정보를 입력하십시오.
                  (호스트 수가 변경될 경우 입력한 값이 초기화됩니다.)
                </Content>
              </Content>
              <Alert
                isInline
                title={clusterConfigLoadState === "error"
                  ? "cluster.json 정보를 불러오지 못했습니다."
                  : clusterConfigLoadState === "success"
                    ? "cluster.json의 모니터링 대상 IP를 자동으로 적용했습니다."
                    : "cluster.json의 모니터링 대상 IP를 불러오는 중입니다."}
                variant={clusterConfigLoadState === "error" ? "warning" : "info"}
                className="ct-monitoring-center-wizard__info"
              >
                {clusterConfigLoadState === "error" && clusterConfigLoadError}
              </Alert>
              <Form className="ct-monitoring-center-wizard__section ct-monitoring-center-wizard__form-horizontal" isHorizontal>
                <FormGroup
                  label="호스트 수"
                  isRequired
                  fieldId="monitoring-host-count"
                  className="ct-monitoring-center-wizard__host-count-row"
                >
                  <TextInput
                    id="monitoring-host-count"
                    type="number"
                    value={hostCount}
                    isDisabled={isStandalone}
                    onChange={(_event, value) => updateHostCount(String(value))}
                  />
                </FormGroup>

                <div className="ct-monitoring-center-wizard__field-group ct-monitoring-center-wizard__field-group--single">
                  <div className="ct-monitoring-center-wizard__field-title">클라우드센터 VM</div>
                  <FormGroup label="CCVM 관리 IP" isRequired fieldId="monitoring-ccvm-ip">
                    <TextInput
                      className="ct-monitoring-center-wizard__ip-input"
                      id="monitoring-ccvm-ip"
                      value={ccvmIp}
                      onChange={(_event, value) => setCcvmIp(String(value))}
                    />
                  </FormGroup>
                </div>

                <div className="ct-monitoring-center-wizard__field-group ct-monitoring-center-wizard__field-group--host-list">
                  <div className="ct-monitoring-center-wizard__field-title">Cube 호스트 ({hostCount || 0}대)</div>
                  <div className="ct-monitoring-center-wizard__host-list">
                    {cubeHosts.slice(0, hostCount).map((value, index) => (
                      <FormGroup
                        key={`cube-host-${index}`}
                        label={`Cube${index + 1} 관리 IP`}
                        isRequired
                        fieldId={`monitoring-cube-${index + 1}`}
                      >
                        <TextInput
                          className="ct-monitoring-center-wizard__ip-input"
                          id={`monitoring-cube-${index + 1}`}
                          value={value}
                          onChange={(_event, nextValue) => updateCubeHost(index, String(nextValue))}
                        />
                      </FormGroup>
                    ))}
                  </div>
                </div>

                {isScvmRequired && (
                  <div className="ct-monitoring-center-wizard__field-group ct-monitoring-center-wizard__field-group--host-list">
                    <div className="ct-monitoring-center-wizard__field-title">스토리지센터 VM ({hostCount || 0}대)</div>
                    <div className="ct-monitoring-center-wizard__host-list">
                      {scvmHosts.slice(0, hostCount).map((value, index) => (
                        <FormGroup
                          key={`scvm-host-${index}`}
                          label={`SCVM${index + 1} 관리 IP`}
                          isRequired
                          fieldId={`monitoring-scvm-${index + 1}`}
                        >
                          <TextInput
                            className="ct-monitoring-center-wizard__ip-input"
                            id={`monitoring-scvm-${index + 1}`}
                            value={value}
                            onChange={(_event, nextValue) => updateScvmHost(index, String(nextValue))}
                          />
                        </FormGroup>
                      ))}
                    </div>
                  </div>
                )}
              </Form>
              <Alert
                isInline
                title="IP 설정 시 참고사항"
                variant="info"
                customIcon={<InfoCircleIcon />}
                className="ct-monitoring-center-wizard__info"
              >
                <Content component="p">{monitoringTargetLabel}의 관리 IP 정보를 입력하십시오.</Content>
              </Alert>
            </div>
          </WizardStep>

          <WizardStep name="알림 SMTP 설정" id="monitoring-smtp">
            <div className="ct-monitoring-center-wizard__content">
              <Content>
                <Content component="p">
                  Wall 모니터링 알림 서비스를 위해 SMTP 정보를 설정합니다. 아래의 항목에 적합한 값을 입력하십시오.
                </Content>
              </Content>
              <Form className="ct-monitoring-center-wizard__section ct-monitoring-center-wizard__form-horizontal" isHorizontal>
                <FormGroup label="SMTP 구성 여부" isRequired fieldId="monitoring-smtp-enabled">
                  <Checkbox
                    id="monitoring-smtp-enabled"
                    label="SMTP 구성 하기"
                    isChecked={smtpEnabled}
                    onChange={(_event, checked) => handleSmtpEnabledChange(checked)}
                  />
                </FormGroup>
                <FormGroup label="SMTP 서버" isRequired fieldId="monitoring-smtp-server">
                  <TextInput
                    id="monitoring-smtp-server"
                    value={smtpServer}
                    isDisabled={!smtpEnabled}
                    onChange={(_event, value) => setSmtpServer(String(value))}
                  />
                </FormGroup>
                <FormGroup label="SMTP Port" isRequired fieldId="monitoring-smtp-port">
                  <TextInput
                    id="monitoring-smtp-port"
                    value={smtpPort}
                    isDisabled={!smtpEnabled}
                    onChange={(_event, value) => setSmtpPort(String(value))}
                  />
                </FormGroup>
                <FormGroup label="관리자 이메일 주소" isRequired fieldId="monitoring-smtp-email">
                  <TextInput
                    id="monitoring-smtp-email"
                    value={smtpEmail}
                    isDisabled={!smtpEnabled}
                    onChange={(_event, value) => setSmtpEmail(String(value))}
                  />
                </FormGroup>
                <FormGroup label="이메일 비밀번호" isRequired fieldId="monitoring-smtp-password">
                  <TextInput
                    id="monitoring-smtp-password"
                    type="password"
                    value={smtpPassword}
                    isDisabled={!smtpEnabled}
                    onChange={(_event, value) => setSmtpPassword(String(value))}
                  />
                </FormGroup>
              </Form>
              <Alert
                isInline
                title="알림 SMTP 구성 시 참고사항"
                variant="info"
                customIcon={<InfoCircleIcon />}
                className="ct-monitoring-center-wizard__info"
              >
                <Content component="p">
                  SMTP 설정은 선택사항입니다. 현재 SMTP를 설정하지 않아도 Wall 모니터링 구성 후 Wall 모니터링센터에서
                  수동으로 구성 가능합니다. SMTP 구성 작업 후 Wall 대시보드에 접속하여 "경고 &gt; 콘택트 포인트" 메뉴에서
                  수신받을 이메일 정보를 입력해주세요.
                </Content>
              </Alert>
            </div>
          </WizardStep>

          <WizardStep name="설정확인" id="monitoring-review">
            <div className="ct-monitoring-center-wizard__content">
              <Content>
                <Content component="p">
                  Wall 모니터링센터 구성을 위해 입력한 설정 정보는 다음과 같습니다. 입력한 정보를 수정하고자 하는 경우,
                  해당 탭으로 이동하여 정보를 수정하십시오.
                </Content>
                <Content component="p">모든 정보를 확인한 후 "구성"을 시작합니다.</Content>
              </Content>
              <div className="ct-monitoring-center-wizard__review-accordion">
                <div className="ct-monitoring-center-wizard__review-section">
                  <button
                    type="button"
                    className="ct-monitoring-center-wizard__review-header"
                    onClick={() => setReviewOpen((prev) => ({ ...prev, ip: !prev.ip }))}
                  >
                    <span>모니터링 대상 IP 설정</span>
                    <span className={reviewOpen.ip ? "ct-monitoring-chevron ct-monitoring-chevron--open" : "ct-monitoring-chevron"}>
                      <AngleRightIcon aria-hidden="true" />
                    </span>
                  </button>
                  {reviewOpen.ip && (
                    <div className="ct-monitoring-center-wizard__review-body">
                      <DescriptionList isCompact className="ct-monitoring-center-wizard__review-detail">
                        <DescriptionListGroup>
                          <DescriptionListTerm>호스트 수</DescriptionListTerm>
                          <DescriptionListDescription>{hostCount || "미입력"}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>클라우드센터 VM</DescriptionListTerm>
                          <DescriptionListDescription>CCVM 관리 IP : {ccvmIp || "미입력"}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>Cube 호스트</DescriptionListTerm>
                          <DescriptionListDescription>
                            {cubeHosts.slice(0, hostCount).map((value, index) => (
                              <div key={`review-cube-${index}`}>Cube{index + 1} 관리 IP : {value || "미입력"}</div>
                            ))}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                        {isScvmRequired && (
                          <DescriptionListGroup>
                            <DescriptionListTerm>스토리지센터 VM</DescriptionListTerm>
                            <DescriptionListDescription>
                              {scvmHosts.slice(0, hostCount).map((value, index) => (
                                <div key={`review-scvm-${index}`}>SCVM{index + 1} 관리 IP : {value || "미입력"}</div>
                              ))}
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                        )}
                      </DescriptionList>
                    </div>
                  )}
                </div>

                <div className="ct-monitoring-center-wizard__review-section">
                  <button
                    type="button"
                    className="ct-monitoring-center-wizard__review-header"
                    onClick={() => setReviewOpen((prev) => ({ ...prev, smtp: !prev.smtp }))}
                  >
                    <span>알림 SMTP 설정</span>
                    <span className={reviewOpen.smtp ? "ct-monitoring-chevron ct-monitoring-chevron--open" : "ct-monitoring-chevron"}>
                      <AngleRightIcon aria-hidden="true" />
                    </span>
                  </button>
                  {reviewOpen.smtp && (
                    <div className="ct-monitoring-center-wizard__review-body">
                      <DescriptionList isCompact className="ct-monitoring-center-wizard__review-detail">
                        <DescriptionListGroup>
                          <DescriptionListTerm>SMTP 구성 여부</DescriptionListTerm>
                          <DescriptionListDescription>{smtpEnabledLabel}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>SMTP 서버</DescriptionListTerm>
                          <DescriptionListDescription>{smtpEnabled ? smtpServer || "미입력" : "N/A"}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>SMTP Port</DescriptionListTerm>
                          <DescriptionListDescription>{smtpEnabled ? smtpPort || "미입력" : "N/A"}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>관리자 이메일 주소</DescriptionListTerm>
                          <DescriptionListDescription>{smtpEnabled ? smtpEmail || "미입력" : "N/A"}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                          <DescriptionListTerm>이메일 비밀번호</DescriptionListTerm>
                          <DescriptionListDescription>{smtpEnabled ? smtpPassword ? "********" : "미입력" : "N/A"}</DescriptionListDescription>
                        </DescriptionListGroup>
                      </DescriptionList>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </WizardStep>

          <WizardStep name="구성" id="monitoring-deploy">
            <div className="ct-monitoring-center-wizard__content">
              <Content component="p" className="ct-monitoring-center-wizard__deploy-title">
                {deployPhase === "done"
                  ? "Wall 모니터링센터 구성이 완료되었습니다."
                  : deployPhase === "error"
                    ? "Wall 모니터링센터 구성에 실패했습니다. 실패 원인을 확인한 후 다시 시도해주세요."
                    : `Wall 모니터링센터를 구성 중입니다. 전체 3단계 중 ${activeDeployStep}단계 진행 중입니다.`}
              </Content>
              <div className="ct-monitoring-center-wizard__status-list">
                <div className={wizardStatusRowClass(deploySteps.health)}>
                  <WizardStepStatusLabel status={deploySteps.health} ariaLabel="모니터링 대상 네트워크 연결 확인 중" />
                  <span className="ct-wizard-status-row__text">Wall 구성 HOST 네트워크 연결 테스트</span>
                </div>
                <div className={wizardStatusRowClass(deploySteps.targets)}>
                  <WizardStepStatusLabel status={deploySteps.targets} ariaLabel="모니터링 대상 IP 설정 진행 중" />
                  <span className="ct-wizard-status-row__text">Wall·Netdive·서비스·SMTP 구성 및 실행 상태 검증</span>
                </div>
                <div className={wizardStatusRowClass(deploySteps.profile)}>
                  <WizardStepStatusLabel status={deploySteps.profile} ariaLabel="모니터링 구성 완료 상태 반영 중" />
                  <span className="ct-wizard-status-row__text">전체 호스트 모니터링 구성 완료 상태 반영</span>
                </div>
              </div>
              {deployError && (
                <Alert isInline variant="danger" title="Wall 모니터링 구성 실패">
                  {deployError}
                </Alert>
              )}
            </div>
          </WizardStep>

          <WizardStep name="완료" id="monitoring-finish">
            <div className="ct-monitoring-center-wizard__content">
              <Content>
                <Content component="p">Wall 모니터링센터 구성을 완료했습니다.</Content>
                <Content component="ul">
                  <Content component="li">
                    Wall 모니터링센터를 통해 대시보드 서비스, 알람 서비스, 플레이리스트 등 작업을 수행할 수 있습니다.
                  </Content>
                  <Content component="li">관리자로 로그인 하신 후 보안을 위해 비밀번호를 변경해 주세요.</Content>
                </Content>
                <Content component="p">위의 모든 작업은 Wall 모니터링센터의 웹 관리콘솔을 이용해 진행합니다.</Content>
              </Content>
            </div>
          </WizardStep>
        </Wizard>
      </Modal>

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        aria-label="모니터링센터 대시보드 구성 진행"
        variant="small"
      >
        <ModalHeader title="모니터링센터 대시보드 구성 진행" />
        <ModalBody>
          <Content component="p">모니터링센터 대시보드 구성을 진행하시겠습니까?</Content>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={executeMonitoringDeploy}>
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
        aria-label="Wall 모니터링센터 VM 구성 취소"
        variant="small"
      >
        <ModalHeader title="Wall 모니터링센터 VM 구성 취소" />
        <ModalBody>
          <Content component="p">
            Wall 모니터링센터 VM 구성을 취소하시겠습니까? 입력된 데이터는 초기화 됩니다.
          </Content>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={handleClose}>
            예
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
