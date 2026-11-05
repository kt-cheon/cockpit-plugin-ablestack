import React from "react";
import DbBackupModal from '../status/db-backup-modal';
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
import SelectActionModal from "../components/common/SelectActionModal";
import TextInputConfirmModal from "../components/common/TextInputConfirmModal";
import VmResourceUpdateModal from "../components/common/VmResourceUpdateModal";
import ActionProgressModal from "../components/common/ActionProgressModal";
import type { ActionProgressPhase } from "../components/common/ActionProgressModal";
import { useStatusPolling } from "../hooks/useStatusPolling";
import {
  CLOUD_VM_STATUS_FALLBACK,
  fetchCloudVmStatus,
} from "../services/api/cloud-vm-status";
import {
  controlCloudVmService,
  listCloudVmSnapshots,
  resizeCloudVmSecondary,
  runCloudVmDbBackup,
  runCloudVmSnapshot,
  updateCloudVmResources,
} from "../services/api/card-actions";
import {
  CardDivider,
  compactDiskUsage,
  DotStatus,
  InfoGrid,
  InfoItem,
  NicGroup,
  nicName,
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

type CloudVmConfirmAction = "snapshotBackup";

type CloudVmSelectAction =
  | "moldService"
  | "moldDb"
  | "snapshotRollback"
  | "dbBackup";

const CLOUD_VM_CONFIRM_ACTIONS: Record<CloudVmConfirmAction, { title: string; message: string; confirmLabel?: string }> = {
  snapshotBackup: {
    title: "클라우드센터VM 스냅샷 백업",
    message: "클라우드센터VM 백업용 스냅샷을 생성하시겠습니까?",
  },
};

const CLOUD_VM_SELECT_ACTIONS: Record<
CloudVmSelectAction,
{ title: string; message: string; selectLabel: string; options: { value: string; label: string }[]; warning?: string }
> = {
  moldService: {
    title: "Mold 서비스 제어",
    message: "Mold 서비스 제어 명령을 선택해주세요.",
    selectLabel: "제어 명령",
    options: [
      { value: "start", label: "시작" },
      { value: "restart", label: "재시작" },
      { value: "stop", label: "정지" },
    ],
  },
  moldDb: {
    title: "Mold DB 제어",
    message: "Mold DB 제어 명령을 선택해주세요.",
    selectLabel: "제어 명령",
    options: [
      { value: "start", label: "시작" },
      { value: "restart", label: "재시작" },
      { value: "stop", label: "정지" },
    ],
  },
  snapshotRollback: {
    title: "클라우드센터VM 스냅샷 복구",
    message: "복구할 스냅샷을 선택해주세요.",
    selectLabel: "스냅샷 목록",
    options: [],
    warning: "스냅샷 복구 후에는 현재 상태로 돌아갈 수 없습니다.",
  },
  dbBackup: {
    title: "DB 백업",
    message: "DB 백업 작업을 선택해주세요.",
    selectLabel: "백업 작업",
    options: [
      { value: "instantBackup", label: "즉시 백업" },
      { value: "regularBackup", label: "정기 백업 (매일 02:00)" },
      { value: "deleteOldBackup", label: "백업파일 삭제관리 (30일, 매일 03:00)" },
    ],
  },
};

export default function CloudVmStatus({ pollingEnabled = true, readOnly = false }: { pollingEnabled?: boolean; readOnly?: boolean }) {
  const [dbBackupOpen, setDbBackupOpen] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);
  const [confirmAction, setConfirmAction] = React.useState<CloudVmConfirmAction | null>(null);
  const [selectAction, setSelectAction] = React.useState<CloudVmSelectAction | null>(null);
  const [isResourceUpdateModalOpen, setIsResourceUpdateModalOpen] = React.useState(false);
  const [isSecondarySizeModalOpen, setIsSecondarySizeModalOpen] = React.useState(false);
  const [snapshotOptions, setSnapshotOptions] = React.useState<{ value: string; label: string }[]>([]);
  const [actionProgress, setActionProgress] = React.useState<{
    isOpen: boolean;
    title: string;
    phase: ActionProgressPhase;
    message: string;
  }>({ isOpen: false, title: "", phase: "running", message: "" });

  const handleStatusError = React.useCallback((error: unknown) => {
    console.error("cloud vm status API error:", error);
  }, []);
  const { data, isCollecting, refresh } = useStatusPolling({
    fetcher: fetchCloudVmStatus,
    fallback: CLOUD_VM_STATUS_FALLBACK,
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
    ? "클라우드센터 가상머신 상태를 확인하고 있습니다."
    : isVmUnknown
    ? "클라우드센터 가상머신 상태 정보를 확인할 수 없습니다."
    : isVmError
      ? "클라우드센터 가상머신이 배포되지 않았습니다."
      : "클라우드센터 가상머신이 배포되었습니다.";
  const footerColor = `var(--pf-t--global--text--color--status--${isCollecting || isVmUnknown ? 'warning' : isVmError ? 'danger' : 'success'}--default)`;
  const isVmRunning = data.vmStatus === "running";
  const currentConfirmAction = confirmAction ? CLOUD_VM_CONFIRM_ACTIONS[confirmAction] : null;
  const currentSelectAction = selectAction ? CLOUD_VM_SELECT_ACTIONS[selectAction] : null;

  const onSelect = () => setIsOpen(false);

  const openConfirmActionModal = (action: CloudVmConfirmAction) => {
    setConfirmAction(action);
    setIsOpen(false);
  };

  const closeConfirmActionModal = () => {
    setConfirmAction(null);
  };

  const runAction = async (title: string, runningMessage: string, action: () => Promise<unknown>) => {
    setActionProgress({ isOpen: true, title, phase: "running", message: runningMessage });
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

  const confirmCloudVmAction = () => {
    if (!confirmAction) return;
    const title = CLOUD_VM_CONFIRM_ACTIONS[confirmAction].title;
    setConfirmAction(null);
    void runAction(title, "클라우드센터VM 스냅샷을 생성하고 있습니다.", () => runCloudVmSnapshot("backup"));
  };

  const openSelectActionModal = async (action: CloudVmSelectAction) => {
    if (action === "snapshotRollback") {
      try {
        const snapshots = await listCloudVmSnapshots();
        setSnapshotOptions(snapshots.map((snapshot) => ({ value: snapshot, label: snapshot })));
      } catch (error) {
        setActionProgress({
          isOpen: true,
          title: "스냅샷 목록 조회",
          phase: "error",
          message: error instanceof Error ? error.message : "스냅샷 목록 조회에 실패했습니다.",
        });
        setIsOpen(false);
        return;
      }
    }
    setSelectAction(action);
    setIsOpen(false);
  };

  const closeSelectActionModal = () => {
    setSelectAction(null);
  };

  const confirmCloudVmSelectAction = (value: string) => {
    if (!selectAction) return;
    const action = selectAction;
    const title = CLOUD_VM_SELECT_ACTIONS[action].title;
    setSelectAction(null);
    const request = action === "moldService"
      ? () => controlCloudVmService("mold.service", value)
      : action === "moldDb"
        ? () => controlCloudVmService("mysqld", value)
        : action === "snapshotRollback"
          ? () => runCloudVmSnapshot("rollback", value)
          : () => runCloudVmDbBackup(value);
    void runAction(title, `${title} 작업을 실행하고 있습니다.`, request);
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
      "클라우드센터VM 자원변경",
      "클라우드센터VM CPU와 Memory를 변경하고 있습니다.",
      () => updateCloudVmResources(cpu, memory)
    );
  };

  const openSecondarySizeModal = () => {
    setIsSecondarySizeModalOpen(true);
    setIsOpen(false);
  };

  const closeSecondarySizeModal = () => {
    setIsSecondarySizeModalOpen(false);
  };

  const confirmSecondarySize = (size: string) => {
    setIsSecondarySizeModalOpen(false);
    const addSize = Number(size);
    if (!Number.isInteger(addSize) || addSize < 1 || addSize > 500) {
      setActionProgress({
        isOpen: true,
        title: "Mold 세컨더리 용량 추가",
        phase: "error",
        message: "추가 용량은 1~500 사이의 정수로 입력해 주세요.",
      });
      return;
    }
    void runAction(
      "Mold 세컨더리 용량 추가",
      "Mold 세컨더리 디스크 용량을 확장하고 있습니다.",
      () => resizeCloudVmSecondary(addSize)
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
                <DropdownGroup label="자원" className="ct-status-card__menu-group">
                  <DropdownItem
                    isDisabled={isVmRunning}
                    onClick={openResourceUpdateModal}
                  >
                    클라우드센터VM 자원변경
                  </DropdownItem>
                  <DropdownItem
                    isDisabled={!isVmRunning}
                    onClick={openSecondarySizeModal}
                  >
                    Mold 세컨더리 용량 추가
                  </DropdownItem>
                </DropdownGroup>
                <DropdownGroup label="서비스" className="ct-status-card__menu-group">
                  <DropdownItem
                    isDisabled={!isVmRunning}
                    onClick={() => openSelectActionModal("moldService")}
                  >
                    Mold 서비스 제어
                  </DropdownItem>
                  <DropdownItem
                    isDisabled={!isVmRunning}
                    onClick={() => openSelectActionModal("moldDb")}
                  >
                    Mold DB 제어
                  </DropdownItem>
                </DropdownGroup>
                <DropdownGroup label="백업 / 복구" className="ct-status-card__menu-group">
                  <DropdownItem onClick={() => openConfirmActionModal("snapshotBackup")}>
                    스냅샷 백업
                  </DropdownItem>
                  <DropdownItem
                    isDisabled={isVmRunning}
                    onClick={() => openSelectActionModal("snapshotRollback")}
                  >
                    스냅샷 복구
                  </DropdownItem>
                  <DropdownItem
                    isDisabled={!isVmRunning}
                    onClick={() => { setIsOpen(false); setDbBackupOpen(true); }}
                  >
                    DB 백업
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
            title="클라우드센터 가상머신 상태"
            subtitle="Cloud Center VM"
            tone="cloud-vm"
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
          <InfoItem label="Mold 서비스">{data.moldServiceStatus}</InfoItem>
          <InfoItem label="Mold DB">{data.moldDbStatus}</InfoItem>
        </InfoGrid>

        <UsageProgress
          label="ROOT Disk 사용량"
          value={compactDiskUsage(data.rootDiskSize)}
        />
        <UsageProgress
          label="세컨더리 Disk 사용량"
          value={compactDiskUsage(data.secondaryDiskSize)}
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
          onConfirm={confirmCloudVmAction}
        />
      )}

      {currentSelectAction && (
        <SelectActionModal
          isOpen={selectAction !== null}
          title={currentSelectAction.title}
          message={currentSelectAction.message}
          selectLabel={currentSelectAction.selectLabel}
          options={selectAction === "snapshotRollback" ? snapshotOptions : currentSelectAction.options}
          {...(currentSelectAction.warning ? { warning: currentSelectAction.warning } : {})}
          onClose={closeSelectActionModal}
          onConfirm={confirmCloudVmSelectAction}
        />
      )}

      <VmResourceUpdateModal
        isOpen={isResourceUpdateModalOpen}
        title="클라우드센터VM 자원변경"
        cpuOptions={["2", "4", "8", "16"]}
        memoryOptions={["4", "8", "16", "32", "64"]}
        onClose={closeResourceUpdateModal}
        onConfirm={confirmResourceUpdate}
      />

      <TextInputConfirmModal
        isOpen={isSecondarySizeModalOpen}
        title="Mold 세컨더리 용량 추가"
        message="추가 확장할 용량을 입력해 주세요. (1회 최대 500GiB)"
        inputLabel="추가 용량"
        placeholder="예: 100"
        warning="용량 추가 작업시 클라우드센터 가상머신 스냅샷이 모두 삭제되고, 클라우드센터 가상머신을 재시작합니다."
        checkLabel="Mold 세컨더리 용량 추가 확인"
        onClose={closeSecondarySizeModal}
        onConfirm={confirmSecondarySize}
      />

      <DbBackupModal isOpen={dbBackupOpen} onClose={() => setDbBackupOpen(false)} />
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
