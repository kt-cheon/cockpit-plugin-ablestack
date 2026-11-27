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

import ClvmDiskActionModal from "./clvm-disk-action-modal";
import type { ClvmDiskAction } from "./clvm-disk-action-modal";
import GfsDiskActionModal from "./gfs-disk-action-modal";
import type { GfsDiskAction } from "./gfs-disk-action-modal";
import type { GfsDiskActionOptions, GfsDiskRow } from "./gfs-disk-action-modal";
import GfsMountInfoModal from "./gfs-mount-info-modal";
import type { GfsMountInfo } from "./gfs-mount-info-modal";
import { StatusLoadingMessage } from "./status-loading";
import { useStatusPolling } from "../hooks/useStatusPolling";
import ActionProgressModal from "../components/common/ActionProgressModal";
import type { ActionProgressPhase } from "../components/common/ActionProgressModal";
import {
  fetchGfsDiskStatus,
  GFS_DISK_STATUS_FALLBACK,
} from "../services/api/gfs-disk-status";
import { fetchDiskInventory, type DiskInventoryOption } from "../services/api/inventory";
import {
  createClvmDisks,
  deleteClvmDisks,
  listClvmDisks,
  runGfsVolumeAction,
  type ClvmDisk,
} from "../services/api/card-actions";
import {
  InfoGrid,
  InfoItem,
  parseUsagePercent,
  StatusCardHeading,
} from "./status-card-layout";
import "./status-card.scss";

function isKnownValue(value: string | undefined): value is string {
  const normalizedValue = String(value ?? "").trim().toUpperCase();

  return normalizedValue !== "" && normalizedValue !== "N/A";
}

function mountCapacityLabel(mountInfo: GfsMountInfo): string {
  const total = isKnownValue(mountInfo.totalCapacity) ? mountInfo.totalCapacity : mountInfo.diskSize;
  const used = isKnownValue(mountInfo.usedCapacity) ? mountInfo.usedCapacity : "N/A";
  const available = isKnownValue(mountInfo.availableCapacity) ? mountInfo.availableCapacity : "N/A";
  const usagePercentage = isKnownValue(mountInfo.usagePercentage) ? mountInfo.usagePercentage : "N/A";
  const details = [
    isKnownValue(used) ? `${used} 사용` : "",
    isKnownValue(available) ? `${available} 가능` : "",
    isKnownValue(total) ? `전체 ${total}` : "",
  ].filter(Boolean);

  if (details.length > 0 && isKnownValue(usagePercentage)) {
    return `${details.join(" / ")} (${usagePercentage})`;
  }

  if (details.length > 0) {
    return details.join(" / ");
  }

  return "N/A";
}

function parseLvmNames(path: string): { vg: string; lv: string } {
  const normalized = path.trim();
  if (normalized.startsWith("/dev/mapper/")) {
    const [vg = "", ...lvParts] = normalized.slice("/dev/mapper/".length).split("-");
    return { vg: vg.replace(/--/g, "-"), lv: lvParts.join("-").replace(/--/g, "-") };
  }
  const parts = normalized.split("/").filter(Boolean);
  return parts.length >= 3
    ? { vg: parts[parts.length - 2] ?? "", lv: parts[parts.length - 1] ?? "" }
    : { vg: "", lv: "" };
}

function toGfsDiskRows(mountDetails: GfsMountInfo[]): GfsDiskRow[] {
  return mountDetails.map((mount, index) => {
    const { vg, lv } = parseLvmNames(mount.physicalVolume);
    const mountParts = mount.mountPath.split("/").filter(Boolean);
    const name = mountParts[mountParts.length - 1] || `gfs-${index + 1}`;
    const multipathDevices = isKnownValue(mount.multipaths)
      ? mount.multipaths.split(",").map((value) => value.trim()).filter(Boolean)
      : [];
    const physicalDevices = isKnownValue(mount.devices)
      ? mount.devices.split(",").map((value) => value.trim()).filter(Boolean)
      : [];
    const isMultipath = multipathDevices.length > 0;
    const disks = isMultipath ? multipathDevices : physicalDevices;

    return {
      id: `${mount.mountPath}-${index}`,
      name,
      mount: mount.mountPath,
      pv: mount.physicalVolume,
      vg,
      lv,
      size: mount.diskSize,
      uuid: mount.uuid,
      disks,
    };
  }).filter((row) => row.vg && row.lv && row.mount !== "N/A");
}

