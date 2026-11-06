import { requestCubeApi } from "./client";
import { fetchUiFeatures } from "./system-config";

export interface InventorySelectOption {
  value: string;
  label: string;
}

export interface NicInventory {
  bridges: InventorySelectOption[];
  passthroughNics: InventorySelectOption[];
  refreshTime: string;
}

export interface DiskInventoryOption {
  id: string;
  value: string;
  name: string;
  path: string;
  device: string;
  deviceId: string;
  size: string;
  state: string;
  model: string;
  vendor: string;
  type: string;
  uuid: string;
  pathMode: string;
  inUse: boolean;
  inUseReason: string;
  label: string;
}

export interface DiskSelectOption {
  id: string;
  value: string;
  label: string;
  isDisabled?: boolean;
  disabledReason?: string;
}

export interface StorageVmDiskInventory {
  lunPassthroughEnabled: boolean;
  raidDisks: DiskSelectOption[];
  physicalDisks: DiskSelectOption[];
  lunDisks: DiskSelectOption[];
}

type RecordValue = Record<string, unknown>;
type DiskInventoryAction = "list" | "gfs" | "rbd" | "detail";

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function unwrapApiValue(value: unknown): unknown {
  const parsed = parseMaybeJson(value);

  if (!isRecord(parsed)) return parsed;

  if (parsed.data !== undefined) return unwrapApiValue(parsed.data);
  if (parsed.val !== undefined) return unwrapApiValue(parsed.val);

  return parsed;
}

function readString(source: RecordValue, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }

  return "";
}

