interface PreviewRequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
}

export function isPreviewMode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const params = new URLSearchParams(window.location.search);

  return params.get("preview") === "1" || params.get("mock") === "1";
}

function normalizePath(path: string): string {
  try {
    return new URL(path, "http://localhost").pathname;
  } catch {
    return path.split("?")[0];
  }
}

function normalizeSearch(path: string): URLSearchParams {
  try {
    return new URL(path, "http://localhost").searchParams;
  } catch {
    const queryIndex = path.indexOf("?");

    return new URLSearchParams(queryIndex >= 0 ? path.slice(queryIndex + 1) : "");
  }
}

function previewSearchParams(): URLSearchParams {
  if (typeof window === "undefined") {
    return new URLSearchParams();
  }

  return new URLSearchParams(window.location.search);
}

function previewProductType(): string {
  const product = previewSearchParams().get("product") || previewSearchParams().get("osType");

  switch (product) {
  case "hci":
  case "ablestack-hci":
    return "ablestack-hci";
  case "hci-filesystem":
  case "filesystem":
  case "ablestack-hci-filesystem":
    return "ablestack-hci-filesystem";
  case "standalone":
  case "ablestack-standalone":
    return "ablestack-standalone";
  default:
    return "ablestack-vm";
  }
}

function previewDeployStatus() {
  const osType = previewProductType();
  const hasStorageCenter = osType === "ablestack-hci" || osType === "ablestack-hci-filesystem";
  const usesGfs = osType === "ablestack-vm" || osType === "ablestack-hci-filesystem";
  const usesLocalStorage = osType === "ablestack-standalone";

  return {
    code: 200,
    data: {
      os_type: osType,
      stage: "monitoring_center_connect",
      stage_order: 9,
      severity: "success",
      message_key: "ready",
      available_actions: [
        "download_config_file",
        "open_storage_center",
        "configure_gfs_storage",
        "configure_local_storage",
        "configure_cloud_vm",
        "configure_cloud_cluster",
        "configure_cloud_resource",
        "configure_monitoring",
        "open_cloud_center",
        "open_monitoring_center",
        "run_security_patch",
      ],
      warnings: [],
      polling: Object.fromEntries(['storage_vm', 'storage_cluster', 'gfs_resource', 'gfs_disk', 'cloud_vm', 'cloud_cluster', 'mold']
        .map((name) => [name, { enabled: true, reason: '' }])),
      checked_at: new Date().toISOString(),
      raw: {
        license_status: "true",
        ccfg_status: "true",
        scvm_status: hasStorageCenter ? "running" : "",
        scvm_bootstrap_status: hasStorageCenter ? "true" : "",
        sc_status: hasStorageCenter ? "HEALTH_OK" : "",
        cc_status: "HEALTH_OK",
        ccvm_status: "running",
        ccvm_bootstrap_status: "true",
        wall_monitoring_status: "true",
        gfs_configure: usesGfs ? "true" : "",
        local_configure: usesLocalStorage ? "true" : "",
        security_patch: "false",
      },
    },
  };
}

function previewGfsResourceStatus() {
  const hosts = ["ablecube1", "ablecube2", "ablecube3"];

  return {
    code: 200,
    val: {
      resources: {
        fence_resources: hosts.map((host) => ({
          id: "fence-scsi",
          node_name: host,
          role: "Started",
          active: "true",
          failed: "false",
          blocked: "false",
          maintenance: "false",
          managed: "true",
        })),
        glue_locking_resources: hosts.flatMap((host) => ([
          {
            id: "glue-dlm",
            node_name: host,
            role: "Started",
            active: "true",
            failed: "false",
            blocked: "false",
            maintenance: "false",
            managed: "true",
          },
          {
            id: "glue-lvmlockd",
            node_name: host,
            role: "Started",
            active: "true",
            failed: "false",
            blocked: "false",
            maintenance: "false",
            managed: "true",
          },
        ])),
        gfs_mount_resources: hosts.flatMap((host) => ([
          {
            id: "glue-gfs_res",
            node_name: host,
            role: "Started",
            active: "true",
            failed: "false",
            blocked: "false",
            maintenance: "false",
            managed: "true",
          },
          {
            id: "glue-gfs",
            node_name: host,
            role: "Started",
            active: "true",
            failed: "false",
            blocked: "false",
            maintenance: "false",
            managed: "true",
          },
        ])),
      },
    },
  };
}

