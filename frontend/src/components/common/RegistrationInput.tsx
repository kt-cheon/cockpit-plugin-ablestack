import React from 'react';
import { Alert, FormGroup } from '@patternfly/react-core';
import FileAttachControl from './FileAttachControl';

export default function RegistrationInput({ onChange }: { onChange: (value: Record<string, unknown> | null) => void }) {
  const [error, setError] = React.useState('');
  const [filename, setFilename] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const readVersion = React.useRef(0);
  React.useEffect(() => () => { readVersion.current += 1; }, []);
  const clear = () => {
    readVersion.current += 1;
    setFilename(''); setError(''); onChange(null);
  };
  const selectFile = async (file: File) => {
    const version = ++readVersion.current;
    setFilename(file.name); setError(''); onChange(null);
    try {
      const value = JSON.parse(await file.text());
      if (!value || value.format !== 'ablestack-cube-enrollment-v1') throw new Error('호스트 통신 등록 파일 형식을 확인해 주세요.');
      if (version === readVersion.current) onChange(value);
    } catch (error) {
      if (version === readVersion.current) setError(String(error));
    }
  };
  return <FormGroup label="호스트 통신 등록 파일" fieldId="host-registration">
    <FileAttachControl id="host-registration" inputRef={inputRef} filename={filename}
      placeholder="선택된 호스트 등록 파일 없음" accept=".json,application/json"
      onFileSelect={selectFile} onClear={clear} />
    <p>첫 호스트에서 받은 현재 호스트용 등록 파일을 선택하세요. 이미 등록된 호스트는 생략할 수 있습니다.</p>
    {error && <Alert isInline variant="danger" title={error} />}
  </FormGroup>;
}
