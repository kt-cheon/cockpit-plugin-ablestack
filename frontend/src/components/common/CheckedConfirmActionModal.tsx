// 위험 작업처럼 확인 체크가 필요한 카드 액션 모달을 공통으로 제공합니다.
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

interface CheckedConfirmActionModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  warning: string;
  checkLabel: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onClose: () => void;
  onConfirm: () => void;
}

export default function CheckedConfirmActionModal({
  isOpen,
  title,
  message,
  warning,
  checkLabel,
  confirmLabel = "실행",
  cancelLabel = "취소",
  onClose,
  onConfirm,
}: CheckedConfirmActionModalProps) {
  const [isChecked, setIsChecked] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) {
      setIsChecked(false);
    }
  }, [isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      variant="small"
      aria-label={title}
      className="ct-action-confirm-modal ct-action-confirm-modal--checked"
    >
      <ModalHeader title={title} />
      <ModalBody>
        <div className="ct-action-confirm-modal__body">
          <Content component="p">{message}</Content>
          <div className="ct-action-confirm-modal__warning">
            <ExclamationTriangleIcon aria-hidden="true" />
            <span>{warning}</span>
          </div>
          <label className="ct-action-confirm-modal__check">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={(event) => setIsChecked(event.currentTarget.checked)}
            />
            <span>{checkLabel}</span>
          </label>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" isDisabled={!isChecked} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="link" onClick={onClose}>
          {cancelLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
