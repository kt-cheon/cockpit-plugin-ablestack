import cockpit from "cockpit";

import { isPreviewMode } from "./api/preview";

function normalizeHostname(value: string): string {
    return value.split(/\r?\n/)[0]?.trim() ?? "";
}

function shortHostname(value: string): string {
    return normalizeHostname(value).split(".")[0] ?? "";
}

function isLoopbackOrIp(value: string): boolean {
    return value === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

function previewHostname(): string {
    if (typeof window === "undefined") {
        return "ablecube1";
    }

    const params = new URLSearchParams(window.location.search);
    return shortHostname(
        params.get("hostname") ||
        params.get("host") ||
        params.get("currentHostname") ||
        "ablecube1"
    );
}

function cockpitTransportHostname(): string {
    const transportHost = (cockpit as unknown as { transport?: { host?: string } }).transport?.host ?? "";
    const hostname = shortHostname(transportHost);

    return hostname && !isLoopbackOrIp(hostname) ? hostname : "";
}

function firstRoutableIpv4(value: string): string {
    return value
            .split(/\s+/)
            .map((item) => item.trim())
            .find((item) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(item) && item !== "127.0.0.1") ?? "";
}

export async function fetchCurrentHostname(): Promise<string> {
    if (isPreviewMode()) {
        return previewHostname();
    }

    try {
        const shortHostname = normalizeHostname(await cockpit.spawn(["hostname", "-s"]));

        if (shortHostname) {
            return shortHostname;
        }
    } catch {
        // Fall back to the full hostname below.
    }

    try {
        const fullHostname = shortHostname(await cockpit.spawn(["hostname"]));

        if (fullHostname) {
            return fullHostname;
        }
    } catch {
        // Fall back to Cockpit transport metadata below.
    }

    return cockpitTransportHostname();
}

export async function fetchCurrentHostIp(): Promise<string> {
    try {
        const hostIps = firstRoutableIpv4(await cockpit.spawn(["hostname", "-I"]));

        if (hostIps) {
            return hostIps;
        }
    } catch {
        // Fall back to the default route lookup below.
    }

    try {
        const routeOutput = await cockpit.spawn(["ip", "-4", "route", "get", "1.1.1.1"]);
        const routeIp = routeOutput.match(/\bsrc\s+(\d{1,3}(?:\.\d{1,3}){3})\b/)?.[1] ?? "";

        return routeIp === "127.0.0.1" ? "" : routeIp;
    } catch {
        return "";
    }
}
