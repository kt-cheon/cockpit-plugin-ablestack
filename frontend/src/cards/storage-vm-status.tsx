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
import {
  STATUS_LOADING_LABEL,
  STATUS_UNKNOWN_LABEL,
  StatusLoadingMessage,
} from "./status-loading";
import ConfirmActionModal from "../components/common/ConfirmActionModal";
import VmResourceUpdateModal from "../components/common/VmResourceUpdateModal";
import ActionProgressModal from "../components/common/ActionProgressModal";
import type { ActionProgressPhase } from "../components/common/ActionProgressModal";
import { useStatusPolling } from "../hooks/useStatusPolling";
import {
  fetchStorageVmStatus,
  STORAGE_VM_STATUS_FALLBACK,
} from "../services/api/storage-vm-status";
import {
  controlStorageVm,
  updateStorageVmResources,
} from "../services/api/card-actions";
import {
  CardDivider,
  compactDiskUsage,
  DotStatus,
  InfoGrid,
  InfoItem,
  NicGroup,
  nicName,
  statusIpWithPrefix,
  StatusCardHeading,
  stripStatusLabel,
  UsageProgress,
} from "./status-card-layout";
import "./status-card.scss";

const VM_STATUS_META = {
  running: {
    label: "Running",
    color: "green",
  },
  shutOff: {
    label: "Stopped",
    color: "orange",
  },
  HEALTH_ERR: {
    label: "Health Err",
    color: "red",
  },
};

type StorageVmAction = "start" | "stop" | "delete";

const STORAGE_VM_ACTIONS: Record<StorageVmAction, { title: string; message: string; confirmLabel?: string }> = {
  start: {
    title: "스토리지 센터 가상머신 상태 변경",
    message: "스토리지 센터 가상머신을 '시작' 하시겠습니까?",
    confirmLabel: "시작",
  },
  stop: {
    title: "스토리지 센터 가상머신 상태 변경",
    message: "스토리지 센터 가상머신을 '정지' 하시겠습니까?",
    confirmLabel: "정지",
  },
  delete: {
    title: "스토리지 센터 가상머신 상태 변경",
    message: "스토리지 센터 가상머신을 '삭제' 하시겠습니까?",
    confirmLabel: "삭제",
  },
};

