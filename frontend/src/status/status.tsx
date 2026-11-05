import React from "react";

import {
    PageSection,
    PageSectionVariants,
    Button, Flex, FlexItem, Title,
} from "@patternfly/react-core";
import { Gallery } from "@patternfly/react-core/dist/esm/layouts/Gallery";

import CloudClusterStatus from "../cards/cloud-cluster-status.tsx";
import CloudVmStatus from "../cards/cloud-vm-status.tsx";
import GfsDiskStatus from "../cards/gfs-disk-status.tsx";
import GfsResourceStatus from "../cards/gfs-resource-status.tsx";
import StorageClusterStatus from "../cards/storage-cluster-status.tsx";
import StorageVmStatus from "../cards/storage-vm-status.tsx";
import ConfirmActionModal from "../components/common/ConfirmActionModal.tsx";
import { bootstrapCCVM } from "../services/api/cloud-vm-deploy.ts";
import {
    DEPLOY_STATUS_FALLBACK,
    fetchDeployUrl,
    type DeployStatusData,
    type DeployUrlOption,
} from "../services/api/deploy-status.ts";
import CloudVmDeployWizardModal from "../wizard/cloud-vm-deploy-wizard.tsx";
import ClusterConfigPrepareWizardModal from "../wizard/cluster-config-prepare-wizard.tsx";
import GfsStorageConfigureWizardModal from "../wizard/gfs-storage-configure-wizard.tsx";
import MonitoringCenterWizardModal from "../wizard/monitoring-center-wizard.tsx";
import StorageVmDeployWizardModal from "../wizard/storage-vm-deploy-wizard.tsx";

import AblestackUpdateModal from "./ablestack-update-modal.tsx";
import AllInOneControlModal from "./all-in-one-control-modal.tsx";
import CloudResourceConfigureModal from "./cloud-resource-configure-modal.tsx";
import ConfigFileDownloadModal from "./config-file-download-modal.tsx";
import DeploymentOverview from "./deployment-overview.tsx";
import LicenseManagementModal from "./license-management-modal.tsx";
import TaskProgress from "../components/common/TaskProgress";
import VmBackupModal from "./vm-backup-modal";
import SharedStorageModal from "./shared-storage-modal";
import PowerflexStatus from "../cards/powerflex-status";
import { requestCubeApi } from "../services/api/client";
import { fetchCurrentHostname } from "../services/host";
import SecurityEvidenceModal from "./security-evidence-modal.tsx";
import SecurityPatchModal from "./security-patch-modal.tsx";

import "./status.scss";

type DeployClusterType =
    | "powerflex"
    | "ablestack-hci"
    | "ablestack-vm"
    | "ablestack-standalone"
    | "ablestack-hci-filesystem";

