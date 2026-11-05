// GFS 마운트 경로 클릭 시 디스크 상세 정보를 보여주는 모달입니다.
import React from "react";
import {
  Button,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "@patternfly/react-core";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InfoCircleIcon,
} from "@patternfly/react-icons";

export interface GfsMountInfo {
  mountPath: string;
  status: string;
  devices: string;
  multipaths: string;
  uuid: string;
  physicalVolume: string;
  volumeGroup: string;
  diskSize: string;
  totalCapacity?: string;
  usedCapacity?: string;
  availableCapacity?: string;
  usagePercentage?: string;
  resourceStatus: string[];
}

interface GfsMountInfoModalProps {
  isOpen: boolean;
  mountInfo: GfsMountInfo | null;
  onClose: () => void;
}

const renderValue = (value?: string) => value && value.trim() ? value : "N/A";

function statusMeta(status: string) {
  const normalizedStatus = status.toLowerCase();

  if (normalizedStatus.includes("ok")) {
    return {
      label: "Health OK",
      color: "green" as const,
      icon: <CheckCircleIcon />,
    };
  }

  if (normalizedStatus.includes("warn")) {
    return {
      label: "Health Warn",
      color: "orange" as const,
      icon: <ExclamationTriangleIcon />,
    };
  }

  if (normalizedStatus.includes("err") || normalizedStatus.includes("error")) {
    return {
      label: "Health Err",
      color: "red" as const,
      icon: <ExclamationCircleIcon />,
    };
  }

  return {
    label: renderValue(status),
    color: "orange" as const,
    icon: <InfoCircleIcon />,
  };
}

export default function GfsMountInfoModal({
  isOpen,
  mountInfo,
  onClose,
}: GfsMountInfoModalProps) {
  if (!mountInfo) {
    return null;
  }

  const diskDevice = mountInfo.multipaths && mountInfo.multipaths.trim().toUpperCase() !== "N/A"
    ? mountInfo.multipaths
    : mountInfo.devices;
  const rows = [
    ["마운트 경로", mountInfo.mountPath],
    ["디스크 장치명", diskDevice],
    ["볼륨 그룹", mountInfo.volumeGroup || mountInfo.physicalVolume],
    ["스토리지 용량", mountInfo.totalCapacity || mountInfo.diskSize],
    ["사용량", `${renderValue(mountInfo.usedCapacity)} / ${renderValue(mountInfo.usagePercentage)}`],
    ["사용 가능 용량", mountInfo.availableCapacity],
  ];
  const status = statusMeta(mountInfo.status);
  const resourceStatus = mountInfo.resourceStatus.filter((line) => line && line !== "N/A");

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      variant="medium"
      aria-label="GFS 디스크 정보"
      className="ct-gfs-mount-info-modal ct-clvm-disk-modal ct-clvm-disk-modal--medium"
    >
      <ModalHeader title="GFS 디스크 정보" />
      <ModalBody>
        <div className="ct-gfs-mount-info-modal__body">
          <div className="ct-gfs-mount-info-modal__row">
            <strong>디스크 마운트 상태</strong>
            <div className="ct-gfs-mount-info-modal__status">
              <Label
                className="ct-gfs-mount-info-modal__status-label"
                color={status.color}
                icon={status.icon}
              >
                {status.label}
              </Label>
              <span className="ct-gfs-mount-info-modal__status-text">
                {resourceStatus.length > 0
                  ? resourceStatus.map((line, index) => (
                    <React.Fragment key={`${line}-${index}`}>
                      {line}
                      {index < resourceStatus.length - 1 && <br />}
                    </React.Fragment>
                  ))
                  : "N/A"}
              </span>
            </div>
          </div>

          {rows.map(([label, value]) => (
            <div className="ct-gfs-mount-info-modal__row" key={label}>
              <strong>{label}</strong>
              <span className="ct-gfs-mount-info-modal__value">{renderValue(value)}</span>
            </div>
          ))}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={onClose}>
          확인
        </Button>
      </ModalFooter>
    </Modal>
  );
}
