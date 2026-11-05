// GFS 디스크 추가/삭제/확장/상세정보 모달입니다.
import React from "react";
import {
  Button,
  ClipboardCopy,
  Content,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "@patternfly/react-core";
import { ExclamationTriangleIcon } from "@patternfly/react-icons";
import type { DiskInventoryOption } from "../services/api/inventory";

export type GfsDiskAction = "add" | "delete" | "extend" | "info";

export interface GfsDiskRow {
  id: string;
  name: string;
  mount: string;
  pv: string;
  vg: string;
  lv: string;
  size: string;
  uuid: string;
  disks: string[];
}

export interface GfsDiskActionOptions {
  extendMethod: "resize" | "add-lun";
  nonStop: boolean;
  addDisks: string[];
}

interface GfsDiskActionModalProps {
  action: GfsDiskAction | null;
  isOpen: boolean;
  availableDisks?: DiskInventoryOption[];
  gfsDisks?: GfsDiskRow[];
  isLoading?: boolean;
  onClose: () => void;
  onConfirm: (action: Exclude<GfsDiskAction, "info">, selectedIds: string[], options: GfsDiskActionOptions) => void;
}

const ACTION_TITLE: Record<GfsDiskAction, string> = {
  add: "GFS 디스크 추가",
  delete: "GFS 디스크 삭제",
  extend: "GFS 디스크 확장",
  info: "디스크 상세 정보",
};

const toggleSelection = (values: string[], value: string) => (
  values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]
);

