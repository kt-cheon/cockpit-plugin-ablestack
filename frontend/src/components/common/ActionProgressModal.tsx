import React from "react";
import {
  Alert,
  Button,
  Content,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
} from "@patternfly/react-core";

export type ActionProgressPhase = "running" | "success" | "error";

interface ActionProgressModalProps {
  isOpen: boolean;
  title: string;
  phase: ActionProgressPhase;
  message: string;
  onClose: () => void;
}

export default function ActionProgressModal({
  isOpen,
  title,
  phase,
  message,
  onClose,
}: ActionProgressModalProps) {
  const isRunning = phase === "running";
  const statusTitle = phase === "success"
    ? "완료"
    : phase === "error"
      ? "실패"
      : "진행 중";
  const bodyClassName = isRunning
    ? "ct-action-progress-modal__body ct-action-progress-modal__body--running"
    : "ct-action-progress-modal__body";

  return (
    <Modal
      isOpen={isOpen}
      onClose={isRunning ? undefined : onClose}
      variant="small"
      aria-label={title}
      className="ct-action-progress-modal"
    >
      <ModalHeader title={title} />
      <ModalBody>
        <div className={bodyClassName}>
          {isRunning ? (
            <div className="ct-action-progress-modal__running">
              <Spinner
                size="sm"
                aria-label={statusTitle}
                className="ct-action-progress-modal__spinner"
              />
              <Content
                component="p"
                className="ct-action-progress-modal__message ct-action-progress-modal__message--running"
              >
                {message}
              </Content>
            </div>
          ) : (
            <>
              <Alert
                isInline
                variant={phase === "success" ? "success" : "danger"}
                title={statusTitle}
              />
              <Content
                component="p"
                className={`ct-action-progress-modal__message ct-action-progress-modal__message--${phase}`}
              >
                {message}
              </Content>
            </>
          )}
        </div>
      </ModalBody>
      {isRunning ? (
        <ModalFooter className="ct-action-progress-modal__footer--running">
          <button
            type="button"
            aria-label="작업 진행 중"
            className="ct-action-progress-modal__focus-target"
          />
        </ModalFooter>
      ) : (
        <ModalFooter>
          <Button variant="primary" onClick={onClose}>
            {phase === "success" ? "완료" : "닫기"}
          </Button>
        </ModalFooter>
      )}
    </Modal>
  );
}
