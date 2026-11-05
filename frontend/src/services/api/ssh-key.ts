
import { isPreviewMode } from "./preview.ts";
import { requestCubeApi } from "./client.ts";

interface SSHKeyResponse {
  code?: number;
  message?: string;
  val?: unknown;
}

export interface SSHKeyBundleDownload {
  href: string;
  buffer: ArrayBuffer | null;
  privateKey?: string;
  publicKey?: string;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl}/${path.replace(/^\/+/, "")}`;
}

function binaryDownloadHref(base64Content: string) {
  return `data:application/octet-stream;base64,${base64Content.replace(/\s+/g, "")}`;
}

function base64ToArrayBuffer(base64Content: string): ArrayBuffer {
  const binary = window.atob(base64Content.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return window.btoa(binary);
}

function safeFilename(filename: string): string {
  return filename.trim().replace(/[^\w.-]/g, "_") || "ssh-key.dat";
}

export async function generateSSHKeyFiles() {
  if (isPreviewMode()) return;

  const response = await requestCubeApi<SSHKeyResponse>("/api/v1/cube/ssh/key", {
    method: "POST",
    body: {
      action: "generate",
      overwrite: true,
    },
    maxTimeSeconds: 30,
  });

  if (response.code && response.code >= 300) {
    throw new Error(response.message || "SSH KEY 생성에 실패했습니다.");
  }
}

export async function uploadSSHKeyBundle(buffer: ArrayBuffer, _filename = "ssh-key.dat") {
  if (isPreviewMode()) return;
  const response = await requestCubeApi<SSHKeyResponse>("/api/v1/cube/ssh/key", {
    method: "POST", body: { action: "upload", content: arrayBufferToBase64(buffer) },
  });
  if (Number(response.code) !== 200) throw new Error(response.message || "SSH KEY 등록에 실패했습니다.");
}

export async function downloadSSHKeyBundle(): Promise<SSHKeyBundleDownload> {
  if (isPreviewMode()) {
    const privateKey = "-----BEGIN RSA PRIVATE KEY-----\\nPREVIEW_PRIVATE_KEY\\n-----END RSA PRIVATE KEY-----";
    const publicKey = "ssh-rsa PREVIEW_PUBLIC_KEY root@ablecube";
    return { href: binaryDownloadHref(window.btoa(privateKey)), buffer: null, privateKey, publicKey };
  }
  const response = await requestCubeApi<{code: number; content: string; private_key: string; public_key: string; message?: string}>(
    "/api/v1/cube/ssh/key", { method: "POST", body: { action: "download" } });
  if (Number(response.code) !== 200) throw new Error(response.message || "SSH KEY 다운로드에 실패했습니다.");
  return { href: binaryDownloadHref(response.content), buffer: base64ToArrayBuffer(response.content),
    privateKey: response.private_key, publicKey: response.public_key };
}
