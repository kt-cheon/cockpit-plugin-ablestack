import React from "react";

import {
    Alert,
    Button,
    Modal,
    ModalBody,
    ModalFooter,
    ModalHeader,
} from "@patternfly/react-core";
import { SecurityIcon } from "@patternfly/react-icons";

import {
    downloadSecurityEvidenceZip,
    fetchLatestSecurityEvidence,
    generateSecurityEvidence,
    type SecurityEvidenceMetadata,
} from "../services/api/security-evidence.ts";

interface SecurityEvidenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCompleted: (message: string) => void;
  clusterType?: ClusterType;
}

type ClusterType =
    | "powerflex"
    | "ablestack-hci"
    | "ablestack-vm"
    | "ablestack-standalone"
    | "ablestack-hci-filesystem";

type SubmitState = "idle" | "loading" | "running" | "downloading" | "success" | "error";

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function formatSize(size: number): string {
    if (!size) return "-";

    const units = ["B", "KiB", "MiB", "GiB"];
    let value = size;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDateTime(value: string): string {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

function evidenceSummary(evidence: SecurityEvidenceMetadata | null) {
    if (!evidence) {
        return "생성된 보안 증적이 없습니다.";
    }

    return `${evidence.filename} · ${formatSize(evidence.size)} · ${formatDateTime(evidence.generatedAt)}`;
}

function evidenceDescription(clusterType: ClusterType): string {
    if (clusterType === "ablestack-hci" || clusterType === "ablestack-hci-filesystem") {
        return "ABLESTACK HCI 환경의 Ablecube 호스트, 스토리지센터 VM(SCVM), 클라우드센터 VM(CCVM)을 대상으로 보안 점검 결과를 수집합니다.";
    }

    if (clusterType === "ablestack-standalone") {
        return "ABLESTACK Standalone 환경의 단일 Ablecube 호스트와 클라우드센터 VM(CCVM)을 대상으로 보안 점검 결과를 수집합니다.";
    }

    return "ABLESTACK-VM 환경의 Ablecube 호스트와 클라우드센터 VM(CCVM)을 대상으로 보안 점검 결과를 수집합니다.";
}

export default function SecurityEvidenceModal({
    isOpen,
    onClose,
    onCompleted,
    clusterType = "ablestack-vm",
}: SecurityEvidenceModalProps) {
    const [latest, setLatest] = React.useState<SecurityEvidenceMetadata | null>(null);
    const [submitState, setSubmitState] = React.useState<SubmitState>("idle");
    const [message, setMessage] = React.useState("");

    React.useEffect(() => {
        if (!isOpen) return;

        let isCurrent = true;

        setLatest(null);
        setSubmitState("loading");
        setMessage("최신 보안 증적 정보를 확인하고 있습니다.");

        fetchLatestSecurityEvidence()
                .then((metadata) => {
                    if (!isCurrent) return;
                    setLatest(metadata);
                    setSubmitState("idle");
                    setMessage(metadata ? "" : "아직 생성된 보안 증적이 없습니다.");
                })
                .catch((error) => {
                    if (!isCurrent) return;
                    setLatest(null);
                    setSubmitState("error");
                    setMessage(errorMessage(error));
                });

        return () => {
            isCurrent = false;
        };
    }, [isOpen]);

    const closeModal = () => {
        if (submitState === "running" || submitState === "downloading") return;
        onClose();
    };

    const createEvidence = async () => {
        setSubmitState("running");
        setMessage("보안 증적을 생성하고 있습니다. 대상 수에 따라 시간이 걸릴 수 있습니다.");

        try {
            const metadata = await generateSecurityEvidence();

            setLatest(metadata);
            setSubmitState("success");
            const nextMessage = `보안 증적 생성 완료: ${evidenceSummary(metadata)}`;
            setMessage(nextMessage);
            onCompleted(nextMessage);
        } catch (error) {
            setSubmitState("error");
            setMessage(errorMessage(error));
        }
    };

    const downloadEvidence = async () => {
        setSubmitState("downloading");
        setMessage("보안 증적 파일을 준비하고 있습니다.");

        try {
            const href = await downloadSecurityEvidenceZip();
            const anchor = document.createElement("a");

            anchor.href = href;
            anchor.download = latest?.filename || "security-evidence.zip";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setSubmitState("success");
            setMessage("보안 증적 다운로드를 시작했습니다.");
        } catch (error) {
            setSubmitState("error");
            setMessage(errorMessage(error));
        }
    };

    const isBusy = submitState === "loading" || submitState === "running" || submitState === "downloading";
    const canDownload = Boolean(latest?.downloadAvailable || latest?.filename);

    return (
        <Modal
          isOpen={isOpen}
          onClose={closeModal}
          variant="medium"
          aria-label="보안 증적"
          className="ct-security-evidence-modal"
        >
            <ModalHeader title="보안 증적" />
            <ModalBody>
                <div className="ct-security-evidence-modal__summary">
                    <span>최신 증적</span>
                    <strong>{evidenceSummary(latest)}</strong>
                    {latest?.collectorWarning && (
                        <p>{latest.collectorWarning}</p>
                    )}
                </div>

                <section className="ct-security-evidence-modal__guide">
                    <div className="ct-security-evidence-modal__guide-icon" aria-hidden="true">
                        <SecurityIcon />
                    </div>
                    <div className="ct-security-evidence-modal__guide-content">
                        <strong>ABLESTACK 보안 증적 패키지</strong>
                        <p>{evidenceDescription(clusterType)}</p>
                        <p>수집된 결과는 검토와 보고에 활용할 수 있도록 세 가지 문서 형식으로 제공합니다.</p>
                        <div className="ct-security-evidence-modal__formats" aria-label="제공 파일 형식">
                            <span>PPTX</span>
                            <span>XLSX</span>
                            <span>TXT</span>
                        </div>
                    </div>
                </section>

                {message && (
                    <Alert
                      className="ct-security-evidence-modal__alert"
                      variant={submitState === "error" ? "danger" : submitState === "success" ? "success" : "info"}
                      title={message}
                      isInline
                    />
                )}
            </ModalBody>
            <ModalFooter>
                <Button
                  variant="primary"
                  isDisabled={isBusy}
                  isLoading={submitState === "running"}
                  spinnerAriaLabel="보안 증적 생성 중"
                  onClick={createEvidence}
                >
                    {submitState === "running" ? "증적 생성 중" : "증적 생성"}
                </Button>
                <Button
                  variant="secondary"
                  isDisabled={isBusy || !canDownload}
                  isLoading={submitState === "downloading"}
                  spinnerAriaLabel="보안 증적 다운로드 중"
                  onClick={downloadEvidence}
                >
                    {submitState === "downloading" ? "다운로드 준비 중" : "다운로드"}
                </Button>
                <Button
                  variant="link"
                  isDisabled={isBusy}
                  onClick={closeModal}
                >
                    닫기
                </Button>
            </ModalFooter>
        </Modal>
    );
}
