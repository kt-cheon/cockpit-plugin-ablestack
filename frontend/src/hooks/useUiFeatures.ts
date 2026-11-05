import React from "react";
import { DEFAULT_UI_FEATURES, fetchUiFeatures } from "../services/api/system-config";

// Read on each opening so editing ablestack.json takes effect when a dialog is reopened.
export function useUiFeatures(isOpen: boolean) {
    const [features, setFeatures] = React.useState(DEFAULT_UI_FEATURES);
    React.useEffect(() => {
        if (!isOpen) return;
        let active = true;
        setFeatures(DEFAULT_UI_FEATURES);
        fetchUiFeatures()
                .then((value) => { if (active) setFeatures(value); })
                .catch((error) => console.error("화면 표시 설정 조회 실패:", error));
        return () => { active = false; };
    }, [isOpen]);
    return features;
}
