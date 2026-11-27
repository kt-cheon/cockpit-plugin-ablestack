import React from "react";
import { Checkbox, Tooltip } from "@patternfly/react-core";
import { TimesIcon } from "@patternfly/react-icons";

interface UnavailableStorageDiskProps {
  id: string;
  label: string;
  reason?: string;
}

export default function UnavailableStorageDisk({ id, label, reason }: UnavailableStorageDiskProps) {
  return (
    <Tooltip content={reason ? `사용 불가 · ${reason}` : "사용 불가"} position="top">
      <div className="ct-storage-vm-wizard__disk-unavailable" tabIndex={0}>
        <Checkbox id={id} isDisabled label={(
          <span className="ct-storage-vm-wizard__disk-unavailable-label">
            <TimesIcon className="ct-storage-vm-wizard__disk-unavailable-icon" aria-hidden="true" />
            {label}
          </span>
        )} />
      </div>
    </Tooltip>
  );
}
