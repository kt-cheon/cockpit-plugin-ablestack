import React from "react";
import TaskProgress from "../components/common/TaskProgress";
import {
  Alert,
  Modal,
  Wizard,
  WizardStep,
  Title,
  Content,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Radio,
  Switch,
  TextInput,
  TextArea,
  Button,
  Label,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
} from "@patternfly/react-core";
import { CheckCircleIcon, InfoCircleIcon } from "@patternfly/react-icons";
import cockpit from "cockpit";

import ValidationErrorModal from "../components/common/ValidationErrorModal";
import RegistrationInput from "../components/common/RegistrationInput";
import FileAttachControl, { type FileAttachControlProps } from "../components/common/FileAttachControl";
import ClusterManagementNetworkHelp from "../components/common/ClusterManagementNetworkHelp";
import RegistrationDownloads from "../components/common/RegistrationDownloads";
import WizardStepStatusLabel, { wizardStatusRowClass } from "../components/common/WizardStepStatus";
import {
  fetchDeployRunJobs,
  startDeployRun,
  type DeployRunJob,
  type DeployRunStepResult,
} from "../services/api/deploy-status.ts";
import {
  downloadSSHKeyBundle,
  generateSSHKeyFiles,
  uploadSSHKeyBundle,
  type SSHKeyBundleDownload,
} from "../services/api/ssh-key.ts";
import { fetchCurrentHostIp, fetchCurrentHostname } from "../services/host";
import { useUiFeatures } from "../hooks/useUiFeatures";
import { isClusterTypeVisible } from "../services/api/system-config";
import "./cluster-config-prepare-wizard.scss";
import {
  duplicateMessage,
  firstError,
  isHostAddress,
  isIntegerInRange,
  isIpv4,
  optionalIpv4,
  requireClusterJsonFileName,
  requireHostname,
  requireIpv4,
  requireValue,
} from "./validation";

type ClusterType = "powerflex" | "ablestack-hci" | "ablestack-vm" | "ablestack-standalone" | "ablestack-hci-filesystem";
type PcsNodeIpSource = "ablecube" | "ablecubePn";
type RadioValue = "new" | "existing";
type HostMode = "new" | "add";
type HostRole = "master" | "second" | "other";
type DeployPhase = "idle" | "running" | "success" | "error";
type SSHKeyPreviewStatus = "empty" | "loading" | "ready" | "error";

interface ClusterHostRow {
  hostName: string;
  hostIp: string;
  storageIp: string;
  scvmMgmtIp: string;
  hostPnIp: string;
  scvmPnIp: string;
  scvmCnIp: string;
}

interface ClusterProgressRow {
  id: string;
  label: string;
  status: string;
  message?: string;
}

interface ClusterApplyTargetResult {
  target: string;
  code: string;
  message: string;
  isFailed: boolean;
}

interface SSHKeyPreview {
  status: SSHKeyPreviewStatus;
  privateKey: string;
  publicKey: string;
  message: string;
}

interface ClusterConfigPrepareWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCompleted?: () => void;
}

const DEFAULT_HOSTS: ClusterHostRow[] = [
  {
    hostName: "",
    hostIp: "",
    storageIp: "",
    scvmMgmtIp: "",
    hostPnIp: "",
    scvmPnIp: "",
    scvmCnIp: "",
  },
  {
    hostName: "",
    hostIp: "",
    storageIp: "",
    scvmMgmtIp: "",
    hostPnIp: "",
    scvmPnIp: "",
    scvmCnIp: "",
  },
  {
    hostName: "",
    hostIp: "",
    storageIp: "",
    scvmMgmtIp: "",
    hostPnIp: "",
    scvmPnIp: "",
    scvmCnIp: "",
  },
];

