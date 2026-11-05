import React from "react";

import {
    FALLBACK_STATUS_CARD_REFRESH_INTERVAL_SECONDS,
    getStatusCardRefreshIntervalMs,
} from "../services/api/config.ts";

const FALLBACK_STATUS_CARD_REFRESH_INTERVAL_MS =
    FALLBACK_STATUS_CARD_REFRESH_INTERVAL_SECONDS * 1000;

interface UseStatusPollingOptions<T> {
    fetcher: () => Promise<T>;
    fallback: T;
    enabled?: boolean;
    intervalMs?: number;
    onSuccess?: (data: T) => void;
    onError?: (error: unknown) => void;
    retainPreviousOnError?: boolean;
}

export function useStatusPolling<T>({
    fetcher,
    fallback,
    enabled = true,
    intervalMs,
    onSuccess,
    onError,
    retainPreviousOnError = false,
}: UseStatusPollingOptions<T>) {
    const [data, setData] = React.useState<T>(fallback);
    const [isCollecting, setIsCollecting] = React.useState(false);
    const [hasResolved, setHasResolved] = React.useState(false);
    const [resolvedIntervalMs, setResolvedIntervalMs] = React.useState<number | null>(
        intervalMs ?? null
    );
    const [refreshSequence, setRefreshSequence] = React.useState(0);
    const onSuccessRef = React.useRef(onSuccess);
    const onErrorRef = React.useRef(onError);
    const hasResolvedRef = React.useRef(false);

    React.useEffect(() => {
        if (intervalMs !== undefined) {
            setResolvedIntervalMs(intervalMs);
            return;
        }

        let isMounted = true;

        getStatusCardRefreshIntervalMs()
                .then((nextIntervalMs) => {
                    if (isMounted) {
                        setResolvedIntervalMs(nextIntervalMs);
                    }
                })
                .catch((error) => {
                    console.error("status card refresh interval config error:", error);

                    if (isMounted) {
                        setResolvedIntervalMs(FALLBACK_STATUS_CARD_REFRESH_INTERVAL_MS);
                    }
                });

        return () => {
            isMounted = false;
        };
    }, [intervalMs]);

    React.useEffect(() => {
        onSuccessRef.current = onSuccess;
    }, [onSuccess]);

    React.useEffect(() => {
        onErrorRef.current = onError;
    }, [onError]);

    React.useEffect(() => {
        if (!enabled || resolvedIntervalMs === null) {
            setIsCollecting(false);
            return;
        }

        let isActive = true;
        let isFetching = false;

        const collectStatus = async () => {
            if (isFetching) return;

            isFetching = true;
            setIsCollecting(true);

            try {
                const nextData = await fetcher();

                if (!isActive) return;

                setData(nextData);
                hasResolvedRef.current = true;
                setHasResolved(true);
                onSuccessRef.current?.(nextData);
            } catch (error) {
                if (!isActive) return;

                setData((currentData) => (
                    retainPreviousOnError && hasResolvedRef.current ? currentData : fallback
                ));
                hasResolvedRef.current = true;
                setHasResolved(true);
                onErrorRef.current?.(error);
            } finally {
                isFetching = false;

                if (isActive) {
                    setIsCollecting(false);
                }
            }
        };

        collectStatus();
        const intervalId = window.setInterval(collectStatus, resolvedIntervalMs);

        return () => {
            isActive = false;
            window.clearInterval(intervalId);
        };
    }, [enabled, fetcher, fallback, refreshSequence, resolvedIntervalMs, retainPreviousOnError]);

    const refresh = React.useCallback(() => {
        setRefreshSequence((current) => current + 1);
    }, []);

    return { data, isCollecting, hasResolved, refresh };
}
