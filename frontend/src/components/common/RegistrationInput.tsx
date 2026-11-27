import React from 'react';
import { Alert, FormGroup } from '@patternfly/react-core';
import FileAttachControl from './FileAttachControl';

export type RegistrationSelection =
  | { filename: string; status: 'reading' }
  | { filename: string; status: 'valid'; value: Record<string, unknown> }
  | { filename: string; status: 'invalid'; message: string };

interface RegistrationInputProps {
  hostname: string;
  selection: RegistrationSelection | null;
  onChange: (selection: RegistrationSelection | null) => void;
}

const FORMAT_ERROR = '호스트 통신 등록 파일 형식을 확인해 주세요.';
const BUNDLE_FILES = ['agent.json', 'ca.crt', 'node.crt', 'node.key'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readRegistration(file: File, hostname: string) {
  const expectedFilename = `${hostname}.cube-agent.json`;
  if (file.name !== expectedFilename) {
    throw new Error(`현재 호스트용 '${expectedFilename}' 파일을 선택해 주세요.`);
  }

  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new Error(FORMAT_ERROR);
  }
  if (!isRecord(value) || value.format !== 'ablestack-cube-enrollment-v1' ||
      typeof value.host !== 'string' || !value.host.trim()) {
    throw new Error(FORMAT_ERROR);
  }
  if (value.host !== hostname) {
    throw new Error(`파일에 기록된 호스트가 현재 호스트(${hostname})와 다릅니다. '${expectedFilename}' 파일을 확인해 주세요.`);
  }

  const hostBundle = isRecord(value.bundles) ? value.bundles[hostname] : undefined;
  if (typeof value.digest !== 'string' || !/^[a-f0-9]{64}$/.test(value.digest) ||
      !isRecord(hostBundle) || !BUNDLE_FILES.every((name) => {
        const content = hostBundle[name];
        return typeof content === 'string' && Boolean(content.trim());
      })) {
    throw new Error(FORMAT_ERROR);
  }
  return value;
}

export default function RegistrationInput({ hostname, selection, onChange }: RegistrationInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const readVersion = React.useRef(0);
  const error = selection?.status === 'invalid' ? selection.message : '';
  React.useEffect(() => () => { readVersion.current += 1; }, []);
  const clear = () => {
    readVersion.current += 1;
    onChange(null);
  };
  const selectFile = async (file: File) => {
    const version = ++readVersion.current;
    onChange({ filename: file.name, status: 'reading' });
    try {
      const value = await readRegistration(file, hostname);
      if (version === readVersion.current) onChange({ filename: file.name, status: 'valid', value });
    } catch (error) {
      if (version !== readVersion.current) return;
      const message = error instanceof Error ? error.message : FORMAT_ERROR;
      onChange({ filename: file.name, status: 'invalid', message });
    }
  };
  return <FormGroup label="호스트 통신 등록 파일" fieldId="host-registration">
    <FileAttachControl id="host-registration" inputRef={inputRef} filename={selection?.filename ?? ''}
      placeholder="선택된 호스트 등록 파일 없음" accept=".json,application/json"
      isDisabled={!hostname} isInvalid={Boolean(error)}
      onFileSelect={selectFile} onClear={clear} />
    <p>{hostname
      ? '첫 호스트에서 받은 현재 호스트용 등록 파일을 선택하세요. 이미 등록된 호스트는 생략할 수 있습니다.'
      : '현재 호스트 이름을 확인한 후 등록 파일을 선택할 수 있습니다.'}</p>
    {error && <Alert isInline variant="danger" title={error} />}
  </FormGroup>;
}
