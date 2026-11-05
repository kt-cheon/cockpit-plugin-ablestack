import React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  CardFooter,
  Dropdown,
  DropdownGroup,
  DropdownList,
  DropdownItem,
  MenuToggle,
} from "@patternfly/react-core";
import CloudClusterMigrationModal from "./cloud-cluster-migration-modal";
import SshPortChangeModal from "./ssh-port-change-modal";
import {
  STATUS_LOADING_LABEL,
  STATUS_UNKNOWN_LABEL,
  StatusLoadingMessage,
} from "./status-loading";
import ActionProgressModal from "../components/common/ActionProgressModal";
import type { ActionProgressPhase } from "../components/common/ActionProgressModal";
import ConfirmActionModal from "../components/common/ConfirmActionModal";
import { useStatusPolling } from "../hooks/useStatusPolling";
import {
  CLOUD_CLUSTER_STATUS_FALLBACK,
  controlCloudCenterVm,
  controlCloudClusterPcs,
  fetchCloudClusterStatus,
  updateCloudCenterMonitoringConfig,
} from "../services/api/cloud-cluster-status";
import { runSecurityPatch } from "../services/api/security-patch";
import {
  DotStatus,
  InfoGrid,
  InfoItem,
  StatusCardHeading,
} from "./status-card-layout";
import "./status-card.scss";

const CLUSTER_STATUS_META = {
  HEALTH_OK: {
    label: "Health OK",
    color: "green",
  },
  HEALTH_WARN: {
    label: "Health Warn",
    color: "orange",
  },
  HEALTH_ERR: {
    label: "Health Err",
    color: "red",
  },
};

type CloudClusterConfirmAction =
  | "start"
  | "stop"
  | "cleanup"
  | "monitoringConfigUpdate";

const CLOUD_CLUSTER_ACTIONS: Record<
CloudClusterConfirmAction,
{ title: string; message: string; confirmLabel?: string }
> = {
  start: {
    title: "클라우드센터VM 시작",
    message: "클라우드센터VM을 시작하시겠습니까?",
  },
  stop: {
    title: "클라우드센터VM 정지",
    message: "클라우드센터VM을 정지하시겠습니까?",
  },
  cleanup: {
    title: "클라우드센터 클러스터 클린업",
    message: "클라우드센터 클러스터를 클린업하시겠습니까?",
  },
  monitoringConfigUpdate: {
    title: "모니터링센터 수집 정보 업데이트",
    message: "모니터링센터 수집 정보를 업데이트하시겠습니까?",
  },
};

