// 카드 드롭다운의 유지보수 모드 변경 전 확인 팝업을 공통으로 제공합니다.
import React from "react";
import {
  Button,
  Content,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "@patternfly/react-core";

export type MaintenanceModeAction = "set" | "unset";

interface MaintenanceModeConfirmModalProps {
  isOpen: boolean;
  mode: MaintenanceModeAction;
  subject: string;
  onClose: () => void;
  onConfirm: () => void;
}

export default function MaintenanceModeConfirmModal({
  isOpen,
  mode,
  subject,
  onClose,
  onConfirm,
}: MaintenanceModeConfirmModalProps) {
  const actionLabel = mode === "set" ? "설정" : "해제";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      variant="small"
      aria-label={`${subject} 유지보수 모드 변경`}
      className="ct-maintenance-mode-modal"
    >
      <ModalHeader title={`${subject} 유지보수 모드 변경`} />
      <ModalBody>
        <Content component="p">
          {subject}를 유지보수 모드로 '{actionLabel}' 하시겠습니까?
        </Content>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={onConfirm}>
          변경
        </Button>
        <Button variant="link" onClick={onClose}>
          취소
        </Button>
      </ModalFooter>
    </Modal>
  );
}
