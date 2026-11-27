import React from "react";
import { Label, Spinner } from "@patternfly/react-core";

export type WizardStepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

const STATUS_VIEW: Record<WizardStepStatus, {
  label: string;
  color: "grey" | "blue" | "green" | "red" | "teal";
}> = {
  pending: { label: "대기", color: "grey" },
  running: { label: "진행 중", color: "blue" },
  succeeded: { label: "완료", color: "green" },
  failed: { label: "실패", color: "red" },
  skipped: { label: "건너뜀", color: "teal" },
};

function normalizeStatus(status: string): WizardStepStatus {
  return Object.prototype.hasOwnProperty.call(STATUS_VIEW, status)
    ? status as WizardStepStatus
    : "pending";
}

export function wizardStatusRowClass(status: string): string {
  return `ct-wizard-status-row ct-wizard-status-row--${normalizeStatus(status)}`;
}

interface WizardStepStatusLabelProps {
  status: string;
  ariaLabel?: string;
}

export default function WizardStepStatusLabel({
  status,
  ariaLabel,
}: WizardStepStatusLabelProps) {
  const normalizedStatus = normalizeStatus(status);
  const view = STATUS_VIEW[normalizedStatus];

  return (
    <Label
      className="ct-wizard-status-label"
      color={view.color}
      icon={normalizedStatus === "running"
        ? <Spinner size="sm" aria-label={ariaLabel || "진행 중"} />
        : undefined}
    >
      {view.label}
    </Label>
  );
}