export default function StorageVmStatus({ pollingEnabled = true, readOnly = false }: { pollingEnabled?: boolean; readOnly?: boolean }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [confirmAction, setConfirmAction] = React.useState<StorageVmAction | null>(null);
  const [isResourceUpdateModalOpen, setIsResourceUpdateModalOpen] = React.useState(false);
  const [actionProgress, setActionProgress] = React.useState<{
    isOpen: boolean;
    title: string;
    phase: ActionProgressPhase;
    message: string;
  }>({ isOpen: false, title: "", phase: "running", message: "" });

  const handleStatusError = React.useCallback((error: unknown) => {
    console.error("storage vm status API error:", error);
  }, []);
  const { data, isCollecting, refresh } = useStatusPolling({
    fetcher: fetchStorageVmStatus,
    fallback: STORAGE_VM_STATUS_FALLBACK,
    enabled: pollingEnabled,
    onError: handleStatusError,
  });

  const statusMeta = isCollecting
    ? {
      label: STATUS_LOADING_LABEL,
      color: "orange",
    }
    : (VM_STATUS_META as any)[data.vmStatus] ?? {
      label: STATUS_UNKNOWN_LABEL,
      color: "orange",
    };

  const isVmError = data.vmStatus === "HEALTH_ERR";
  const isVmUnknown = data.vmStatus === "N/A" || data.vmStatus === "";
  const footerMessage = isCollecting
    ? "스토리지센터 가상머신 상태를 확인하고 있습니다."
    : isVmUnknown
    ? "스토리지센터 가상머신 상태 정보를 확인할 수 없습니다."
    : isVmError
      ? "스토리지센터 가상머신이 배포되지 않았습니다."
      : "스토리지센터 가상머신이 배포되었습니다.";
  const footerColor = `var(--pf-t--global--text--color--status--${isCollecting || isVmUnknown ? 'warning' : isVmError ? 'danger' : 'success'}--default)`;
  const isVmRunning = data.vmStatus === "running";
  const isVmStopped = data.vmStatus === "shutOff";
  const currentConfirmAction = confirmAction ? STORAGE_VM_ACTIONS[confirmAction] : null;

  const onSelect = () => setIsOpen(false);

  const openConfirmActionModal = (action: StorageVmAction) => {
    setConfirmAction(action);
    setIsOpen(false);
  };

  const closeConfirmActionModal = () => {
    setConfirmAction(null);
  };

  const runAction = async (title: string, action: () => Promise<unknown>) => {
    setActionProgress({ isOpen: true, title, phase: "running", message: `${title} 작업을 실행하고 있습니다.` });
    try {
      await action();
      await refresh();
      setActionProgress({ isOpen: true, title, phase: "success", message: `${title}이 완료되었습니다.` });
    } catch (error) {
      setActionProgress({
        isOpen: true,
        title,
        phase: "error",
        message: error instanceof Error ? error.message : `${title}에 실패했습니다.`,
      });
    }
  };

  const confirmStorageVmAction = () => {
    if (!confirmAction) return;
    const action = confirmAction;
    const title = `스토리지센터VM ${STORAGE_VM_ACTIONS[action].confirmLabel}`;
    setConfirmAction(null);
    void runAction(title, () => controlStorageVm(action));
  };

  const openResourceUpdateModal = () => {
    setIsResourceUpdateModalOpen(true);
    setIsOpen(false);
  };

  const closeResourceUpdateModal = () => {
    setIsResourceUpdateModalOpen(false);
  };

  const confirmResourceUpdate = (cpu: string, memory: string) => {
    setIsResourceUpdateModalOpen(false);
    void runAction(
      "스토리지센터VM 자원변경",
      () => updateStorageVmResources(cpu, memory)
    );
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
                    isDisabled={!isVmStopped}
                    onClick={() => openConfirmActionModal("start")}
                  >
                    스토리지센터VM 시작
                  </DropdownItem>
                  <DropdownItem
                    isDisabled={!isVmRunning}
                    onClick={() => openConfirmActionModal("stop")}
                  >
                    스토리지센터VM 정지
                  </DropdownItem>
                </DropdownGroup>
                <DropdownGroup label="관리" className="ct-status-card__menu-group">
                  <DropdownItem
                    isDisabled={isVmRunning}
                    onClick={openResourceUpdateModal}
                  >
                    스토리지센터VM 자원변경
                  </DropdownItem>
                </DropdownGroup>
                <DropdownGroup label="VM 관리" className="ct-status-card__menu-group">
                  <DropdownItem
                    isDisabled={isVmRunning}
                    onClick={() => openConfirmActionModal("delete")}
                  >
                    스토리지센터VM 삭제
                  </DropdownItem>
                </DropdownGroup>
              </DropdownList>
            </Dropdown>
          ),
        }}
      >
        <CardTitle>
          <StatusCardHeading
            icon={<span className="ct-status-card__emoji" aria-hidden="true">🖥</span>}
            title="스토리지센터 가상머신 상태"
            subtitle="Storage Center VM"
            tone="storage-vm"
          />
        </CardTitle>
      </CardHeader>

      <CardBody>
        <InfoGrid>
          <InfoItem label="가상머신 상태" full>
            <DotStatus tone={statusMeta.color}>
              {statusMeta.label}
            </DotStatus>
          </InfoItem>
          <InfoItem label="CPU">{data.cpu}</InfoItem>
          <InfoItem label="Memory">{data.memory}</InfoItem>
        </InfoGrid>

        <UsageProgress
          label="ROOT Disk 사용량"
          value={compactDiskUsage(data.rootDiskSize)}
        />

        <CardDivider />

        <NicGroup
          title={`관리 NIC - ${nicName(data.manageNicType) || "N/A"}`}
          items={[
            { label: "IP", value: stripStatusLabel(data.manageNicIp, "IP") },
            { label: "PREFIX", value: stripStatusLabel(data.manageNicPrefix, "PREFIX") },
            { label: "GW", value: stripStatusLabel(data.manageNicGw, "GW") },
            { label: "DNS", value: stripStatusLabel(data.manageNicDns, "DNS") },
          ]}
        />

        <NicGroup
          title={`스토리지 NIC - ${[
            nicName(data.storageServerNicType),
            nicName(data.storageReplicationNicType),
          ].filter(Boolean).join(" / ") || "N/A"}`}
          items={[
            {
              label: "IP (Storage)",
              value: statusIpWithPrefix(data.storageServerNicIp, ""),
            },
            {
              label: "IP (Repl.)",
              value: statusIpWithPrefix(data.storageReplicationNicIp, ""),
            },
          ]}
        />
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
          {...(currentConfirmAction.confirmLabel ? { confirmLabel: currentConfirmAction.confirmLabel } : {})}
          onClose={closeConfirmActionModal}
          onConfirm={confirmStorageVmAction}
        />
      )}

      <VmResourceUpdateModal
        isOpen={isResourceUpdateModalOpen}
        title="스토리지센터 가상머신 자원변경"
        onClose={closeResourceUpdateModal}
        onConfirm={confirmResourceUpdate}
      />

      <ActionProgressModal
        isOpen={actionProgress.isOpen}
        title={actionProgress.title}
        phase={actionProgress.phase}
        message={actionProgress.message}
        onClose={() => setActionProgress((current) => ({ ...current, isOpen: false }))}
      />
    </Card>
  );
}