export default function CloudClusterStatus({ pollingEnabled = true, readOnly = false }: { pollingEnabled?: boolean; readOnly?: boolean }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [confirmAction, setConfirmAction] = React.useState<CloudClusterConfirmAction | null>(null);
  const [isMigrationModalOpen, setIsMigrationModalOpen] = React.useState(false);
  const [isSshPortChangeModalOpen, setIsSshPortChangeModalOpen] = React.useState(false);
  const [actionProgress, setActionProgress] = React.useState<{
    isOpen: boolean;
    title: string;
    phase: ActionProgressPhase;
    message: string;
  }>({ isOpen: false, title: "", phase: "running", message: "" });

  const handleStatusError = React.useCallback((error: unknown) => {
    console.error("cloud cluster status API error:", error);
  }, []);
  const { data, isCollecting, refresh } = useStatusPolling({
    fetcher: fetchCloudClusterStatus,
    fallback: CLOUD_CLUSTER_STATUS_FALLBACK,
    enabled: pollingEnabled,
    onError: handleStatusError,
  });

  const statusMeta = isCollecting
    ? {
      label: STATUS_LOADING_LABEL,
      color: "orange",
    }
    : (CLUSTER_STATUS_META as any)[data.clusterStatus] ?? {
      label: STATUS_UNKNOWN_LABEL,
      color: "orange",
    };

  const isClusterError = data.clusterStatus === "HEALTH_ERR";
  const isClusterUnknown = data.clusterStatus === "N/A" || data.clusterStatus === "";
  const footerMessage = isCollecting
    ? "인프라 클러스터 상태를 확인하고 있습니다."
    : isClusterUnknown
    ? "인프라 클러스터 상태 정보를 확인할 수 없습니다."
    : isClusterError
      ? "인프라 클러스터가 구성되지 않았습니다."
      : "인프라 클러스터가 구성되었습니다.";
  const footerColor = `var(--pf-t--global--text--color--status--${isCollecting || isClusterUnknown ? 'warning' : isClusterError ? 'danger' : 'success'}--default)`;
  const isActionRunning = actionProgress.isOpen && actionProgress.phase === "running";
  const isClusterReady = data.clusterStatus === "HEALTH_OK" && data.nodeStatus !== "N/A";
  const isCloudVmRunning = data.resourceStatus === "실행중";
  const migrationNodes = data.onlineNodes.filter((node) => node !== data.executionNode);
  const currentConfirmAction = confirmAction ? CLOUD_CLUSTER_ACTIONS[confirmAction] : null;

  const onSelect = () => setIsOpen(false);

  const openConfirmActionModal = (action: CloudClusterConfirmAction) => {
    setConfirmAction(action);
    setIsOpen(false);
  };

  const closeConfirmActionModal = () => {
    setConfirmAction(null);
  };

  const errorMessage = (error: unknown) => error instanceof Error
    ? error.message
    : "요청을 처리하지 못했습니다.";

  const runAction = async (
    title: string,
    runningMessage: string,
    successMessage: string,
    action: () => Promise<unknown>
  ) => {
    setActionProgress({ isOpen: true, title, phase: "running", message: runningMessage });

    try {
      await action();
      await refresh();
      setActionProgress({ isOpen: true, title, phase: "success", message: successMessage });
    } catch (error) {
      const message = errorMessage(error);
      setActionProgress({ isOpen: true, title, phase: "error", message });
    }
  };

  const confirmCloudClusterAction = async () => {
    if (!confirmAction) return;

    const action = confirmAction;
    const request = action === "start"
      ? () => controlCloudCenterVm("start")
      : action === "stop"
        ? () => controlCloudCenterVm("stop")
        : action === "cleanup"
          ? () => controlCloudClusterPcs("cleanup")
          : updateCloudCenterMonitoringConfig;
    const messages = {
      start: ["클라우드센터VM을 시작하고 있습니다.", "클라우드센터VM 시작 요청이 완료되었습니다."],
      stop: ["클라우드센터VM을 정지하고 있습니다.", "클라우드센터VM 정지 요청이 완료되었습니다."],
      cleanup: ["클라우드센터 클러스터를 클린업하고 있습니다.", "클라우드센터 클러스터 클린업이 완료되었습니다."],
      monitoringConfigUpdate: ["모니터링센터 수집 정보를 업데이트하고 있습니다.", "모니터링센터 수집 정보 업데이트가 완료되었습니다."],
    } as const;

    setConfirmAction(null);
    await runAction(CLOUD_CLUSTER_ACTIONS[action].title, messages[action][0], messages[action][1], request);
  };

  const openMigrationModal = () => {
    setIsMigrationModalOpen(true);
    setIsOpen(false);
  };

  const closeMigrationModal = () => {
    setIsMigrationModalOpen(false);
  };

  const confirmMigration = async (targetNode: string) => {
    setIsMigrationModalOpen(false);
    await runAction(
      "클라우드센터VM 마이그레이션",
      "클라우드센터VM을 마이그레이션하고 있습니다.",
      `클라우드센터VM을 ${targetNode} 노드로 마이그레이션했습니다.`,
      () => controlCloudClusterPcs("move", targetNode)
    );
  };

  const openSshPortChangeModal = () => {
    setIsSshPortChangeModalOpen(true);
    setIsOpen(false);
  };

  const closeSshPortChangeModal = () => {
    setIsSshPortChangeModalOpen(false);
  };

  const confirmSshPortChange = async (beforePort: string, afterPort: string) => {
    setIsSshPortChangeModalOpen(false);
    await runAction(
      "SSH Port 변경",
      `SSH Port를 ${beforePort}에서 ${afterPort}(으)로 변경하고 있습니다.`,
      `SSH Port를 ${afterPort}(으)로 변경했습니다.`,
      () => runSecurityPatch({
        targets: ["all"],
        sshUser: "root",
        sshPort: Number(beforePort),
        dryRun: false,
        portChangeOnly: true,
        newPort: Number(afterPort),
      })
    );
  };

  const closeActionProgressModal = () => {
    setActionProgress((current) => ({ ...current, isOpen: false }));
  };

  return (
    <Card className="ct-status-card">
      <CardHeader
        className="ct-status-card__header"
        actions={{
          actions: !readOnly && (
            <Dropdown
              className="ct-status-card__dropdown"
              isOpen={isOpen}
              onSelect={onSelect}
              onOpenChange={setIsOpen}
              popperProps={{ placement: "bottom-end", preventOverflow: true }}
              toggle={(toggleRef) => (
                <MenuToggle
                  ref={toggleRef}
                  variant="plain"
                  aria-expanded={isOpen}
                  aria-label={isOpen ? "카드 메뉴 닫기" : "카드 메뉴 열기"}
                  isDisabled={isActionRunning}
                  onClick={() => setIsOpen(!isOpen)}
                >
                  <span
                    className={`ct-status-card__menu-arrow${isOpen ? " ct-status-card__menu-arrow--open" : ""}`}
                    aria-hidden="true"
                  />
                </MenuToggle>
              )}
            >
              <DropdownList>
                <DropdownGroup label="VM 제어" className="ct-status-card__menu-group">
                  <DropdownItem
                    isDisabled={!isClusterReady || isCloudVmRunning}
                    onClick={() => openConfirmActionModal("start")}
                  >
                    클라우드센터VM 시작
                  </DropdownItem>

                  <DropdownItem
                    isDisabled={!isClusterReady || !isCloudVmRunning}
                    onClick={() => openConfirmActionModal("stop")}
                  >
                    클라우드센터VM 정지
                  </DropdownItem>

                  <DropdownItem
                    isDisabled={!isClusterReady || !isCloudVmRunning}
                    onClick={openMigrationModal}
                  >
                    클라우드센터VM 마이그레이션
                  </DropdownItem>
                </DropdownGroup>

                <DropdownGroup label="클러스터 관리" className="ct-status-card__menu-group">
                  <DropdownItem
                    isDisabled={!isClusterReady}
                    onClick={() => openConfirmActionModal("cleanup")}
                  >
                    클라우드센터 클러스터 클린업
                  </DropdownItem>

                  <DropdownItem onClick={openSshPortChangeModal}>
                    SSH Port 변경
                  </DropdownItem>
                </DropdownGroup>

                <DropdownGroup label="모니터링" className="ct-status-card__menu-group">
                  <DropdownItem
                    isDisabled={!isClusterReady}
                    onClick={() => openConfirmActionModal("monitoringConfigUpdate")}
                  >
                    모니터링센터 수집 정보 업데이트
                  </DropdownItem>
                </DropdownGroup>
              </DropdownList>
            </Dropdown>
          ),
        }}
      >
        <CardTitle>
          <StatusCardHeading
            icon={<span className="ct-status-card__emoji" aria-hidden="true">☁</span>}
            title="인프라 클러스터 상태"
            subtitle="Pacemaker"
            tone="cloud"
          />
        </CardTitle>
      </CardHeader>

      <CardBody>
        <InfoGrid>
          <InfoItem label="클러스터 상태">
              <DotStatus tone={statusMeta.color}>
                {statusMeta.label}
              </DotStatus>
          </InfoItem>
          <InfoItem label="노드 구성" full mono>{data.nodeStatus}</InfoItem>
          <InfoItem label="CCVM 실행 노드" mono>{data.executionNode}</InfoItem>
          <InfoItem label="현재 DC" mono>{data.currentDc}</InfoItem>
        </InfoGrid>
      </CardBody>

      <CardFooter className="ct-status-card__footer" style={{ color: footerColor }}>
        {isCollecting ? (
          <StatusLoadingMessage>{footerMessage}</StatusLoadingMessage>
        ) : footerMessage}
      </CardFooter>

      {currentConfirmAction && (
        <ConfirmActionModal
          isOpen={confirmAction !== null}
          title={currentConfirmAction.title}
          message={currentConfirmAction.message}
          confirmLabel={currentConfirmAction.confirmLabel}
          onClose={closeConfirmActionModal}
          onConfirm={confirmCloudClusterAction}
        />
      )}

      <CloudClusterMigrationModal
        isOpen={isMigrationModalOpen}
        nodes={migrationNodes}
        onClose={closeMigrationModal}
        onConfirm={confirmMigration}
      />

      <SshPortChangeModal
        isOpen={isSshPortChangeModalOpen}
        onClose={closeSshPortChangeModal}
        onConfirm={confirmSshPortChange}
      />

      <ActionProgressModal
        isOpen={actionProgress.isOpen}
        title={actionProgress.title}
        phase={actionProgress.phase}
        message={actionProgress.message}
        onClose={closeActionProgressModal}
      />
    </Card>
  );
}
