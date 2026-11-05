// 선택값이 필요한 카드 액션 모달을 공통으로 제공합니다.
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

interface SelectActionOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectActionModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  selectLabel?: string;
  options: SelectActionOption[];
  warning?: string;
  checkLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
}

export default function SelectActionModal({
  isOpen,
  title,
  message,
  selectLabel = "선택",
  options,
  warning,
  checkLabel,
  confirmLabel = "실행",
  cancelLabel = "취소",
  onClose,
  onConfirm,
}: SelectActionModalProps) {
  const [selectedValue, setSelectedValue] = React.useState("");
  const [isChecked, setIsChecked] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) {
      setSelectedValue("");
      setIsChecked(false);
    }
  }, [isOpen]);

  const isExecutable = Boolean(selectedValue) && (!checkLabel || isChecked);

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
          {warning && (
            <div className="ct-action-confirm-modal__warning">
              <ExclamationTriangleIcon aria-hidden="true" />
              <span>{warning}</span>
            </div>
          )}
          <label className="ct-action-confirm-modal__field">
            <span>{selectLabel}</span>
            <select
              value={selectedValue}
              onChange={(event) => setSelectedValue(event.currentTarget.value)}
            >
              <option value="">선택하십시오</option>
              {options.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
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
          onClick={() => onConfirm(selectedValue)}
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
