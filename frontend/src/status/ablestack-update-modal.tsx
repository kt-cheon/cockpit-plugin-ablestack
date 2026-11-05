import React from "react";

import {
    Alert,
    Button,
    Content,
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
    fetchVersionUpdateInfo,
    runVersionUpdate,
    type VersionUpdateInfo,
    type VersionUpdateRunResult,
    type VersionUpdateType,
} from "../services/api/version-update.ts";
import {
    fetchVersionInfo,
    type VersionInfo,
} from "../services/api/version.ts";

interface AblestackUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCompleted: (message: string) => void;
}

type SubmitState = "idle" | "checking" | "ready" | "running" | "success" | "error";

const UPDATE_TYPES: Array<{
  type: VersionUpdateType;
  title: string;
  description: string;
}> = [
    {
        type: "all",
        title: "전체 업데이트",
        description: "커널과 Mold를 함께 업데이트합니다.",
    },
    {
        type: "mold",
        title: "Mold 업데이트",
        description: "호스트와 CCVM의 Mold만 업데이트합니다.",
    },
];

const EMPTY_VERSION: VersionInfo = {
    osVersion: "",
    kernelVersion: "",
    cockpitVersion: "",
    moldVersion: "",
    glueVersion: "",
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function displayValue(value: string): string {
    return value.trim() || "확인 필요";
}

function resultMessage(result: VersionUpdateRunResult): string {
    const target = [
        result.targetOsVersion ? `OS ${result.targetOsVersion}` : "",
        result.targetMoldVersion ? `Mold ${result.targetMoldVersion}` : "",
    ].filter(Boolean).join(" / ");

    return target ? `${result.message} (${target})` : result.message;
}

export default function AblestackUpdateModal({
    isOpen,
    onClose,
    onCompleted,
}: AblestackUpdateModalProps) {
    const [mountPath, setMountPath] = React.useState("");
    const [updateType, setUpdateType] = React.useState<VersionUpdateType>("all");
    const [versionInfo, setVersionInfo] = React.useState<VersionInfo>(EMPTY_VERSION);
    const [updateInfo, setUpdateInfo] = React.useState<VersionUpdateInfo | null>(null);
    const [confirmed, setConfirmed] = React.useState(false);
    const [submitState, setSubmitState] = React.useState<SubmitState>("idle");
    const [message, setMessage] = React.useState("");

    React.useEffect(() => {
        if (!isOpen) return;

        setMountPath("");
        setUpdateType("all");
        setVersionInfo(EMPTY_VERSION);
        setUpdateInfo(null);
        setConfirmed(false);
        setSubmitState("idle");
        setMessage("");

        fetchVersionInfo()
                .then(setVersionInfo)
                .catch(() => {
                    setVersionInfo({
                        ...EMPTY_VERSION,
                        osVersion: "확인 불가",
                        moldVersion: "확인 불가",
                    });
                });
    }, [isOpen]);

    const closeModal = () => {
        if (submitState === "checking" || submitState === "running") return;
        onClose();
    };

    const resetCheckedInfo = () => {
        setUpdateInfo(null);
        setConfirmed(false);
        if (submitState !== "running") {
            setSubmitState("idle");
        }
        setMessage("");
    };

    const checkVersionInfo = async () => {
        const trimmedPath = mountPath.trim();

        if (!trimmedPath) {
            setSubmitState("error");
            setMessage("마운트 경로를 입력해주세요.");
            return;
        }

        setSubmitState("checking");
        setMessage("업데이트 버전을 확인하는 중입니다.");
        setUpdateInfo(null);
        setConfirmed(false);

        try {
            const nextInfo = await fetchVersionUpdateInfo(trimmedPath, updateType);

            setUpdateInfo(nextInfo);
            setSubmitState("ready");
            setMessage("업데이트 버전 확인이 완료되었습니다.");
        } catch (error) {
            setSubmitState("error");
            setMessage(errorMessage(error));
        }
    };

    const executeUpdate = async () => {
        if (!updateInfo) {
            setSubmitState("error");
            setMessage("업데이트 버전을 먼저 확인해주세요.");
            return;
        }

        if (!confirmed) {
            setSubmitState("error");
            setMessage("업데이트 실행 확인을 활성화해주세요.");
            return;
        }

        setSubmitState("running");
        setMessage("ABLESTACK 업데이트를 실행하는 중입니다.");

        try {
            const result = await runVersionUpdate(updateInfo.mountPath || mountPath.trim(), updateType);
            const nextMessage = resultMessage(result);

            setSubmitState("success");
            setMessage(nextMessage);
            setConfirmed(false);
            onCompleted(nextMessage);
        } catch (error) {
            setSubmitState("error");
            setMessage(errorMessage(error));
        }
    };

    const currentOsVersion = updateInfo?.currentOsVersion || versionInfo.osVersion;
    const currentMoldVersion = updateInfo?.currentMoldVersion || versionInfo.moldVersion;
    const canCheck = mountPath.trim() !== "" && submitState !== "checking" && submitState !== "running";
    const canExecute = Boolean(updateInfo) && confirmed && submitState !== "running" && submitState !== "checking";
    const isBusy = submitState === "checking" || submitState === "running";
    const alertVariant = submitState === "error"
        ? "danger"
        : submitState === "success"
            ? "success"
            : "info";

    return (
        <Modal
          isOpen={isOpen}
          onClose={closeModal}
          variant="medium"
          aria-label="ABLESTACK 업데이트"
          className="ct-ablestack-update-modal"
        >
            <ModalHeader title="ABLESTACK 업데이트" />
            <ModalBody>
                <div className="ct-ablestack-update-modal__body">
                    <div className="ct-ablestack-update-modal__summary">
                        <div>
                            <span>현재 OS 버전</span>
                            <strong>{displayValue(currentOsVersion)}</strong>
                        </div>
                        <div>
                            <span>현재 Mold 버전</span>
                            <strong>{displayValue(currentMoldVersion)}</strong>
                        </div>
                        <div>
                            <span>업데이트 OS 버전</span>
                            <strong>{displayValue(updateInfo?.targetOsVersion ?? "")}</strong>
                        </div>
                        <div>
                            <span>업데이트 Mold 버전</span>
                            <strong>{displayValue(updateInfo?.targetMoldVersion ?? "")}</strong>
                        </div>
                    </div>

                    <Form className="ct-ablestack-update-modal__form">
                        <FormGroup
                          label="업데이트 방식" isRequired
                          fieldId="ablestack-update-type"
                        >
                            <div className="ct-ablestack-update-modal__type-grid" id="ablestack-update-type">
                                {UPDATE_TYPES.map((item) => (
                                    <button
                                      key={item.type}
                                      type="button"
                                      className={[
                                          "ct-ablestack-update-modal__type-card",
                                          updateType === item.type
                                              ? "ct-ablestack-update-modal__type-card--selected"
                                              : "",
                                      ].join(" ")}
                                      onClick={() => {
                                          setUpdateType(item.type);
                                          resetCheckedInfo();
                                      }}
                                      disabled={isBusy}
                                    >
                                        <strong>{item.title}</strong>
                                        <small>{item.description}</small>
                                    </button>
                                ))}
                            </div>
                        </FormGroup>

                        <FormGroup
                          label="마운트 경로" isRequired
                          fieldId="ablestack-update-mount-path"
                        >
                            <div className="ct-ablestack-update-modal__path-row">
                                <TextInput
                                  id="ablestack-update-mount-path"
                                  value={mountPath}
                                  placeholder="마운트 경로를 입력하세요."
                                  isDisabled={isBusy}
                                  onChange={(_event, value) => {
                                      setMountPath(value);
                                      resetCheckedInfo();
                                  }}
                                />
                                <Button
                                  variant="secondary"
                                  isDisabled={!canCheck}
                                  isLoading={submitState === "checking"}
                                  spinnerAriaLabel="버전 확인 중"
                                  onClick={checkVersionInfo}
                                >
                                    {submitState === "checking" ? "확인 중" : "버전 확인"}
                                </Button>
                            </div>
                        </FormGroup>
                    </Form>

                    {updateInfo && (
                        <div className="ct-ablestack-update-modal__details">
                            <div>
                                <span>복사 경로</span>
                                <strong>{displayValue(updateInfo.copyPath)}</strong>
                            </div>
                            <div>
                                <span>실행 스크립트</span>
                                <strong>{displayValue(updateInfo.workUpdateScript || updateInfo.updateScript)}</strong>
                            </div>
                        </div>
                    )}

                    <div className="ct-ablestack-update-modal__confirm">
                        <div>
                            <strong>업데이트 실행 확인</strong>
                            <Content component="p">
                                버전 확인이 완료된 마운트 경로와 업데이트 방식으로 실행합니다.
                            </Content>
                        </div>
                        <Switch
                          id="ablestack-update-confirm"
                          aria-label="업데이트 실행 확인"
                          isChecked={confirmed}
                          isDisabled={!updateInfo || isBusy}
                          onChange={(_event, checked) => {
                              setConfirmed(checked);
                              if (message && submitState !== "success") {
                                  setMessage("");
                              }
                          }}
                        />
                    </div>

                    {message && (
                        <Alert
                          className="ct-ablestack-update-modal__alert"
                          variant={alertVariant}
                          title={message}
                          isInline
                        />
                    )}
                </div>
            </ModalBody>
            <ModalFooter>
                <Button
                  variant="primary"
                  isDisabled={!canExecute}
                  isLoading={submitState === "running"}
                  spinnerAriaLabel="ABLESTACK 업데이트 실행 중"
                  onClick={executeUpdate}
                >
                    {submitState === "running" ? "실행 중" : "실행"}
                </Button>
                <Button
                  variant="link"
                  isDisabled={isBusy}
                  onClick={closeModal}
                >
                    취소
                </Button>
            </ModalFooter>
        </Modal>
    );
}