export default function StatusPage() {
    const [backupOpen, setBackupOpen] = React.useState(false);
    const [sharedOpen, setSharedOpen] = React.useState(false);
    const [gfsInventory, setGfsInventory] = React.useState<'gfs' | 'rbd'>('gfs');
    const [hostname, setHostname] = React.useState("");
    const [centerKind, setCenterKind] = React.useState<'scvm' | 'ccvm'>('ccvm');
    React.useEffect(() => { fetchCurrentHostname().then(setHostname).catch(() => undefined); }, []);
    const [isClusterWizardOpen, setIsClusterWizardOpen] = React.useState(false);
    const [isStorageVmWizardOpen, setIsStorageVmWizardOpen] = React.useState(false);
    const [isCloudVmWizardOpen, setIsCloudVmWizardOpen] = React.useState(false);
    const [isMonitoringWizardOpen, setIsMonitoringWizardOpen] = React.useState(false);
    const [isGfsWizardOpen, setIsGfsWizardOpen] = React.useState(false);
    const [isConfigFileDownloadOpen, setIsConfigFileDownloadOpen] = React.useState(false);
    const [isLicenseManagementOpen, setIsLicenseManagementOpen] = React.useState(false);
    const [isAllInOneControlOpen, setIsAllInOneControlOpen] = React.useState(false);
    const [isSecurityPatchOpen, setIsSecurityPatchOpen] = React.useState(false);
    const [isAblestackUpdateOpen, setIsAblestackUpdateOpen] = React.useState(false);
    const [isSecurityEvidenceOpen, setIsSecurityEvidenceOpen] = React.useState(false);
    const [isCloudResourceOpen, setIsCloudResourceOpen] = React.useState(false);
    const [isCloudCenterConfigureOpen, setIsCloudCenterConfigureOpen] = React.useState(false);
    const [isCloudCenterConfiguring, setIsCloudCenterConfiguring] = React.useState(false);
    const [isCloudCenterConfigured, setIsCloudCenterConfigured] = React.useState(false);
    const [cloudCenterConfigureError, setCloudCenterConfigureError] = React.useState("");
    const [deployStatus, setDeployStatus] = React.useState<DeployStatusData>(DEPLOY_STATUS_FALLBACK);
    const [actionNotice, setActionNotice] = React.useState("");
    const [statusRefreshKey, setStatusRefreshKey] = React.useState(0);

    const refreshDeployOverview = React.useCallback(() => {
        setStatusRefreshKey((current) => current + 1);
    }, []);

    const openAllInOneControl = React.useCallback(() => {
        if (deployStatus.raw.licenseStatus.toLowerCase() !== "true") {
            setActionNotice("라이선스 등록을 완료한 뒤 올인원 제어를 사용할 수 있습니다.");
            setIsLicenseManagementOpen(true);
            return;
        }

        setIsAllInOneControlOpen(true);
    }, [deployStatus.raw.licenseStatus]);

    const openCenterUrl = async (option: DeployUrlOption, title: string) => {
        setActionNotice("");
        const centerWindow = window.open("about:blank", "_blank");

        if (!centerWindow) {
            setActionNotice("브라우저 팝업 차단을 해제한 후 다시 시도해주세요.");
            return;
        }

        try {
            centerWindow.document.title = title;

            const targetUrl = await fetchDeployUrl(option);

            centerWindow.opener = null;
            centerWindow.location.href = targetUrl;
        } catch (error) {
            centerWindow.close();
            setActionNotice(
                error instanceof Error ? error.message : `${title} 주소 조회에 실패했습니다.`
            );
        }
    };

    const closeCloudCenterConfigure = () => {
        if (isCloudCenterConfiguring) return;
        setIsCloudCenterConfigureOpen(false);
        setIsCloudCenterConfigured(false);
        setCloudCenterConfigureError("");
    };

    const configureCloudCenter = async () => {
        setIsCloudCenterConfiguring(true);
        setCloudCenterConfigureError("");

        try {
            if (centerKind === 'ccvm') await bootstrapCCVM();
            else await requestCubeApi('/api/v1/cube/scvm/bootstrap', { method: 'POST', body: { run_script: true }, maxTimeSeconds: 7800 });
            setIsCloudCenterConfigured(true);
            refreshDeployOverview();
        } catch (error) {
            setCloudCenterConfigureError(
                error instanceof Error ? error.message : "클라우드센터 구성에 실패했습니다."
            );
        } finally {
            setIsCloudCenterConfiguring(false);
        }
    };

    const handleDeployAction = (action: string) => {
        setActionNotice("");

        switch (action) {
        case "open_deploy_run":
            openAllInOneControl();
            break;
        case "manage_license":
            setIsLicenseManagementOpen(true);
            break;
        case "download_config_file":
            setIsConfigFileDownloadOpen(true);
            break;
        case "prepare_cluster_config":
            setIsClusterWizardOpen(true);
            break;
        case "deploy_storage_vm":
            setIsStorageVmWizardOpen(true);
            break;
        case "configure_storage_vm":
            setCenterKind('scvm');
            setCloudCenterConfigureError("");
            setIsCloudCenterConfigured(false);
            setIsCloudCenterConfigureOpen(true);
            break;
        case "configure_hci_shared_file":
            setSharedOpen(true);
            break;
        case "configure_gfs_storage":
            setGfsInventory('gfs');
            setIsGfsWizardOpen(true);
            break;
        case "configure_storage_cluster":
        case "open_storage_center":
            openCenterUrl("storageCenter", "스토리지센터 연결");
            break;
        case "deploy_cloud_vm":
            setIsCloudVmWizardOpen(true);
            break;
        case "configure_cloud_vm":
            setCenterKind('ccvm');
            setCloudCenterConfigureError("");
            setIsCloudCenterConfigured(false);
            setIsCloudCenterConfigureOpen(true);
            break;
        case "configure_cloud_cluster":
        case "open_cloud_center":
            openCenterUrl("cloudCenter", "클라우드센터 연결");
            break;
        case "configure_cloud_resource":
            setIsCloudResourceOpen(true);
            break;
        case "configure_monitoring":
            setIsMonitoringWizardOpen(true);
            break;
        case "open_monitoring_center":
            openCenterUrl("wallCenter", "모니터링센터 연결");
            break;
        case "configure_local_storage":
            openAllInOneControl();
            break;
        case "run_security_patch":
            setIsSecurityPatchOpen(true);
            break;
        case "ablestack_update":
            setIsAblestackUpdateOpen(true);
            break;
        case "security_evidence":
            setIsSecurityEvidenceOpen(true);
            break;
        default:
            setActionNotice(`${action} 작업은 아직 화면 액션에 연결되어 있지 않습니다.`);
        }
    };

    const renderDashboardCards = () => {
        const osType = deployStatus.osType;
        const usesGfs = osType === "ablestack-hci-filesystem" || osType === "ablestack-vm";
        const isKnownProduct = [
            "ablestack-hci",
            "ablestack-hci-filesystem",
            "powerflex",
            "ablestack-vm",
            "ablestack-standalone",
        ].includes(osType);
        const cards: React.ReactElement[] = [];
        const isLicenseRegistered = deployStatus.raw.licenseStatus.toLowerCase() === "true";
        const isClusterPrepared = deployStatus.raw.clusterConfigStatus.toLowerCase() === "true";

        if (!isKnownProduct || !isLicenseRegistered || !isClusterPrepared) {
            return null;
        }

        const addGfsCards = () => {
            if (!usesGfs) return;
            cards.push(
                <GfsResourceStatus
                  key="gfs-resource"
                  pollingEnabled={deployStatus.polling.gfsResource.enabled}
                />
            );
            cards.push(<GfsDiskStatus key="gfs-disk" pollingEnabled={deployStatus.polling.gfsDisk.enabled} />);
        };

        if (osType === "ablestack-vm") {
            cards.push(
                <GfsResourceStatus
                  key="gfs-resource"
                  pollingEnabled={deployStatus.polling.gfsResource.enabled}
                />
            );
            cards.push(
                <CloudClusterStatus
                  key="cloud-cluster"
                  pollingEnabled={deployStatus.polling.cloudCluster.enabled}
                />
            );
            cards.push(<GfsDiskStatus key="gfs-disk" pollingEnabled={deployStatus.polling.gfsDisk.enabled} />);
            cards.push(<CloudVmStatus key="cloud-vm" pollingEnabled={deployStatus.polling.cloudVm.enabled} />);
        } else if (osType === "ablestack-standalone") {
            cards.push(<CloudVmStatus key="cloud-vm" pollingEnabled={deployStatus.polling.cloudVm.enabled} />);
        } else if (osType === "ablestack-hci-filesystem") {
            cards.push(
                <StorageClusterStatus
                  key="storage-cluster"
                  pollingEnabled={deployStatus.polling.storageCluster.enabled}
                />
            );
            cards.push(
                <CloudClusterStatus
                  key="cloud-cluster"
                  pollingEnabled={deployStatus.polling.cloudCluster.enabled}
                />
            );
            cards.push(<StorageVmStatus key="storage-vm" pollingEnabled={deployStatus.polling.storageVm.enabled} />);
            cards.push(<CloudVmStatus key="cloud-vm" pollingEnabled={deployStatus.polling.cloudVm.enabled} />);
            addGfsCards();
        } else {
            cards.push(
                osType === 'powerflex' ? <PowerflexStatus key="powerflex" /> : <StorageClusterStatus
                  key="storage-cluster"
                  pollingEnabled={deployStatus.polling.storageCluster.enabled}
                />
            );
            cards.push(
                <CloudClusterStatus
                  key="cloud-cluster"
                  pollingEnabled={deployStatus.polling.cloudCluster.enabled}
                />
            );
            cards.push(<StorageVmStatus key="storage-vm" pollingEnabled={deployStatus.polling.storageVm.enabled} />);
            cards.push(<CloudVmStatus key="cloud-vm" pollingEnabled={deployStatus.polling.cloudVm.enabled} />);
        }

        if (cards.length === 0) {
            return null;
        }

        return (
            <PageSection className="ct-status-context">
                <Gallery
                  key={statusRefreshKey}
                  hasGutter
                  className="ct-system-status"
                >
                    {cards}
                </Gallery>
            </PageSection>
        );
    };

    return (
        <>
            <PageSection>
                <Flex alignItems={{ default: 'alignItemsCenter' }}>
                    <FlexItem flex={{ default: 'flex_1' }}><Title headingLevel="h1">ABLESTACK <small>{hostname}</small></Title></FlexItem>
                    <Button variant="link" onClick={() => setIsLicenseManagementOpen(true)}>라이선스 관리</Button>
                    <Button variant="secondary" onClick={refreshDeployOverview}>상태 새로고침</Button>
                    <Button variant="link" onClick={() => setBackupOpen(true)}>백업·복원</Button>
                    <select className="ct-workflow-select" aria-label="배포·운영 작업" value="" onChange={(event) => handleDeployAction(event.target.value)}>
                        <option value="">배포·운영 작업</option>
                        <option value="download_config_file">설정파일 다운로드</option>
                        {deployStatus.raw.licenseStatus.toLowerCase() === 'true' && <>
                            <option value="open_deploy_run">배포 단계별 작업 제어</option>
                            <option value="prepare_cluster_config">클러스터 구성 준비</option>
                            <option value="deploy_storage_vm">스토리지센터 가상머신 배포</option>
                            <option value="configure_storage_vm">스토리지센터 구성</option>
                            <option value="configure_gfs_storage">공유 스토리지 구성</option>
                            <option value="deploy_cloud_vm">클라우드센터 가상머신 배포</option>
                            <option value="configure_cloud_vm">클라우드센터 구성</option>
                            <option value="configure_cloud_resource">클라우드 리소스 구성</option>
                            <option value="configure_monitoring">모니터링센터 구성</option>
                            <option value="run_security_patch">보안 업데이트</option>
                            <option value="security_evidence">보안 증적 자료</option>
                            <option value="ablestack_update">ABLESTACK 업데이트</option>
                        </>}
                    </select>
                </Flex>
                <TaskProgress />
            </PageSection>
            <PageSection
              variant={PageSectionVariants.default}
              className="ct-status-deploy-overview"
            >
                <details className="ct-deploy-details" open={deployStatus.raw.clusterConfigStatus.toLowerCase() !== 'true'}>
                <summary>구성 및 배포 단계</summary>
                <DeploymentOverview
                  key={`deploy-overview-${statusRefreshKey}`}
                  mode="ribbon"
                  onAction={handleDeployAction}
                  onOpenDeployRun={openAllInOneControl}
                  onStatusChange={setDeployStatus}
                />
                </details>
            </PageSection>

            {actionNotice && (
                <PageSection
                  variant={PageSectionVariants.default}
                  className="ct-status-notice-section"
                >
                    <div className="ct-status-action-notice">{actionNotice}</div>
                </PageSection>
            )}

            {renderDashboardCards()}

            <ClusterConfigPrepareWizardModal
              isOpen={isClusterWizardOpen}
              onClose={() => setIsClusterWizardOpen(false)}
              onCompleted={refreshDeployOverview}
            />

            <StorageVmDeployWizardModal
              isOpen={isStorageVmWizardOpen}
              onClose={() => { setIsStorageVmWizardOpen(false); refreshDeployOverview(); }}
            />

            <CloudVmDeployWizardModal
              isOpen={isCloudVmWizardOpen}
              onClose={() => setIsCloudVmWizardOpen(false)}
              onCompleted={refreshDeployOverview}
              clusterType={deployStatus.osType as DeployClusterType}
            />

            <ConfirmActionModal
              isOpen={isCloudCenterConfigureOpen}
              title={centerKind === 'scvm' ? "스토리지센터 구성" : "클라우드센터 구성"}
              message={isCloudCenterConfiguring
                  ? <><p>구성 작업을 진행하고 있습니다.</p><TaskProgress /></>
                  : (centerKind === 'scvm' ? "스토리지센터를 구성하시겠습니까?" : "클라우드센터를 구성하시겠습니까?")}
              confirmLabel="구성"
              isSubmitting={isCloudCenterConfiguring}
              isCompleted={isCloudCenterConfigured}
              completedMessage={centerKind === 'scvm' ? "스토리지센터 구성이 완료되었습니다." : "클라우드센터 구성이 완료되었습니다."}
              errorMessage={cloudCenterConfigureError}
              onClose={closeCloudCenterConfigure}
              onConfirm={configureCloudCenter}
            />

            <MonitoringCenterWizardModal
              isOpen={isMonitoringWizardOpen}
              onClose={() => setIsMonitoringWizardOpen(false)}
              onCompleted={refreshDeployOverview}
              clusterType={deployStatus.osType as DeployClusterType}
            />

            <GfsStorageConfigureWizardModal
              diskInventoryAction={gfsInventory}
              isOpen={isGfsWizardOpen}
              onClose={() => setIsGfsWizardOpen(false)}
              onCompleted={refreshDeployOverview}
            />

            <ConfigFileDownloadModal
              isOpen={isConfigFileDownloadOpen}
              onClose={() => setIsConfigFileDownloadOpen(false)}
            />
            <VmBackupModal isOpen={backupOpen} onClose={() => setBackupOpen(false)} />
            <SharedStorageModal isOpen={sharedOpen} onClose={() => setSharedOpen(false)} onReady={() => {
                setSharedOpen(false); setGfsInventory('rbd'); setIsGfsWizardOpen(true);
            }} />

            <LicenseManagementModal
              isOpen={isLicenseManagementOpen}
              onClose={() => { setIsLicenseManagementOpen(false); refreshDeployOverview(); }}
            />

            <AllInOneControlModal
              isOpen={isAllInOneControlOpen}
              onClose={() => setIsAllInOneControlOpen(false)}
              deployStatus={deployStatus}
              onStarted={setActionNotice}
              onCompleted={refreshDeployOverview}
            />

            <SecurityPatchModal
              isOpen={isSecurityPatchOpen}
              onClose={() => setIsSecurityPatchOpen(false)}
              onCompleted={() => {
                  refreshDeployOverview();
              }}
            />

            <SecurityEvidenceModal
              isOpen={isSecurityEvidenceOpen}
              onClose={() => setIsSecurityEvidenceOpen(false)}
              onCompleted={setActionNotice}
              clusterType={deployStatus.osType as DeployClusterType}
            />

            <AblestackUpdateModal
              isOpen={isAblestackUpdateOpen}
              onClose={() => setIsAblestackUpdateOpen(false)}
              onCompleted={setActionNotice}
            />

            <CloudResourceConfigureModal
              isOpen={isCloudResourceOpen}
              onClose={() => setIsCloudResourceOpen(false)}
              onCompleted={(message) => {
                  setActionNotice(message);
                  refreshDeployOverview();
              }}
            />
        </>
    );
}
