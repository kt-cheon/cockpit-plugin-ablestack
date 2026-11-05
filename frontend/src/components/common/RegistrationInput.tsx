import React from 'react';
import { Alert, FormGroup } from '@patternfly/react-core';

export default function RegistrationInput({ onChange }: { onChange: (value: Record<string, unknown> | null) => void }) {
  const [error, setError] = React.useState('');
  return <FormGroup label="호스트 통신 등록 파일" fieldId="host-registration">
    <input id="host-registration" type="file" accept=".json" onChange={async (event) => {
      onChange(null);
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const value = JSON.parse(await file.text());
        if (value.format !== 'ablestack-cube-enrollment-v1') throw new Error('호스트 통신 등록 파일 형식을 확인해 주세요.');
        onChange(value); setError('');
      } catch (error) { setError(String(error)); }
    }} />
    <p>첫 호스트에서 받은 현재 호스트용 등록 파일을 선택하세요. 이미 등록된 호스트는 생략할 수 있습니다.</p>
    {error && <Alert isInline variant="danger" title={error} />}
  </FormGroup>;
}