function previewGfsDiskStatus() {
  return {
    code: 200,
    val: {
      mode: "multi",
      blockdevices: [
        {
          lvm: "vg_glue_gfs",
          mountpoint: "/mnt/glue-gfs",
          size: "1.8T",
          used: "620G",
          available: "1.18T",
          usage_percentage: "34%",
          multipaths: ["/dev/mapper/mpathb"],
          devices: ["/dev/sdb", "/dev/sdc"],
          disk_id: ["3600508b1001c2d3e"],
        },
        {
          lvm: "vg_glue_gfs_1",
          mountpoint: "/mnt/glue-gfs-1",
          size: "900G",
          used: "214G",
          available: "686G",
          usage_percentage: "24%",
          multipaths: ["/dev/mapper/mpathc"],
          devices: ["/dev/sdd", "/dev/sde"],
          disk_id: ["3600508b1001c2d3f"],
        },
      ],
    },
  };
}

function previewCloudClusterStatus() {
  const hosts = ["10.10.31.10", "10.10.31.11", "10.10.31.12"];

  return {
    code: 200,
    val: {
      clustered_host: hosts,
      started: "10.10.31.10",
      role: "Started",
      active: "true",
      blocked: "false",
      failed: "false",
      nodes: hosts.map((host, index) => ({
        host,
        online: "true",
        is_dc: index === 0 ? "true" : "false",
        resources_running: "true",
        standby: "false",
        maintenance: "false",
        pending: "false",
        unclean: "false",
        shutdown: "false",
        expected_up: "true",
      })),
    },
  };
}

function previewCloudVmStatus() {
  return {
    code: 200,
    data: {
      State: "running",
      MOLD_SERVICE_STATUS: "running",
      MOLD_DB_STATUS: "running",
      "CPU(s)": "8",
      "Max memory": "16777216",
      "Used memory": "16777216",
      DISK_CAP: "83G",
      DISK_ALLOC: "21G",
      DISK_PHY: "62G",
      DISK_USAGE_RATE: "26%",
      SECOND_DISK_CAP: "350G",
      SECOND_DISK_ALLOC: "20G",
      SECOND_DISK_PHY: "330G",
      SECOND_DISK_USAGE_RATE: "6%",
      nictype: "bridge",
      nicbridge: "bridge0",
      ip: "10.10.31.10",
      prefix: "16",
      GW: "10.10.0.1",
      DNS: "8.8.8.8",
    },
  };
}

function previewStorageClusterStatus() {
  return {
    cluster_status: "HEALTH_OK",
    osd: 6,
    osd_up: 6,
    mon_gw1: 3,
    mon_gw2: ["ablecube1", "ablecube2", "ablecube3"],
    mgr: "ablecube1",
    mgr_cnt: 3,
    pools: 4,
    avail: "18.4 TiB",
    used: "2.1 TiB",
    usage_percentage: "10%",
    maintenance_status: false,
    json_raw: {
      quorum_names: ["ablecube1", "ablecube2", "ablecube3"],
      monmap: {
        mons: [
          { name: "ablecube1" },
          { name: "ablecube2" },
          { name: "ablecube3" },
        ],
      },
      health: {
        status: "HEALTH_OK",
        checks: {},
      },
    },
  };
}

function previewStorageVmStatus() {
  return {
    code: 200,
    data: {
      scvm_status: "running",
      vcpu: "8",
      memory: "16 GiB",
      rootDiskSize: "83G",
      rootDiskAvail: "54G",
      rootDiskUsePer: "36%",
      manageNicType: "bridge",
      manageNicParent: "bridge0",
      manageNicIp: "10.10.12.10/16",
      manageNicGw: "10.10.0.1",
      manageNicDns: "8.8.8.8",
      storageServerNicType: "bridge",
      storageServerNicParent: "br-storage",
      storageServerNicIp: "100.100.0.10",
      storageReplicationNicType: "bridge",
      storageReplicationNicParent: "br-replication",
      storageReplicationNicIp: "100.101.0.10",
    },
  };
}

function previewUrl(path: string) {
  const option = normalizeSearch(path).get("option");
  const urls = {
    cloudCenter: "https://10.10.31.10:9090",
    storageCenter: "https://10.10.12.10:9090",
    wallCenter: "https://10.10.32.10:9090",
  };

  return {
    code: 200,
    val: option && option in urls
      ? { [option]: urls[option as keyof typeof urls] }
      : urls,
  };
}

