// 상단 "라이선스 관리" 버튼에서 사용하는 라이선스 상태 확인/등록 모달입니다.
import React from "react";

import {
    Button,
    Content,
    Form,
    FormGroup,
    Modal,
    ModalBody,
    ModalFooter,
    ModalHeader,
    Spinner,
} from "@patternfly/react-core";
import {
    CheckCircleIcon,
    ExclamationCircleIcon,
    ExclamationTriangleIcon,
    InfoCircleIcon,
} from "@patternfly/react-icons";

import {
    fetchLicenseStatus,
    registerLicenseFile,
    type LicenseStatus,
} from "../services/api/license.ts";

interface LicenseManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type RegisterStatusKind = "idle" | "registering" | "success" | "error";

function statusErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export default function LicenseManagementModal({
    isOpen,
    onClose,
}: LicenseManagementModalProps) {
    const [licenseFile, setLicenseFile] = React.useState<File | null>(null);
    const [licenseStatus, setLicenseStatus] = React.useState<LicenseStatus>({
        kind: "loading",
    });
    const [registerStatus, setRegisterStatus] = React.useState<RegisterStatusKind>("idle");
    const [registerMessage, setRegisterMessage] = React.useState("");
    const fileInputRef = React.useRef<HTMLInputElement | null>(null);

    const clearSelectedFile = () => {
        setLicenseFile(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    const loadLicenseStatus = React.useCallback(() => {
        setLicenseStatus({ kind: "loading" });

        fetchLicenseStatus()
                .then(setLicenseStatus)
                .catch((error) => {
                    setLicenseStatus({
                        kind: "error",
                        message: statusErrorMessage(error) || "시스템 오류가 발생했습니다.",
                    });
                });
    }, []);

    React.useEffect(() => {
        if (!isOpen) return;

        clearSelectedFile();
        setRegisterStatus("idle");
        setRegisterMessage("");
        loadLicenseStatus();
    }, [isOpen, loadLicenseStatus]);

    const closeModal = () => {
        clearSelectedFile();
        setRegisterStatus("idle");
        setRegisterMessage("");
        onClose();
    };

    const registerLicense = async () => {
        if (!licenseFile) {
            setRegisterStatus("error");
            setRegisterMessage("라이선스 파일을 선택해주세요.");
            return;
        }

        setRegisterStatus("registering");
        setRegisterMessage("라이선스를 등록하는 중입니다. 잠시만 기다려주세요.");

        try {
            await registerLicenseFile(licenseFile, licenseStatus.kind === "active");
            setRegisterStatus("success");
            setRegisterMessage("라이선스가 성공적으로 등록되었습니다.");
            clearSelectedFile();
            loadLicenseStatus();
        } catch (error) {
            setRegisterStatus("error");
            setRegisterMessage(`라이선스 등록 중 오류가 발생했습니다: ${statusErrorMessage(error)}`);
        }
    };

    const renderLicenseDescription = () => {
        if (licenseStatus.kind === "loading") {
            return (
                <div className="ct-license-management-modal__description">
                    <Spinner size="sm" aria-label="라이선스 상태 확인 중" />
                    <span>라이선스 상태를 확인하는 중입니다.</span>
                </div>
            );
        }

        if (licenseStatus.kind === "active") {
            return (
                <div className="ct-license-management-modal__description">
                    <CheckCircleIcon className="ct-license-management-modal__icon--success" aria-hidden="true" />
                    <div>
                        <Content component="p">라이선스가 등록되어 있습니다.</Content>
                        <Content component="p"><strong>시작일:</strong> {licenseStatus.issued || "-"}</Content>
                        <Content component="p"><strong>만료일:</strong> {licenseStatus.expired || "-"}</Content>
                        <hr />
                        <Content component="p" className="ct-license-management-modal__muted">
                            새로운 라이선스를 등록하면 기존 라이선스가 교체됩니다.
                        </Content>
                    </div>
                </div>
            );
        }

        if (licenseStatus.kind === "inactive") {
            return (
                <div className="ct-license-management-modal__description">
                    <ExclamationTriangleIcon className="ct-license-management-modal__icon--danger" aria-hidden="true" />
                    <div>
                        <Content component="p" className="ct-license-management-modal__danger-text">
                            등록된 라이선스의 유효기간이 만료되었습니다. 새로운 라이선스를 등록해 주세요.
                        </Content>
                        <Content component="p"><strong>시작일:</strong> {licenseStatus.issued || "-"}</Content>
                        <Content component="p"><strong>만료일:</strong> {licenseStatus.expired || "-"}</Content>
                        <hr />
                        <Content component="p" className="ct-license-management-modal__muted">
                            새로운 라이선스를 등록하면 기존 라이선스가 교체됩니다.
                        </Content>
                    </div>
                </div>
            );
        }

        if (licenseStatus.kind === "missing") {
            return (
                <div className="ct-license-management-modal__description">
                    <ExclamationCircleIcon className="ct-license-management-modal__icon--warning" aria-hidden="true" />
                    <div>
                        <Content component="p">등록된 라이선스가 없습니다.</Content>
                        <Content component="p">라이선스 파일을 선택하여 등록해주세요.</Content>
                    </div>
                </div>
            );
        }

        return (
            <div className="ct-license-management-modal__description">
                <ExclamationTriangleIcon className="ct-license-management-modal__icon--danger" aria-hidden="true" />
                <div>
                    <Content component="p">라이선스 상태 확인 중 오류가 발생했습니다.</Content>
                    <Content component="p">{licenseStatus.message || "시스템 오류가 발생했습니다."}</Content>
                </div>
            </div>
        );
    };

    const renderRegisterMessage = () => {
        if (registerStatus === "idle") {
            return (
                <div
                  className={[
                      "ct-license-management-modal__description",
                      "ct-license-management-modal__description--compact",
                  ].join(" ")}
                >
                    <InfoCircleIcon aria-hidden="true" />
                    <span>라이선스 파일을 선택해주세요.</span>
                </div>
            );
        }

        return (
            <div
              className={[
                  "ct-license-management-modal__register-message",
                  `ct-license-management-modal__register-message--${registerStatus}`,
              ].join(" ")}
            >
                {registerStatus === "registering" && <Spinner size="sm" aria-label="라이선스 등록 중" />}
                <span>{registerMessage}</span>
            </div>
        );
    };

    return (
        <Modal
          isOpen={isOpen}
          onClose={closeModal}
          variant="small"
          aria-label="라이선스 관리"
          className="ct-license-management-modal"
        >
            <ModalHeader title="라이선스 관리" />
            <ModalBody>
                <Form className="ct-license-management-modal__form" isHorizontal>
                    <FormGroup
                      label="라이선스 파일" isRequired
                      fieldId="input-license-file"
                    >
                        <input
                          ref={fileInputRef}
                          className="ct-license-management-modal__file-input"
                          type="file"
                          id="input-license-file"
                          name="input-license-file"
                          accept="*"
                          required
                          onChange={(event) => {
                              setLicenseFile(event.currentTarget.files?.[0] ?? null);
                              setRegisterStatus("idle");
                              setRegisterMessage("");
                          }}
                        />
                    </FormGroup>
                </Form>
                <div className="ct-license-management-modal__status">{renderLicenseDescription()}</div>
                {renderRegisterMessage()}
            </ModalBody>
            <ModalFooter>
                <Button
                  variant="primary"
                  isDisabled={!licenseFile || registerStatus === "registering"}
                  onClick={registerLicense}
                >
                    실행
                </Button>
                <Button variant="link" onClick={closeModal}>
                    취소
                </Button>
            </ModalFooter>
        </Modal>
    );
}
