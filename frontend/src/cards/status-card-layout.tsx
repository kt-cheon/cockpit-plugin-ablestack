import React from "react";

interface StatusCardHeadingProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tone: "storage" | "cloud" | "storage-vm" | "cloud-vm" | "gfs" | "disk" | "local";
}

interface InfoItemProps {
  label: string;
  children: React.ReactNode;
  full?: boolean;
  mono?: boolean;
}

interface UsageProgressProps {
  label: string;
  value: string;
}

interface StorageCapacitySummaryProps {
  total: string;
  usable: string;
  available: string;
  used: string;
  usagePercentage: string;
}

interface NicGroupProps {
  title: string;
  items: Array<{
    label: string;
    value: string;
  }>;
}

interface DotStatusProps {
  tone: string;
  children: React.ReactNode;
}

function isKnownValue(value: string | undefined | null): value is string {
  const normalized = String(value ?? "").trim().toUpperCase();

  return normalized !== "" && normalized !== "N/A";
}

export function stripStatusLabel(value: string, label: string): string {
  if (!isKnownValue(value)) {
    return "";
  }

  return value.replace(new RegExp(`^${label}\\s*:\\s*`, "i"), "").trim();
}

export function nicName(value: string): string {
  if (!isKnownValue(value)) {
    return "";
  }

  const parentMatch = value.match(/\(Parent\s*:\s*([^)]+)\)/i);

  if (parentMatch?.[1]) {
    return parentMatch[1].trim().toLowerCase();
  }

  const parentOnlyMatch = value.match(/^Parent\s*:\s*(.+)$/i);

  if (parentOnlyMatch?.[1]) {
    return parentOnlyMatch[1].trim().toLowerCase();
  }

  const typeOnlyMatch = value.match(/^NIC Type\s*:\s*(.+)$/i);

  if (typeOnlyMatch?.[1]) {
    return typeOnlyMatch[1].replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();
  }

  return value.trim().toLowerCase();
}

export function statusIpWithPrefix(ipValue: string, prefixValue: string): string {
  const ip = stripStatusLabel(ipValue, "IP");
  const prefix = stripStatusLabel(prefixValue, "PREFIX");

  if (!ip) {
    return "";
  }

  return prefix ? `${ip}/${prefix}` : ip;
}

export function parseUsagePercent(value: string): number | null {
  const match = value.match(/(\d+(?:\.\d+)?)\s*%/);

  if (!match) {
    return null;
  }

  return Math.max(0, Math.min(100, Number(match[1])));
}

export function compactStorageCapacity(value: string): string {
  const match = value.match(/^전체\s+(.+?)\s+중\s+(.+?)\s+사용\s+중\s+\(사용률\s+(.+?)\)$/);

  if (!match) {
    return value;
  }

  return `${match[2]} / ${match[1]} (${match[3]})`;
}

function deriveUsedCapacity(capacity: string | undefined, available: string | undefined): string | null {
  if (!capacity || !available) {
    return null;
  }

  const capacityMatch = capacity.match(/^(\d+(?:\.\d+)?)\s*([kmgtpe]i?b?|[kmgtpe])$/i);
  const availableMatch = available.match(/^(\d+(?:\.\d+)?)\s*([kmgtpe]i?b?|[kmgtpe])$/i);

  if (!capacityMatch || !availableMatch) {
    return null;
  }

  const capacityUnit = capacityMatch[2].toUpperCase();
  const availableUnit = availableMatch[2].toUpperCase();

  if (capacityUnit !== availableUnit) {
    return null;
  }

  const used = Number(capacityMatch[1]) - Number(availableMatch[1]);

  if (!Number.isFinite(used) || used < 0) {
    return null;
  }

  const roundedUsed = Number.isInteger(used) ? String(used) : used.toFixed(2).replace(/\.?0+$/, "");

  return `${roundedUsed}${capacityMatch[2]}`;
}

export function compactDiskUsage(value: string): string {
  const capacity = value.match(/^([^(]+?)\s*\(/)?.[1]?.trim();
  const rawUsed = value.match(/사용\s+([^/()]+?)(?:\s*\/|\s*\))/)?.[1]?.trim();
  const available = value.match(/사용가능\s+([^/()]+?)(?:\s*\/|\s*\))/)?.[1]?.trim();
  const usageRate = value.match(/사용률\s+([^/()]+?)\)/)?.[1]?.trim();
  const used = rawUsed || deriveUsedCapacity(capacity, available) || undefined;

  if (!capacity || !usageRate) {
    return value;
  }

  const details = [
    used ? `${used} 사용` : "",
    available ? `${available} 가능` : "",
    `전체 ${capacity}`,
  ].filter(Boolean);

  return `${details.join(" / ")} (${usageRate})`;
}

