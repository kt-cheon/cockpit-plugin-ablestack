import React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  CardFooter,
  Button,
  Dropdown,
  DropdownGroup,
  DropdownList,
  DropdownItem,
  MenuToggle,
} from "@patternfly/react-core";
import {
  SearchIcon,
} from "@patternfly/react-icons";

import ClvmDiskActionModal from "./clvm-disk-action-modal";
import type { ClvmDiskAction } from "./clvm-disk-action-modal";
import StorageClusterHealthChecksModal from "./storage-cluster-health-checks-modal";
import {
  STATUS_LOADING_LABEL,
  STATUS_UNKNOWN_LABEL,
  StatusLoadingMessage,
} from "./status-loading";
import WwnListModal from "./wwn-list-modal";
import CheckedConfirmActionModal from "../components/common/CheckedConfirmActionModal";
import ConfirmActionModal from "../components/common/ConfirmActionModal";
import MaintenanceModeConfirmModal from "../components/common/MaintenanceModeConfirmModal";
import type { MaintenanceModeAction } from "../components/common/MaintenanceModeConfirmModal";
import ActionProgressModal from "../components/common/ActionProgressModal";
import type { ActionProgressPhase } from "../components/common/ActionProgressModal";
import SelectActionModal from "../components/common/SelectActionModal";
import { useStatusPolling } from "../hooks/useStatusPolling";
import {
  fetchStorageClusterStatus,
  STORAGE_CLUSTER_STATUS_FALLBACK,
  type StorageClusterStatusData,
  updateGlueConfigAllHosts,
  updateStorageClusterMaintenanceMode,
} from "../services/api/storage-cluster-status";
import {
  formatMultipathSyncAction,
  formatMultipathSyncCompletedMessage,
  formatMultipathSyncProgressMessage,
  runMultipathSync,
  type MultipathSyncAction,
} from "../services/api/multipath-sync";
import { fetchDiskInventory, type DiskInventoryOption } from "../services/api/inventory";
import {
  createClvmDisks,
  deleteClvmDisks,
  listGfsHosts,
  listClvmDisks,
  removeClusterHost,
  runAutoShutdownStep,
  type ClvmDisk,
  type GfsHost,
} from "../services/api/card-actions";
import { controlCloudCenterVm } from "../services/api/cloud-cluster-status";
import {
  DotStatus,
  InfoGrid,
  InfoItem,
  StatusCardHeading,
  StorageCapacitySummary,
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

export default function StorageClusterStatus({ pollingEnabled = true, readOnly = false }: { pollingEnabled?: boolean; readOnly?: boolean }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isMaintenance, setIsMaintenance] = React.useState(false);
  const [maintenanceModeToConfirm, setMaintenanceModeToConfirm] =
    React.useState<MaintenanceModeAction | null>(null);
  const [maintenanceProgress, setMaintenanceProgress] = React.useState<{
    isOpen: boolean;
    phase: ActionProgressPhase;
    message: string;
  }>({
    isOpen: false,
    phase: "running",
    message: "",
  });
  const [glueUpdateProgress, setGlueUpdateProgress] = React.useState<{
    isOpen: boolean;
    phase: ActionProgressPhase;
    message: string;
  }>({
    isOpen: false,
    phase: "running",
    message: "",
  });
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
  const [isGlueUpdateModalOpen, setIsGlueUpdateModalOpen] = React.useState(false);
  const [isExternalStorageSyncModalOpen, setIsExternalStorageSyncModalOpen] = React.useState(false);
  const [isExternalStorageRescanModalOpen, setIsExternalStorageRescanModalOpen] = React.useState(false);
  const [clvmDiskAction, setClvmDiskAction] = React.useState<ClvmDiskAction | null>(null);
  const [isWwnListModalOpen, setIsWwnListModalOpen] = React.useState(false);
  const [isAutoShutdownModalOpen, setIsAutoShutdownModalOpen] = React.useState(false);
  const [isRemoveCubeHostModalOpen, setIsRemoveCubeHostModalOpen] = React.useState(false);
	const [clusterHosts, setClusterHosts] = React.useState<GfsHost[]>([]);
  const [isHealthChecksModalOpen, setIsHealthChecksModalOpen] = React.useState(false);
  const [availableDisks, setAvailableDisks] = React.useState<DiskInventoryOption[]>([]);
  const [clvmDisks, setClvmDisks] = React.useState<ClvmDisk[]>([]);
  const [isDiskListLoading, setIsDiskListLoading] = React.useState(false);
  const [systemProgress, setSystemProgress] = React.useState<{
    isOpen: boolean;
    title: string;
    phase: ActionProgressPhase;
    message: string;
  }>({ isOpen: false, title: "", phase: "running", message: "" });

  const handleStatusLoad = React.useCallback((nextData: StorageClusterStatusData) => {
    setIsMaintenance(nextData.maintenanceStatus);
  }, []);
  const handleStatusError = React.useCallback((error: unknown) => {
    console.error("storage cluster status API error:", error);
    setIsMaintenance(false);
  }, []);
  const { data, isCollecting, refresh } = useStatusPolling({
    fetcher: fetchStorageClusterStatus,
    fallback: STORAGE_CLUSTER_STATUS_FALLBACK,
    enabled: pollingEnabled,
    onSuccess: handleStatusLoad,
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
  const canOpenHealthChecks =
    !isCollecting && !isClusterUnknown && data.clusterStatus !== "HEALTH_OK";
  const footerMessage = isCollecting
    ? "스토리지센터 클러스터 상태를 확인하고 있습니다."
    : isClusterUnknown
    ? "스토리지센터 클러스터 상태 정보를 확인할 수 없습니다."
    : isClusterError
      ? "스토리지센터 클러스터가 구성되지 않았습니다."
      : "스토리지센터 클러스터가 구성되었습니다.";
  const footerColor = `var(--pf-t--global--text--color--status--${isCollecting || isClusterUnknown ? 'warning' : isClusterError ? 'danger' : 'success'}--default)`;

  const onSelect = () => setIsOpen(false);

  const openMaintenanceModeModal = (mode: MaintenanceModeAction) => {
    setMaintenanceModeToConfirm(mode);
    setIsOpen(false);
  };

  const closeMaintenanceModeModal = () => {
    setMaintenanceModeToConfirm(null);
  };

  const confirmMaintenanceModeChange = async () => {
    if (!maintenanceModeToConfirm) return;

    const mode = maintenanceModeToConfirm;
    const isNextMaintenance = mode === "set";
    const actionLabel = isNextMaintenance ? "설정" : "해제";

    setMaintenanceModeToConfirm(null);
    setMaintenanceProgress({
      isOpen: true,
      phase: "running",
      message: "스토리지 클러스터 유지보수모드 변경중입니다.",
    });

    try {
      await updateStorageClusterMaintenanceMode(mode);
      sessionStorage.setItem(
        "storage_cluster_maintenance_status",
        String(isNextMaintenance)
      );
      setIsMaintenance(isNextMaintenance);
      setMaintenanceProgress({
        isOpen: true,
        phase: "success",
        message: `스토리지 클러스터 유지보수 모드 ${actionLabel}이 완료되었습니다.`,
      });
    } catch (error) {
      console.error("storage cluster maintenance mode update API error:", error);
      setMaintenanceProgress({
        isOpen: true,
        phase: "error",
        message: error instanceof Error
          ? error.message
          : "스토리지 클러스터 유지보수 모드 변경 요청에 실패했습니다.",
      });
    }
  };

  const closeMaintenanceProgressModal = () => {
    setMaintenanceProgress((prev) => ({ ...prev, isOpen: false }));
  };

  const openGlueUpdateModal = () => {
    setIsGlueUpdateModalOpen(true);
    setIsOpen(false);
  };

  const closeGlueUpdateModal = () => {
    setIsGlueUpdateModalOpen(false);
  };

  const confirmGlueUpdate = async () => {
    setIsGlueUpdateModalOpen(false);
    setGlueUpdateProgress({
      isOpen: true,
      phase: "running",
      message: "전체 호스트 Glue 설정 업데이트를 진행하고 있습니다.",
    });

    try {
      await updateGlueConfigAllHosts();
      setGlueUpdateProgress({
        isOpen: true,
        phase: "success",
        message: "전체 호스트 Glue 설정 업데이트가 완료되었습니다.",
      });
    } catch (error) {
      console.error("glue config update API error:", error);
      setGlueUpdateProgress({
        isOpen: true,
        phase: "error",
        message: error instanceof Error
          ? error.message
          : "전체 호스트 Glue 설정 업데이트에 실패했습니다.",
      });
    }
  };

  const closeGlueUpdateProgressModal = () => {
    setGlueUpdateProgress((prev) => ({ ...prev, isOpen: false }));
  };

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

  const openClvmDiskActionModal = async (action: ClvmDiskAction) => {
    setClvmDiskAction(action);
    setIsOpen(false);
    setIsDiskListLoading(true);
    try {
      const [inventory, configured] = await Promise.all([
        action === "add" ? fetchDiskInventory("gfs") : Promise.resolve([]),
        listClvmDisks(),
      ]);
      setAvailableDisks(inventory);
      setClvmDisks(configured);
    } catch (error) {
      setSystemProgress({
        isOpen: true,
        title: "CLVM 디스크 목록 조회",
        phase: "error",
        message: error instanceof Error ? error.message : "CLVM 디스크 목록 조회에 실패했습니다.",
      });
      setClvmDiskAction(null);
    } finally {
      setIsDiskListLoading(false);
    }
  };

  const closeClvmDiskActionModal = () => {
    setClvmDiskAction(null);
  };

  const confirmClvmDiskAction = (action: Exclude<ClvmDiskAction, "info">, selectedIds: string[]) => {
    setClvmDiskAction(null);
    const title = action === "add" ? "CLVM 디스크 추가" : "CLVM 디스크 삭제";
    setSystemProgress({ isOpen: true, title, phase: "running", message: `${title} 작업을 실행하고 있습니다.` });
    const request = action === "add"
      ? createClvmDisks(selectedIds)
      : deleteClvmDisks(clvmDisks.filter((disk) => selectedIds.includes(disk.vgName)));
    void request.then(async () => {
      await refresh();
      setSystemProgress({ isOpen: true, title, phase: "success", message: `${title}가 완료되었습니다.` });
    }).catch((error) => {
      setSystemProgress({
        isOpen: true,
        title,
        phase: "error",
        message: error instanceof Error ? error.message : `${title}에 실패했습니다.`,
      });
    });
  };

  const openWwnListModal = () => {
    setIsWwnListModalOpen(true);
    setIsOpen(false);
  };

  const closeWwnListModal = () => {
    setIsWwnListModalOpen(false);
  };

  const openAutoShutdownModal = () => {
    setIsAutoShutdownModalOpen(true);
    setIsOpen(false);
  };

  const closeAutoShutdownModal = () => {
    setIsAutoShutdownModalOpen(false);
  };

  const confirmAutoShutdown = async () => {
    setIsAutoShutdownModalOpen(false);
    const title = "전체 시스템 종료 절차";
    setSystemProgress({ isOpen: true, title, phase: "running", message: "클라우드센터VM을 정지하고 있습니다." });
    try {
      await controlCloudCenterVm("stop");
      setSystemProgress({ isOpen: true, title, phase: "running", message: "스토리지 클러스터를 유지보수 모드로 전환하고 있습니다." });
      await updateStorageClusterMaintenanceMode("set");
      setSystemProgress({ isOpen: true, title, phase: "running", message: "마운트를 확인하고 스토리지센터VM을 정지하고 있습니다." });
      await runAutoShutdownStep("check_mount");
      await runAutoShutdownStep("stop_scvms");
      setSystemProgress({ isOpen: true, title, phase: "running", message: "전체 호스트 종료를 요청하고 있습니다." });
      await runAutoShutdownStep("shutdown_hosts");
      setSystemProgress({ isOpen: true, title, phase: "success", message: "전체 호스트에 종료 요청을 전송했습니다." });
    } catch (error) {
      setSystemProgress({
        isOpen: true,
        title,
        phase: "error",
        message: error instanceof Error ? error.message : "전체 시스템 종료 절차에 실패했습니다.",
      });
    }
  };

  const openRemoveCubeHostModal = async () => {
    setIsOpen(false);
    try {
      setClusterHosts(await listGfsHosts());
      setIsRemoveCubeHostModalOpen(true);
    } catch (error) {
      setSystemProgress({
        isOpen: true,
        title: "HCI 호스트 제거",
        phase: "error",
        message: error instanceof Error ? error.message : "클러스터 호스트 목록 조회에 실패했습니다.",
      });
    }
  };

  const closeRemoveCubeHostModal = () => {
    setIsRemoveCubeHostModalOpen(false);
  };

  const confirmRemoveCubeHost = async (hostname: string) => {
    setIsRemoveCubeHostModalOpen(false);
    const title = "HCI 호스트 제거";
    setSystemProgress({ isOpen: true, title, phase: "running", message: `${hostname} 호스트 제거 Job을 시작하고 있습니다.` });
    try {
      await removeClusterHost(hostname, (message) => {
        setSystemProgress({ isOpen: true, title, phase: "running", message });
      });
      await refresh();
      setSystemProgress({ isOpen: true, title, phase: "success", message: `${hostname} 호스트 설정과 클러스터 프로파일을 정리했습니다.` });
    } catch (error) {
      setSystemProgress({
        isOpen: true,
        title,
        phase: "error",
        message: error instanceof Error ? error.message : "Cube 호스트 제거에 실패했습니다.",
      });
    }
  };

  const closeHealthChecksModal = () => {
    setIsHealthChecksModalOpen(false);
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
                <DropdownGroup label="운영 모드" className="ct-status-card__menu-group">
                  <DropdownItem
                    isDisabled={isMaintenance}
                    onClick={() => openMaintenanceModeModal("set")}
                  >
                    유지보수 모드 설정
                  </DropdownItem>

                  <DropdownItem
                    isDisabled={!isMaintenance}
                    onClick={() => openMaintenanceModeModal("unset")}
                  >
                    유지보수 모드 해제
                  </DropdownItem>
                </DropdownGroup>

                <DropdownGroup label="구성" className="ct-status-card__menu-group">
                  <DropdownItem
                    onClick={openGlueUpdateModal}
                  >
                    전체 호스트 Glue 설정 업데이트
                  </DropdownItem>
                </DropdownGroup>

                <DropdownGroup label="외부 스토리지" className="ct-status-card__menu-group">
                  <DropdownItem
                    onClick={openExternalStorageSyncModal}
                  >
                    외부 스토리지 동기화
                  </DropdownItem>

                  <DropdownItem
                    onClick={openExternalStorageRescanModal}
                  >
                    외부 스토리지 재검색
                  </DropdownItem>
                </DropdownGroup>

                <DropdownGroup label="디스크 / WWN" className="ct-status-card__menu-group">
                  <DropdownItem
                    onClick={() => openClvmDiskActionModal("add")}
                  >
                    CLVM 디스크 추가
                  </DropdownItem>
                  <DropdownItem
                    onClick={() => openClvmDiskActionModal("delete")}
                  >
                    CLVM 디스크 삭제
                  </DropdownItem>
                  <DropdownItem
                    onClick={() => openClvmDiskActionModal("info")}
                  >
                    CLVM 디스크 정보
                  </DropdownItem>
                  <DropdownItem
                    onClick={openWwnListModal}
                  >
                    WWN 목록 조회
                  </DropdownItem>
                </DropdownGroup>

                <DropdownGroup label="시스템 관리" className="ct-status-card__menu-group">
                  <DropdownItem
                    onClick={openAutoShutdownModal}
                  >
                    전체 시스템 자동 종료
                  </DropdownItem>
                  <DropdownItem
                    onClick={openRemoveCubeHostModal}
                  >
                    Cube 호스트 제거
                  </DropdownItem>
                </DropdownGroup>
              </DropdownList>
            </Dropdown>
          ),
        }}
      >
        <CardTitle>
          <StatusCardHeading
            icon={<span className="ct-status-card__emoji" aria-hidden="true">🗄</span>}
            title="스토리지센터 클러스터 상태"
            subtitle="Glue Cluster"
            tone="storage"
          />
        </CardTitle>
      </CardHeader>

      <CardBody>
        <InfoGrid>
          <InfoItem label="클러스터 상태">
              <span className="ct-health-status">
                <DotStatus tone={statusMeta.color}>
                  {statusMeta.label}
                </DotStatus>
                {canOpenHealthChecks ? (
                  <Button
                    variant="plain"
                    aria-label="스토리지 클러스터 Health 상세 보기"
                    className="ct-health-detail-button"
                    onClick={() => setIsHealthChecksModalOpen(true)}
                  >
                    <SearchIcon aria-hidden="true" />
                  </Button>
                ) : null}
              </span>
          </InfoItem>
          <InfoItem label="스토리지 풀">{data.storagePools}</InfoItem>
          <InfoItem label="게이트웨이" full>{data.gatewayStatus}</InfoItem>
          <InfoItem label="관리데몬" full>{data.daemonStatus}</InfoItem>
          <InfoItem label="디스크" full>{data.diskStatus}</InfoItem>
        </InfoGrid>

        <StorageCapacitySummary
          total={data.storageTotalCapacity}
          usable={data.storageUsableCapacity}
          available={data.storageAvailableCapacity}
          used={data.storageUsedCapacity}
          usagePercentage={data.storageUsagePercentage}
        />
      </CardBody>

      <CardFooter className="ct-status-card__footer" style={{ color: footerColor }}>
        {isCollecting ? (
          <StatusLoadingMessage>{footerMessage}</StatusLoadingMessage>
        ) : footerMessage}
      </CardFooter>

      <MaintenanceModeConfirmModal
        isOpen={maintenanceModeToConfirm !== null}
        mode={maintenanceModeToConfirm ?? "set"}
        subject="스토리지 클러스터"
        onClose={closeMaintenanceModeModal}
        onConfirm={confirmMaintenanceModeChange}
      />

      <ActionProgressModal
        isOpen={maintenanceProgress.isOpen}
        title="스토리지 클러스터 유지보수 모드 변경"
        phase={maintenanceProgress.phase}
        message={maintenanceProgress.message}
        onClose={closeMaintenanceProgressModal}
      />

      <StorageClusterHealthChecksModal
        isOpen={isHealthChecksModalOpen}
        checks={data.healthChecks}
        onClose={closeHealthChecksModal}
      />

      <ConfirmActionModal
        isOpen={isGlueUpdateModalOpen}
        title="전체 호스트 Glue 설정 업데이트"
        message="전체 호스트 Glue 설정 업데이트를 진행하시겠습니까?"
        onClose={closeGlueUpdateModal}
        onConfirm={confirmGlueUpdate}
      />

      <ActionProgressModal
        isOpen={glueUpdateProgress.isOpen}
        title="전체 호스트 Glue 설정 업데이트"
        phase={glueUpdateProgress.phase}
        message={glueUpdateProgress.message}
        onClose={closeGlueUpdateProgressModal}
      />

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

      <ClvmDiskActionModal
        action={clvmDiskAction}
        isOpen={clvmDiskAction !== null}
        availableDisks={availableDisks}
        clvmDisks={clvmDisks}
        isLoading={isDiskListLoading}
        onClose={closeClvmDiskActionModal}
        onConfirm={confirmClvmDiskAction}
      />

      <WwnListModal
        isOpen={isWwnListModalOpen}
        onClose={closeWwnListModal}
      />

      <CheckedConfirmActionModal
        isOpen={isAutoShutdownModalOpen}
        title="전체 시스템 종료 절차 실행"
        message="전체 시스템을 '종료' 하시겠습니까?"
        warning="사전에 각 호스트에 Mount된 볼륨을 작업 수행자가 직접 해제해야 합니다. 해제 후, 아래 볼륨 마운트 해제 확인을 체크하여 계속 진행합니다."
        checkLabel="볼륨 마운트 해제 확인"
        onClose={closeAutoShutdownModal}
        onConfirm={confirmAutoShutdown}
      />

      <ActionProgressModal
        isOpen={systemProgress.isOpen}
        title={systemProgress.title}
        phase={systemProgress.phase}
        message={systemProgress.message}
        onClose={() => setSystemProgress((current) => ({ ...current, isOpen: false }))}
      />

      <SelectActionModal
        isOpen={isRemoveCubeHostModalOpen}
        title="HCI 호스트 제거"
        message="사전 정리를 완료한 호스트를 선택해 주세요. 해당 호스트의 설정과 클러스터 프로파일을 정리합니다."
        selectLabel="호스트"
        options={clusterHosts.map((host) => ({
          value: host.hostname,
          label: host.address ? `${host.hostname} (${host.address})` : host.hostname,
        }))}
        warning="실행 중인 가상머신 이전, 클라우드 호스트 등록 해제, Glue 데이터 이동과 해당 SCVM의 데몬 제거를 먼저 완료해야 합니다. 현재 접속한 호스트는 제거할 수 없습니다."
        checkLabel="가상머신·클라우드 등록·스토리지 정리를 완료했고 호스트 설정 초기화에 동의합니다."
        confirmLabel="호스트 제거"
        onClose={closeRemoveCubeHostModal}
        onConfirm={confirmRemoveCubeHost}
      />
    </Card>
  );
}