function normalizeByIdPath(value: string, isMultipath: boolean): string {
  const normalized = value.trim();

  if (!normalized || normalized.toUpperCase() === "N/A") {
    return "";
  }

  if (normalized.startsWith("/dev/disk/by-id/")) {
    return normalized;
  }

  const identifier = normalized
    .replace(/^.*\/dev\/disk\/by-id\//, "")
    .replace(/^dm-uuid-(?:part\d+-)?mpath-/, "")
    .replace(/-part\d+$/, "");

  if (/^(?:dm-uuid-|wwn-|scsi-)/.test(identifier)) {
    return `/dev/disk/by-id/${identifier}`;
  }

  return isMultipath
    ? `/dev/disk/by-id/dm-uuid-mpath-${identifier}`
    : `/dev/disk/by-id/${identifier}`;
}

export default function GfsDiskActionModal({
  action,
  isOpen,
  availableDisks = [],
  gfsDisks = [],
  isLoading = false,
  onClose,
  onConfirm,
}: GfsDiskActionModalProps) {
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [extendMethod, setExtendMethod] = React.useState("resize");
  const [isNoDowntime, setIsNoDowntime] = React.useState(false);
  const [selectedExtendDisks, setSelectedExtendDisks] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!isOpen) {
      setSelectedIds([]);
      setExtendMethod("resize");
      setIsNoDowntime(false);
      setSelectedExtendDisks([]);
    }
  }, [isOpen]);

  if (!action) {
    return null;
  }

  const isInfo = action === "info";
  const isAdd = action === "add";
  const isExtend = action === "extend";
  const isExecutable = isInfo || (
    selectedIds.length > 0 && (!isExtend || extendMethod === "resize" || selectedExtendDisks.length > 0)
  );
  const execute = () => {
    if (isInfo) {
      onClose();
      return;
    }

    onConfirm(action, selectedIds, {
      extendMethod: extendMethod as "resize" | "add-lun",
      nonStop: isNoDowntime,
      addDisks: selectedExtendDisks,
    });
  };

  const renderAvailableDiskTable = () => (
    <div className="ct-disk-table-wrap">
      {availableDisks.length > 0 ? (
        <table className="ct-disk-table ct-disk-table--nowrap">
          <thead>
            <tr>
              <th aria-label="선택" />
              <th>디스크 이름</th>
              <th>디스크 장치명</th>
              <th>UUID</th>
              <th>사이즈</th>
              <th>유형</th>
            </tr>
          </thead>
          <tbody>
            {availableDisks.map((disk) => {
              const selection = isExtend ? selectedExtendDisks : selectedIds;
              const isSelected = selection.includes(disk.value);
              const toggleDisk = () => {
                if (disk.inUse) return;
                if (isExtend) {
                  setSelectedExtendDisks((values) => toggleSelection(values, disk.value));
                } else {
                  setSelectedIds((values) => toggleSelection(values, disk.value));
                }
              };

              return (
                <tr
                  className={disk.inUse
                    ? "ct-disk-table__row--disabled"
                    : isSelected ? "ct-disk-table__row--selected" : ""}
                  key={disk.id}
                  onClick={toggleDisk}
                >
                  <td className="ct-disk-table__select">
                    <input
                      type="checkbox"
                      aria-label={`${disk.name} 선택`}
                      checked={isSelected}
                      disabled={disk.inUse}
                      onClick={(event) => event.stopPropagation()}
                      onChange={toggleDisk}
                    />
                  </td>
                  <td><span className="ct-disk-table__name">{disk.name}</span></td>
                  <td className="ct-disk-table__mono">{disk.device}</td>
                  <td className="ct-disk-table__mono">{disk.uuid || "N/A"}</td>
                  <td className="ct-disk-table__mono">{disk.size}</td>
                  <td>
                    <span className="ct-disk-table__status">
                      {disk.inUse ? "사용 중 (파티션 존재)" : disk.type}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <Content component="p">{isLoading ? "디스크 목록을 조회하고 있습니다." : "추가 가능한 디스크가 없습니다."}</Content>
      )}
    </div>
  );

  const renderGfsDiskTable = () => (
    <div className="ct-disk-table-wrap">
      {gfsDisks.length > 0 ? (
        <table className="ct-disk-table ct-disk-table--nowrap">
          <thead>
            <tr>
              <th aria-label="선택" />
              <th>디스크 이름</th>
              <th>마운트 경로</th>
              <th>디스크 장치명</th>
              <th>볼륨 그룹</th>
              <th>UUID</th>
              <th>사이즈</th>
            </tr>
          </thead>
          <tbody>
            {gfsDisks.map((disk) => {
              const isSelected = selectedIds.includes(disk.id);
              const toggleDisk = () => {
                setSelectedIds((values) => (
                  action === "delete" || action === "extend"
                    ? (values.includes(disk.id) ? [] : [disk.id])
                    : toggleSelection(values, disk.id)
                ));
              };

              return (
                <tr
                  className={isSelected ? "ct-disk-table__row--selected" : ""}
                  key={disk.id}
                  onClick={toggleDisk}
                >
                  <td className="ct-disk-table__select">
                    <input
                      type="checkbox"
                      aria-label={`${disk.name} 선택`}
                      checked={isSelected}
                      onClick={(event) => event.stopPropagation()}
                      onChange={toggleDisk}
                    />
                  </td>
                  <td><span className="ct-disk-table__name">{disk.name}</span></td>
                  <td className="ct-disk-table__mono">{disk.mount}</td>
                  <td className="ct-disk-table__mono">{disk.pv}</td>
                  <td className="ct-disk-table__mono">{disk.vg}</td>
                  <td className="ct-disk-table__mono">{disk.uuid || "N/A"}</td>
                  <td className="ct-disk-table__mono">{disk.size}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <Content component="p">{isLoading ? "GFS 목록을 조회하고 있습니다." : "구성된 GFS 디스크가 없습니다."}</Content>
      )}
    </div>
  );

  const renderInfo = () => (
    <div className="ct-disk-table-wrap">
      {availableDisks.length > 0 ? (
        <table className="ct-disk-table ct-disk-table--static ct-disk-table--nowrap">
          <thead>
            <tr>
              <th>디스크 이름</th>
              <th>디스크 장치명</th>
              <th>UUID</th>
              <th>사이즈</th>
              <th>유형</th>
            </tr>
          </thead>
          <tbody>
            {availableDisks.map((disk) => {
              const isMultipath = disk.pathMode.toLowerCase() === "multipath";
              const uuidPath = normalizeByIdPath(disk.deviceId || disk.uuid, isMultipath);

              return (
                <tr key={disk.id}>
                  <td><span className="ct-disk-table__name">{disk.name}</span></td>
                  <td className="ct-disk-table__mono">{disk.device}</td>
                  <td>
                    {uuidPath ? (
                      <ClipboardCopy
                        className="ct-disk-table__copy"
                        variant="inline-compact"
                        isReadOnly
                        hoverTip="UUID 경로 복사"
                        clickTip="복사되었습니다"
                        copyAriaLabel={`${uuidPath} 복사`}
                      >
                        {uuidPath}
                      </ClipboardCopy>
                    ) : (
                      <span className="ct-disk-table__mono">N/A</span>
                    )}
                  </td>
                  <td className="ct-disk-table__mono">{disk.size}</td>
                  <td>
                    <span className="ct-disk-table__status">
                      {isMultipath ? "Multipath" : "Single path"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <Content component="p">{isLoading ? "디스크 목록을 조회하고 있습니다." : "조회된 디스크가 없습니다."}</Content>
      )}
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      variant="large"
      aria-label={ACTION_TITLE[action]}
      className="ct-clvm-disk-modal ct-clvm-disk-modal--large ct-gfs-disk-action-modal"
    >
      <ModalHeader title={ACTION_TITLE[action]} />
      <ModalBody>
        {isAdd && (
          <div className="ct-clvm-disk-modal__warning">
            <ExclamationTriangleIcon aria-hidden="true" />
            <span>선택한 항목과 관계없이 한 번에 하나의 디스크만 생성됩니다. 원하는 디스크를 신중하게 선택하세요.</span>
          </div>
        )}
        {action === "delete" && (
          <div className="ct-clvm-disk-modal__warning">
            <ExclamationTriangleIcon aria-hidden="true" />
            <span>선택한 디스크의 모든 데이터가 영구적으로 삭제됩니다.</span>
          </div>
        )}
        {isExtend && (
          <div className="ct-action-confirm-modal__body">
            <Content component="p">확장할 GFS 디스크 및 확장 방식을 선택해주세요.</Content>
            <label className="ct-action-confirm-modal__check">
              <input
                type="radio"
                name="gfs-extend-method"
                checked={extendMethod === "resize"}
                onChange={() => setExtendMethod("resize")}
              />
              <span>기존 디스크 사이즈만 확장</span>
            </label>
            <label className="ct-action-confirm-modal__check">
              <input
                type="radio"
                name="gfs-extend-method"
                checked={extendMethod === "add-lun"}
                onChange={() => setExtendMethod("add-lun")}
              />
              <span>새로운 LUN 디스크 추가</span>
            </label>
            <label className="ct-action-confirm-modal__check">
              <input
                type="checkbox"
                checked={isNoDowntime}
                onChange={(event) => setIsNoDowntime(event.currentTarget.checked)}
              />
              <span>무중단 확장</span>
            </label>
          </div>
        )}
        {isInfo ? renderInfo() : isAdd ? renderAvailableDiskTable() : renderGfsDiskTable()}
        {isExtend && extendMethod === "add-lun" ? renderAvailableDiskTable() : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" isDisabled={!isExecutable} onClick={execute}>
          {isAdd ? "추가" : action === "delete" ? "삭제" : isExtend ? "확장" : "확인"}
        </Button>
        {!isInfo && (
          <Button variant="link" onClick={onClose}>
            취소
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
