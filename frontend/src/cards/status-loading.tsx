import React from "react";

import { Spinner } from "@patternfly/react-core";

export const STATUS_LOADING_LABEL = "확인 중";
export const STATUS_UNKNOWN_LABEL = "상태 확인 필요";

export function StatusLoadingIcon() {
    return (
        <Spinner
          isInline
          diameter="0.875em"
          aria-label="상태 확인 중"
          className="ct-status-card__loading-spinner"
        />
    );
}

interface StatusLoadingMessageProps {
  children: React.ReactNode;
}

export function StatusLoadingMessage({ children }: StatusLoadingMessageProps) {
    return (
        <span className="ct-status-card__loading-message">
            <StatusLoadingIcon />
            <span>{children}</span>
        </span>
    );
}
