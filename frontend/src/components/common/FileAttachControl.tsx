import React from "react";
import { Button } from "@patternfly/react-core";

export interface FileAttachControlProps {
  id: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  filename: string;
  placeholder: string;
  accept?: string;
  isDisabled?: boolean;
  onFileSelect: (file: File) => void;
  onClear: () => void;
}

export default function FileAttachControl({
    id, inputRef, filename, placeholder, accept, isDisabled = false, onFileSelect, onClear,
}: FileAttachControlProps) {
    return <div className={[
        "ct-file-attach",
        filename ? "ct-file-attach--selected" : "",
        isDisabled ? "ct-file-attach--disabled" : "",
    ].filter(Boolean).join(" ")}>
        <input ref={inputRef} id={id} className="ct-file-attach__input" type="file"
          accept={accept} disabled={isDisabled}
          onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) onFileSelect(file);
              event.currentTarget.value = "";
          }} />
        <button type="button" className="ct-file-attach__surface" disabled={isDisabled}
          onClick={() => inputRef.current?.click()} aria-label={`${placeholder} 파일 첨부`}>
            <span className="ct-file-attach__copy">
                <strong>{filename || placeholder}</strong>
                <small>{filename
                    ? "선택된 파일입니다. 다시 누르면 다른 파일을 첨부합니다."
                    : "영역을 클릭해서 파일을 첨부하세요."}</small>
            </span>
            <span className="ct-file-attach__action">파일 첨부</span>
        </button>
        <Button type="button" variant="secondary" className="ct-file-attach__clear"
          isDisabled={isDisabled || !filename} onClick={onClear}>초기화</Button>
    </div>;
}
