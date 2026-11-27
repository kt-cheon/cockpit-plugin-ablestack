import React from "react";

import {
    Alert,
    Button,
    Form,
    FormGroup,
    Modal,
    ModalBody,
    ModalFooter,
    ModalHeader,
    Switch,
    TextInput,
} from "@patternfly/react-core";

import {
    markSecurityPatchComplete,
    runSecurityPatch,
} from "../services/api/security-patch.ts";

interface SecurityPatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void;
}

type SubmitState = "idle" | "running" | "success" | "error";

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function validatePort(value: string, emptyMessage: string, invalidMessage: string): string {
    const trimmed = value.trim();

    if (!trimmed) {
        return emptyMessage;
    }

    if (!/^\d+$/.test(trimmed)) {
        return invalidMessage;
    }

    const parsed = Number(trimmed);

    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        return invalidMessage;
    }

    return "";
}

export default function SecurityPatchModal({
    isOpen,
    onClose,
    onCompleted,
}: SecurityPatchModalProps) {
    const [portChange, setPortChange] = React.useState(false);
    const [newPort, setNewPort] = React.useState("");
    const [includeAddedHosts, setIncludeAddedHosts] = React.useState(false);
    const [securityPatchConfirmed, setSecurityPatchConfirmed] = React.useState(false);
    const [submitState, setSubmitState] = React.useState<SubmitState>("idle");
    const [message, setMessage] = React.useState("");

    React.useEffect(() => {
        if (!isOpen) return;

        setPortChange(false);
        setNewPort("");
        setIncludeAddedHosts(false);
        setSecurityPatchConfirmed(false);
        setSubmitState("idle");
        setMessage("");
    }, [isOpen]);

    const closeModal = () => {
        if (submitState === "running") return;
        onClose();
    };

    const newPortError = React.useMemo(
        () => portChange
            ? validatePort(
                newPort,
                "변경 포트를 입력해주세요.",
                "변경 포트는 1-65535 사이의 숫자여야 합니다."
            )
            : "",
        [newPort, portChange]
    );

    const hasValidationError = Boolean(newPortError);
    const canExecute = securityPatchConfirmed &&
        !hasValidationError &&
        submitState !== "running" &&
        submitState !== "success";

    const handlePortChange = (checked: boolean) => {
        setPortChange(checked);
        setNewPort("");
        setMessage("");
    };

    const executePatch = async () => {
        if (!canExecute) {
            setSubmitState("error");
            setMessage(
                hasValidationError
                    ? newPortError
                    : "취약점 조치 확인을 먼저 활성화해주세요."
            );
            return;
        }

        setSubmitState("running");
        setMessage("취약점 조치를 실행하는 중입니다.");

        try {
            const parsedNewPort = Number(newPort.trim());

            await runSecurityPatch({
                targets: ["all"],
                sshUser: "root",
                sshPort: 22,
                dryRun: false,
                addHost: includeAddedHosts,
                ...(portChange ? { newPort: parsedNewPort } : {}),
            });

            await markSecurityPatchComplete();
            setSubmitState("success");
            setMessage("취약점 조치가 성공적으로 완료되었습니다.");
            onCompleted();
        } catch (error) {
            setSubmitState("error");
            setMessage(errorMessage(error));
        }
    };

    return (
        <Modal
          isOpen={isOpen}
          onClose={closeModal}
          variant="small"
          aria-label="취약점 조치"
          className="ct-security-patch-modal"
        >
            <ModalHeader title="취약점 조치" />
            <ModalBody>
                <p className="ct-security-patch-modal__intro">
                    취약점 조치를 진행하시겠습니까?
                </p>

                <Form className="ct-security-patch-modal__form">
                    <div className="ct-security-patch-modal__switch-row">
                        <span className="ct-security-patch-modal__switch-label">SSH PORT 변경</span>
                        <Switch
                          id="security-patch-port-change"
                          aria-label="SSH PORT 변경"
                          isChecked={portChange}
                          onChange={(_event, checked) => handlePortChange(checked)}
                        />
                    </div>

                    {portChange
                        ? (
                            <FormGroup
                              label="변경 포트" isRequired
                              fieldId="security-patch-new-port"
                            >
                                <TextInput
                                  id="security-patch-new-port"
                                  type="number"
                                  value={newPort}
                                  onChange={(_event, value) => {
                                      setNewPort(value);
                                      setMessage("");
                                  }}
                                />
                                <div
                                  className={[
                                      "ct-security-patch-modal__helper",
                                      newPortError ? "ct-security-patch-modal__helper--error" : "",
                                  ].join(" ")}
                                >
                                    {newPortError || "변경할 SSH 포트입니다."}
                                </div>
                            </FormGroup>
                        )
                        : null}

                    <div className="ct-security-patch-modal__switch-row">
                        <span className="ct-security-patch-modal__switch-label">추가된 호스트 취약점 조치 실행</span>
                        <Switch
                          id="security-patch-added-hosts"
                          aria-label="추가된 호스트 취약점 조치 실행"
                          isChecked={includeAddedHosts}
                          onChange={(_event, checked) => {
                              setIncludeAddedHosts(checked);
                              setMessage("");
                          }}
                        />
                    </div>

                    <div className="ct-security-patch-modal__switch-row">
                        <span className="ct-security-patch-modal__switch-label">취약점 조치 확인</span>
                        <Switch
                          id="security-patch-confirmed"
                          aria-label="취약점 조치 확인"
                          isChecked={securityPatchConfirmed}
                          onChange={(_event, checked) => {
                              setSecurityPatchConfirmed(checked);
                              setMessage("");
                          }}
                        />
                    </div>
                </Form>

                {message && (
                    <Alert
                      className="ct-security-patch-modal__alert"
                      variant={submitState === "error"
                          ? "danger"
                          : submitState === "success"
                              ? "success"
                              : "info"}
                      title={message}
                      isInline
                    />
                )}
            </ModalBody>
            <ModalFooter>
                {submitState === "success"
                    ? (
                        <Button variant="primary" onClick={closeModal}>
                            완료
                        </Button>
                    )
                    : (
                        <>
                            <Button
                              variant="primary"
                              isDisabled={!canExecute}
                              isLoading={submitState === "running"}
                              spinnerAriaLabel="취약점 조치 실행 중"
                              onClick={executePatch}
                            >
                                {submitState === "running" ? "실행 중" : "실행"}
                            </Button>
                            <Button
                              variant="link" isDisabled={submitState === "running"}
                              onClick={closeModal}
                            >
                                취소
                            </Button>
                        </>
                    )}
            </ModalFooter>
        </Modal>
    );
}
