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
import WwnListModal from "./wwn-list-modal";
import ActionProgressModal from "../components/common/ActionProgressModal";
import type { ActionProgressPhase } from "../components/common/ActionProgressModal";
import CheckedConfirmActionModal from "../components/common/CheckedConfirmActionModal";
import SelectActionModal from "../components/common/SelectActionModal";
import { useStatusPolling } from "../hooks/useStatusPolling";
import {
  fetchGfsResourceStatus,
  GFS_RESOURCE_STATUS_FALLBACK,
} from "../services/api/gfs-resource-status";
import {
  formatMultipathSyncAction,
  formatMultipathSyncCompletedMessage,
  formatMultipathSyncProgressMessage,
  runMultipathSync,
  type MultipathSyncAction,
} from "../services/api/multipath-sync";
import {
  listGfsHosts,
  removeClusterHost,
  type GfsHost,
} from "../services/api/card-actions";
import {
  DotStatus,
  InfoGrid,
  InfoItem,
  StatusCardHeading,
} from "./status-card-layout";
import "./status-card.scss";

const STATUS_META = {
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

export default function GfsResourceStatus({ pollingEnabled = true, readOnly = false }: { pollingEnabled?: boolean; readOnly?: boolean }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isExternalStorageSyncModalOpen, setIsExternalStorageSyncModalOpen] = React.useState(false);
  const [isExternalStorageRescanModalOpen, setIsExternalStorageRescanModalOpen] = React.useState(false);
  const [isWwnListModalOpen, setIsWwnListModalOpen] = React.useState(false);
  const [isHostRemoveModalOpen, setIsHostRemoveModalOpen] = React.useState(false);
  const [gfsHosts, setGfsHosts] = React.useState<GfsHost[]>([]);
  const [multipathProgress, setMultipathProgress] = React.useState<{
    isOpen: boolean;
    title: string;
    phase: ActionProgressPhase;
    message: string;
  }>({
    isOpen: false,
    title: "외부 스토리지 동기화",
    phase: "running",
    message: "",
  });
  const [hostRemoveProgress, setHostRemoveProgress] = React.useState<{
    isOpen: boolean;
	title: string;
    phase: ActionProgressPhase;
    message: string;
  }>({ isOpen: false, title: "호스트 제거", phase: "running", message: "" });

  const handleStatusError = React.useCallback((error: unknown) => {
    console.error("gfs resource status API error:", error);
  }, []);
  const { data, isCollecting, refresh } = useStatusPolling({
    fetcher: fetchGfsResourceStatus,
    fallback: GFS_RESOURCE_STATUS_FALLBACK,
    enabled: pollingEnabled,
    onError: handleStatusError,
  });

  const onSelect = () => setIsOpen(false);

  const openExternalStorageSyncModal = () => {
    setIsExternalStorageSyncModalOpen(true);
    setIsOpen(false);
  };

  const closeExternalStorageSyncModal = () => {
    setIsExternalStorageSyncModalOpen(false);
  };

  const runExternalStorageAction = async (action: MultipathSyncAction) => {
    const title = formatMultipathSyncAction(action);

    setMultipathProgress({
      isOpen: true,
      title,
      phase: "running",
      message: formatMultipathSyncProgressMessage(action),
    });

    try {
      await runMultipathSync(action);

      setMultipathProgress({
        isOpen: true,
        title,
        phase: "success",
        message: formatMultipathSyncCompletedMessage(action),
      });
    } catch (error) {
      console.error("multipath sync API error:", error);
      setMultipathProgress({
        isOpen: true,
        title,
        phase: "error",
        message: error instanceof Error
          ? error.message
          : `${title}에 실패했습니다.`,
      });
    }
  };

  const closeMultipathProgressModal = () => {
    setMultipathProgress((prev) => ({ ...prev, isOpen: false }));
  };

  const confirmExternalStorageSync = () => {
    setIsExternalStorageSyncModalOpen(false);
    void runExternalStorageAction("sync");
  };

  const openExternalStorageRescanModal = () => {
    setIsExternalStorageRescanModalOpen(true);
    setIsOpen(false);
  };

  const closeExternalStorageRescanModal = () => {
    setIsExternalStorageRescanModalOpen(false);
  };

  const confirmExternalStorageRescan = () => {
    setIsExternalStorageRescanModalOpen(false);
    void runExternalStorageAction("rescan");
  };

  const openWwnListModal = () => {
    setIsWwnListModalOpen(true);
    setIsOpen(false);
  };

  const closeWwnListModal = () => {
    setIsWwnListModalOpen(false);
  };

  const openHostRemoveModal = async () => {
    setIsOpen(false);
    try {
      setGfsHosts(await listGfsHosts());
      setIsHostRemoveModalOpen(true);
    } catch (error) {
      setHostRemoveProgress({
        isOpen: true,
		title: "호스트 제거",
        phase: "error",
        message: error instanceof Error ? error.message : "GFS 호스트 목록 조회에 실패했습니다.",
      });
    }
  };

  const closeHostRemoveModal = () => {
    setIsHostRemoveModalOpen(false);
  };

  const confirmHostRemove = async (hostname: string) => {
    setIsHostRemoveModalOpen(false);
    setHostRemoveProgress({ isOpen: true, title: "호스트 제거", phase: "running", message: `${hostname} 호스트 제거 Job을 시작하고 있습니다.` });
    try {
      const job = await removeClusterHost(hostname, (message, currentJob) => {
        const title = currentJob.cluster_type === "ablestack-hci-filesystem"
          ? "HCI Filesystem 호스트 제거"
          : "VM 호스트 제거";
        setHostRemoveProgress({ isOpen: true, title, phase: "running", message });
      });
      await refresh();
      const title = job.cluster_type === "ablestack-hci-filesystem"
        ? "HCI Filesystem 호스트 제거"
        : "VM 호스트 제거";
      setHostRemoveProgress({ isOpen: true, title, phase: "success", message: `${hostname} 호스트 제거가 완료되었습니다.` });
    } catch (error) {
      setHostRemoveProgress({
        isOpen: true,
		title: "호스트 제거",
        phase: "error",
        message: error instanceof Error ? error.message : "호스트 제거에 실패했습니다.",
      });
    }
  };

  const statusDetail = (statusKey: string) => (
    isCollecting
      ? {
        label: STATUS_LOADING_LABEL,
        color: "orange",
      }
      : (STATUS_META as any)[statusKey] ?? {
        label: statusKey || STATUS_UNKNOWN_LABEL,
        color: "orange",
      }
  );
  const fenceStatus = statusDetail(data.fenceDeviceStatus);
  const lockStatus = statusDetail(data.lockDeviceStatus);
  const gfsStatus = statusDetail(data.gfsDeviceStatus);

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
                <DropdownGroup label="외부 스토리지" className="ct-status-card__menu-group">
                  <DropdownItem onClick={openExternalStorageSyncModal}>
                    외부 스토리지 동기화
                  </DropdownItem>
                  <DropdownItem onClick={openExternalStorageRescanModal}>
                    외부 스토리지 재검색
                  </DropdownItem>
                </DropdownGroup>
                <DropdownGroup label="장치 정보" className="ct-status-card__menu-group">
                  <DropdownItem onClick={openWwnListModal}>
                    WWN 목록 조회
                  </DropdownItem>
                </DropdownGroup>
                <DropdownGroup label="호스트 관리" className="ct-status-card__menu-group">
                  <DropdownItem onClick={openHostRemoveModal}>
                    호스트 제거
                  </DropdownItem>
                </DropdownGroup>
              </DropdownList>
            </Dropdown>
          ),
        }}
      >
        <CardTitle>
          <StatusCardHeading
            icon={<span className="ct-status-card__emoji" aria-hidden="true">⛓</span>}
            title="GFS 리소스 상태"
            subtitle="Global File System"
            tone="gfs"
          />
        </CardTitle>
      </CardHeader>

      <CardBody>
        <InfoGrid className="ct-status-card__info-grid--gfs-resource">
          <InfoItem label="펜스 장치 상태">
            <DotStatus tone={fenceStatus.color}>
              {fenceStatus.label}
            </DotStatus>
          </InfoItem>
          <InfoItem label="잠금 장치 상태">
            <DotStatus tone={lockStatus.color}>
              {lockStatus.label}
            </DotStatus>
          </InfoItem>
          <InfoItem label="GFS2 마운트 장치 상태">
            <DotStatus tone={gfsStatus.color}>
              {gfsStatus.label}
            </DotStatus>
          </InfoItem>
          <InfoItem label="펜스 장치 상세" full mono>
            {data.fenceDeviceDetail || "N/A"}
          </InfoItem>
          <InfoItem label="잠금 장치 상세" full mono>
            <span className="ct-status-card__line-stack">
              {data.lockDeviceDetails.length > 0
                ? data.lockDeviceDetails.map((line, index) => (
                    <span key={`${line}-${index}`}>{line}</span>
                  ))
                : <span>N/A</span>}
            </span>
          </InfoItem>
          <InfoItem label="GFS2 마운트 장치 상세" full mono>
            <span className="ct-status-card__line-stack">
              {data.gfsDeviceDetails.length > 0
                ? data.gfsDeviceDetails.map((line, index) => (
                    <span key={`${line}-${index}`}>{line}</span>
                  ))
                : <span>N/A</span>}
            </span>
          </InfoItem>
        </InfoGrid>
      </CardBody>

      <CardFooter
        className="ct-status-card__footer"
        style={{ color: isCollecting ? "#f0ab00" : data.footerColor }}
      >
        {isCollecting ? (
          <StatusLoadingMessage>GFS 리소스 상태를 확인하고 있습니다.</StatusLoadingMessage>
        ) : data.footerMessage}
      </CardFooter>

      <CheckedConfirmActionModal
        isOpen={isExternalStorageSyncModalOpen}
        title="외부 스토리지 동기화"
        message="동기화를 진행하시겠습니까?"
        warning="해당 장치는 반드시 이중화되어 있어야 합니다. 만약 싱글 패스로 구성되어 있다면 실행하지 마세요."
        checkLabel="외부 스토리지 설정 확인"
        onClose={closeExternalStorageSyncModal}
        onConfirm={confirmExternalStorageSync}
      />

      <CheckedConfirmActionModal
        isOpen={isExternalStorageRescanModalOpen}
        title="외부 스토리지 재검색"
        message="재검색을 진행하시겠습니까?"
        warning="외부 스토리지를 먼저 연결해주시기 바랍니다. 스토리지에서 연결이 정상적으로 확인된 후, 작업을 진행해주시기 바랍니다."
        checkLabel="외부 스토리지 연결 확인"
        onClose={closeExternalStorageRescanModal}
        onConfirm={confirmExternalStorageRescan}
      />

      <ActionProgressModal
        isOpen={multipathProgress.isOpen}
        title={multipathProgress.title}
        phase={multipathProgress.phase}
        message={multipathProgress.message}
        onClose={closeMultipathProgressModal}
      />

      <WwnListModal
        isOpen={isWwnListModalOpen}
        onClose={closeWwnListModal}
      />

      <SelectActionModal
        isOpen={isHostRemoveModalOpen}
        title="호스트 제거"
        message="제거할 호스트를 선택해 주세요."
        selectLabel="호스트"
        options={gfsHosts.map((host) => ({
          value: host.hostname,
          label: host.address ? `${host.hostname} (${host.address})` : host.hostname,
        }))}
        warning="가상머신 이전과 클라우드 등록 해제를 먼저 완료해 주세요. Glue를 사용하는 제품은 해당 SCVM의 데이터와 데몬 정리도 완료해야 합니다. 현재 접속한 호스트는 제거할 수 없습니다."
        checkLabel="가상머신·클라우드 등록·스토리지 정리를 완료했고 호스트 설정 초기화에 동의합니다."
        confirmLabel="호스트 제거"
        onClose={closeHostRemoveModal}
        onConfirm={confirmHostRemove}
      />

      <ActionProgressModal
        isOpen={hostRemoveProgress.isOpen}
        title={hostRemoveProgress.title}
        phase={hostRemoveProgress.phase}
        message={hostRemoveProgress.message}
        onClose={() => setHostRemoveProgress((current) => ({ ...current, isOpen: false }))}
      />
    </Card>
  );
}