function previewClusterConfig() {
  const osType = previewProductType();
  const isHci = osType === "ablestack-hci" || osType === "ablestack-hci-filesystem";
  const isVm = osType === "ablestack-vm";
  const isStandalone = osType === "ablestack-standalone";
  const hosts = isHci
    ? [
      {
        index: "1",
        hostname: "ablecube1",
        ablecube: "10.10.12.1",
        ablecubePn: "100.100.12.1",
        scvmMngt: "10.10.12.10",
        scvm: "100.100.12.10",
        scvmCn: "100.200.12.10",
      },
      {
        index: "2",
        hostname: "ablecube2",
        ablecube: "10.10.12.2",
        ablecubePn: "100.100.12.2",
        scvmMngt: "10.10.12.11",
        scvm: "100.100.12.11",
        scvmCn: "100.200.12.11",
      },
      {
        index: "3",
        hostname: "ablecube3",
        ablecube: "10.10.12.3",
        ablecubePn: "100.100.12.3",
        scvmMngt: "10.10.12.12",
        scvm: "100.100.12.12",
        scvmCn: "100.200.12.12",
      },
    ]
    : [
      {
        index: "1",
        hostname: "ablecube1",
        ablecube: "10.10.31.1",
        ...(isVm ? { ablecubePn: "100.100.31.1" } : {}),
      },
      ...(!isStandalone ? [
      {
        index: "2",
        hostname: "ablecube2",
        ablecube: "10.10.31.2",
        ...(isVm ? { ablecubePn: "100.100.31.2" } : {}),
      },
      {
        index: "3",
        hostname: "ablecube3",
        ablecube: "10.10.31.3",
        ...(isVm ? { ablecubePn: "100.100.31.3" } : {}),
      },
      ] : []),
    ];

  return {
    type: osType,
    backup_path: "/mnt/glue-gfs/backup/ccvm",
    ccvm: { ip: "10.10.31.10" },
    mngtNic: {
      cidr: "16",
      gw: "10.10.0.1",
      dns: "8.8.8.8",
    },
    pcsCluster: isHci
      ? {
        hostname1: "100.100.12.1",
        hostname2: "100.100.12.2",
        hostname3: "100.100.12.3",
      }
      : {
        hostname1: "10.10.31.1",
        hostname2: "10.10.31.2",
        hostname3: "10.10.31.3",
      },
    hosts,
    external_timeserver: "time.google.com",
    storage_network: isVm ? "true" : "false",
  };
}

function previewNicInventory() {
  return {
    bridges: [
      {
        DEVICE: "bridge0",
        TYPE: "bridge",
        STATE: "connected",
        MODEL: "Management bridge",
        IPV4: {
          ENABLE: true,
          ADDRESSES: [{ FAMILY: "inet", ADDRESS: "10.10.12.1", PREFIXLEN: 16 }],
        },
      },
      {
        DEVICE: "br-storage",
        TYPE: "bridge",
        STATE: "connected",
        MODEL: "Storage bridge",
      },
      {
        DEVICE: "br-replication",
        TYPE: "bridge",
        STATE: "connected",
        MODEL: "Replication bridge",
      },
    ],
    ethernets: [
      {
        DEVICE: "eno1",
        TYPE: "ethernet",
        STATE: "connected",
        PCI: "0000:18:00.0",
        SPEED: "10G",
        MODEL: "Intel X710",
      },
      {
        DEVICE: "eno2",
        TYPE: "ethernet",
        STATE: "connected",
        PCI: "0000:18:00.1",
        SPEED: "10G",
        MODEL: "Intel X710",
      },
      {
        DEVICE: "ens1f0",
        TYPE: "ethernet",
        STATE: "connected",
        PCI: "0000:3b:00.0",
        SPEED: "25G",
        MODEL: "Mellanox ConnectX",
      },
      {
        DEVICE: "ens1f1",
        TYPE: "ethernet",
        STATE: "connected",
        PCI: "0000:3b:00.1",
        SPEED: "25G",
        MODEL: "Mellanox ConnectX",
      },
    ],
    bonds: [],
    others: [],
    refresh_time: new Date().toISOString(),
  };
}

