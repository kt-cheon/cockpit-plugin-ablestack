// 입력값과 확인 체크가 필요한 카드 액션 모달을 공통으로 제공합니다.
import React from "react";
import {
  Button,
  Content,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "@patternfly/react-core";
import { ExclamationCircleIcon } from "@patternfly/react-icons";

interface TextInputConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  inputLabel: string;
  placeholder?: string;
  warning?: string;
  checkLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
}

export default function TextInputConfirmModal({
  isOpen,
  title,
  message,
  inputLabel,
  placeholder,
  warning,
  checkLabel,
  confirmLabel = "실행",
  cancelLabel = "취소",
  onClose,
  onConfirm,
}: TextInputConfirmModalProps) {
  const [value, setValue] = React.useState("");
  const [isChecked, setIsChecked] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) {
      setValue("");
      setIsChecked(false);
    }
  }, [isOpen]);

  const isExecutable = Boolean(value.trim()) && (!checkLabel || isChecked);

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
          <Content component="p">{message}</Content>
          <label className="ct-action-confirm-modal__field">
            <span>{inputLabel}</span>
            <input
              type="text"
              value={value}
              placeholder={placeholder}
              onChange={(event) => setValue(event.currentTarget.value)}
            />
          </label>
          {warning && (
            <div className="ct-action-confirm-modal__warning">
              <ExclamationCircleIcon aria-hidden="true" />
              <span>{warning}</span>
            </div>
          )}
          {checkLabel && (
            <label className="ct-action-confirm-modal__check">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(event) => setIsChecked(event.currentTarget.checked)}
              />
              <span>{checkLabel}</span>
            </label>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          isDisabled={!isExecutable}
          onClick={() => onConfirm(value.trim())}
        >
          {confirmLabel}
        </Button>
        <Button variant="link" onClick={onClose}>
          {cancelLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
