// 스토리지센터 클러스터 카드의 CLVM 디스크 추가/삭제/정보 모달입니다.
import React from "react";
import {
  Button,
  Content,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "@patternfly/react-core";
import { ExclamationTriangleIcon } from "@patternfly/react-icons";
import type { DiskInventoryOption } from "../services/api/inventory";
import type { ClvmDisk } from "../services/api/card-actions";

export type ClvmDiskAction = "add" | "delete" | "info";

interface ClvmDiskActionModalProps {
  action: ClvmDiskAction | null;
  isOpen: boolean;
  availableDisks?: DiskInventoryOption[];
  clvmDisks?: ClvmDisk[];
  isLoading?: boolean;
  onClose: () => void;
  onConfirm: (action: Exclude<ClvmDiskAction, "info">, selectedIds: string[]) => void;
}

const ACTION_TITLE: Record<ClvmDiskAction, string> = {
  add: "CLVM 디스크 추가",
  delete: "CLVM 디스크 삭제",
  info: "CLVM 디스크 정보",
};

const toggleSelection = (values: string[], value: string) => (
  values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]
);

export default function ClvmDiskActionModal({
  action,
  isOpen,
  availableDisks = [],
  clvmDisks = [],
  isLoading = false,
  onClose,
  onConfirm,
}: ClvmDiskActionModalProps) {
  const [selectedAddDisks, setSelectedAddDisks] = React.useState<string[]>([]);
  const [selectedDeleteDisks, setSelectedDeleteDisks] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!isOpen) {
      setSelectedAddDisks([]);
      setSelectedDeleteDisks([]);
    }
  }, [isOpen]);

  if (!action) {
    return null;
  }

  const isAdd = action === "add";
  const isDelete = action === "delete";
  const selectedIds = isAdd ? selectedAddDisks : selectedDeleteDisks;
  const isExecutable = action === "info" || selectedIds.length > 0;
  const modalSizeClass = isAdd ? "ct-clvm-disk-modal--large" : "ct-clvm-disk-modal--medium";

  const execute = () => {
    if (action === "info") {
      onClose();
      return;
    }

    onConfirm(action, selectedIds);
  };

  const renderAddBody = () => (
    <>
      <div className="ct-clvm-disk-modal__warning">
        <ExclamationTriangleIcon aria-hidden="true" />
        <span>여러 디스크를 선택하면, 각 디스크에 대해 순차적으로 볼륨 그룹이 자동 생성됩니다.</span>
      </div>
      <div className="ct-disk-table-wrap">
        {availableDisks.length > 0 ? (
          <table className="ct-disk-table">
            <thead>
              <tr>
                <th aria-label="선택" />
                <th>디스크 이름</th>
                <th>디스크 장치명</th>
                <th>사이즈</th>
                <th>유형</th>
                <th>UUID</th>
              </tr>
            </thead>
            <tbody>
              {availableDisks.map((disk) => {
                const isSelected = selectedAddDisks.includes(disk.value);
                const toggleDisk = () => {
                  if (disk.inUse) return;
                  setSelectedAddDisks((values) => toggleSelection(values, disk.value));
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
                    <td>
                      <span className="ct-disk-table__name">{disk.name}</span>
                    </td>
                    <td className="ct-disk-table__mono">{disk.device}</td>
                    <td className="ct-disk-table__mono">{disk.size}</td>
                    <td>
                      <span className="ct-disk-table__status">
                        {disk.inUse ? "사용 중 (파티션 존재)" : disk.state || "N/A"}
                      </span>
                      <span className="ct-disk-table__muted">{[disk.type, disk.vendor].filter(Boolean).join(" / ") || "N/A"}</span>
                    </td>
                    <td className="ct-disk-table__mono">{disk.uuid || "N/A"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Content component="p">{isLoading ? "디스크 목록을 조회하고 있습니다." : "추가 가능한 디스크가 없습니다."}</Content>
        )}
      </div>
    </>
  );

  const renderDeleteBody = () => (
    <div className="ct-disk-table-wrap">
      {clvmDisks.length > 0 ? (
        <table className="ct-disk-table">
          <thead>
            <tr>
              <th aria-label="선택" />
              <th>디스크 이름</th>
              <th>디스크 장치명</th>
              <th>사이즈</th>
              <th>UUID</th>
            </tr>
          </thead>
          <tbody>
            {clvmDisks.map((disk) => {
              const isSelected = selectedDeleteDisks.includes(disk.vgName);
              const toggleDisk = () => {
                setSelectedDeleteDisks((values) => toggleSelection(values, disk.vgName));
              };

              return (
                <tr
                  className={isSelected ? "ct-disk-table__row--selected" : ""}
                key={`${disk.vgName}-${disk.pvName}`}
                  onClick={toggleDisk}
                >
                  <td className="ct-disk-table__select">
                    <input
                      type="checkbox"
                      aria-label={`${disk.vgName} 선택`}
                      checked={isSelected}
                      onClick={(event) => event.stopPropagation()}
                      onChange={toggleDisk}
                    />
                  </td>
                  <td><span className="ct-disk-table__name">{disk.vgName}</span></td>
                  <td className="ct-disk-table__mono">{disk.pvName}</td>
                  <td className="ct-disk-table__mono">{disk.pvSize}</td>
                  <td className="ct-disk-table__mono">{disk.uuid || "N/A"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <Content component="p">{isLoading ? "CLVM 목록을 조회하고 있습니다." : "구성된 CLVM 디스크가 없습니다."}</Content>
      )}
    </div>
  );

  const renderInfoBody = () => (
    <div className="ct-disk-table-wrap">
      {clvmDisks.length > 0 ? (
        <table className="ct-disk-table ct-disk-table--static">
          <thead>
            <tr>
              <th>순번</th>
              <th>디스크 이름</th>
              <th>디스크 장치명</th>
              <th>사이즈</th>
              <th>UUID</th>
            </tr>
          </thead>
          <tbody>
            {clvmDisks.map((disk, index) => (
              <tr key={`${disk.vgName}-${disk.pvName}`}>
                <td className="ct-disk-table__index">{index + 1}</td>
                <td><span className="ct-disk-table__name">{disk.vgName}</span></td>
                <td className="ct-disk-table__mono">{disk.pvName}</td>
                <td className="ct-disk-table__mono">{disk.pvSize}</td>
                <td className="ct-disk-table__mono">{disk.uuid || "N/A"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Content component="p">{isLoading ? "CLVM 목록을 조회하고 있습니다." : "구성된 CLVM 디스크가 없습니다."}</Content>
      )}
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      variant={isAdd ? "large" : "medium"}
      aria-label={ACTION_TITLE[action]}
      className={`ct-clvm-disk-modal ${modalSizeClass}`}
    >
      <ModalHeader title={ACTION_TITLE[action]} />
      <ModalBody>
        {isAdd && renderAddBody()}
        {isDelete && renderDeleteBody()}
        {action === "info" && renderInfoBody()}
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" isDisabled={!isExecutable} onClick={execute}>
          {isAdd ? "추가" : "확인"}
        </Button>
        {action !== "info" && (
          <Button variant="link" onClick={onClose}>
            취소
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
