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
    Tabs,
    Tab,
    TabTitleText,
    TextInput,
} from "@patternfly/react-core";

import {
    fetchVersionUpdateInfo,
    fetchVersionUpdateLog,
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

type SubmitState = "idle" | "checking" | "ready" | "running" | "started" | "success" | "error";

const UPDATE_TYPES: Array<{
  type: VersionUpdateType;
  title: string;
  description: string;
}> = [
    {
        type: "all",
        title: "전체 패키지 업데이트",
        description: "OS 전체 패키지를 업데이트합니다. HA를 비활성화하고 업데이트·검증 후 다시 활성화합니다.",
    },
    {
        type: "mold",
        title: "Mold 패키지 업데이트",
        description: "호스트와 실행 중인 CCVM의 Mold를 업데이트합니다. 검증 후 HA를 다시 활성화합니다.",
    },
    {
        type: "packages",
        title: "기타 패키지 업데이트",
        description: "RPM 전용 ISO로 호스트·SCVM·실행 중인 CCVM을 업데이트합니다. CloudStack 패키지는 제외합니다.",
    },
    {
        type: "tools",
        title: "ABLESTACK Tools 업데이트",
        description: "전체 업데이트와 재부팅 후 실행합니다. 현재 커널이 설치 대상과 맞는지 확인합니다.",
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
    if (result.updateType === "tools") return result.message;
    if (result.background) {
        return `${result.message} 진행/완료 로그: ${result.logFile || "/var/log/ablestack-update.log"}`;
    }
    if (result.rpmOnly) return result.message;
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
    const [logText, setLogText] = React.useState("");
    const [logFile, setLogFile] = React.useState("");
    const [logError, setLogError] = React.useState("");
    const [moldUsername, setMoldUsername] = React.useState("admin");
    const [moldPassword, setMoldPassword] = React.useState("");
    const [moldApiUrl, setMoldApiUrl] = React.useState("http://ccvm:8080/client/api");
    React.useEffect(() => { setMoldPassword(""); }, [isOpen, updateType]);

    React.useEffect(() => {
        if (!isOpen) return;
        let disposed = false;
        let pending = false;
        setLogText("");
        setLogFile("");
        setLogError("");
        const refreshLog = async () => {
            if (pending) return;
            pending = true;
            try {
                const result = await fetchVersionUpdateLog(updateType);
                if (!disposed) {
                    setLogText(result.text);
                    setLogFile(result.logFile);
                    setLogError("");
                }
            } catch (error) {
                if (!disposed) setLogError(`로그 조회 실패: ${errorMessage(error)}`);
            } finally {
                pending = false;
            }
        };
        void refreshLog();
        const timer = window.setInterval(() => { void refreshLog(); }, 5000);
        return () => { disposed = true; window.clearInterval(timer); };
    }, [isOpen, updateType]);

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
        setMoldPassword("");
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
        if (updateType !== "tools" && (!moldUsername.trim() || !moldPassword || !moldApiUrl.trim())) {
            setSubmitState("error");
            setMessage("Mold API 주소와 관리자 ID, 비밀번호를 입력해주세요.");
            return;
        }

        setSubmitState("running");
        setMessage("ABLESTACK 업데이트를 실행하는 중입니다.");

        try {
            const result = await runVersionUpdate(updateInfo.mountPath || mountPath.trim(), updateType,
                updateType === "tools" ? undefined : { username: moldUsername.trim(), password: moldPassword, api_url: moldApiUrl.trim() });
            const nextMessage = resultMessage(result);

            setSubmitState(result.background ? "started" : "success");
            setMessage(nextMessage);
            setConfirmed(false);
            onCompleted(nextMessage);
        } catch (error) {
            setSubmitState("error");
            setMessage(errorMessage(error));
        } finally {
            setMoldPassword("");
        }
    };

    const currentOsVersion = updateInfo?.currentOsVersion || versionInfo.osVersion;
    const currentMoldVersion = updateInfo?.currentMoldVersion || versionInfo.moldVersion;
    const canCheck = mountPath.trim() !== "" && submitState !== "checking" && submitState !== "running";
    const canExecute = Boolean(updateInfo) && confirmed && submitState !== "running" && submitState !== "checking"
        && (updateType === "tools" || Boolean(moldUsername.trim() && moldPassword && moldApiUrl.trim()));
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
                        {updateType === "packages" || updateInfo?.rpmOnly ? (
                            <><div><span>대상</span><strong>호스트 · SCVM(HCI) · 실행 중인 CCVM</strong></div>
                                <div><span>ISO 패키지</span><strong>{updateInfo ? `${updateInfo.packageCount}개` : "확인 필요"}</strong></div></>
                        ) : updateType === "tools" ? (
                            <>
                                <div><span>현재 실행 커널</span><strong>{displayValue(updateInfo?.currentKernel || versionInfo.kernelVersion)}</strong></div>
                                <div><span>Tools 설치 대상 커널</span><strong>{displayValue(updateInfo?.targetKernel ?? "")}</strong></div>
                            </>
                        ) : <>
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
                        </>}
                    </div>

                    <Form className="ct-ablestack-update-modal__form">
                        <FormGroup
                          label="업데이트 방식" isRequired
                          fieldId="ablestack-update-type"
                        >
                            <Tabs activeKey={updateType} aria-label="업데이트 종류"
                              isOverflowHorizontal={{ defaultTitleText: "업데이트 종류", toggleAriaLabel: "다른 업데이트 종류" }}
                              onSelect={(_event, key) => {
                                const next = key as VersionUpdateType;
                                setUpdateType(next);
                                if (next === "tools" && !mountPath.trim()) setMountPath("/opt/ABLESTACK_UPDATE");
                                resetCheckedInfo();
                            }}>
                                {UPDATE_TYPES.map((item) => (
                                    <Tab
                                      key={item.type}
                                      eventKey={item.type}
                                      title={<TabTitleText>{item.title}</TabTitleText>}
                                      isDisabled={isBusy}
                                    />
                                ))}
                            </Tabs>
                            <Content component="p">{updateInfo?.rpmOnly && updateType === "all"
                                ? "ISO의 packages.json에 지정된 역할별 패키지만 설치하거나 업데이트합니다."
                                : UPDATE_TYPES.find((item) => item.type === updateType)?.description}</Content>
                        </FormGroup>
                        {updateType !== "tools" && <>
                            <FormGroup label="Mold API 주소" isRequired fieldId="ablestack-update-mold-api">
                                <TextInput id="ablestack-update-mold-api" aria-label="Mold API 주소" value={moldApiUrl} isDisabled={isBusy}
                                  onChange={(_event, value) => setMoldApiUrl(value)} />
                            </FormGroup>
                            <FormGroup label="Mold 관리자 ID" isRequired fieldId="ablestack-update-mold-user">
                                <TextInput id="ablestack-update-mold-user" aria-label="Mold 관리자 ID" value={moldUsername} autoComplete="username" isDisabled={isBusy}
                                  onChange={(_event, value) => setMoldUsername(value)} />
                            </FormGroup>
                            <FormGroup label="Mold 관리자 비밀번호" isRequired fieldId="ablestack-update-mold-password">
                                <TextInput id="ablestack-update-mold-password" type="password" value={moldPassword}
                                  aria-label="Mold 관리자 비밀번호" autoComplete="off" isDisabled={isBusy} onChange={(_event, value) => setMoldPassword(value)} />
                            </FormGroup>
                            <Content component="p">현재 클러스터와 전체 호스트의 HA를 끄고, 업데이트와 검증이 모두 성공한 후 다시 켭니다. 한 호스트씩 순차 실행하세요.</Content>
                        </>}

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
                    {updateInfo?.rolePackages && (
                        <div className="ct-ablestack-update-modal__details" aria-label="역할별 설치 패키지">
                            {(["host", "scvm", "ccvm"] as const).map((role) => (
                                <div key={role}>
                                    <span>{role.toUpperCase()} 패키지</span>
                                    <strong>{updateInfo.rolePackages?.[role].join(", ") || "대상 없음 · 생략"}</strong>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="ct-ablestack-update-modal__confirm">
                        <div>
                            <strong>업데이트 실행 확인</strong>
                            <Content component="p">
                                {updateType === "tools"
                                    ? "재부팅 후 대상 커널로 부팅했는지 확인합니다. 커널이 맞지 않으면 설치를 중단합니다."
                                    : updateType === "all" && !updateInfo?.rpmOnly
                                        ? "백그라운드 시작 후 로그에서 완료를 확인하세요. 완료 후 재부팅하고 ABLESTACK Tools 업데이트를 실행하세요."
                                        : "버전 확인이 완료된 마운트 경로와 업데이트 방식으로 실행합니다."}
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
                    <section className="ct-ablestack-update-modal__log" aria-label="업데이트 로그">
                        <strong>업데이트 로그</strong>
                        <small>{logFile} · 5초마다 갱신</small>
                        {logError && <p role="status">{logError}</p>}
                        <pre tabIndex={0}>{logText || "아직 기록된 업데이트 로그가 없습니다."}</pre>
                    </section>
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
