import React from "react";
import TaskProgress from "../components/common/TaskProgress";

import {
    Alert,
    Button,
    Form,
    FormGroup,
    Label,
    Modal,
    ModalBody,
    ModalFooter,
    ModalHeader,
    TextInput,
} from "@patternfly/react-core";

import { bootstrapCCVM } from "../services/api/cloud-vm-deploy.ts";
import { requestCubeApi } from "../services/api/client";
import {
    fetchClusterConfigProfile,
    type ClusterConfigProfile,
} from "../services/api/cluster-config.ts";
import {
    defaultMoldBootstrapForm,
    fetchMoldBootstrapJob,
    fetchMoldBootstrapPlan,
    startMoldBootstrap,
    type MoldBootstrapForm,
    type MoldBootstrapJob,
    type MoldBootstrapPlan,
} from "../services/api/mold-bootstrap.ts";

interface CloudResourceConfigureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCompleted: (message: string) => void;
}

type SubmitState = "idle" | "checking" | "running" | "success" | "error";

interface AutoConfigRow {
    label: string;
    value: string;
    mono?: boolean;
}

const STEP_LABELS: Record<string, string> = {
    wait_mold_api_ready: "Mold API 준비 확인",
    login_admin: "관리자 로그인",
    create_zone: "Zone 생성",
    create_physical_network: "Physical Network 생성",
    add_traffic_types: "Traffic Type 구성",
    enable_physical_network: "Physical Network 활성화",
    enable_network_providers: "Network Provider 활성화",
    create_pod: "Pod 생성",
    create_public_ip_range: "Public IP Range 생성",
    create_cluster: "Cluster 생성",
    add_host: "Host 등록",
    add_primary_storage: "Primary Storage 등록",
    add_secondary_storage: "Secondary Storage 등록",
    add_secondary_staging_store: "Secondary Staging Store 등록",
    enable_zone: "Zone 활성화",
    wait_system_vm_running: "System VM 실행 확인",
    final_health_check: "최종 상태 확인",
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function statusLabel(status: string): string {
    switch (status) {
    case "queued":
        return "대기";
    case "running":
        return "진행 중";
    case "succeeded":
        return "완료";
    case "failed":
        return "실패";
    default:
        return status || "대기";
    }
}

function statusColor(status: string): "green" | "orange" | "red" | "grey" | "blue" {
    switch (status) {
    case "succeeded":
        return "green";
    case "running":
        return "blue";
    case "failed":
        return "red";
    case "queued":
    case "pending":
        return "orange";
    default:
        return "grey";
    }
}

function normalizeProductType(profile: ClusterConfigProfile | null): string {
    return profile?.type.trim().toLowerCase() ?? "";
}

function productTypeLabel(profile: ClusterConfigProfile | null): string {
    const type = normalizeProductType(profile);

    return type ? type.toUpperCase() : "cluster.json 확인 중";
}

function isGlueBlockProduct(profile: ClusterConfigProfile | null): boolean {
    return normalizeProductType(profile) === "ablestack-hci";
}

function isSharedMountProduct(profile: ClusterConfigProfile | null): boolean {
    return [
        "ablestack-vm",
        "ablestack-standalone",
        "ablestack-hci-filesystem",
    ].includes(normalizeProductType(profile));
}

function glueMountPath(profile: ClusterConfigProfile | null): string {
    return normalizeProductType(profile) === "ablestack-standalone"
        ? "/mnt/glue"
        : "/mnt/glue-gfs";
}

function scvmMonitorList(profile: ClusterConfigProfile | null): string {
    const hosts = profile?.hosts ?? [];
    const monitors = hosts
            .map((host, index) => `scvm${host.index || index + 1}`)
            .filter(Boolean);

    return monitors.length > 0 ? monitors.join(",") : "cluster.json hosts 확인 필요";
}

function hostUrls(profile: ClusterConfigProfile | null): string[] {
    return (profile?.hosts ?? [])
            .map((host) => host.ablecube.trim())
            .filter(Boolean)
            .map((ip) => `http://${ip}`);
}

function secondaryStorageUrl(profile: ClusterConfigProfile | null): string {
    const ccvmIp = profile?.ccvmIp.trim() ?? "";

    return ccvmIp ? `nfs://${ccvmIp}/nfs/secondary` : "cluster.json ccvm.ip 확인 필요";
}

function primaryStorageRows(profile: ClusterConfigProfile | null, form: MoldBootstrapForm): AutoConfigRow[] {
    if (form.primaryStorageUrl.trim()) return [
        { label: "이름", value: "Primary Storage" },
        { label: "제공자", value: form.primaryStorageProvider || "DefaultPrimary" },
        { label: "URL", value: form.primaryStorageUrl, mono: true },
    ];
    if (!profile) {
        return [{ label: "구성 기준", value: "cluster.json을 확인하고 있습니다." }];
    }

    if (isGlueBlockProduct(profile)) {
        return [
            { label: "이름", value: "Primary Storage" },
            { label: "제공자", value: form.primaryStorageProvider || "DefaultPrimary" },
            { label: "프로토콜", value: "Glue Block" },
            { label: "Glue Block 모니터", value: scvmMonitorList(profile), mono: true },
            { label: "Glue Block 풀", value: "rbd" },
            { label: "Glue Block 사용자", value: "admin" },
            { label: "Glue Block 인증 정보", value: "서버에서 기존 Glue 인증 정보를 조회해 적용" },
        ];
    }

    if (!isSharedMountProduct(profile)) {
        return [
            { label: "제품 타입", value: profile.type || "확인 필요" },
            { label: "Primary Storage", value: "지원 제품 타입을 확인해주세요." },
        ];
    }

    return [
        { label: "이름", value: "Primary Storage" },
        { label: "제공자", value: form.primaryStorageProvider || "DefaultPrimary" },
        { label: "프로토콜", value: "SharedMountPoint" },
        { label: "경로", value: glueMountPath(profile), mono: true },
    ];
}

function secondaryAndHostRows(profile: ClusterConfigProfile | null): AutoConfigRow[] {
    return [
        { label: "Secondary Storage", value: secondaryStorageUrl(profile), mono: true },
        { label: "Physical Network VLAN", value: "1-1" },
        { label: "Host 인증", value: "CCVM Mold 관리 SSH key 사용" },
    ];
}

function updateForm<K extends keyof MoldBootstrapForm>(
    setter: React.Dispatch<React.SetStateAction<MoldBootstrapForm>>,
    key: K,
    value: MoldBootstrapForm[K]
) {
    setter((current) => ({ ...current, [key]: value }));
}

function validate(form: MoldBootstrapForm): string {
    const required: Array<[keyof MoldBootstrapForm, string]> = [
        ["adminUsername", "관리자 계정"],
        ["adminPassword", "관리자 비밀번호"],
        ["dns1", "DNS #1"],
        ["internalDns1", "Internal DNS #1"],
        ["podGateway", "Pod Gateway"],
        ["podNetmask", "Pod Netmask"],
        ["podStartIp", "Pod 시작 IP"],
        ["podEndIp", "Pod 종료 IP"],
        ["publicGateway", "Public Gateway"],
        ["publicNetmask", "Public Netmask"],
        ["publicStartIp", "Public 시작 IP"],
        ["publicEndIp", "Public 종료 IP"],
    ];
    const missing = required.find(([key]) => !String(form[key]).trim());

    return missing ? `${missing[1]} 값을 입력해주세요.` : "";
}

export default function CloudResourceConfigureModal({
    isOpen,
    onClose,
    onCompleted,
}: CloudResourceConfigureModalProps) {
    const [form, setForm] = React.useState<MoldBootstrapForm>(() => defaultMoldBootstrapForm());
    const [plan, setPlan] = React.useState<MoldBootstrapPlan | null>(null);
    const [job, setJob] = React.useState<MoldBootstrapJob | null>(null);
    const [clusterProfile, setClusterProfile] = React.useState<ClusterConfigProfile | null>(null);
    const [clusterProfileError, setClusterProfileError] = React.useState("");
    const [submitState, setSubmitState] = React.useState<SubmitState>("idle");
    const [message, setMessage] = React.useState("");
    const ccvmBootstrapCompleteRef = React.useRef(false);
    const pollTimerRef = React.useRef<number | null>(null);

    React.useEffect(() => {
        if (!isOpen) return;
        let isCurrent = true;

        setForm(defaultMoldBootstrapForm());
        setPlan(null);
        setJob(null);
        setClusterProfile(null);
        setClusterProfileError("");
        setSubmitState("idle");
        setMessage("");
        ccvmBootstrapCompleteRef.current = false;

        fetchClusterConfigProfile()
                .then((profile) => {
                    if (isCurrent) {
                        setClusterProfile(profile);
                    }
                })
                .catch((error) => {
                    if (isCurrent) {
                        setClusterProfileError(errorMessage(error));
                    }
                });

        return () => {
            isCurrent = false;
            if (pollTimerRef.current) {
                window.clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
        };
    }, [isOpen]);

    const closeModal = () => {
        if (submitState === "checking" || submitState === "running") return;
        onClose();
    };

    const ensureCCVMBootstrap = async () => {
        if (ccvmBootstrapCompleteRef.current) return;
        const settings = await requestCubeApi<{val: {bootstrap: {ccvm: string}}}>('/api/v1/cube/system/config');
        if (String(settings.val.bootstrap.ccvm) === 'true') {
            ccvmBootstrapCompleteRef.current = true;
            return;
        }

        setMessage("클라우드센터 가상머신 상세 설정을 진행하고 있습니다.");
        await bootstrapCCVM();
        ccvmBootstrapCompleteRef.current = true;
    };

    const checkPlan = async () => {
        const validationMessage = validate(form);

        if (validationMessage) {
            setSubmitState("error");
            setMessage(validationMessage);
            return null;
        }

        setSubmitState("checking");
        setMessage("클라우드 리소스 구성 계획을 확인하고 있습니다.");

        try {
            setMessage("클라우드 리소스 구성 계획을 확인하고 있습니다.");
            const nextPlan = await fetchMoldBootstrapPlan(form);

            setPlan(nextPlan);
            setSubmitState(nextPlan.ready ? "idle" : "error");
            setMessage(nextPlan.ready
                ? "클라우드 리소스 구성 계획 확인이 완료되었습니다."
                : `누락 입력값이 있습니다: ${nextPlan.missingInputs.join(", ")}`);

            return nextPlan;
        } catch (error) {
            setSubmitState("error");
            setMessage(errorMessage(error));
            return null;
        }
    };

    const pollJob = (jobId: string) => {
        if (pollTimerRef.current) {
            window.clearInterval(pollTimerRef.current);
        }

        pollTimerRef.current = window.setInterval(() => {
            fetchMoldBootstrapJob(jobId)
                    .then((nextJob) => {
                        setJob(nextJob);

                        if (nextJob.status === "succeeded" || nextJob.status === "failed") {
                            if (pollTimerRef.current) {
                                window.clearInterval(pollTimerRef.current);
                                pollTimerRef.current = null;
                            }

                            if (nextJob.status === "succeeded") {
                                const nextMessage = "클라우드 리소스 구성이 완료되었습니다.";

                                setSubmitState("success");
                                setMessage(nextMessage);
                                onCompleted(nextMessage);
                            } else {
                                setSubmitState("error");
                                setMessage(nextJob.message || "클라우드 리소스 구성 Job이 실패했습니다.");
                            }
                        }
                    })
                    .catch((error) => {
                        if (pollTimerRef.current) {
                            window.clearInterval(pollTimerRef.current);
                            pollTimerRef.current = null;
                        }
                        setSubmitState("error");
                        setMessage(errorMessage(error));
                    });
        }, 3000);
    };

    const execute = async () => {
        const readyPlan = plan?.ready ? plan : await checkPlan();

        if (!readyPlan?.ready) return;

        setSubmitState("running");
        setMessage("클라우드 리소스 구성 Job을 시작하고 있습니다.");
        setJob(null);

        try {
            await ensureCCVMBootstrap();
            setMessage("클라우드 리소스 구성 Job을 시작하고 있습니다.");
            const startedJob = await startMoldBootstrap(form);

            setJob(startedJob);
            setMessage("클라우드 리소스 구성 Job이 시작되었습니다.");
            pollJob(startedJob.jobId);
        } catch (error) {
            setSubmitState("error");
            setMessage(errorMessage(error));
        }
    };

    const isBusy = submitState === "checking" || submitState === "running";
    const clusterHostUrls = hostUrls(clusterProfile);

    return (
        <Modal
          isOpen={isOpen}
          onClose={closeModal}
          variant="large"
          aria-label="클라우드 리소스 구성"
          className="ct-cloud-resource-modal"
        >
            <ModalHeader title="클라우드 리소스 구성" />
            <ModalBody>
                <TaskProgress />
                <Form>
                    <FormGroup label="주 스토리지 URL (비워 두면 기존 구성 사용)" fieldId="mold-primary-url">
                        <TextInput id="mold-primary-url" value={form.primaryStorageUrl}
                          onChange={(_event, value) => updateForm(setForm, "primaryStorageUrl", value)} />
                    </FormGroup>
                    <FormGroup label="주 스토리지 제공자" fieldId="mold-primary-provider">
                        <TextInput id="mold-primary-provider" value={form.primaryStorageProvider}
                          onChange={(_event, value) => updateForm(setForm, "primaryStorageProvider", value)} />
                    </FormGroup>
                </Form>
                <Form className="ct-cloud-resource-modal__form">
                    <div className="ct-cloud-resource-modal__section">
                        <h3>관리자 접속</h3>
                        <div className="ct-cloud-resource-modal__grid">
                            <FormGroup
                              label="관리자 계정" isRequired
                              fieldId="mold-admin-username"
                            >
                                <TextInput
                                  id="mold-admin-username" value={form.adminUsername}
                                  onChange={(_event, value) => updateForm(setForm, "adminUsername", value)}
                                />
                            </FormGroup>
                            <FormGroup
                              label="관리자 비밀번호" isRequired
                              fieldId="mold-admin-password"
                            >
                                <TextInput
                                  id="mold-admin-password" type="password"
                                  value={form.adminPassword}
                                  onChange={(_event, value) => updateForm(setForm, "adminPassword", value)}
                                />
                            </FormGroup>
                            <FormGroup label="도메인" fieldId="mold-admin-domain">
                                <TextInput
                                  id="mold-admin-domain" value={form.adminDomain}
                                  onChange={(_event, value) => updateForm(setForm, "adminDomain", value)}
                                />
                            </FormGroup>
                        </div>
                    </div>

                    <div className="ct-cloud-resource-modal__section">
                        <h3>Zone</h3>
                        <div className="ct-cloud-resource-modal__grid">
                            <FormGroup label="Zone 이름" fieldId="mold-zone-name">
                                <TextInput
                                  id="mold-zone-name" value={form.zoneName}
                                  onChange={(_event, value) => updateForm(setForm, "zoneName", value)}
                                />
                            </FormGroup>
                            <FormGroup
                              label="DNS #1" isRequired
                              fieldId="mold-dns1"
                            >
                                <TextInput
                                  id="mold-dns1" value={form.dns1}
                                  onChange={(_event, value) => updateForm(setForm, "dns1", value)}
                                />
                            </FormGroup>
                            <FormGroup label="DNS #2" fieldId="mold-dns2">
                                <TextInput
                                  id="mold-dns2" value={form.dns2}
                                  onChange={(_event, value) => updateForm(setForm, "dns2", value)}
                                />
                            </FormGroup>
                            <FormGroup
                              label="Internal DNS #1" isRequired
                              fieldId="mold-internal-dns1"
                            >
                                <TextInput
                                  id="mold-internal-dns1" value={form.internalDns1}
                                  onChange={(_event, value) => updateForm(setForm, "internalDns1", value)}
                                />
                            </FormGroup>
                            <FormGroup label="Internal DNS #2" fieldId="mold-internal-dns2">
                                <TextInput
                                  id="mold-internal-dns2" value={form.internalDns2}
                                  onChange={(_event, value) => updateForm(setForm, "internalDns2", value)}
                                />
                            </FormGroup>
                            <FormGroup label="Guest CIDR" fieldId="mold-guest-cidr">
                                <TextInput
                                  id="mold-guest-cidr" value={form.guestCidr}
                                  onChange={(_event, value) => updateForm(setForm, "guestCidr", value)}
                                />
                            </FormGroup>
                        </div>
                    </div>

                    <div className="ct-cloud-resource-modal__section">
                        <h3>Pod / Public IP</h3>
                        <div className="ct-cloud-resource-modal__grid">
                            <FormGroup label="Pod 이름" fieldId="mold-pod-name">
                                <TextInput
                                  id="mold-pod-name" value={form.podName}
                                  onChange={(_event, value) => updateForm(setForm, "podName", value)}
                                />
                            </FormGroup>
                            <FormGroup
                              label="Pod Gateway" isRequired
                              fieldId="mold-pod-gateway"
                            >
                                <TextInput
                                  id="mold-pod-gateway" value={form.podGateway}
                                  onChange={(_event, value) => updateForm(setForm, "podGateway", value)}
                                />
                            </FormGroup>
                            <FormGroup
                              label="Pod Netmask" isRequired
                              fieldId="mold-pod-netmask"
                            >
                                <TextInput
                                  id="mold-pod-netmask" value={form.podNetmask}
                                  onChange={(_event, value) => updateForm(setForm, "podNetmask", value)}
                                />
                            </FormGroup>
                            <FormGroup
                              label="Pod 시작 IP" isRequired
                              fieldId="mold-pod-start"
                            >
                                <TextInput
                                  id="mold-pod-start" value={form.podStartIp}
                                  onChange={(_event, value) => updateForm(setForm, "podStartIp", value)}
                                />
                            </FormGroup>
                            <FormGroup
                              label="Pod 종료 IP" isRequired
                              fieldId="mold-pod-end"
                            >
                                <TextInput
                                  id="mold-pod-end" value={form.podEndIp}
                                  onChange={(_event, value) => updateForm(setForm, "podEndIp", value)}
                                />
                            </FormGroup>
                            <FormGroup
                              label="Public Gateway" isRequired
                              fieldId="mold-public-gateway"
                            >
                                <TextInput
                                  id="mold-public-gateway" value={form.publicGateway}
                                  onChange={(_event, value) => updateForm(setForm, "publicGateway", value)}
                                />
                            </FormGroup>
                            <FormGroup
                              label="Public Netmask" isRequired
                              fieldId="mold-public-netmask"
                            >
                                <TextInput
                                  id="mold-public-netmask" value={form.publicNetmask}
                                  onChange={(_event, value) => updateForm(setForm, "publicNetmask", value)}
                                />
                            </FormGroup>
                            <FormGroup
                              label="Public 시작 IP" isRequired
                              fieldId="mold-public-start"
                            >
                                <TextInput
                                  id="mold-public-start" value={form.publicStartIp}
                                  onChange={(_event, value) => updateForm(setForm, "publicStartIp", value)}
                                />
                            </FormGroup>
                            <FormGroup
                              label="Public 종료 IP" isRequired
                              fieldId="mold-public-end"
                            >
                                <TextInput
                                  id="mold-public-end" value={form.publicEndIp}
                                  onChange={(_event, value) => updateForm(setForm, "publicEndIp", value)}
                                />
                            </FormGroup>
                        </div>
                    </div>

                    <div className="ct-cloud-resource-modal__section">
                        <h3>Cluster</h3>
                        <div className="ct-cloud-resource-modal__grid">
                            <FormGroup label="Physical Network 이름" fieldId="mold-physical-name">
                                <TextInput
                                  id="mold-physical-name" value={form.physicalNetworkName}
                                  onChange={(_event, value) => updateForm(setForm, "physicalNetworkName", value)}
                                />
                            </FormGroup>
                            <FormGroup label="Network Speed" fieldId="mold-network-speed">
                                <TextInput
                                  id="mold-network-speed" value={form.networkSpeed}
                                  onChange={(_event, value) => updateForm(setForm, "networkSpeed", value)}
                                />
                            </FormGroup>
                            <FormGroup label="Cluster 이름" fieldId="mold-cluster-name">
                                <TextInput
                                  id="mold-cluster-name" value={form.clusterName}
                                  onChange={(_event, value) => updateForm(setForm, "clusterName", value)}
                                />
                            </FormGroup>
                        </div>
                    </div>

                    <div className="ct-cloud-resource-modal__section ct-cloud-resource-modal__auto-summary">
                        <div className="ct-cloud-resource-modal__section-head">
                            <h3>cluster.json 자동 구성</h3>
                            <Label color={clusterProfileError ? "red" : clusterProfile ? "blue" : "grey"}>
                                {clusterProfileError ? "확인 필요" : productTypeLabel(clusterProfile)}
                            </Label>
                        </div>
                        <p className="ct-cloud-resource-modal__section-note">
                            Primary Storage, Secondary Storage, Host, VLAN은 API가 cluster.json과 CCVM SSH key를
                            기준으로 자동 구성합니다.
                        </p>
                        {clusterProfileError && (
                            <Alert
                              className="ct-cloud-resource-modal__inline-alert"
                              variant="warning"
                              title={clusterProfileError}
                              isInline
                            />
                        )}
                        <div className="ct-cloud-resource-modal__auto-grid">
                            <section className="ct-cloud-resource-modal__auto-card">
                                <strong>Primary Storage</strong>
                                <dl className="ct-cloud-resource-modal__kv-list">
                                    {primaryStorageRows(clusterProfile, form).map((row) => (
                                        <div
                                          key={`primary-${row.label}`}
                                          className={row.mono
                                              ? "ct-cloud-resource-modal__kv ct-cloud-resource-modal__kv--mono"
                                              : "ct-cloud-resource-modal__kv"}
                                        >
                                            <dt>{row.label}</dt>
                                            <dd>{row.value}</dd>
                                        </div>
                                    ))}
                                </dl>
                            </section>
                            <section className="ct-cloud-resource-modal__auto-card">
                                <strong>Secondary / Host</strong>
                                <dl className="ct-cloud-resource-modal__kv-list">
                                    {secondaryAndHostRows(clusterProfile).map((row) => (
                                        <div
                                          key={`secondary-${row.label}`}
                                          className={row.mono
                                              ? "ct-cloud-resource-modal__kv ct-cloud-resource-modal__kv--mono"
                                              : "ct-cloud-resource-modal__kv"}
                                        >
                                            <dt>{row.label}</dt>
                                            <dd>{row.value}</dd>
                                        </div>
                                    ))}
                                </dl>
                                <div className="ct-cloud-resource-modal__host-list" aria-label="Mold Host URL">
                                    {clusterHostUrls.length > 0
                                        ? clusterHostUrls.map((url) => (
                                            <span key={url} className="ct-cloud-resource-modal__host-chip">
                                                {url}
                                            </span>
                                        ))
                                        : (
                                            <span className="ct-cloud-resource-modal__host-empty">
                                                cluster.json hosts 확인 필요
                                            </span>
                                        )}
                                </div>
                            </section>
                        </div>
                    </div>
                </Form>

                {plan && (
                    <div className="ct-cloud-resource-modal__plan">
                        <div className="ct-cloud-resource-modal__plan-head">
                            <strong>실행 계획</strong>
                            <Label color={plan.ready ? "green" : "orange"}>{plan.ready ? "실행 가능" : "입력 확인 필요"}</Label>
                        </div>
                        <div className="ct-cloud-resource-modal__step-list">
                            {plan.steps.map((step) => (
                                <div key={step.name} className="ct-cloud-resource-modal__step">
                                    <strong>{STEP_LABELS[step.name] ?? step.name}</strong>
                                    <span>{step.command || step.verifyCommand || "-"}</span>
                                    {step.missingInputs.length > 0 && (
                                        <small>누락: {step.missingInputs.join(", ")}</small>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {job && (
                    <div className="ct-cloud-resource-modal__job">
                        <div className="ct-cloud-resource-modal__plan-head">
                            <strong>Job {job.jobId}</strong>
                            <Label color={statusColor(job.status)}>{statusLabel(job.status)}</Label>
                        </div>
                        <div className="ct-cloud-resource-modal__step-list">
                            {job.steps.map((step) => (
                                <div key={step.name} className="ct-cloud-resource-modal__job-step">
                                    <Label color={statusColor(step.status)}>{statusLabel(step.status)}</Label>
                                    <strong>{STEP_LABELS[step.name] ?? step.name}</strong>
                                    <span>{step.message || step.command || "-"}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {message && (
                    <Alert
                      className="ct-cloud-resource-modal__alert"
                      variant={submitState === "error" ? "danger" : submitState === "success" ? "success" : "info"}
                      title={message}
                      isInline
                    />
                )}
            </ModalBody>
            <ModalFooter>
                <Button
                  variant="secondary" isDisabled={isBusy}
                  onClick={checkPlan}
                >
                    계획 확인
                </Button>
                <Button
                  variant="primary" isDisabled={isBusy}
                  isLoading={submitState === "running"}
                  spinnerAriaLabel="클라우드 리소스 구성 중"
                  onClick={execute}
                >
                    {submitState === "running" ? "구성 중" : "구성"}
                </Button>
                <Button
                  variant="link" isDisabled={isBusy}
                  onClick={closeModal}
                >
                    닫기
                </Button>
            </ModalFooter>
        </Modal>
    );
}