function previewDiskInventory() {
  return {
    blockdevices: [
      {
        name: "mpathb",
        kname: "dm-2",
        path: "/dev/mapper/mpathb",
        size: "1.8T",
        state: "running",
        type: "mpath",
        vendor: "DELL",
        model: "ME5",
        wwn: "3600508b1001c2d3e",
        single_path: [
          {
            name: "sdb",
            kname: "sdb",
            path: "/dev/sdb",
            size: "1.8T",
            state: "running",
            type: "disk",
          },
        ],
      },
      {
        name: "mpathc",
        kname: "dm-3",
        path: "/dev/mapper/mpathc",
        size: "900G",
        state: "running",
        type: "mpath",
        vendor: "DELL",
        model: "ME5",
        wwn: "3600508b1001c2d3f",
      },
    ],
    raidcontrollers: [
      {
        Slot: "0000:5e:00.0",
        Class: "RAID bus controller",
        Device: "MegaRAID SAS-3 Controller",
        Vendor: "Broadcom",
      },
    ],
    refresh_time: new Date().toISOString(),
  };
}

export function getPreviewCubeApiResponse<T>(
  path: string,
  options: PreviewRequestOptions = {}
): T | undefined {
  if (!isPreviewMode()) {
    return undefined;
  }

  const normalizedPath = normalizePath(path);

  if (normalizedPath.startsWith("/api/v1/mold/jobs/")) {
    return {
      code: 200,
      job: {
        job_id: "preview-mold-job",
        status: "succeeded",
        current_step: "",
        message: "프리뷰 모드 클라우드 리소스 구성이 완료되었습니다.",
        steps: [
          { name: "create_zone", command: "createZone", status: "succeeded", message: "ok" },
          { name: "create_pod", command: "createPod", status: "succeeded", message: "ok" },
          { name: "add_host", command: "addHost", status: "succeeded", message: "ok" },
          { name: "add_primary_storage", command: "createStoragePool", status: "succeeded", message: "ok" },
          { name: "add_secondary_storage", command: "addImageStore", status: "succeeded", message: "ok" },
        ],
      },
      message: "ok",
    } as T;
  }

  switch (normalizedPath) {
  case "/api/v1/cube/system/context":
    return { code: 200, role: previewSearchParams().get('role') === 'scvm' ? 'scvm' : 'host', hostname: 'ablecube1' } as T;
  case "/api/v1/cube/_tasks":
    return { code: 200, jobs: [] } as T;
  case "/api/v1/cube/downloads":
    return (options.body as {kind?: string})?.kind === "registrations" ? { code: 200, files: [] } as T
      : { code: 200, content: window.btoa("preview"), filename: "preview" } as T;
  case "/api/v1/cube/license":
    return { code: 200, val: { status: "active", issued: "2025-11-11", expired: "9999-12-31", oem: null } } as T;
  case "/api/v1/cube/infrastructure/status":
    return { code: 200, val: { health: "ok", resource_started: true, ccvm_running_node: "ablecube1", current_dc: "ablecube2", online_nodes: ["ablecube1", "ablecube2", "ablecube3"], offline_nodes: [] } } as T;
  case "/api/v1/cube/deploy/status":
    return previewDeployStatus() as T;
  case "/api/v1/cube/deploy/jobs":
    return { code: 200, jobs: [] } as T;
  case "/api/v1/cube/deploy/run":
    return {
      code: 200,
      job_id: "preview-job",
      status: "succeeded",
      message: "프리뷰 모드에서 실행이 완료된 것으로 표시합니다.",
      steps: [],
    } as T;
  case "/api/v1/version":
    return {
      code: 200,
      os_version: "ABLESTACK 2026",
      kernel_version: "5.14.0-503.35.1.el9_5.x86_64",
      cockpit_version: "344",
      mold_version: "4.20.0",
      glue_version: "glue version 1.0.0",
    } as T;
  case "/api/v1/cube/gfs/resource/status":
    return previewGfsResourceStatus() as T;
  case "/api/v1/cube/gfs/disk/status":
    return previewGfsDiskStatus() as T;
  case "/api/v1/cube/pcs/control": {
    const body = typeof options.body === "object" && options.body
      ? options.body as { action?: unknown; target?: unknown }
      : {};
    const action = String(body.action ?? "status");

    if (action === "status") {
      return previewCloudClusterStatus() as T;
    }

    return {
      code: 200,
      action,
      target: String(body.target ?? "10.10.31.10"),
      message: "preview ok",
      val: "ok",
    } as T;
  }
  case "/api/v1/cube/ccvm/lifecycle":
    return {
      code: 200,
      message: "preview ok",
      val: "cloud center lifecycle success",
    } as T;
  case "/api/v1/cube/license/apply":
    return {
      code: 200,
      message: "license apply success",
      results: [{ role: "ccvm", hostname: "ccvm", target: "10.10.31.10", code: 200, attempts: 1 }],
    } as T;
  case "/api/v1/cube/ccvm/bootstrap":
    return {
      code: 200,
      role: "ccvm",
      message: "ccvm_bootstrap success",
    } as T;
  case "/api/v1/cube/ccvm/monitoring/config":
    return {
      code: 200,
      message: "preview ok",
      val: "monitoring config update success",
    } as T;
  case "/api/v1/cube/ccvm/status":
    return previewCloudVmStatus() as T;
  case "/api/v1/cube/ccvm/edit":
  case "/api/v1/cube/ccvm/secondary/resize":
  case "/api/v1/cube/ccvm/service/control":
  case "/api/v1/cube/db/dump":
  case "/api/v1/cube/scvm/lifecycle":
  case "/api/v1/cube/auto-shutdown":
  case "/api/v1/cube/cluster/apply":
  case "/api/v1/cube/cluster/apply-local":
    return { code: 200, message: "preview ok", val: "ok" } as T;
  case "/api/v1/cube/ccvm/snap": {
    const body = typeof options.body === "object" && options.body
      ? options.body as { action?: unknown }
      : {};
    const action = String(body.action ?? "list");
    return {
      code: 200,
      action,
      message: "preview ok",
      val: action === "list"
        ? [{ name: "2026-08-06-01:00:00" }, { name: "2026-08-05-01:00:00" }]
        : "ok",
    } as T;
  }
  case "/api/v1/cube/gluecluster/status":
    return previewStorageClusterStatus() as T;
  case "/api/v1/cube/scvm/status":
    return previewStorageVmStatus() as T;
  case "/api/v1/cube/url":
    return previewUrl(path) as T;
  case "/api/v1/cube/multipath/sync":
    return {
      code: 200,
      message: "preview ok",
      action: typeof options.body === "object" && options.body && "action" in options.body
        ? String((options.body as { action?: unknown }).action)
        : "sync",
      target: "fanout",
      results: [
        {
          hostname: "ablecube1",
          target: "10.10.31.10",
          code: 200,
          message: "ok",
          steps: [
            { name: "rescan_scsi", status: "succeeded", message: "ok" },
            { name: "restart_multipathd", status: "succeeded", message: "ok" },
          ],
        },
      ],
    } as T;
  case "/api/v1/cube/gfs/manage": {
    const body = typeof options.body === "object" && options.body
      ? options.body as { action?: unknown }
      : {};
    const action = String(body.action ?? "init-pcs-cluster");

    return {
      code: 200,
      action,
      target: action === "configure-stonith" ? "local" : "fanout",
      message: "preview ok",
      val: action === "configure-stonith"
        ? { configured: true, stonithEnabled: true }
        : action === "check-host"
          ? [
              { hostname: "ablecube1", ablecube: "10.10.12.1" },
              { hostname: "ablecube2", ablecube: "10.10.12.2" },
              { hostname: "ablecube3", ablecube: "10.10.12.3" },
            ]
          : action === "list-gfs"
            ? [{ vg_name: "vg_glue" }, { vg_name: "vg_glue_1" }]
            : "ok",
      results: action === "configure-stonith"
        ? []
        : [
            { hostname: "ablecube1", target: "10.10.12.1", code: 200, message: "완료" },
            { hostname: "ablecube2", target: "10.10.12.2", code: 200, message: "완료" },
            { hostname: "ablecube3", target: "10.10.12.3", code: 200, message: "완료" },
          ],
    } as T;
  }
  case "/api/v1/cube/clvm/manage": {
    const body = typeof options.body === "object" && options.body
      ? options.body as { action?: unknown }
      : {};
    const action = String(body.action ?? "list-clvm");
    return {
      code: 200,
      action,
      message: "preview ok",
      val: action === "list-clvm" ? [
        {
          vg_name: "vg_clvm01",
          pv_name: "/dev/mapper/mpathb1",
          pv_size: "500.00 GiB",
          wwn: "3600d0230000000000e13955cc3757801",
          disk_id: "/dev/mapper/mpathb",
        },
      ] : "ok",
    } as T;
  }
  case "/api/v1/cube/hba/manage":
    return {
      code: 200,
      val: [
        {
          hostname: "ablecube1",
          target: "10.10.31.10",
          wwn: ["10:00:00:00:c9:aa:bb:01", "10:00:00:00:c9:aa:bb:02"],
        },
      ],
    } as T;
  case "/api/v1/cube/security/patch":
    return {
      code: 200,
      val: {
        summary: {
          message: "프리뷰 모드 취약점 조치 결과입니다.",
          total: 3,
          success: 3,
          failed: 0,
          dryRun: true,
        },
      },
    } as T;
  case "/api/v1/cube/security/evidence":
    return {
      code: 200,
      message: "preview ok",
      val: {
        path: "/var/lib/ablestack/security-evidence/security-evidence.zip",
        filename: "security-evidence-preview.zip",
        size: 5242880,
        generated_at: new Date().toISOString(),
        hosts: 3,
        collected_hosts: ["ablecube1", "ablecube2", "ablecube3"],
        requested_hosts: 3,
        requested_targets: ["all"],
        cluster_type: previewProductType(),
        target_groups: ["ablecube", "ccvm"],
        items: 67,
        slides: 67,
        collector_status: 0,
        download_available: true,
      },
    } as T;
  case "/api/v1/mold/bootstrap/plan":
    return {
      code: 200,
      val: {
        ready: true,
        missing_inputs: [],
        notes: ["preview"],
        steps: [
          { name: "wait_mold_api_ready", command: "listCapabilities", verify_command: "listCapabilities" },
          { name: "login_admin", command: "login", verify_command: "listCapabilities" },
          { name: "create_zone", command: "createZone", verify_command: "listZones" },
          { name: "create_pod", command: "createPod", verify_command: "listPods" },
          { name: "add_host", command: "addHost", verify_command: "listHosts" },
          { name: "add_primary_storage", command: "createStoragePool", verify_command: "listStoragePools" },
          { name: "add_secondary_storage", command: "addImageStore", verify_command: "listImageStores" },
          { name: "enable_zone", command: "updateZone", verify_command: "listZones" },
          { name: "final_health_check", verify_command: "listZones,listHosts,listStoragePools" },
        ],
      },
    } as T;
  case "/api/v1/mold/bootstrap":
    return {
      code: 202,
      job_id: "preview-mold-job",
      status: "queued",
      message: "preview mold bootstrap job started",
      steps: [
        { name: "create_zone", command: "createZone", status: "pending" },
        { name: "add_host", command: "addHost", status: "pending" },
      ],
    } as T;
  case "/api/v1/cube/version/update": {
    const body = typeof options.body === "object" && options.body
      ? options.body as { action?: unknown; mount_path?: unknown; update_type?: unknown }
      : {};
    const updateType = String(body.update_type ?? "all") === "mold" ? "mold" : "all";
    const isRun = String(body.action ?? "info") === "run";

    return {
      code: 200,
      action: isRun ? "run" : "info",
      message: isRun
        ? "프리뷰 모드 ABLESTACK 업데이트 실행이 완료되었습니다."
        : "ok",
      val: {
        message: isRun ? "프리뷰 모드 ABLESTACK 업데이트 실행이 완료되었습니다." : undefined,
        mount_path: String(body.mount_path ?? "/mnt/ablestack-iso"),
        copy_path: "/opt/ABLESTACK_UPDATE",
        current_os_version: "ABLESTACK Diplo v4.6.1",
        current_mold_version: "4.20.0",
        target_os_version: updateType === "all" ? "ABLESTACK Diplo v4.7.0" : "ABLESTACK Diplo v4.6.1",
        target_mold_version: "4.21.0",
        update_type: updateType,
        update_label: updateType === "mold" ? "Mold 업데이트" : "전체 업데이트",
        update_script: updateType === "mold"
          ? "/mnt/ablestack-iso/update_mold.sh"
          : "/mnt/ablestack-iso/update_all.sh",
        work_update_script: updateType === "mold"
          ? "/opt/ABLESTACK_UPDATE/update_mold.sh"
          : "/opt/ABLESTACK_UPDATE/update_all.sh",
        stdout: isRun ? "preview update completed" : "",
        stderr: "",
      },
    } as T;
  }
  case "/api/v1/cube/cluster/config":
    return previewClusterConfig() as T;
  case "/api/v1/cube/nics":
    return previewNicInventory() as T;
  case "/api/v1/cube/disk":
    return previewDiskInventory() as T;
  case "/api/v1/cube/system/config":
    return {
      code: 200,
      val: JSON.stringify({ preview: true }, null, 2),
    } as T;
  default:
    return {
      code: 200,
      message: "preview ok",
      val: {},
    } as T;
  }
}
