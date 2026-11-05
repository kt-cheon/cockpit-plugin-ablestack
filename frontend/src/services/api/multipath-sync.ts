import { requestCubeApi } from "./client";

export type MultipathSyncAction = "sync" | "rescan";

export interface MultipathSyncStepResult {
  name: string;
  status: string;
  message: string;
  output: string;
}

export interface MultipathSyncTargetResult {
  hostname: string;
  target: string;
  code: number;
  message: string;
  steps: MultipathSyncStepResult[];
}

export interface MultipathSyncResult {
  code: number;
  message: string;
  action: MultipathSyncAction | string;
  target: string;
  results: MultipathSyncTargetResult[];
  steps: MultipathSyncStepResult[];
}

interface MultipathSyncResponse {
  code?: number | string;
  message?: string;
  error?: string;
  action?: string;
  target?: string;
  results?: unknown;
  steps?: unknown;
  val?: unknown;
}

export class MultipathSyncError extends Error {
  result: MultipathSyncResult | null;

  constructor(message: string, result: MultipathSyncResult | null = null) {
    super(message);
    this.name = "MultipathSyncError";
    this.result = result;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function normalizeNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeStep(value: unknown): MultipathSyncStepResult | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    name: normalizeString(value.name) || "step",
    status: normalizeString(value.status) || "unknown",
    message: normalizeString(value.message),
    output: normalizeString(value.output),
  };
}

function normalizeSteps(value: unknown): MultipathSyncStepResult[] {
  return Array.isArray(value)
    ? value.map(normalizeStep).filter((item): item is MultipathSyncStepResult => Boolean(item))
    : [];
}

function normalizeTargetResult(value: unknown): MultipathSyncTargetResult | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    hostname: normalizeString(value.hostname),
    target: normalizeString(value.target) || "local",
    code: normalizeNumber(value.code),
    message: normalizeString(value.message),
    steps: normalizeSteps(value.steps),
  };
}

function normalizeTargetResults(value: unknown): MultipathSyncTargetResult[] {
  return Array.isArray(value)
    ? value.map(normalizeTargetResult).filter((item): item is MultipathSyncTargetResult => Boolean(item))
    : [];
}

function unwrapResponse(response: MultipathSyncResponse): MultipathSyncResponse {
  if (isRecord(response.val)) {
    const value = response.val;
    const code = response.code ?? value.code;
    const message = response.message ?? value.message;
    const error = response.error ?? value.error;
    const action = response.action ?? value.action;
    const target = response.target ?? value.target;
    const results = response.results ?? value.results;
    const steps = response.steps ?? value.steps;
    const normalizedResponse: MultipathSyncResponse = {};

    if (typeof code === "string" || typeof code === "number") {
      normalizedResponse.code = code;
    }

    if (typeof message === "string") {
      normalizedResponse.message = message;
    }

    if (typeof error === "string") {
      normalizedResponse.error = error;
    }

    if (typeof action === "string") {
      normalizedResponse.action = action;
    }

    if (typeof target === "string") {
      normalizedResponse.target = target;
    }

    if (results !== undefined) {
      normalizedResponse.results = results;
    }

    if (steps !== undefined) {
      normalizedResponse.steps = steps;
    }

    return normalizedResponse;
  }

  return response;
}

function normalizeResponse(response: MultipathSyncResponse): MultipathSyncResult {
  const normalizedResponse = unwrapResponse(response);

  return {
    code: normalizeNumber(normalizedResponse.code),
    message: normalizeString(normalizedResponse.error) || normalizeString(normalizedResponse.message),
    action: normalizeString(normalizedResponse.action),
    target: normalizeString(normalizedResponse.target),
    results: normalizeTargetResults(normalizedResponse.results),
    steps: normalizeSteps(normalizedResponse.steps),
  };
}

function getResultMessage(result: MultipathSyncResult, fallbackMessage: string): string {
  if (result.message) {
    return result.message;
  }

  const failedTarget = result.results.find((target) => target.code !== 200);

  if (failedTarget?.message) {
    return failedTarget.hostname
      ? `${failedTarget.hostname}: ${failedTarget.message}`
      : failedTarget.message;
  }

  const failedStep = result.steps.find((step) => step.status !== "succeeded");

  return failedStep?.message || fallbackMessage;
}

export function formatMultipathSyncAction(action: MultipathSyncAction): string {
  return action === "sync" ? "외부 스토리지 동기화" : "외부 스토리지 재검색";
}

export function formatMultipathSyncProgressMessage(action: MultipathSyncAction): string {
  return action === "sync"
    ? "외부 스토리지를 동기화하고 있습니다."
    : "외부 스토리지 장치를 다시 검색하고 있습니다.";
}

export function formatMultipathSyncCompletedMessage(action: MultipathSyncAction): string {
  return action === "sync"
    ? "외부 스토리지 동기화가 완료되었습니다."
    : "외부 스토리지 재검색이 완료되었습니다.";
}

export async function runMultipathSync(action: MultipathSyncAction): Promise<MultipathSyncResult> {
  const parsed = await requestCubeApi<MultipathSyncResponse>(
    "/api/v1/cube/multipath/sync",
    {
      method: "POST",
      body: { action },
      maxTimeSeconds: 360,
    }
  );
  const result = normalizeResponse(parsed);

  if (result.code !== 200) {
    throw new MultipathSyncError(
      getResultMessage(result, `${formatMultipathSyncAction(action)}에 실패했습니다.`),
      result
    );
  }

  return result;
}
