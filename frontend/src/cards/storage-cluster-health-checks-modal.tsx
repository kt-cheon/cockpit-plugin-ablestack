import React from "react";
import {
  Button,
  Content,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "@patternfly/react-core";

import type { StorageClusterHealthCheck } from "../services/api/storage-cluster-status";

interface StorageClusterHealthChecksModalProps {
  isOpen: boolean;
  checks: StorageClusterHealthCheck[];
  onClose: () => void;
}

function getSeverityColor(severity: string) {
  if (severity === "HEALTH_ERR") {
    return "red" as const;
  }

  if (severity === "HEALTH_WARN") {
    return "orange" as const;
  }

  return "grey" as const;
}

export default function StorageClusterHealthChecksModal({
  isOpen,
  checks,
  onClose,
}: StorageClusterHealthChecksModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      variant="medium"
      aria-label="스토리지 클러스터 Health 상세"
      className="ct-health-checks-modal"
    >
      <ModalHeader title="스토리지 클러스터 Health 상세" />
      <ModalBody>
        {checks.length === 0 ? (
          <Content component="p">
            표시할 Health Check 상세 정보가 없습니다.
          </Content>
        ) : (
          <div className="ct-health-checks-modal__list">
            {checks.map((check) => (
              <section className="ct-health-checks-modal__item" key={check.name}>
                <div className="ct-health-checks-modal__item-header">
                  <span className="ct-health-checks-modal__name">{check.name}</span>
                  <Label color={getSeverityColor(check.severity)}>
                    {check.severity}
                  </Label>
                </div>
                <dl className="ct-health-checks-modal__summary">
                  <div>
                    <dt>내용</dt>
                    <dd>{check.summary}</dd>
                  </div>
                </dl>
                {check.details.length > 0 ? (
                  <Content component="ul" className="ct-health-checks-modal__details">
                    {check.details.map((detail, detailIndex) => (
                      <Content component="li" key={`${check.name}-${detailIndex}`}>
                        {detail}
                      </Content>
                    ))}
                  </Content>
                ) : null}
              </section>
            ))}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={onClose}>
          확인
        </Button>
      </ModalFooter>
    </Modal>
  );
}
