// 단순 실행 확인이 필요한 카드 액션 모달을 공통으로 제공합니다.
import React from "react";
import {
  Alert,
  Button,
  Content,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "@patternfly/react-core";

interface ConfirmActionModalProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  isSubmitting?: boolean;
  isCompleted?: boolean;
  completedMessage?: React.ReactNode;
  errorMessage?: string;
  onClose: () => void;
  onConfirm: () => void;
}

export default function ConfirmActionModal({
  isOpen,
  title,
  message,
  confirmLabel = "실행",
  cancelLabel = "취소",
  isSubmitting = false,
  isCompleted = false,
  completedMessage = "요청이 완료되었습니다.",
  errorMessage,
  onClose,
  onConfirm,
}: ConfirmActionModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      variant="small"
      aria-label={title}
      className="ct-action-confirm-modal"
    >
      <ModalHeader title={title} />
      <ModalBody>
        <div className="ct-action-confirm-modal__body">
          {isCompleted ? (
            <Alert isInline variant="success" title="완료">
              {completedMessage}
            </Alert>
          ) : (
            typeof message === "string" ? (
              <Content component="p">{message}</Content>
            ) : message
          )}
          {errorMessage && (
            <Alert isInline variant="danger" title="요청 실행 실패">
              {errorMessage}
            </Alert>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        {isCompleted ? (
          <Button variant="primary" onClick={onClose}>
            닫기
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              isDisabled={isSubmitting}
              isLoading={isSubmitting}
              spinnerAriaLabel="요청 실행 중"
              onClick={onConfirm}
            >
              {isSubmitting ? "실행 중" : confirmLabel}
            </Button>
            <Button variant="link" isDisabled={isSubmitting} onClick={onClose}>
              {cancelLabel}
            </Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
}