function readRecordArray(source: RecordValue, key: string): RecordValue[] {
  const value = source[key];

  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function deviceLabel(device: RecordValue, includePci: boolean): string {
  const name = readString(device, ["DEVICE", "device", "name"]);
  const type = readString(device, ["TYPE", "type"]);
  const state = readString(device, ["STATE", "state"]);
  const pci = readString(device, ["PCI", "pci"]);
  const speed = readString(device, ["SPEED", "speed"]);
  const model = readString(device, ["MODEL", "model"]);
  const details = [
    type,
    includePci ? pci : "",
    state,
    speed,
    model,
  ].filter(Boolean);

  return details.length > 0 ? `${name} (${details.join(" · ")})` : name;
}

function nicOptionValue(device: RecordValue, preferPci: boolean): string {
  const pci = readString(device, ["PCI", "pci"]);
  const name = readString(device, ["DEVICE", "device", "name"]);

  return preferPci && pci ? pci : name;
}

function uniqueOptions(options: InventorySelectOption[]): InventorySelectOption[] {
  const seen = new Set<string>();

  return options.filter((option) => {
    if (!option.value || seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

export async function fetchNicInventory(): Promise<NicInventory> {
  const raw = await requestCubeApi<unknown>("/api/v1/cube/nics?action=detail");
  const inventory = unwrapApiValue(raw);
  const record = isRecord(inventory) ? inventory : {};
  const bridges = readRecordArray(record, "bridges").filter((device) => !['virbr0', 'lo'].includes(nicOptionValue(device, false)));
  const passthroughDevices = [
    ...readRecordArray(record, "ethernets"),
    ...readRecordArray(record, "bonds"),
  ];

  return {
    bridges: [
      { value: "", label: "선택하십시오" },
      ...uniqueOptions(
        bridges.map((device) => ({
          value: nicOptionValue(device, false),
          label: deviceLabel(device, false),
        }))
      ),
    ],
    passthroughNics: uniqueOptions(
      passthroughDevices.map((device) => ({
        value: nicOptionValue(device, true),
        label: deviceLabel(device, true),
      }))
    ),
    refreshTime: readString(record, ["refresh_time", "refreshTime"]),
  };
}

function readOptionalString(source: RecordValue, key: string): string {
  const value = source[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);

  return "";
}

function readBoolean(source: RecordValue, key: string): boolean {
  const value = source[key];
  return value === true || value === 1 || value === "true";
}

function diskPath(device: RecordValue): string {
  const path = readOptionalString(device, "path");
  const rbdPath = readOptionalString(device, "rbd_path");
  const id = readOptionalString(device, "id");
  const name = readOptionalString(device, "name");
  const kname = readOptionalString(device, "kname");

  if (path) return path;
  if (rbdPath) return rbdPath;
  if (id) return id;
  if (kname) return `/dev/${kname}`;
  if (name) return name.startsWith("/dev/") ? name : `/dev/${name}`;

  return "";
}

function flattenDisks(devices: RecordValue[]): RecordValue[] {
  return devices.flatMap((device) => {
    const children = [
      ...readRecordArray(device, "single_path"),
      ...readRecordArray(device, "children"),
    ];

    return [device, ...flattenDisks(children)];
  });
}

function diskOption(device: RecordValue, preferStableId = false): DiskInventoryOption {
  const name = readOptionalString(device, "name") || readOptionalString(device, "kname");
  const path = diskPath(device);
  const deviceId = readOptionalString(device, "id");
  const size = readOptionalString(device, "size");
  const state = readOptionalString(device, "state");
  const type = readOptionalString(device, "type");
  const vendor = readOptionalString(device, "vendor");
  const model = readOptionalString(device, "model");
  const wwn = readOptionalString(device, "wwn");
  const uuid = readOptionalString(device, "uuid") || wwn;
  const pathMode = readOptionalString(device, "path_mode") || "single";
  const inUse = readBoolean(device, "in_use");
  const inUseReason = readOptionalString(device, "in_use_reason");
  const details = [path, uuid, pathMode, state, size, vendor, model, inUse ? "사용 중 (파티션 존재)" : ""].filter(Boolean);
  const value = preferStableId ? deviceId : path || deviceId || name;

  return {
    id: value,
    value,
    name,
    path,
    device: path || name,
    deviceId,
    size,
    state,
    model,
    vendor,
    type,
    uuid,
    pathMode,
    inUse,
    inUseReason,
    label: [name, ...details].filter(Boolean).join(" "),
  };
}

export async function fetchDiskInventory(action: DiskInventoryAction = "list"): Promise<DiskInventoryOption[]> {
  const raw = await requestCubeApi<unknown>(`/api/v1/cube/disk?action=${action}`);
  const inventory = unwrapApiValue(raw);
  const record = isRecord(inventory) ? inventory : {};
  const rawDevices = readRecordArray(record, "blockdevices");
  const sourceDevices = action === "gfs" || action === "detail"
    ? rawDevices
    : flattenDisks(rawDevices);
  const devices = sourceDevices
    .map((device) => diskOption(device, action === "gfs"))
    .filter((disk) => disk.value);
  const seen = new Set<string>();

  return devices.filter((disk) => {
    if (seen.has(disk.value)) return false;
    seen.add(disk.value);
    return true;
  });
}

function raidControllerOption(controller: RecordValue, index: number): DiskSelectOption | null {
  const slot = readString(controller, ["Slot", "slot", "PCI", "pci"]);
  const className = readString(controller, ["Class", "class"]);
  const vendor = readString(controller, ["Vendor", "vendor"]);
  const device = readString(controller, ["Device", "device", "Model", "model"]);
  const value = slot;

  if (!value) return null;

  return {
    id: value || `raid-${index + 1}`,
    value,
    label: [slot, className, vendor, device].filter(Boolean).join(" "),
  };
}

function diskSelectOption(disk: DiskInventoryOption, index: number): DiskSelectOption {
  return {
    id: disk.value || `disk-${index + 1}`,
    value: disk.value,
    label: disk.label,
  };
}

function physicalDiskOption(device: RecordValue): DiskSelectOption | null {
  // Match the legacy wizard: use the collector's top-level devices, never its children.
  if (readOptionalString(device, "type").toLowerCase() !== "disk") return null;
  const name = readString(device, ["kname", "name"]);
  const disk = diskOption(device);
  if (!name || !disk.value) return null;
  const hasPartitions = readRecordArray(device, "children").length > 0;
  const isDisabled = hasPartitions || disk.inUse;
  return {
    id: disk.value,
    value: disk.value,
    label: name.startsWith("/dev/") ? name : `/dev/${name}`,
    isDisabled,
    disabledReason: isDisabled ? disk.inUseReason || "파티션이 있거나 사용 중인 디스크는 선택할 수 없습니다." : undefined,
  };
}

export async function fetchStorageVmDiskInventory(): Promise<StorageVmDiskInventory> {
  const raw = await requestCubeApi<unknown>("/api/v1/cube/disk?action=list");
  const inventory = unwrapApiValue(raw);
  const record = isRecord(inventory) ? inventory : {};
  const raidDisks = readRecordArray(record, "raidcontrollers")
    .map(raidControllerOption)
    .filter((option): option is DiskSelectOption => Boolean(option));
  const physicalDisks = readRecordArray(record, "blockdevices")
    .map(physicalDiskOption)
    .filter((option): option is DiskSelectOption => Boolean(option));
  const lunDisks = flattenDisks(readRecordArray(record, "blockdevices"))
    .map((device) => diskOption(device))
    .filter((disk) => disk.value)
    .map(diskSelectOption);
  const seenLun = new Set<string>();
  const seenPhysical = new Set<string>();

  return {
    lunPassthroughEnabled: (await fetchUiFeatures()).scvmLunPassthrough,
    raidDisks,
    physicalDisks: physicalDisks.filter((disk) => {
      if (seenPhysical.has(disk.value)) return false;
      seenPhysical.add(disk.value);
      return true;
    }),
    lunDisks: lunDisks.filter((disk) => {
      if (seenLun.has(disk.value)) return false;
      seenLun.add(disk.value);
      return true;
    }),
  };
}
