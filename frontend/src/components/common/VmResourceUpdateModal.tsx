// 가상머신 CPU/Memory 자원변경 모달을 공통으로 제공합니다.
import React from "react";
import {
  Button,
  Content,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "@patternfly/react-core";

interface VmResourceUpdateModalProps {
  isOpen: boolean;
  title: string;
  cpuOptions?: string[];
  memoryOptions?: string[];
  onClose: () => void;
  onConfirm: (cpu: string, memory: string) => void;
}

export default function VmResourceUpdateModal({
  isOpen,
  title,
  cpuOptions = ["8", "16"],
  memoryOptions = ["16", "32", "64"],
  onClose,
  onConfirm,
}: VmResourceUpdateModalProps) {
  const [cpu, setCpu] = React.useState("");
  const [memory, setMemory] = React.useState("");

  React.useEffect(() => {
    if (!isOpen) {
      setCpu("");
      setMemory("");
    }
  }, [isOpen]);

  const isExecutable = Boolean(cpu && memory);

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
          <Content component="p">변경할 CPU와 Memory 값을 선택해주세요.</Content>
          <label className="ct-action-confirm-modal__field">
            <span>CPU</span>
            <select value={cpu} onChange={(event) => setCpu(event.currentTarget.value)}>
              <option value="">선택하십시오.</option>
              {cpuOptions.map((value) => (
                <option key={value} value={value}>
                  {value} vCore
                </option>
              ))}
            </select>
          </label>
          <label className="ct-action-confirm-modal__field">
            <span>Memory</span>
            <select value={memory} onChange={(event) => setMemory(event.currentTarget.value)}>
              <option value="">선택하십시오.</option>
              {memoryOptions.map((value) => (
                <option key={value} value={value}>
                  {value} GiB
                </option>
              ))}
            </select>
          </label>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" isDisabled={!isExecutable} onClick={() => onConfirm(cpu, memory)}>
          변경
        </Button>
        <Button variant="link" onClick={onClose}>
          취소
        </Button>
      </ModalFooter>
    </Modal>
  );
}