export function StatusCardHeading({
  icon,
  title,
  subtitle,
  tone,
}: StatusCardHeadingProps) {
  return (
    <div className="ct-status-card__title-group">
      <div className={`ct-status-card__icon ct-status-card__icon--${tone}`}>
        {icon}
      </div>
      <div className="ct-status-card__title-text">
        <span className="ct-status-card__title-main">{title}</span>
        <span className="ct-status-card__subtitle">{subtitle}</span>
      </div>
    </div>
  );
}

export function InfoGrid({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={["ct-status-card__info-grid", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

export function InfoItem({ label, children, full = false, mono = false }: InfoItemProps) {
  return (
    <div className={`ct-status-card__info-item${full ? " ct-status-card__info-item--full" : ""}`}>
      <span className="ct-status-card__info-label">{label}</span>
      <span className={`ct-status-card__info-value${mono ? " ct-status-card__info-value--mono" : ""}`}>
        {children}
      </span>
    </div>
  );
}

export function UsageProgress({ label, value }: UsageProgressProps) {
  const percent = parseUsagePercent(value);

  return (
    <div className="ct-status-card__progress">
      <div className="ct-status-card__progress-header">
        <span className="ct-status-card__info-label">{label}</span>
        <span className="ct-status-card__progress-value">{value}</span>
      </div>
      <div className="ct-status-card__progress-track">
        <div
          className="ct-status-card__progress-fill"
          style={{ inlineSize: `${percent ?? 0}%` }}
        />
      </div>
    </div>
  );
}

export function StorageCapacitySummary({
  total,
  usable,
  available,
  used,
  usagePercentage,
}: StorageCapacitySummaryProps) {
  const percent = parseUsagePercent(usagePercentage);
  const progressValue = [
    isKnownValue(used) ? `${used} 사용 중` : "",
    isKnownValue(available) ? `${available} 사용 가능` : "",
    isKnownValue(usagePercentage) ? `사용률 ${usagePercentage}` : "",
  ].filter(Boolean).join(" / ") || "N/A";

  return (
    <div className="ct-status-card__capacity">
      <div className="ct-status-card__capacity-header">
        <span className="ct-status-card__info-label">스토리지 용량</span>
      </div>
      <div className="ct-status-card__capacity-grid">
        <div className="ct-status-card__capacity-item">
          <span>총 용량</span>
          <strong>{isKnownValue(total) ? total : "N/A"}</strong>
        </div>
        <div className="ct-status-card__capacity-item">
          <span>Usable 용량</span>
          <strong>{isKnownValue(usable) ? usable : "N/A"}</strong>
        </div>
        <div className="ct-status-card__capacity-item">
          <span>사용 가능 용량</span>
          <strong>{isKnownValue(available) ? available : "N/A"}</strong>
        </div>
      </div>
      <div className="ct-status-card__capacity-usage">
        <span className="ct-status-card__info-label">사용량</span>
        <span className="ct-status-card__progress-value">{progressValue}</span>
      </div>
      <div className="ct-status-card__capacity-bar">
        <div
          className="ct-status-card__capacity-fill"
          style={{ inlineSize: `${percent ?? 0}%` }}
        />
      </div>
    </div>
  );
}

export function CardDivider() {
  return <div className="ct-status-card__divider" />;
}

export function DotStatus({ tone, children }: DotStatusProps) {
  const normalizedTone = String(tone || "grey").toLowerCase();

  return (
    <span className={`ct-card-dot-status ct-card-dot-status--${normalizedTone}`}>
      {children}
    </span>
  );
}

export function NicGroup({ title, items }: NicGroupProps) {
  const knownItems = items.filter((item) => isKnownValue(item.value));

  return (
    <div className="ct-status-card__nic-group">
      <div className="ct-status-card__nic-title">{title}</div>
      <div className="ct-status-card__nic-grid">
        {knownItems.length > 0
          ? knownItems.map((item) => (
              <div className="ct-status-card__nic-item" key={`${item.label}-${item.value}`}>
                <span className="ct-status-card__nic-label">{item.label}</span>
                <span className="ct-status-card__nic-value">{item.value}</span>
              </div>
            ))
          : (
              <div className="ct-status-card__nic-item">
                <span className="ct-status-card__nic-label">상태</span>
                <span className="ct-status-card__nic-value">N/A</span>
              </div>
            )}
      </div>
    </div>
  );
}