const SSH_KEY_BUNDLE_MAGIC = [0x41, 0x53, 0x4b, 0x31];
const SSH_KEY_ENCRYPTION_CONTEXT = "ablestack-api:ssh-key-bundle:v1";
const SSH_KEY_BUNDLE_DEFAULT_SECRET = "ablestack-api-ssh-key-bundle-default-secret-v1";
const CLUSTER_JSON_DOWNLOAD_PATHS = [
  "/etc/ablestack/properties/cluster.json",
  "/etc/ablestack/cluster.json",
];
const EMPTY_SSH_KEY_PREVIEW: SSHKeyPreview = {
  status: "empty",
  privateKey: "",
  publicKey: "",
  message: "SSH KEY .dat 파일을 선택하면 id_rsa와 id_rsa.pub 내용을 확인할 수 있습니다.",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function findJobStep(job: DeployRunJob | null, name: string): DeployRunStepResult | undefined {
  return job?.steps.find((step) => step.name === name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function outputText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function normalizeClusterType(value: unknown): ClusterType | null {
  const normalized = outputText(value).toLowerCase().replace(/_/g, "-");

  if (normalized.includes("powerflex")) return "powerflex";
  if (normalized.includes("filesystem")) return "ablestack-hci-filesystem";
  if (normalized.includes("standalone")) return "ablestack-standalone";
  if (normalized.includes("hci")) return "ablestack-hci";
  if (normalized.includes("vm")) return "ablestack-vm";
  return null;
}

function isTrueLike(value: unknown): boolean {
  const normalized = outputText(value).toLowerCase();

  return ["true", "1", "yes", "y", "on", "enabled", "사용"].includes(normalized);
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(outputText).filter(Boolean);
  const text = outputText(value);

  return text ? [text] : [];
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return window.btoa(binary);
}

function binaryDownloadHref(buffer: ArrayBuffer): string {
  return `data:application/octet-stream;base64,${arrayBufferToBase64(buffer)}`;
}

function uint32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function uint16LE(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

async function inflateZipPayload(data: Uint8Array): Promise<Uint8Array> {
  const DecompressionStreamCtor = (globalThis as unknown as {
    DecompressionStream?: new (format: string) => DecompressionStream;
  }).DecompressionStream;

  if (!DecompressionStreamCtor) {
    throw new Error("현재 브라우저에서 zip 압축 미리보기를 지원하지 않습니다.");
  }

  const inflate = async (format: string) => {
    const stream = new Blob([new Uint8Array(data).buffer]).stream().pipeThrough(new DecompressionStreamCtor(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };

  try {
    return await inflate("deflate-raw");
  } catch {
    return inflate("deflate");
  }
}

async function extractSSHKeyZipFiles(zipBytes: Uint8Array): Promise<Record<string, string>> {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let eocdOffset = -1;

  for (let offset = zipBytes.length - 22; offset >= 0; offset -= 1) {
    if (uint32LE(view, offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new Error("SSH KEY 파일 내부 zip 구조를 확인할 수 없습니다.");
  }

  const entries = uint16LE(view, eocdOffset + 10);
  let centralOffset = uint32LE(view, eocdOffset + 16);
  const files: Record<string, string> = {};

  for (let index = 0; index < entries; index += 1) {
    if (uint32LE(view, centralOffset) !== 0x02014b50) {
      throw new Error("SSH KEY 파일 내부 zip 항목을 확인할 수 없습니다.");
    }

    const method = uint16LE(view, centralOffset + 10);
    const compressedSize = uint32LE(view, centralOffset + 20);
    const fileNameLength = uint16LE(view, centralOffset + 28);
    const extraLength = uint16LE(view, centralOffset + 30);
    const commentLength = uint16LE(view, centralOffset + 32);
    const localOffset = uint32LE(view, centralOffset + 42);
    const fileName = decodeText(zipBytes.slice(centralOffset + 46, centralOffset + 46 + fileNameLength));

    if (fileName === "id_rsa" || fileName === "id_rsa.pub") {
      const localFileNameLength = uint16LE(view, localOffset + 26);
      const localExtraLength = uint16LE(view, localOffset + 28);
      const dataOffset = localOffset + 30 + localFileNameLength + localExtraLength;
      const compressedData = zipBytes.slice(dataOffset, dataOffset + compressedSize);
      const plainData = method === 0
        ? compressedData
        : method === 8
          ? await inflateZipPayload(compressedData)
          : null;

      if (!plainData) {
        throw new Error(`${fileName} 압축 형식을 확인할 수 없습니다.`);
      }

      files[fileName] = decodeText(plainData);
    }

    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return files;
}

async function parseSSHKeyBundle(buffer: ArrayBuffer): Promise<Pick<SSHKeyPreview, "privateKey" | "publicKey">> {
  const bytes = new Uint8Array(buffer);

  if (bytes.length <= SSH_KEY_BUNDLE_MAGIC.length + 12) {
    throw new Error("SSH KEY 파일 크기가 올바르지 않습니다.");
  }
  if (!SSH_KEY_BUNDLE_MAGIC.every((magicByte, index) => bytes[index] === magicByte)) {
    throw new Error("ABLESTACK SSH KEY .dat 파일 형식이 아닙니다.");
  }
  if (!crypto.subtle) {
    throw new Error("현재 브라우저에서 SSH KEY 파일 복호화를 지원하지 않습니다.");
  }

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${SSH_KEY_ENCRYPTION_CONTEXT}\0${SSH_KEY_BUNDLE_DEFAULT_SECRET}`)
  );
  const key = await crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["decrypt"]);
  const nonce = bytes.slice(SSH_KEY_BUNDLE_MAGIC.length, SSH_KEY_BUNDLE_MAGIC.length + 12);
  const ciphertext = bytes.slice(SSH_KEY_BUNDLE_MAGIC.length + 12);
  const zipPayload = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: encoder.encode(SSH_KEY_ENCRYPTION_CONTEXT),
    },
    key,
    ciphertext
  );
  const files = await extractSSHKeyZipFiles(new Uint8Array(zipPayload));

  return {
    privateKey: files.id_rsa || "",
    publicKey: files["id_rsa.pub"] || "",
  };
}

function parseClusterConfigFile(text: string) {
  const parsed = JSON.parse(text) as unknown;
  const root = isRecord(parsed) ? parsed : {};
  const clusterConfig = isRecord(root.clusterConfig)
    ? root.clusterConfig
    : root;

  if (!isRecord(clusterConfig)) {
    throw new Error("clusterConfig block not found");
  }

  const rootSecurity = isRecord(root.security) ? root.security : {};
  const clusterSecurity = isRecord(clusterConfig.security) ? clusterConfig.security : {};
  const rawHosts = Array.isArray(clusterConfig.hosts) ? clusterConfig.hosts.filter(isRecord) : [];
  const hostRows: ClusterHostRow[] = rawHosts.map((host) => {
    const ablecubePn = outputText(host.ablecubePn);

    return {
      hostName: outputText(host.hostname),
      hostIp: outputText(host.ablecube),
      storageIp: ablecubePn,
      scvmMgmtIp: outputText(host.scvmMngt),
      hostPnIp: ablecubePn,
      scvmPnIp: outputText(host.scvm),
      scvmCnIp: outputText(host.scvmCn),
    };
  });
  const ccvm = isRecord(clusterConfig.ccvm) ? clusterConfig.ccvm : {};
  const mngtNic = isRecord(clusterConfig.mngtNic) ? clusterConfig.mngtNic : {};
  const explicitTimeServers = stringList(clusterConfig.timeServers);
  const hostTimeServers = hostRows.map((host) => host.hostIp || host.hostName).filter(Boolean);
  const pcsCluster = isRecord(clusterConfig.pcsCluster) ? clusterConfig.pcsCluster : {};
  const pcsClusterAddresses = (() => {
    const arrayValues = Array.isArray(pcsCluster.hostnames)
      ? pcsCluster.hostnames
      : Array.isArray(pcsCluster.hosts)
        ? pcsCluster.hosts
        : null;

    if (arrayValues) return arrayValues.map(outputText).filter(Boolean);

    return Object.entries(pcsCluster)
      .map(([key, value]) => {
        const match = /^hostname(\d+)$/.exec(key);
        return match ? { index: Number(match[1]), value: outputText(value) } : null;
      })
      .filter((item): item is { index: number; value: string } => Boolean(item?.value))
      .sort((left, right) => left.index - right.index)
      .map((item) => item.value);
  })();
  const pcsNodeIpSource: PcsNodeIpSource = pcsClusterAddresses.length > 0 &&
    pcsClusterAddresses.every((address, index) => address === hostRows[index]?.hostIp)
    ? "ablecube"
    : "ablecubePn";

  return {
    clusterType: normalizeClusterType(clusterConfig.type),
    hostRows,
    pcsNodeIpSource,
    ccvmMgmtIp: outputText(ccvm.ip),
    mgmtCidr: outputText(mngtNic.cidr) || outputText(ccvm.cidr),
    mgmtGateway: outputText(mngtNic.gw) || outputText(ccvm.gw),
    mgmtDns: outputText(mngtNic.dns) || outputText(ccvm.dns),
    externalTimeServer: outputText(clusterConfig.external_timeserver) || outputText(clusterConfig.extenal_timeserver),
    isIscsiExclusive: isTrueLike(clusterConfig.storage_network) ||
      isTrueLike(clusterConfig.storageNetwork) ||
      isTrueLike(clusterConfig.iscsi_storage) ||
      isTrueLike(clusterConfig.iscsiStorageExclusive),
    timeServer1: explicitTimeServers[0] || hostTimeServers[0] || "",
    timeServer2: explicitTimeServers[1] || hostTimeServers[1] || "",
    internalToken: outputText(rootSecurity.internal_token) || outputText(clusterSecurity.internal_token),
  };
}

function clusterApplyTargetResults(job: DeployRunJob | null): ClusterApplyTargetResult[] {
  const output = findJobStep(job, "cluster_apply")?.output;

  if (!isRecord(output) || !Array.isArray(output.results)) return [];

  return output.results
    .filter(isRecord)
    .map((result) => {
      const code = outputText(result.code);

      return {
        target: outputText(result.target) || "unknown",
        code: code || "-",
        message: outputText(result.message) || "결과 메시지가 없습니다.",
        isFailed: code !== "200",
      };
    });
}

function clusterStepStatus(job: DeployRunJob | null, phase: DeployPhase): string {
  const step = findJobStep(job, "cluster_apply");

  if (step?.status) return step.status;
  if (phase === "running" && job) return "running";
  if (phase === "error" && job) return "failed";
  return "pending";
}

function progressLabel(status: string) {
  return <WizardStepStatusLabel status={status} />;
}

export default function ClusterConfigPrepareWizardModal({
  isOpen,
  onClose,
  onCompleted,
}: ClusterConfigPrepareWizardModalProps) {
  const uiFeatures = useUiFeatures(isOpen);
  const [registration, setRegistration] = React.useState<Record<string, unknown> | null>(null);
  const [clusterType, setClusterType] = React.useState<ClusterType>("ablestack-hci");
  const [sshKeyMode, setSshKeyMode] = React.useState<RadioValue>("new");
  const [clusterHostMode, setClusterHostMode] = React.useState<HostMode>("new");
  const [hostsFileMode, setHostsFileMode] = React.useState<RadioValue>("new");
  const [hosts, setHosts] = React.useState<ClusterHostRow[]>(DEFAULT_HOSTS);
  const [hostCount, setHostCount] = React.useState(3);
	const [existingHostCount, setExistingHostCount] = React.useState(0);
  const [pcsNodeIpSource, setPcsNodeIpSource] = React.useState<PcsNodeIpSource>("ablecubePn");
  const [isIscsiExclusive, setIsIscsiExclusive] = React.useState(false);
  const [currentHostname, setCurrentHostname] = React.useState("");
  const [currentHostIp, setCurrentHostIp] = React.useState("");
  const [ccvmMgmtIp, setCcvmMgmtIp] = React.useState("");
  const [mgmtCidr, setMgmtCidr] = React.useState("");
  const [mgmtGateway, setMgmtGateway] = React.useState("");
  const [mgmtDns, setMgmtDns] = React.useState("");
  const [securityInternalToken, setSecurityInternalToken] = React.useState("");
  const [hostsFileText, setHostsFileText] = React.useState("");
  const [sshKeyText, setSshKeyText] = React.useState("");
  const [sshKeyFilename, setSshKeyFilename] = React.useState("");
  const [sshKeyPreview, setSshKeyPreview] = React.useState<SSHKeyPreview>(EMPTY_SSH_KEY_PREVIEW);
  const [sshKeyBundleHref, setSshKeyBundleHref] = React.useState("");
  const [sshKeyBundleBuffer, setSshKeyBundleBuffer] = React.useState<ArrayBuffer | null>(null);
  const [hostsFilename, setHostsFilename] = React.useState("");
  const [hostRole, setHostRole] = React.useState<HostRole>("master");
  const [externalTimeServer, setExternalTimeServer] = React.useState("");
  const [timeServer1, setTimeServer1] = React.useState("");
  const [timeServer2, setTimeServer2] = React.useState("");
  const [ipmiIp, setIpmiIp] = React.useState("");
  const [ipmiUser, setIpmiUser] = React.useState("");
  const [ipmiPassword, setIpmiPassword] = React.useState("");
  const [reviewOpen, setReviewOpen] = React.useState({
    clusterType: true,
    sshKey: true,
    clusterConfig: true,
    timeServer: true,
  });
  const [validationMessage, setValidationMessage] = React.useState("");
  const [deployPhase, setDeployPhase] = React.useState<DeployPhase>("idle");
  const [deployMessage, setDeployMessage] = React.useState("");
  const [deployJob, setDeployJob] = React.useState<DeployRunJob | null>(null);
  const [deployJobId, setDeployJobId] = React.useState("");
  const [clusterJsonDownloadHref, setClusterJsonDownloadHref] = React.useState("");
  const [clusterJsonDownloadError, setClusterJsonDownloadError] = React.useState("");
  const sshKeyFileInputRef = React.useRef<HTMLInputElement>(null);
  const clusterConfigFileInputRef = React.useRef<HTMLInputElement>(null);
  const deployNextStepRef = React.useRef<(() => void) | null>(null);

  const applyCurrentHostname = React.useCallback((hostname: string) => {
    if (!hostname) return;
    setCurrentHostname(hostname);
  }, []);

  const applyCurrentHostIp = React.useCallback((hostIp: string) => {
    if (!hostIp) return;
    setCurrentHostIp(hostIp);
    setTimeServer1((prev) => prev || hostIp);
  }, []);

  const resetState = React.useCallback(() => {
    setRegistration(null);
    setClusterType("ablestack-hci");
    setSshKeyMode("new");
    setClusterHostMode("new");
    setHostsFileMode("new");
    setHosts(DEFAULT_HOSTS);
    setHostCount(3);
	setExistingHostCount(0);
    setPcsNodeIpSource("ablecubePn");
    setIsIscsiExclusive(false);
    setCurrentHostname("");
    setCurrentHostIp("");
    setCcvmMgmtIp("");
    setMgmtCidr("");
    setMgmtGateway("");
    setMgmtDns("");
    setSecurityInternalToken("");
    setHostsFileText("");
    setSshKeyText("");
    setSshKeyFilename("");
    setSshKeyPreview(EMPTY_SSH_KEY_PREVIEW);
    setSshKeyBundleHref("");
    setSshKeyBundleBuffer(null);
    setHostsFilename("");
    setHostRole("master");
    setExternalTimeServer("");
    setTimeServer1("");
    setTimeServer2("");
    setIpmiIp("");
    setIpmiUser("");
    setIpmiPassword("");
    setValidationMessage("");
    setDeployPhase("idle");
    setDeployMessage("");
    setDeployJob(null);
    setDeployJobId("");
    setClusterJsonDownloadHref("");
    setClusterJsonDownloadError("");
    fetchCurrentHostname()
      .then(applyCurrentHostname)
      .catch(() => undefined);
    fetchCurrentHostIp()
      .then(applyCurrentHostIp)
      .catch(() => undefined);
  }, [applyCurrentHostIp, applyCurrentHostname]);

  const handleClose = () => {
    onClose();
    resetState();
  };

  React.useEffect(() => {
    if (hostsFileMode !== "existing") setRegistration(null);
  }, [hostsFileMode]);

  React.useEffect(() => {
    if (!isOpen) return;

    fetchCurrentHostname()
      .then(applyCurrentHostname)
      .catch(() => undefined);
    fetchCurrentHostIp()
      .then(applyCurrentHostIp)
      .catch(() => undefined);
  }, [applyCurrentHostIp, applyCurrentHostname, isOpen]);

  React.useEffect(() => {
    if (hostsFileMode === "existing" && hostsFileText.trim()) return;

    if (clusterType === "ablestack-standalone") {
      setClusterHostMode("new");
      setHostsFileMode("new");
      setIsIscsiExclusive(false);
      updateHostCount(1);
      return;
    }

    if (clusterType === "ablestack-vm") {
      updateHostCount(1);
      return;
    }

    setIsIscsiExclusive(false);
    updateHostCount(Math.max(3, hostCount));
  // hostCount/hostsFileMode 변경까지 의존성에 포함하면 사용자가 +/- 조작 시 다시 보정되어 불편해지므로 clusterType 변화에만 반응합니다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterType]);

  const updateHostCount = (nextCount: number) => {
    const minCount = clusterType === "powerflex" || clusterType === "ablestack-hci" || clusterType === "ablestack-hci-filesystem" ? 3 : 1;
    const maxCount = clusterType === "ablestack-standalone" ? 1 : 99;
    const safeCount = Math.max(minCount, Math.min(maxCount, nextCount));
    setHostCount(safeCount);
    setHosts((prev) => {
      if (safeCount === prev.length) return prev;
      if (safeCount < prev.length) return prev.slice(0, safeCount);
      const extras = Array.from({ length: safeCount - prev.length }, (_, idx) => ({
        hostName: "",
        hostIp: "",
        storageIp: "",
        scvmMgmtIp: "",
        hostPnIp: "",
        scvmPnIp: "",
        scvmCnIp: "",
      }));
      return [...prev, ...extras];
    });
  };

  const updateHost = (index: number, key: keyof ClusterHostRow, value: string) => {
    setHosts((prev) => prev.map((host, hostIndex) => (
      hostIndex === index ? { ...host, [key]: value } : host
    )));
  };

  const applySSHKeyPreview = React.useCallback((privateKey: string, publicKey: string) => {
    setSshKeyText([
      "----- id_rsa -----",
      privateKey,
      "----- id_rsa.pub -----",
      publicKey,
    ].join("\n"));
    setSshKeyPreview({
      status: privateKey && publicKey ? "ready" : "error",
      privateKey,
      publicKey,
      message: privateKey && publicKey
        ? "id_rsa와 id_rsa.pub 내용을 확인했습니다."
        : "SSH KEY 파일 안에서 id_rsa 또는 id_rsa.pub을 찾을 수 없습니다.",
    });
  }, []);

  const clearSSHKeyFile = React.useCallback(() => {
    setSshKeyFilename("");
    setSshKeyText("");
    setSshKeyBundleHref("");
    setSshKeyBundleBuffer(null);
    setSshKeyPreview(EMPTY_SSH_KEY_PREVIEW);
  }, []);

  const clearClusterConfigFile = React.useCallback(() => {
    const defaultCount = clusterType === "powerflex" || clusterType === "ablestack-hci" || clusterType === "ablestack-hci-filesystem" ? 3 : 1;

    setHostsFilename("");
    setHostsFileText("");
    setHosts(DEFAULT_HOSTS.slice(0, defaultCount));
    setHostCount(defaultCount);
    setCcvmMgmtIp("");
    setMgmtCidr("");
    setMgmtGateway("");
    setMgmtDns("");
    setExternalTimeServer("");
    setTimeServer1(currentHostIp);
    setTimeServer2("");
    setPcsNodeIpSource("ablecubePn");
    setIsIscsiExclusive(false);
    setSecurityInternalToken("");
    setValidationMessage("");
  }, [clusterType, currentHostIp]);

  const readSSHKeyFile = (file: File) => {
    setSshKeyFilename(file.name);
    setSshKeyText("");
    setSshKeyBundleHref("");
    setSshKeyBundleBuffer(null);
    setSshKeyPreview({
      ...EMPTY_SSH_KEY_PREVIEW,
      status: "loading",
      message: "SSH KEY 파일을 확인하고 있습니다.",
    });

    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result instanceof ArrayBuffer ? reader.result : null;

      if (!buffer) {
        setSshKeyPreview({
          ...EMPTY_SSH_KEY_PREVIEW,
          status: "error",
          message: "SSH KEY 파일을 읽을 수 없습니다.",
        });
        return;
      }

      setSshKeyBundleHref(binaryDownloadHref(buffer));
      setSshKeyBundleBuffer(buffer);
      parseSSHKeyBundle(buffer)
        .then(({ privateKey, publicKey }) => applySSHKeyPreview(privateKey, publicKey))
        .catch((error) => {
          setSshKeyPreview({
            ...EMPTY_SSH_KEY_PREVIEW,
            status: "error",
            message: `SSH KEY 파일 미리보기를 확인할 수 없습니다. ${errorMessage(error)}`,
          });
        });
    };
    reader.onerror = () => {
      setSshKeyPreview({
        ...EMPTY_SSH_KEY_PREVIEW,
        status: "error",
        message: "SSH KEY 파일을 읽을 수 없습니다.",
      });
    };
    reader.readAsArrayBuffer(file);
  };

  const applyClusterConfigFileText = React.useCallback((text: string) => {
    try {
      const fileConfig = parseClusterConfigFile(text);

      if (fileConfig.clusterType) {
        setClusterType(fileConfig.clusterType);
      }
      if (fileConfig.hostRows.length > 0) {
		const rows = clusterHostMode === "add"
		  ? [...fileConfig.hostRows, {
		      hostName: currentHostname,
		      hostIp: currentHostIp,
		      storageIp: "",
		      scvmMgmtIp: "",
		      hostPnIp: "",
		      scvmPnIp: "",
		      scvmCnIp: "",
		    }]
		  : fileConfig.hostRows;
		setExistingHostCount(clusterHostMode === "add" ? fileConfig.hostRows.length : 0);
		setHosts(rows);
		setHostCount(rows.length);
      }
      setPcsNodeIpSource(fileConfig.pcsNodeIpSource);
      setCcvmMgmtIp(fileConfig.ccvmMgmtIp);
      setMgmtCidr(fileConfig.mgmtCidr);
      setMgmtGateway(fileConfig.mgmtGateway);
      setMgmtDns(fileConfig.mgmtDns);
      setIsIscsiExclusive(fileConfig.isIscsiExclusive);
      setExternalTimeServer(fileConfig.externalTimeServer);
      setTimeServer1(fileConfig.timeServer1 || currentHostIp);
      setTimeServer2(fileConfig.timeServer2);
      setSecurityInternalToken(fileConfig.internalToken || "");
      setValidationMessage("");
    } catch {
      setValidationMessage("클러스터 구성 파일을 읽을 수 없습니다. cluster.json 형식을 확인해주세요.");
    }
	}, [clusterHostMode, currentHostIp, currentHostname]);

  const readClusterConfigFile = (file: File) => {
    setHostsFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";

      setHostsFileText(text);
      applyClusterConfigFileText(text);
    };
    reader.readAsText(file);
  };

  const renderClusterTypeCard = (
    value: ClusterType,
    title: string,
    description: string
  ) => isClusterTypeVisible(value, uiFeatures) ? (
    <button
      type="button"
      className={
        clusterType === value
          ? "ct-cluster-config-wizard__type-card ct-cluster-config-wizard__type-card--active"
          : "ct-cluster-config-wizard__type-card"
      }
      onClick={() => setClusterType(value)}
    >
      <div className="ct-cluster-config-wizard__type-card-title">{title}</div>
      <div className="ct-cluster-config-wizard__type-card-desc">{description}</div>
      {clusterType === value && (
        <div className="ct-cluster-config-wizard__type-card-check">
          <CheckCircleIcon aria-hidden="true" />
        </div>
      )}
    </button>
  ) : null;

  const renderSSHKeyPreview = (compact = false) => {
    const isReady = sshKeyPreview.status === "ready";
    const statusLabel = sshKeyPreview.status === "loading"
      ? <Label color="blue">확인 중</Label>
      : isReady
        ? <Label color="green">확인됨</Label>
        : sshKeyPreview.status === "error"
          ? <Label color="red">확인 필요</Label>
          : <Label color="grey">대기</Label>;

    return (
      <div className="ct-cluster-config-wizard__ssh-preview">
        <div className="ct-cluster-config-wizard__ssh-preview-summary">
          <span>{sshKeyPreview.message}</span>
          {statusLabel}
        </div>
        <div className="ct-cluster-config-wizard__ssh-preview-grid">
          <div className="ct-cluster-config-wizard__ssh-preview-card">
            <div className="ct-cluster-config-wizard__ssh-preview-title">
              <strong>id_rsa</strong>
              <Label color={sshKeyPreview.privateKey ? "green" : "orange"}>
                {sshKeyPreview.privateKey ? "포함" : "미확인"}
              </Label>
            </div>
            <TextArea
              aria-label="id_rsa 내용"
              readOnly
              value={sshKeyPreview.privateKey || (sshKeyMode === "new" ? "신규 생성 시 서버에서 id_rsa를 생성합니다." : "id_rsa 내용을 확인할 수 없습니다.")}
              rows={compact ? 4 : 6}
              className="ct-cluster-config-wizard__review-textarea"
            />
          </div>
          <div className="ct-cluster-config-wizard__ssh-preview-card">
            <div className="ct-cluster-config-wizard__ssh-preview-title">
              <strong>id_rsa.pub</strong>
              <Label color={sshKeyPreview.publicKey ? "green" : "orange"}>
                {sshKeyPreview.publicKey ? "포함" : "미확인"}
              </Label>
            </div>
            <TextArea
              aria-label="id_rsa.pub 내용"
              readOnly
              value={sshKeyPreview.publicKey || (sshKeyMode === "new" ? "신규 생성 시 API가 id_rsa.pub을 생성합니다." : "id_rsa.pub 내용을 확인할 수 없습니다.")}
              rows={compact ? 3 : 4}
              className="ct-cluster-config-wizard__review-textarea"
            />
          </div>
        </div>
      </div>
    );
  };

  const renderFileAttachControl = (props: FileAttachControlProps) => <FileAttachControl {...props} />;

  const clusterTypeLabel =
    clusterType === "powerflex" ? "PowerFlex" : clusterType === "ablestack-hci"
      ? "ABLESTACK-HCI"
      : clusterType === "ablestack-vm"
        ? "ABLESTACK-VM"
        : clusterType === "ablestack-standalone"
          ? "ABLESTACK-STANDALONE"
          : "ABLESTACK-HCI-Filesystem";

  const sshKeyModeLabel = sshKeyMode === "new" ? "신규 생성" : "기존 파일 사용";
  const hostsFileModeLabel = hostsFileMode === "new" ? "신규 생성" : "기존 파일 사용";
  const hostRoleLabel =
    hostRole === "master" ? "Master Server" : hostRole === "second" ? "Second Server" : "Other Server";
  const isVmLikeCluster = clusterType === "ablestack-vm" || clusterType === "ablestack-standalone";
  const isHciCluster = clusterType === "powerflex" || clusterType === "ablestack-hci" || clusterType === "ablestack-hci-filesystem";
  const isStandalone = clusterType === "ablestack-standalone";
  const isAddHost = clusterHostMode === "add";
	const isHciAddHost = isHciCluster && isAddHost;
  const canUseAddHost = !isStandalone;
  const visibleHosts = hosts.slice(0, hostCount);
  const pcsNodeAddress = (host: ClusterHostRow) => (
    pcsNodeIpSource === "ablecube" ? host.hostIp : host.hostPnIp
  );
  const applyTargetResults = clusterApplyTargetResults(deployJob);

  const timeServerCandidatesFromExistingClusterJson = React.useCallback((): string[] => {
    if (!hostsFileText.trim()) return [];

    try {
      const parsed = JSON.parse(hostsFileText) as unknown;
      const clusterConfig = isRecord(parsed) ? parsed.clusterConfig : null;
      const clusterHosts = isRecord(clusterConfig) && Array.isArray(clusterConfig.hosts)
        ? clusterConfig.hosts
        : [];

      return clusterHosts
        .filter(isRecord)
        .map((host) => outputText(host.ablecube) || outputText(host.hostIp) || outputText(host.hostname))
        .filter(Boolean);
    } catch {
      return [];
    }
  }, [hostsFileText]);

  const applyTimeServersFromClusterHosts = React.useCallback(() => {
    const candidates = hostsFileMode === "existing"
      ? timeServerCandidatesFromExistingClusterJson()
      : visibleHosts
        .map((host) => host.hostIp.trim() || host.hostName.trim())
        .filter(Boolean);

    setTimeServer1(candidates[0] || currentHostIp);
    setTimeServer2(candidates[1] || "");
  }, [currentHostIp, hostsFileMode, timeServerCandidatesFromExistingClusterJson, visibleHosts]);

  const buildHostsPreview = () => {
    if (hostsFileText.trim()) return hostsFileText;
    const lines: string[] = [];
    if (!isAddHost && ccvmMgmtIp) {
      lines.push(`${ccvmMgmtIp}\tccvm-mngt\tccvm`);
    }
    visibleHosts.forEach((row, index) => {
      const idx = index + 1;
      if (isVmLikeCluster) {
        lines.push(`${row.hostIp}\t${row.hostName}\tablecube`);
        if (clusterType === "ablestack-vm" && isIscsiExclusive && row.storageIp) {
          lines.push(`${row.storageIp}\tpn-ablecube\tpn-ablecube`);
        }
        return;
      }

      lines.push(`${row.hostIp}\t${row.hostName}${row.hostName === currentHostname ? "\tablecube" : ""}`);
      lines.push(`${row.scvmMgmtIp}\tscvm${idx}-mngt${row.hostName === currentHostname ? "\tscvm-mngt" : ""}`);
      lines.push(`${row.hostPnIp}\tpn-ablecube${idx}${row.hostName === currentHostname ? "\tpn-ablecube" : ""}`);
      lines.push(`${row.scvmPnIp}\tscvm${idx}${row.hostName === currentHostname ? "\tscvm" : ""}`);
      lines.push(`${row.scvmCnIp}\tcn-scvm${idx}${row.hostName === currentHostname ? "\tcn-scvm" : ""}`);
    });
    return lines.join("\n");
  };

  const buildClusterJsonPreview = () => {
    const internalToken = securityInternalToken.trim();
    const pcsClusterHosts = isHciCluster
      ? visibleHosts
          .map((host) => pcsNodeAddress(host).trim())
          .filter(Boolean)
      : [];

    return JSON.stringify({
      clusterConfig: {
        type: clusterType,
        hostType: clusterHostMode,
        iscsiStorageExclusive: clusterType === "ablestack-vm" ? isIscsiExclusive : false,
        ccvm: isAddHost ? undefined : { ip: ccvmMgmtIp },
		mngtNic: isAddHost ? undefined : {
          cidr: mgmtCidr,
          gw: mgmtGateway,
          dns: mgmtDns,
        },
        pcsCluster: isVmLikeCluster ? undefined : Object.fromEntries(
          pcsClusterHosts.map((address, index) => [`hostname${index + 1}`, address])
        ),
        hosts: visibleHosts.map((host, index) => ({
          index: String(index + 1),
          hostname: host.hostName,
          ablecube: host.hostIp,
          ...(clusterType === "ablestack-vm" && isIscsiExclusive ? { ablecubePn: host.storageIp } : {}),
          ...(!isVmLikeCluster ? {
            scvmMngt: host.scvmMgmtIp,
            ablecubePn: host.hostPnIp,
            scvm: host.scvmPnIp,
            scvmCn: host.scvmCnIp,
          } : {}),
        })),
        external_timeserver: externalTimeServer || timeServer1,
        timeServers: [timeServer1, timeServer2].filter(Boolean),
        ...(isAddHost ? {
          ipmi: {
            ip: ipmiIp,
            port: "623",
            user: ipmiUser,
          },
        } : {}),
      },
      ...(internalToken ? {
        security: {
          internal_token: internalToken,
        },
      } : {}),
    }, null, 2);
  };

  const downloadHref = (content: string) => `data:attachment/text;charset=utf-8,${encodeURIComponent(content)}`;

  const refreshClusterJsonDownloadHref = React.useCallback(async () => {
    let lastError = "";

    for (const path of CLUSTER_JSON_DOWNLOAD_PATHS) {
      try {
        const content = await cockpit.file(path).read();

        if (content) {
          setClusterJsonDownloadHref(downloadHref(content));
          setClusterJsonDownloadError("");
          return;
        }
        lastError = `${path} 파일이 비어 있습니다.`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    setClusterJsonDownloadHref("");
    setClusterJsonDownloadError(lastError || "저장된 cluster.json 파일을 읽을 수 없습니다.");
  }, []);

  const validateClusterConfigPrepare = () => {
    if (sshKeyMode === "existing") {
      const keyFileMessage = firstError(
        requireValue(sshKeyFilename, "SSH KEY 파일을 선택해주세요."),
        sshKeyFilename.trim().toLowerCase().endsWith(".dat")
          ? ""
          : "'*.dat' 형식의 SSH KEY 파일만 업로드할 수 있습니다.",
        sshKeyBundleBuffer ? "" : "SSH KEY 파일을 다시 선택해주세요."
      );
      if (keyFileMessage) return keyFileMessage;
    }

    if (hostsFileMode === "existing") {
      const hostsFileMessage = firstError(
        requireClusterJsonFileName(hostsFilename),
        requireValue(hostsFileText, "클러스터 구성 프로파일 정보를 확인해 주세요.")
      );
      if (hostsFileMessage) return hostsFileMessage;
    }

    if (!clusterType) return "OS Type을 선택해주세요.";
    if (!isIntegerInRange(hostCount, isVmLikeCluster || isStandalone ? 1 : 3, isStandalone ? 1 : 99)) {
      return isStandalone ? "단일 구성은 호스트 수가 1대여야 합니다." : "구성할 호스트 수는 3~99 범위로 입력해주세요.";
    }

	if (hostsFileMode === "new" || isAddHost) {
      for (let index = 0; index < visibleHosts.length; index += 1) {
        const row = visibleHosts[index];
        const hostLabel = `${index + 1}번 호스트`;
        const hostNameMessage = requireHostname(row.hostName, `${hostLabel} 호스트명`);
        if (hostNameMessage) return hostNameMessage;
        if (!isIpv4(row.hostIp)) return `${hostLabel} 호스트 IP 형식을 확인해주세요.`;

        if (clusterType === "ablestack-vm" && isIscsiExclusive && !isIpv4(row.storageIp)) {
          return `${hostLabel} 스토리지 전용 IP 형식을 확인해주세요.`;
        }

        if (!isVmLikeCluster) {
          if (!isIpv4(row.scvmMgmtIp)) return `${hostLabel} SCVM MNGT IP 형식을 확인해주세요.`;
          if (!isIpv4(row.hostPnIp)) return `${hostLabel} 호스트 PN IP 형식을 확인해주세요.`;
          if (!isIpv4(row.scvmPnIp)) return `${hostLabel} SCVM PN IP 형식을 확인해주세요.`;
          if (!isIpv4(row.scvmCnIp)) return `${hostLabel} SCVM CN IP 형식을 확인해주세요.`;
        }
      }

      if (isHciCluster && visibleHosts.some((host) => !isIpv4(pcsNodeAddress(host)))) {
        return pcsNodeIpSource === "ablecube"
          ? "PCS 노드 주소로 사용할 호스트 IP 형식을 확인해주세요."
          : "PCS 노드 주소로 사용할 호스트 PN IP 형식을 확인해주세요.";
      }
    }

    if (!isAddHost) {
      const ccvmMessage = requireIpv4(ccvmMgmtIp, "CCVM 관리 IP");
      if (ccvmMessage) return ccvmMessage;
      if (!isIntegerInRange(mgmtCidr, 0, 32)) return "관리 NIC CIDR 범위는 0~32 입니다.";
      const gatewayMessage = optionalIpv4(mgmtGateway, "관리 NIC Gateway");
      if (gatewayMessage) return gatewayMessage;
      const dnsMessage = optionalIpv4(mgmtDns, "관리 NIC DNS");
      if (dnsMessage) return dnsMessage;
    }

    if (isAddHost) {
      const ipmiMessage = firstError(
        requireIpv4(ipmiIp, "IPMI IP"),
        requireValue(ipmiUser, "IPMI User를 입력해주세요."),
        requireValue(ipmiPassword, "IPMI Password를 입력해주세요.")
      );
      if (ipmiMessage) return ipmiMessage;
    }

    if (externalTimeServer.trim() && !isHostAddress(externalTimeServer)) return "외부 시간서버 형식을 확인해주세요.";
    if (!timeServer1.trim()) return "시간 서버 1번 IP 정보를 확인해 주세요.";
    if (!isHostAddress(timeServer1)) return "시간 서버 1번 IP 정보를 확인해 주세요.";
    if (timeServer2.trim() && !isHostAddress(timeServer2)) return "시간 서버 2번 IP 정보를 확인해 주세요.";

	if (hostsFileMode === "new" || isAddHost) {
      const profileIps = visibleHosts.flatMap((row) => [
        row.hostIp,
        clusterType === "ablestack-vm" && isIscsiExclusive ? row.storageIp : "",
        !isVmLikeCluster ? row.scvmMgmtIp : "",
        !isVmLikeCluster ? row.hostPnIp : "",
        !isVmLikeCluster ? row.scvmPnIp : "",
        !isVmLikeCluster ? row.scvmCnIp : "",
      ]);
      const duplicateProfileMessage = duplicateMessage(profileIps, "클러스터 구성 프로파일에 중복된 IP가 존재합니다.");
      if (duplicateProfileMessage) return duplicateProfileMessage;
    }

    return "";
  };

  const buildClusterApplyPayload = () => {
    const internalToken = securityInternalToken.trim();
    const hostsPayload = visibleHosts.map((host, index) => ({
      index: String(index + 1),
      hostname: host.hostName.trim(),
      ablecube: host.hostIp.trim(),
      ...(clusterType === "ablestack-vm" && isIscsiExclusive ? { ablecubePn: host.storageIp.trim() } : {}),
      ...(!isVmLikeCluster ? {
        scvmMngt: host.scvmMgmtIp.trim(),
        ablecubePn: host.hostPnIp.trim(),
        scvm: host.scvmPnIp.trim(),
        scvmCn: host.scvmCnIp.trim(),
      } : {}),
    }));
    const pcsClusterList = isStandalone
      ? []
      : isVmLikeCluster
        ? visibleHosts.map((host) => host.hostIp.trim()).filter(Boolean)
        : visibleHosts.map((host) => pcsNodeAddress(host).trim()).filter(Boolean);

    return {
      mode: "partial",
      only: ["cluster_apply"],
      enrollment: { source: hostsFileMode, registration },
      time_servers: [timeServer1, timeServer2, externalTimeServer].filter(Boolean),
      time_role: hostRole,
      update_system_profile: true,
      cluster: {
        action: "insert",
		option: isAddHost ? "add" : "local",
        type: clusterType,
		...(!isAddHost ? {
          ccvm: { ip: ccvmMgmtIp.trim() },
          mngtNic: {
            cidr: mgmtCidr.trim(),
            gw: mgmtGateway.trim(),
            dns: mgmtDns.trim(),
          },
        } : {}),
        external_timeserver: externalTimeServer.trim() || timeServer1.trim(),
        storage_network: String(clusterType === "ablestack-vm" && isIscsiExclusive),
        ...(pcsClusterList.length > 0 ? { pcs_cluster_list: pcsClusterList } : {}),
        hosts: hostsPayload,
        ...(internalToken ? {
          security: {
            internal_token: internalToken,
          },
        } : {}),
		...(isAddHost ? {
		  new_hostname: visibleHosts[existingHostCount]?.hostName.trim() ?? currentHostname.trim(),
          ipmi: { ip: ipmiIp, user: ipmiUser, password: ipmiPassword },
        } : {}),
      },
    };
  };

  const progressRows = (): ClusterProgressRow[] => {
    const clusterApply = findJobStep(deployJob, "cluster_apply");
	const clusterApplySuccessMessage = isAddHost
      ? "클러스터 구성 파일 및 Hosts 파일 적용과 PCS 호스트 추가 설정이 완료되었습니다."
      : "클러스터 구성 파일 및 Hosts 파일 적용이 완료되었습니다.";
    const clusterApplyMessage = (() => {
      const message = clusterApply?.message?.trim() ?? "";
      const normalized = message.toLowerCase();

      if (clusterStepStatus(deployJob, deployPhase) === "succeeded" && (!message || normalized === "ok" || normalized === "apply success" || normalized === "success")) {
        return clusterApplySuccessMessage;
      }

      return message || "cluster_apply 작업 실행";
    })();
    const jobCreatedStatus = deployJob
      ? "succeeded"
      : deployPhase === "error"
        ? "failed"
        : deployPhase === "running"
          ? "running"
          : "pending";
    const applyStatus = clusterStepStatus(deployJob, deployPhase);
    const verifyStatus = deployPhase === "success"
      ? "succeeded"
      : deployPhase === "error" && applyStatus !== "failed"
        ? "failed"
        : applyStatus === "succeeded" && deployPhase === "running"
          ? "running"
          : "pending";

    return [
      {
        id: "job",
        label: "배포 작업 시작",
        status: jobCreatedStatus,
        message: deployJob?.jobId ? `작업 번호 ${deployJob.jobId}` : "작업 실행 준비",
      },
      {
        id: "cluster_apply",
		label: isHciAddHost
		  ? "신규 호스트 및 SCVM 프로파일 추가"
		  : isAddHost
		    ? "Cluster Config 및 Hosts 파일 생성 및 PCS 호스트 추가 설정"
		    : "Cluster Config 및 Hosts 파일 생성",
        status: applyStatus,
        message: clusterApplyMessage,
      },
      {
        id: "verify",
        label: "시간서버 설정 적용 및 구성 결과 확인",
        status: verifyStatus,
        message: deployPhase === "success" ? "클러스터 구성 준비가 완료되었습니다." : "Job 결과를 확인합니다.",
      },
    ];
  };

  const formatApplyTarget = (target: string) => {
    const normalized = target.trim().toLowerCase();
    const isLocal = normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";

    if (!isLocal) return target;

    const hostname = currentHostname.trim();
    const hostIp = currentHostIp.trim();

    if (hostname && hostIp) return `${hostname} (${hostIp})`;
    return hostname || hostIp || "현재 호스트";
  };

  const formatApplyResultMessage = (result: ClusterApplyTargetResult) => {
    if (result.isFailed) return result.message;

    const message = result.message.trim();
    const normalized = message.toLowerCase();

    if (!message || normalized === "ok" || normalized === "apply success" || normalized === "success") {
		return isAddHost
        ? "클러스터 구성 파일 및 Hosts 파일 적용과 PCS 호스트 추가 설정이 완료되었습니다."
        : "클러스터 구성 파일 및 Hosts 파일 적용이 완료되었습니다.";
    }

    return result.message;
  };

  const ensureNewSSHKeyBundle = async () => {
    if (sshKeyMode !== "new") return;

    setDeployMessage("SSH KEY 파일을 신규 생성하고 있습니다.");
    setSshKeyPreview({
      ...EMPTY_SSH_KEY_PREVIEW,
      status: "loading",
      message: "SSH KEY 파일을 신규 생성하고 있습니다.",
    });

    await generateSSHKeyFiles();

    setDeployMessage("생성된 SSH KEY 파일을 다운로드하고 있습니다.");
    const bundle: SSHKeyBundleDownload = await downloadSSHKeyBundle();
    setSshKeyFilename("ssh-key.dat");
    setSshKeyBundleHref(bundle.href);
    setSshKeyBundleBuffer(bundle.buffer);

    if (bundle.privateKey || bundle.publicKey) {
      applySSHKeyPreview(bundle.privateKey || "", bundle.publicKey || "");
      return;
    }

    if (bundle.buffer) {
      const { privateKey, publicKey } = await parseSSHKeyBundle(bundle.buffer);
      applySSHKeyPreview(privateKey, publicKey);
      return;
    }

    setSshKeyPreview({
      ...EMPTY_SSH_KEY_PREVIEW,
      status: "error",
      message: "생성된 SSH KEY 파일 내용을 확인할 수 없습니다.",
    });
  };

  const ensureExistingSSHKeyUploaded = async () => {
    if (sshKeyMode !== "existing") return;
    if (!sshKeyBundleBuffer) {
      throw new Error("등록할 SSH KEY 파일을 다시 선택해주세요.");
    }

    setDeployMessage("선택한 SSH KEY 파일을 현재 호스트에 등록하고 있습니다.");
    await uploadSSHKeyBundle(sshKeyBundleBuffer, sshKeyFilename || "ssh-key.dat");
    setSshKeyPreview((prev) => ({
      ...prev,
      message: prev.status === "ready"
        ? "id_rsa와 id_rsa.pub 내용을 확인했고 현재 호스트에 등록했습니다."
        : "선택한 SSH KEY 파일을 현재 호스트에 등록했습니다.",
    }));
  };

  const startClusterConfigRun = async () => {
    setDeployPhase("running");
    setDeployMessage("클러스터 구성 Job을 시작하고 있습니다.");
    setDeployJob(null);
    setDeployJobId("");

    try {
      await ensureNewSSHKeyBundle();
      await ensureExistingSSHKeyUploaded();
      setDeployMessage("클러스터 구성 Job을 시작하고 있습니다.");
      const job = await startDeployRun(buildClusterApplyPayload());
      setDeployJob(job);
      setDeployJobId(job.jobId);
      setDeployMessage(job.jobId ? `클러스터 구성 Job이 시작되었습니다. 작업 번호 ${job.jobId}` : "클러스터 구성 Job이 시작되었습니다.");

      if (job.status === "succeeded") {
        await refreshClusterJsonDownloadHref();
        setDeployPhase("success");
        onCompleted?.();
        window.setTimeout(() => deployNextStepRef.current?.(), 700);
      } else if (job.status === "failed") {
        setDeployPhase("error");
        setDeployMessage(job.message || "클러스터 구성 Job이 실패했습니다.");
      }
    } catch (error) {
      setDeployPhase("error");
      setDeployMessage(`클러스터 구성 Job 시작에 실패했습니다: ${errorMessage(error)}`);
    }
  };

  React.useEffect(() => {
    if (!deployJobId || deployPhase !== "running") return undefined;

    let disposed = false;

    const refreshJob = () => {
      fetchDeployRunJobs()
        .then((jobs) => {
          if (disposed) return;
          const nextJob = jobs.find((job) => job.jobId === deployJobId);

          if (!nextJob) return;
          setDeployJob(nextJob);
          if (nextJob.status === "succeeded") {
            refreshClusterJsonDownloadHref()
              .catch(() => undefined)
              .finally(() => {
                if (disposed) return;
                setDeployPhase("success");
                setDeployMessage("클러스터 구성 준비가 완료되었습니다.");
                onCompleted?.();
                window.setTimeout(() => {
                  if (!disposed) deployNextStepRef.current?.();
                }, 700);
              });
          } else if (nextJob.status === "failed") {
            setDeployPhase("error");
            setDeployMessage(nextJob.message || "클러스터 구성 Job이 실패했습니다.");
          }
        })
        .catch((error) => {
          if (!disposed) {
            setDeployMessage(`Job 상태 확인에 실패했습니다: ${errorMessage(error)}`);
          }
        });
    };

    refreshJob();
    const intervalId = window.setInterval(refreshJob, 3000);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [deployJobId, deployPhase, onCompleted, refreshClusterJsonDownloadHref]);

  const wizardFooter = (activeStep: any, goToNextStep: (event?: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>, goToPrevStep: (event?: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>, close: (event?: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>) => {
    if (!activeStep) return null;
    const stepId = String(activeStep.id);
    const isFirst = stepId === "cluster-config-overview";
    const isReview = stepId === "cluster-config-review";
    const isDeploy = stepId === "cluster-config-finish";
    const isFinish = stepId === "cluster-config-complete";

    if (isDeploy) {
      deployNextStepRef.current = goToNextStep;

      return (
        <div className="ct-cluster-config-wizard__footer">
          {deployPhase === "error" && (
            <Button variant="primary" onClick={() => void startClusterConfigRun()}>
              다시 구성
            </Button>
          )}
          {deployPhase === "success" && (
            <Button variant="primary" onClick={goToNextStep}>
              완료
            </Button>
          )}
          {deployPhase === "running" && (
            <Button variant="primary" isDisabled>
              구성 중
            </Button>
          )}
          {deployPhase === "error" && (
            <Button variant="secondary" onClick={goToPrevStep}>
              이전
            </Button>
          )}
          <Button variant="link" onClick={close} isDisabled={deployPhase === "running"}>
            취소
          </Button>
        </div>
      );
    }

    return (
      <div className="ct-cluster-config-wizard__footer">
        {!isFinish && (
          <Button
            variant="primary"
            onClick={() => {
              if (isReview) {
                const message = validateClusterConfigPrepare();
                if (message) {
                  setValidationMessage(message);
                  return;
                }
                setValidationMessage("");
                setDeployPhase("running");
                goToNextStep();
                window.setTimeout(() => {
                  void startClusterConfigRun();
                }, 0);
                return;
              }
              if (stepId === "cluster-config-ip-info") {
                applyTimeServersFromClusterHosts();
              }
              goToNextStep();
            }}
          >
            {isReview ? "구성" : "다음"}
          </Button>
        )}
        {!isFirst && !isFinish && (
          <Button variant="secondary" onClick={goToPrevStep}>
            이전
          </Button>
        )}
        {!isFinish && (
          <Button variant="link" onClick={close}>
            취소
          </Button>
        )}
        {isFinish && (
          <Button variant="primary" onClick={close}>
            닫기
          </Button>
        )}
      </div>
    );
  };

  const renderHostTable = () => (
    <div className="ct-cluster-config-wizard__table-wrap">
      <div className="ct-cluster-config-wizard__table-title">클러스터 구성 프로파일</div>
      <table className="ct-cluster-config-wizard__table">
        <thead>
          <tr>
            <th>순번</th>
            <th>호스트명</th>
            <th>호스트 IP</th>
            {clusterType === "ablestack-vm" && isIscsiExclusive && <th>스토리지 전용 IP</th>}
            {!isVmLikeCluster && (
              <>
                <th>SCVM<br />MNGT IP</th>
                <th>호스트 PN IP</th>
                <th>SCVM PN IP</th>
                <th>SCVM CN IP</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
		  {visibleHosts.map((row, idx) => {
			const isExistingRow = isAddHost && idx < existingHostCount;
			return (
            <tr key={`cluster-host-row-${idx}`}>
              <td>{idx + 1}</td>
              <td>
                <TextInput
                  aria-label={`호스트명 ${idx + 1}`}
                  value={row.hostName}
				  isDisabled={isExistingRow}
                  onChange={(_event, value) => updateHost(idx, "hostName", value)}
                />
              </td>
              <td>
                <TextInput
                  aria-label={`호스트 IP ${idx + 1}`}
                  value={row.hostIp}
				  isDisabled={isExistingRow}
                  onChange={(_event, value) => updateHost(idx, "hostIp", value)}
                />
              </td>
              {clusterType === "ablestack-vm" && isIscsiExclusive && (
                <td>
                  <TextInput
                    aria-label={`스토리지 전용 IP ${idx + 1}`}
                    value={row.storageIp}
					isDisabled={isExistingRow}
                    onChange={(_event, value) => updateHost(idx, "storageIp", value)}
                  />
                </td>
              )}
              {!isVmLikeCluster && (
                <>
                  <td>
                    <TextInput
                      aria-label={`SCVM MNGT IP ${idx + 1}`}
                      value={row.scvmMgmtIp}
					  isDisabled={isExistingRow}
                      onChange={(_event, value) => updateHost(idx, "scvmMgmtIp", value)}
                    />
                  </td>
                  <td>
                    <TextInput
                      aria-label={`호스트 PN IP ${idx + 1}`}
                      value={row.hostPnIp}
					  isDisabled={isExistingRow}
                      onChange={(_event, value) => updateHost(idx, "hostPnIp", value)}
                    />
                  </td>
                  <td>
                    <TextInput
                      aria-label={`SCVM PN IP ${idx + 1}`}
                      value={row.scvmPnIp}
					  isDisabled={isExistingRow}
                      onChange={(_event, value) => updateHost(idx, "scvmPnIp", value)}
                    />
                  </td>
                  <td>
                    <TextInput
                      aria-label={`SCVM CN IP ${idx + 1}`}
                      value={row.scvmCnIp}
					  isDisabled={isExistingRow}
                      onChange={(_event, value) => updateHost(idx, "scvmCnIp", value)}
                    />
                  </td>
                </>
              )}
            </tr>
			);
		  })}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <Modal
        isOpen={isOpen}
        // onClose={handleClose}
        variant="large"
        aria-label="클러스터 구성 준비 마법사"
        className="ct-cluster-config-wizard__modal"
      >
      <Wizard
        onClose={handleClose}
        onSave={handleClose}
        width="100%"
        navAriaLabel="클러스터 구성 준비 단계"
        isVisitRequired
        className={[
          "ct-cluster-config-wizard",
          deployPhase !== "idle" ? "ct-wizard--execution-visible" : "",
          deployPhase === "success" ? "ct-wizard--complete-visible" : "",
        ].join(" ")}
        footer={wizardFooter}
        header={
          <div className="ct-cluster-config-wizard__header">
            <div>
              <Title headingLevel="h1" size="2xl" className="ct-cluster-config-wizard__title">
                클러스터 구성 준비 마법사
              </Title>
            <Content className="ct-cluster-config-wizard__subtitle">
              <Content component="p">
                스토리지센터 및 클라우드센터 클러스터를 구성하기 위해 필요한 다양한 정보 및 구성파일을 준비합니다.
              </Content>
            </Content>
            </div>
            <button
              type="button"
              className="ct-cluster-config-wizard__close"
              aria-label="Close"
              onClick={handleClose}
            >
              ×
            </button>
          </div>
        }
      >
        <WizardStep name="개요" id="cluster-config-overview">
          <div className="ct-cluster-config-wizard__content">
            <Content>
              <Content component="p">
                클러스터 구성 준비 마법사는 클러스터를 자동으로 구성하고, 스토리지센터 및 클라우드센터를 구성하기 위해 필요한 다음의 정보를 입력받아 준비합니다.
              </Content>
              <Content component="ul">
                <Content component="li">HCI를 이용한 가상화 또는 서버 가상화를 사용하기 위한 클러스터 또는 로컬 스토리지를 사용하는 단일 서버 구성</Content>
                <Content component="li">모든 호스트 및 가상머신에서 사용자 인증을 위해 공통으로 사용할 SSH Key 정보</Content>
                <Content component="li">클러스터 또는 단일 노드를 구성하는 호스트 및 가상머신들의 호스트명 및 IP 정보</Content>
                <Content component="li">호스트 및 가상머신의 시간 동기화를 위한 시간서버</Content>
              </Content>
              <Content component="p">
                필요한 정보를 먼저 준비하십시오. 정보가 준비되었다면 "다음" 버튼을 눌러 클러스터 구성
                준비를 시작합니다.
              </Content>
            </Content>
          </div>
        </WizardStep>

        <WizardStep name="클러스터 종류" id="cluster-config-cluster-type">
          <div className="ct-cluster-config-wizard__content">
            <Content>
              <Content component="p">
                ABLESTACK은 고성능 컴퓨팅과 안정적인 가상화 환경을 제공합니다. 사용자는 하이퍼 컨버지드
                인프라(HCI)와 서버 가상화, 그리고 단일 로컬 구성 옵션 중에서 필요에 맞는 솔루션을 선택할 수 있습니다.
              </Content>
              <Content component="ul">
                <Content component="li">
                  ABLESTACK HCI는 데이터의 안정적이고 효율적인 관리를 위해 설계되었습니다. Glue 스토리지는
                  데이터를 여러 위치에 분산시켜 저장하여 높은 가용성과 확장성을 제공합니다.
                </Content>
                <Content component="li">
                  ABLESTACK VM은 물리적 하드웨어를 추상화하여 여러 가상 머신에서 동시 실행이 가능하게 하며,
                  자원의 효율적인 사용과 유연한 시스템 관리를 지원합니다.
                </Content>
                <Content component="li">
                  ABLESTACK STANDALONE은 단일 서버에 로컬 스토리지를 활용해 가상화 환경을 구성할 수 있는 옵션입니다.
                </Content>
                {uiFeatures.hciFilesystem && <Content component="li">
                  ABLESTACK HCI Filesystem은 Glue 스토리지에서 생성한 RBD 이미지를 기반으로 GFS2 클러스터 파일시스템을 구성해,
                  여러 호스트가 동일 볼륨을 동시에 마운트하는 공유 스토리지 환경을 제공합니다.
                </Content>}
              </Content>
            </Content>
            {!isClusterTypeVisible(clusterType, uiFeatures) && <p>등록된 프로파일의 클러스터 종류: {clusterTypeLabel}</p>}
            <div className="ct-cluster-config-wizard__type-grid">
              {renderClusterTypeCard("powerflex", "PowerFlex", "PowerFlex 스토리지 클러스터 구성")}
                {renderClusterTypeCard(
                "ablestack-hci",
                "ABLESTACK-HCI",
                "x86 기반의 서버와 가상화 기술, 그리고 소프트웨어 정의 기술을 접목하여 HCI를 구성하는 소프트웨어 스택입니다."
              )}
              {renderClusterTypeCard(
                "ablestack-vm",
                "ABLESTACK-VM",
                "Cube 및 외부 스토리지를 사용하여 Mold를 ABLESTACK VM으로 올린 소프트웨어 솔루션입니다."
              )}
              {renderClusterTypeCard(
                "ablestack-standalone",
                "ABLESTACK-STANDALONE",
                "단일 서버 환경에서 로컬 스토리지를 기반으로 ABLESTACK 제품을 구동하는 소프트웨어 솔루션입니다."
              )}
              {renderClusterTypeCard(
                "ablestack-hci-filesystem",
                "ABLESTACK-HCI-Filesystem",
                "내부 스토리지(Glue)를 기반으로 공유 파일 환경을 구성하는 ABLESTACK HCI용 소프트웨어 솔루션입니다."
              )}
            </div>
          </div>
        </WizardStep>

        <WizardStep name="SSH Key 파일" id="cluster-config-ssh-key">
          <div className="ct-cluster-config-wizard__content">
            <Content>
              <Content component="p">
                클러스터를 구성하는 호스트 및 가상머신은 모든 명령을 SSH를 이용해 암호화 하여 전달합니다.
                원활한 SSH 연결 및 상호 인증을 위해 동일한 SSH Key 설정이 필요합니다.
                마법사를 통해 새로운 SSH Key를 생성하여 사용하거나 기존의 SSH Key 파일을 사용할 수 있습니다.
                클러스터 호스트 구분이 추가 호스트인 경우 반드시 기존 SSH Key 파일을 사용해 주세요.
              </Content>
            </Content>
            <Form className="ct-cluster-config-wizard__section ct-cluster-config-wizard__form-horizontal" isHorizontal>
              <FormGroup label="SSH Key 준비 방법" isRequired fieldId="ssh-key-mode">
                <div className="ct-cluster-config-wizard__inline">
                  <Radio
                    id="ssh-key-new"
                    name="ssh-key-mode"
                    label="신규 생성"
                    isChecked={sshKeyMode === "new"}
                    onChange={() => {
                      setSshKeyMode("new");
                      clearSSHKeyFile();
                    }}
                  />
                  <Radio
                    id="ssh-key-existing"
                    name="ssh-key-mode"
                    label="기존 파일 사용"
                    isChecked={sshKeyMode === "existing"}
                    onChange={() => setSshKeyMode("existing")}
                  />
                </div>
              </FormGroup>
              {sshKeyMode === "existing" && (
                <FormGroup label="SSH KEY 파일" isRequired fieldId="ssh-key-file">
                  {renderFileAttachControl({
                    id: "ssh-key-file",
                    inputRef: sshKeyFileInputRef,
                    filename: sshKeyFilename,
                    placeholder: "선택된 .dat 파일 없음",
                    accept: ".dat",
                    onFileSelect: readSSHKeyFile,
                    onClear: clearSSHKeyFile,
                  })}
                  {renderSSHKeyPreview()}
                </FormGroup>
              )}
            </Form>
          </div>
        </WizardStep>

        <WizardStep name="클러스터 구성 파일" id="cluster-config-ip-info">
          <div className="ct-cluster-config-wizard__content">
            <Content>
              <Content component="p">
                클러스터를 구성하는 호스트 및 가상머신은 SSH 연결 및 고가용성 구성 등을 위해 호스트 프로파일을 생성하여 사용합니다.
                호스트명 및 IP 정보를 모두 사전 준비한 후 아래의 정보를 구성하십시오.
              </Content>
            </Content>
            <Form className="ct-cluster-config-wizard__section ct-cluster-config-wizard__form-horizontal" isHorizontal>
              <FormGroup label="클러스터 호스트 구분" isRequired fieldId="cluster-host-mode">
                <div className="ct-cluster-config-wizard__inline">
                  <Radio
                    id="cluster-host-new"
                    name="cluster-host-mode"
                    label="신규 클러스터 호스트"
                    isChecked={clusterHostMode === "new"}
                    onChange={() => {
                      setClusterHostMode("new");
                      setHostsFileMode("new");
                    }}
                  />
                  <Radio
                    id="cluster-host-add"
                    name="cluster-host-mode"
                    label="추가 호스트"
                    isChecked={clusterHostMode === "add"}
                    isDisabled={!canUseAddHost}
                    onChange={() => {
                      setClusterHostMode("add");
                      setHostsFileMode("existing");
                      setSshKeyMode("existing");
                    }}
                  />
                </div>
              </FormGroup>
              {hostsFileMode === "existing" && <RegistrationInput onChange={setRegistration} />}
              <FormGroup label={<>클러스터 구성 파일<br />준비</>} isRequired fieldId="hosts-file-mode">
                <div className="ct-cluster-config-wizard__inline">
                  <Radio
                    id="hosts-file-new"
                    name="hosts-file-mode"
                    label="신규 생성"
                    isChecked={hostsFileMode === "new"}
                    isDisabled={clusterHostMode === "add"}
                    onChange={() => setHostsFileMode("new")}
                  />
                  <Radio
                    id="hosts-file-existing"
                    name="hosts-file-mode"
                    label="기존 파일 사용"
                    isChecked={hostsFileMode === "existing"}
                    onChange={() => setHostsFileMode("existing")}
                  />
                </div>
              </FormGroup>

              {hostsFileMode === "existing" && (
                <FormGroup label="클러스터 구성 파일" fieldId="hosts-file">
                  {renderFileAttachControl({
                    id: "hosts-file",
                    inputRef: clusterConfigFileInputRef,
                    filename: hostsFilename,
                    placeholder: "선택된 cluster.json 파일 없음",
                    accept: ".json,application/json",
                    onFileSelect: readClusterConfigFile,
                    onClear: clearClusterConfigFile,
                  })}
                </FormGroup>
              )}

              <FormGroup label="현재 호스트명" isRequired fieldId="current-hostname">
                <TextInput
                  id="current-hostname"
                  value={currentHostname}
                  readOnly
                />
              </FormGroup>

              {clusterType === "ablestack-vm" && (
                <FormGroup label="스토리지 네트워크 전용" fieldId="iscsi-storage-exclusive">
                  <Switch
                    id="iscsi-storage-exclusive"
                    label={isIscsiExclusive ? "사용" : "미사용"}
                    isChecked={isIscsiExclusive}
                    isDisabled={hostsFileMode === "existing"}
                    onChange={(_event, checked) => setIsIscsiExclusive(checked)}
                  />
                </FormGroup>
              )}

              {isHciCluster && (
                <FormGroup label="클러스터 관리 네트워크" labelHelp={<ClusterManagementNetworkHelp />}
                  className="ct-cluster-management-network-field" isRequired fieldId="pcs-node-ip-source">
                  <FormSelect
                    id="pcs-node-ip-source"
                    value={pcsNodeIpSource}
                    onChange={(_event, value) => setPcsNodeIpSource(value as PcsNodeIpSource)}
                  >
                    <FormSelectOption value="ablecube" label="Ablecube IP (관리망)" />
                    <FormSelectOption value="ablecubePn" label="HOST PN (HPN)" />
                  </FormSelect>
                </FormGroup>
              )}

              <FormGroup label="구성할 호스트 수" isRequired fieldId="host-count">
                <div className="ct-cluster-config-wizard__stepper">
                  <Button
                    variant="control"
				  isDisabled={hostsFileMode === "existing" || isStandalone || isAddHost}
                    onClick={() => updateHostCount(hostCount - 1)}
                  >
                    -
                  </Button>
                  <div className="ct-cluster-config-wizard__stepper-value">{hostCount}</div>
                  <Button
                    variant="control"
					isDisabled={hostsFileMode === "existing" || isStandalone || isAddHost}
                    onClick={() => updateHostCount(hostCount + 1)}
                  >
                    +
                  </Button>
                  <span className="ct-cluster-config-wizard__stepper-unit">대</span>
                </div>
              </FormGroup>

              {renderHostTable()}

			  {!isAddHost && (
                <>
                  <FormGroup label="CCVM 관리 IP" isRequired fieldId="ccvm-ip">
                    <TextInput id="ccvm-ip" value={ccvmMgmtIp} onChange={(_event, value) => setCcvmMgmtIp(value)} isDisabled={hostsFileMode === "existing"} />
                  </FormGroup>
                  <FormGroup label="관리 NIC CIDR" fieldId="mgmt-cidr">
                    <TextInput id="mgmt-cidr" value={mgmtCidr} onChange={(_event, value) => setMgmtCidr(value)} isDisabled={hostsFileMode === "existing"} />
                  </FormGroup>
                  <FormGroup label="관리 NIC Gateway" fieldId="mgmt-gw">
                    <TextInput id="mgmt-gw" value={mgmtGateway} onChange={(_event, value) => setMgmtGateway(value)} isDisabled={hostsFileMode === "existing"} />
                  </FormGroup>
                  <FormGroup label="관리 NIC DNS" fieldId="mgmt-dns">
                    <TextInput id="mgmt-dns" value={mgmtDns} onChange={(_event, value) => setMgmtDns(value)} isDisabled={hostsFileMode === "existing"} />
                  </FormGroup>
                </>
              )}

			  {isAddHost && (
                <div className="ct-cluster-config-wizard__field-group">
                  <div className="ct-cluster-config-wizard__field-group-title">추가할 호스트 정보</div>
                  <FormGroup label="IPMI IP" isRequired fieldId="ipmi-ip">
                    <TextInput id="ipmi-ip" value={ipmiIp} placeholder="xxx.xxx.xxx.xxx 형식으로 입력" onChange={(_event, value) => setIpmiIp(value)} />
                  </FormGroup>
                  <FormGroup label="IPMI 아이디" isRequired fieldId="ipmi-user">
                    <TextInput id="ipmi-user" value={ipmiUser} placeholder="아이디를 입력하세요." onChange={(_event, value) => setIpmiUser(value)} />
                  </FormGroup>
                  <FormGroup label="IPMI 비밀번호" isRequired fieldId="ipmi-password">
                    <TextInput id="ipmi-password" type="password" value={ipmiPassword} placeholder="비밀번호를 입력하세요." onChange={(_event, value) => setIpmiPassword(value)} />
                  </FormGroup>
                </div>
              )}
            </Form>
          </div>
        </WizardStep>

        <WizardStep name="시간서버" id="cluster-config-time-server">
          <div className="ct-cluster-config-wizard__content">
            <Content>
              <Content component="p">
                스토리지의 무결성을 유지하고, 가용성을 높이기 위해서 호스트 및 가상머신의 시간동기화는 필수적입니다.
                시간 동기화가 이루어지지 않아 호스트의 시간이 서로 다르면 스토리지가 중단되며, 가상머신이 제대로 운영되지 않게 됩니다.
                인터넷 연결이 되지 않는 환경이라면 반드시 내부 시간 서버를 구성한 후 클러스터를 구성해야 합니다.
              </Content>
            </Content>
            <Form className="ct-cluster-config-wizard__section ct-cluster-config-wizard__form-horizontal" isHorizontal>
              <FormGroup label="현재 Host" isRequired fieldId="host-role">
                <div className="ct-cluster-config-wizard__inline">
                  <Radio
                    id="host-role-master"
                    name="host-role"
                    label="Master Server"
                    isChecked={hostRole === "master"}
                    onChange={() => setHostRole("master")}
                  />
                  <Radio
                    id="host-role-second"
                    name="host-role"
                    label="Second Server"
                    isChecked={hostRole === "second"}
                    onChange={() => setHostRole("second")}
                  />
                  <Radio
                    id="host-role-other"
                    name="host-role"
                    label="Other Server"
                    isChecked={hostRole === "other"}
                    onChange={() => setHostRole("other")}
                  />
                </div>
              </FormGroup>
              <FormGroup label="외부 시간서버" fieldId="external-time-server">
                <TextInput
                  id="external-time-server"
                  value={externalTimeServer}
                  onChange={(_event, value) => setExternalTimeServer(value)}
                />
              </FormGroup>
              <FormGroup label="시간서버 #1" isRequired fieldId="time-server-1">
                <TextInput id="time-server-1" value={timeServer1} onChange={(_event, value) => setTimeServer1(value)} />
              </FormGroup>
              <FormGroup label="시간서버 #2" fieldId="time-server-2">
                <TextInput id="time-server-2" value={timeServer2} onChange={(_event, value) => setTimeServer2(value)} />
              </FormGroup>
              <div className="ct-cluster-config-wizard__info">
                <InfoCircleIcon aria-hidden="true" />
                <div>
                  <div className="ct-cluster-config-wizard__info-title">시간서버 구성시 참고사항</div>
                  <div>구성할 호스트의 수가 3대 미만인 경우 로컬 시간서버 기능이 비활성화 됩니다.</div>
                </div>
              </div>
            </Form>
          </div>
        </WizardStep>

        <WizardStep name="설정확인" id="cluster-config-review">
          <div className="ct-cluster-config-wizard__content">
            <Content>
              <Content component="p">
                클러스터 구성을 위해 설정한 SSH Key, 호스트 프로파일, 시간 동기화 서버 정보는 다음과 같습니다.
                정보를 수정해야 하는 경우 해당 단계로 이동하십시오. 설정을 확인한 뒤 "구성" 버튼을 누르면 API Job이 실행됩니다.
              </Content>
            </Content>
            <div className="ct-cluster-config-wizard__review-accordion">
              <div className="ct-cluster-config-wizard__review-section">
                <button
                  type="button"
                  className="ct-cluster-config-wizard__review-header"
                  onClick={() =>
                    setReviewOpen((prev) => ({ ...prev, clusterType: !prev.clusterType }))
                  }
                >
                  <span>클러스터 종류</span>
                  <span className={reviewOpen.clusterType ? "ct-chevron ct-chevron--open" : "ct-chevron"}>▾</span>
                </button>
                {reviewOpen.clusterType && (
                  <div className="ct-cluster-config-wizard__review-body">
                    <DescriptionList isCompact className="ct-cluster-config-wizard__review-detail">
                      <DescriptionListGroup>
                        <DescriptionListTerm>클러스터 종류</DescriptionListTerm>
                        <DescriptionListDescription>{clusterTypeLabel}</DescriptionListDescription>
                      </DescriptionListGroup>
                    </DescriptionList>
                  </div>
                )}
              </div>

              <div className="ct-cluster-config-wizard__review-section">
                <button
                  type="button"
                  className="ct-cluster-config-wizard__review-header"
                  onClick={() => setReviewOpen((prev) => ({ ...prev, sshKey: !prev.sshKey }))}
                >
                  <span>SSH Key 파일</span>
                  <span className={reviewOpen.sshKey ? "ct-chevron ct-chevron--open" : "ct-chevron"}>▾</span>
                </button>
                {reviewOpen.sshKey && (
                  <div className="ct-cluster-config-wizard__review-body">
                    <DescriptionList isCompact className="ct-cluster-config-wizard__review-detail">
                      <DescriptionListGroup>
                        <DescriptionListTerm>SSH Key 준비 방법</DescriptionListTerm>
                        <DescriptionListDescription>{sshKeyModeLabel}</DescriptionListDescription>
                      </DescriptionListGroup>
                      {sshKeyMode === "existing" ? (
                        <DescriptionListGroup>
                          <DescriptionListTerm>SSH KEY 파일</DescriptionListTerm>
                          <DescriptionListDescription>
                            {renderSSHKeyPreview(true)}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      ) : (
                        <DescriptionListGroup>
                          <DescriptionListTerm>SSH KEY 생성</DescriptionListTerm>
                          <DescriptionListDescription>배포 시작 시 자동 생성합니다.</DescriptionListDescription>
                        </DescriptionListGroup>
                      )}
                    </DescriptionList>
                  </div>
                )}
              </div>

              <div className="ct-cluster-config-wizard__review-section">
                <button
                  type="button"
                  className="ct-cluster-config-wizard__review-header"
                  onClick={() =>
                    setReviewOpen((prev) => ({ ...prev, clusterConfig: !prev.clusterConfig }))
                  }
                >
                  <span>클러스터 구성 파일</span>
                  <span className={reviewOpen.clusterConfig ? "ct-chevron ct-chevron--open" : "ct-chevron"}>▾</span>
                </button>
                {reviewOpen.clusterConfig && (
                  <div className="ct-cluster-config-wizard__review-body">
                    <DescriptionList isCompact className="ct-cluster-config-wizard__review-detail">
                      <DescriptionListGroup>
                        <DescriptionListTerm>클러스터 구성 준비</DescriptionListTerm>
                        <DescriptionListDescription>{hostsFileModeLabel}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>클러스터 호스트 구분</DescriptionListTerm>
                        <DescriptionListDescription>{clusterHostMode === "new" ? "신규 클러스터 호스트" : "추가 호스트"}</DescriptionListDescription>
                      </DescriptionListGroup>
                      {clusterType === "ablestack-vm" && (
                        <DescriptionListGroup>
                          <DescriptionListTerm>스토리지 네트워크 전용</DescriptionListTerm>
                          <DescriptionListDescription>{isIscsiExclusive ? "사용" : "미사용"}</DescriptionListDescription>
                        </DescriptionListGroup>
                      )}
                      {isHciCluster && (
                        <DescriptionListGroup>
                          <DescriptionListTerm>클러스터 관리 네트워크</DescriptionListTerm>
                          <DescriptionListDescription>
                            {pcsNodeIpSource === "ablecube" ? "Ablecube IP (관리망)" : "HOST PN (HPN)"}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      )}
                      <DescriptionListGroup>
                        <DescriptionListTerm>클러스터 구성 프로파일</DescriptionListTerm>
                        <DescriptionListDescription>
                          <TextArea
                            aria-label="클러스터 구성 프로파일 미리보기"
                            readOnly
                            value={buildHostsPreview()}
                            rows={6}
                            className="ct-cluster-config-wizard__review-textarea"
                          />
                        </DescriptionListDescription>
                      </DescriptionListGroup>
					  {!isAddHost && (
                        <>
                          <DescriptionListGroup>
                            <DescriptionListTerm>CCVM 관리 IP</DescriptionListTerm>
                            <DescriptionListDescription>{ccvmMgmtIp}</DescriptionListDescription>
                          </DescriptionListGroup>
                          <DescriptionListGroup>
                            <DescriptionListTerm>관리 NIC CIDR</DescriptionListTerm>
                            <DescriptionListDescription>{mgmtCidr}</DescriptionListDescription>
                          </DescriptionListGroup>
                          <DescriptionListGroup>
                            <DescriptionListTerm>관리 NIC Gateway</DescriptionListTerm>
                            <DescriptionListDescription>{mgmtGateway}</DescriptionListDescription>
                          </DescriptionListGroup>
                          <DescriptionListGroup>
                            <DescriptionListTerm>관리 NIC DNS</DescriptionListTerm>
                            <DescriptionListDescription>{mgmtDns}</DescriptionListDescription>
                          </DescriptionListGroup>
                        </>
                      )}
					  {isAddHost && (
                        <>
                          <DescriptionListGroup>
                            <DescriptionListTerm>IPMI IP</DescriptionListTerm>
                            <DescriptionListDescription>{ipmiIp}</DescriptionListDescription>
                          </DescriptionListGroup>
                          <DescriptionListGroup>
                            <DescriptionListTerm>IPMI 아이디</DescriptionListTerm>
                            <DescriptionListDescription>{ipmiUser}</DescriptionListDescription>
                          </DescriptionListGroup>
                        </>
                      )}
                      <DescriptionListGroup>
                        <DescriptionListTerm>cluster.json 미리보기</DescriptionListTerm>
                        <DescriptionListDescription>
                          <TextArea
                            aria-label="cluster.json 미리보기"
                            readOnly
                            value={buildClusterJsonPreview()}
                            rows={8}
                            className="ct-cluster-config-wizard__review-textarea"
                          />
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    </DescriptionList>
                  </div>
                )}
              </div>

              <div className="ct-cluster-config-wizard__review-section">
                <button
                  type="button"
                  className="ct-cluster-config-wizard__review-header"
                  onClick={() =>
                    setReviewOpen((prev) => ({ ...prev, timeServer: !prev.timeServer }))
                  }
                >
                  <span>시간서버</span>
                  <span className={reviewOpen.timeServer ? "ct-chevron ct-chevron--open" : "ct-chevron"}>▾</span>
                </button>
                {reviewOpen.timeServer && (
                  <div className="ct-cluster-config-wizard__review-body">
                    <DescriptionList isCompact className="ct-cluster-config-wizard__review-detail">
                      <DescriptionListGroup>
                        <DescriptionListTerm>로컬 시간서버</DescriptionListTerm>
                        <DescriptionListDescription>{hostRoleLabel}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>외부 시간 서버</DescriptionListTerm>
                        <DescriptionListDescription>{externalTimeServer}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>시간서버 #1</DescriptionListTerm>
                        <DescriptionListDescription>{timeServer1}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>시간서버 #2</DescriptionListTerm>
                        <DescriptionListDescription>{timeServer2}</DescriptionListDescription>
                      </DescriptionListGroup>
                    </DescriptionList>
                  </div>
                )}
              </div>
            </div>
          </div>
        </WizardStep>

        <WizardStep name="구성" id="cluster-config-finish">
          <div className="ct-cluster-config-wizard__content">
            <TaskProgress />
            <Content>
              <Content component="p">
                클러스터 구성 준비 API를 실행하고 있습니다. 각 단계의 결과에 따라 완료 또는 실패 상태가 표시됩니다.
              </Content>
            </Content>
            {deployMessage && (
              <Alert
                className="ct-cluster-config-wizard__deploy-alert"
                isInline
                variant={deployPhase === "error" ? "danger" : deployPhase === "success" ? "success" : "info"}
                title={deployMessage}
              />
            )}
            <div className="ct-cluster-config-wizard__status-list">
              {progressRows().map((row) => (
                <div
                  key={row.id}
                  className={`ct-cluster-config-wizard__status-row ct-cluster-config-wizard__status-row--${row.status} ${wizardStatusRowClass(row.status)}`}
                >
                  {progressLabel(row.status)}
                  <span className="ct-wizard-status-row__text">{row.label}</span>
                  {row.message && <small>{row.message}</small>}
                </div>
              ))}
            </div>
            {applyTargetResults.length > 0 && (
              <div className="ct-cluster-config-wizard__target-results">
                <div className="ct-cluster-config-wizard__target-results-header">
                  <strong>대상별 적용 결과</strong>
                  <span>각 호스트의 apply-local 작업 요청 결과입니다.</span>
                </div>
                <div className="ct-cluster-config-wizard__target-results-list">
                  {applyTargetResults.map((result) => (
                    <div
                      key={`${result.target}-${result.code}-${result.message}`}
                      className={[
                        "ct-cluster-config-wizard__target-result",
                        result.isFailed ? "ct-cluster-config-wizard__target-result--failed" : "ct-cluster-config-wizard__target-result--success",
                      ].join(" ")}
                    >
                      <Label color={result.isFailed ? "red" : "green"}>
                        {result.isFailed ? "실패" : "성공"}
                      </Label>
                      <strong>{formatApplyTarget(result.target)}</strong>
                      <small>Code {result.code}</small>
                      <span>{formatApplyResultMessage(result)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </WizardStep>

        <WizardStep name="완료" id="cluster-config-complete">
          <div className="ct-cluster-config-wizard__content">
            <RegistrationDownloads refreshKey={deployPhase === 'success' ? 1 : 0} />
            <Content>
              <Content component="p">
                ABLESTACK 클러스터 구성을 위한 모든 설정이 완료되었습니다.
              </Content>
              <Content component="p">
                SSH Key 파일 및 호스트 프로파일을 다운로드 받아 스토리지센터 및 클라우드센터 가상머신 배포 시 사용하십시오.
              </Content>
            </Content>
            <div className="ct-cluster-config-wizard__download-list">
              <span>
                - SSH KEY 파일 다운로드
                <a
                  className="pf-v6-c-button pf-m-link"
                  href={sshKeyBundleHref || downloadHref(sshKeyText)}
                  download="ssh-key.dat"
                >
                  파일을 재사용 하려면 클릭하십시오
                </a>
              </span>
              <span>
                - 클러스터 구성 프로파일 다운로드
                {clusterJsonDownloadHref ? (
                  <a
                    className="pf-v6-c-button pf-m-link"
                    href={clusterJsonDownloadHref}
                    download="cluster.json"
                  >
                    파일을 재사용 하려면 클릭하십시오
                  </a>
                ) : (
                  <span>{clusterJsonDownloadError || "저장된 cluster.json 파일을 확인하고 있습니다."}</span>
                )}
              </span>
            </div>
          </div>
        </WizardStep>
      </Wizard>
      </Modal>
      <ValidationErrorModal
        isOpen={Boolean(validationMessage)}
        message={validationMessage}
        onClose={() => setValidationMessage("")}
      />
    </>
  );
}
