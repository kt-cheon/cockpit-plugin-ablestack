import React from "react";
import { Tooltip } from "@patternfly/react-core";

export default function ClusterManagementNetworkHelp() {
    return <Tooltip content="클러스터 노드 간 통신에 사용할 네트워크를 선택합니다." position="top">
        <button type="button" className="ct-cluster-management-network-help"
          aria-label="클러스터 관리 네트워크 도움말">?</button>
    </Tooltip>;
}
