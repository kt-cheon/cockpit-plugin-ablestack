// 마법사 입력값 검증 실패 메시지를 별도 모달로 안내합니다.
import React from "react";
import {
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "@patternfly/react-core";
import { ExclamationCircleIcon } from "@patternfly/react-icons";

interface ValidationErrorModalProps {
  isOpen: boolean;
  message: string;
  title?: string;
  onClose: () => void;
}

export default function ValidationErrorModal({
  isOpen,
  message,
  title = "입력값을 확인해주세요",
  onClose,
}: ValidationErrorModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      variant="small"
      aria-label={title}
      className="ct-validation-error-modal"
    >
      <ModalHeader title={title} />
      <ModalBody>
        <div className="ct-validation-error-modal__message">
          <ExclamationCircleIcon aria-hidden="true" />
          <span>{message}</span>
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