export default function GfsDiskStatus({ pollingEnabled = true, readOnly = false }: { pollingEnabled?: boolean; readOnly?: boolean }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [gfsDiskAction, setGfsDiskAction] = React.useState<GfsDiskAction | null>(null);
  const [clvmDiskAction, setClvmDiskAction] = React.useState<ClvmDiskAction | null>(null);
  const [selectedMountInfo, setSelectedMountInfo] = React.useState<GfsMountInfo | null>(null);
  const [availableDisks, setAvailableDisks] = React.useState<DiskInventoryOption[]>([]);
  const [clvmDisks, setClvmDisks] = React.useState<ClvmDisk[]>([]);
  const [isActionDataLoading, setIsActionDataLoading] = React.useState(false);
  const [actionProgress, setActionProgress] = React.useState<{
    isOpen: boolean;
    title: string;
    phase: ActionProgressPhase;
    message: string;
  }>({ isOpen: false, title: "", phase: "running", message: "" });

  const handleStatusError = React.useCallback((error: unknown) => {
    console.error("gfs disk status API error:", error);
  }, []);
  const { data, isCollecting, refresh } = useStatusPolling({
    fetcher: fetchGfsDiskStatus,
    fallback: GFS_DISK_STATUS_FALLBACK,
    enabled: pollingEnabled,
    onError: handleStatusError,
  });

  const onSelect = () => setIsOpen(false);

  const mountDetails = data.mountDetails.length > 0
    ? data.mountDetails
    : data.mountPath
      ? [{
        mountPath: data.mountPath,
        status: "N/A",
        devices: "N/A",
        multipaths: "N/A",
        uuid: "N/A",
        physicalVolume: "N/A",
        volumeGroup: "N/A",
        diskSize: "N/A",
        totalCapacity: "N/A",
        usedCapacity: "N/A",
        availableCapacity: "N/A",
        usagePercentage: "N/A",
        resourceStatus: ["N/A"],
      }]
      : [];

  const gfsDiskRows = React.useMemo(() => toGfsDiskRows(mountDetails), [mountDetails]);

  const showActionError = (title: string, error: unknown) => {
    setActionProgress({
      isOpen: true,
      title,
      phase: "error",
      message: error instanceof Error ? error.message : `${title}에 실패했습니다.`,
    });
  };

  const openGfsDiskActionModal = async (action: GfsDiskAction) => {
    setGfsDiskAction(action);
    setIsOpen(false);
    if (action === "add" || action === "extend" || action === "info") {
      setIsActionDataLoading(true);
      try {
        setAvailableDisks(await fetchDiskInventory(action === "info" ? "detail" : "gfs"));
      } catch (error) {
        setGfsDiskAction(null);
        showActionError(action === "info" ? "디스크 상세 정보 조회" : "GFS 디스크 목록 조회", error);
      } finally {
        setIsActionDataLoading(false);
      }
    }
  };

  const closeGfsDiskActionModal = () => {
    setGfsDiskAction(null);
  };

  const confirmGfsDiskAction = (
    action: Exclude<GfsDiskAction, "info">,
    selectedIds: string[],
    options: GfsDiskActionOptions
  ) => {
    setGfsDiskAction(null);
    const title = action === "add" ? "GFS 디스크 추가" : action === "delete" ? "GFS 디스크 삭제" : "GFS 디스크 확장";
    setActionProgress({ isOpen: true, title, phase: "running", message: `${title} 작업을 실행하고 있습니다.` });
    let request: Promise<unknown>;
    if (action === "add") {
      const indexes = gfsDiskRows.map((row) => Number(row.vg.match(/^vg_glue_(\d+)$/)?.[1] ?? 0));
      const nextIndex = Math.max(0, ...indexes) + 1;
      request = runGfsVolumeAction("create-gfs", {
        disks: selectedIds,
        vg_name: `vg_glue_${nextIndex}`,
        lv_name: `lv_glue_${nextIndex}`,
        gfs_name: `glue-gfs-${nextIndex}`,
        mount_point: `/mnt/glue-gfs-${nextIndex}`,
        cluster_name: "cloudcenter_cluster",
      });
    } else {
      const selected = gfsDiskRows.find((row) => selectedIds.includes(row.id));
      if (!selected) {
        showActionError(title, new Error("선택한 GFS 디스크 정보를 확인할 수 없습니다."));
        return;
      }
      const body = {
        disks: action === "delete" ? selected.disks : options.addDisks,
        gfs_name: selected.name,
        vg_name: selected.vg,
        lv_name: selected.lv,
        mount_point: selected.mount,
        non_stop_check: String(options.nonStop),
      };
      request = runGfsVolumeAction(
        action === "delete" ? "delete-gfs" : options.extendMethod === "add-lun" ? "add-extend" : "extend",
        body
      );
    }
    void request.then(async () => {
      await refresh();
      setActionProgress({ isOpen: true, title, phase: "success", message: `${title}이 완료되었습니다.` });
    }).catch((error) => showActionError(title, error));
  };

  const openClvmDiskActionModal = async (action: ClvmDiskAction) => {
    setClvmDiskAction(action);
    setIsOpen(false);
    setIsActionDataLoading(true);
    try {
      const [inventory, configured] = await Promise.all([
        action === "add" ? fetchDiskInventory("gfs") : Promise.resolve([]),
        listClvmDisks(),
      ]);
      setAvailableDisks(inventory);
      setClvmDisks(configured);
    } catch (error) {
      setClvmDiskAction(null);
      showActionError("CLVM 디스크 목록 조회", error);
    } finally {
      setIsActionDataLoading(false);
    }
  };

  const closeClvmDiskActionModal = () => {
    setClvmDiskAction(null);
  };

  const confirmClvmDiskAction = (action: Exclude<ClvmDiskAction, "info">, selectedIds: string[]) => {
    setClvmDiskAction(null);
    const title = action === "add" ? "CLVM 디스크 추가" : "CLVM 디스크 삭제";
    setActionProgress({ isOpen: true, title, phase: "running", message: `${title} 작업을 실행하고 있습니다.` });
    const request = action === "add"
      ? createClvmDisks(selectedIds)
      : deleteClvmDisks(clvmDisks.filter((disk) => selectedIds.includes(disk.vgName)));
    void request.then(async () => {
      await refresh();
      setActionProgress({ isOpen: true, title, phase: "success", message: `${title}가 완료되었습니다.` });
    }).catch((error) => showActionError(title, error));
  };

  const openMountInfoModal = (mountInfo: GfsMountInfo) => {
    setSelectedMountInfo(mountInfo);
  };

  const closeMountInfoModal = () => {
    setSelectedMountInfo(null);
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
                <DropdownGroup label="GFS 디스크" className="ct-status-card__menu-group">
                  <DropdownItem onClick={() => openGfsDiskActionModal("add")}>
                    GFS 디스크 추가
                  </DropdownItem>
                  <DropdownItem onClick={() => openGfsDiskActionModal("delete")}>
                    GFS 디스크 삭제
                  </DropdownItem>
                  <DropdownItem onClick={() => openGfsDiskActionModal("extend")}>
                    GFS 디스크 확장
                  </DropdownItem>
                </DropdownGroup>
                <DropdownGroup label="CLVM 디스크" className="ct-status-card__menu-group">
                  <DropdownItem onClick={() => openClvmDiskActionModal("add")}>
                    CLVM 디스크 추가
                  </DropdownItem>
                  <DropdownItem onClick={() => openClvmDiskActionModal("delete")}>
                    CLVM 디스크 삭제
                  </DropdownItem>
                  <DropdownItem onClick={() => openClvmDiskActionModal("info")}>
                    CLVM 디스크 정보
                  </DropdownItem>
                </DropdownGroup>
                <DropdownGroup label="상세 정보" className="ct-status-card__menu-group">
                  <DropdownItem onClick={() => openGfsDiskActionModal("info")}>
                    디스크 상세 정보
                  </DropdownItem>
                </DropdownGroup>
              </DropdownList>
            </Dropdown>
          ),
        }}
      >
        <CardTitle>
          <StatusCardHeading
            icon={<span className="ct-status-card__emoji" aria-hidden="true">💽</span>}
            title="GFS 디스크 상태"
            subtitle="Global File System"
            tone="disk"
          />
        </CardTitle>
      </CardHeader>

      <CardBody>
        <InfoGrid>
          <InfoItem label="모드">
            {data.mode}
          </InfoItem>
          <InfoItem label="마운트 수">
            {mountDetails.length > 0 ? `${mountDetails.length}개` : "N/A"}
          </InfoItem>
          <InfoItem label="마운트별 용량" full>
            <div className="ct-status-card__mount-capacity-list">
              {mountDetails.length > 0 ? mountDetails.map((mountInfo, index) => (
                <div
                  className="ct-status-card__mount-capacity"
                  key={`${mountInfo.mountPath}-${index}`}
                >
                  <div className="ct-status-card__mount-capacity-head">
                    <button
                      type="button"
                      className="ct-status-card__mount ct-status-card__mount-button"
                      onClick={() => openMountInfoModal(mountInfo)}
                    >
                      {mountInfo.mountPath}
                    </button>
                    <span className="ct-status-card__mount-capacity-meta">
                      {mountCapacityLabel(mountInfo)}
                    </span>
                  </div>
                  <div className="ct-status-card__capacity-bar ct-status-card__mount-capacity-bar">
                    <div
                      className="ct-status-card__capacity-fill"
                      style={{ inlineSize: `${parseUsagePercent(mountInfo.usagePercentage ?? "") ?? 0}%` }}
                    />
                  </div>
                </div>
              )) : (
                <span>N/A</span>
              )}
            </div>
          </InfoItem>
        </InfoGrid>
      </CardBody>

      <CardFooter
        className="ct-status-card__footer"
        style={{ color: isCollecting ? "#f0ab00" : data.footerColor }}
      >
        {isCollecting ? (
          <StatusLoadingMessage>GFS 디스크 상태를 확인하고 있습니다.</StatusLoadingMessage>
        ) : data.footerMessage}
      </CardFooter>

      <GfsDiskActionModal
        action={gfsDiskAction}
        isOpen={gfsDiskAction !== null}
        availableDisks={availableDisks}
        gfsDisks={gfsDiskRows}
        isLoading={isActionDataLoading}
        onClose={closeGfsDiskActionModal}
        onConfirm={confirmGfsDiskAction}
      />

      <ClvmDiskActionModal
        action={clvmDiskAction}
        isOpen={clvmDiskAction !== null}
        availableDisks={availableDisks}
        clvmDisks={clvmDisks}
        isLoading={isActionDataLoading}
        onClose={closeClvmDiskActionModal}
        onConfirm={confirmClvmDiskAction}
      />

      <GfsMountInfoModal
        isOpen={selectedMountInfo !== null}
        mountInfo={selectedMountInfo}
        onClose={closeMountInfoModal}
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
