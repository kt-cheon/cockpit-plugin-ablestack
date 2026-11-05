// 스토리지센터 클러스터 카드의 HBA WWN 목록 조회 모달입니다.
import React from "react";
import {
  Alert,
  Button,
  Content,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
} from "@patternfly/react-core";

import { fetchHbaWwnList, type HbaWwnInfo } from "../services/api/hba-manage";

interface WwnListModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type WwnListLoadStatus = "idle" | "loading" | "success" | "error";

function renderWwnValues(item: HbaWwnInfo) {
  if (item.wwn.length === 0) {
    return <span className="ct-wwn-list-modal__empty">없음</span>;
  }

  return item.wwn.map((value) => (
    <div className="ct-wwn-list-modal__wwn" key={value}>
      {value}
    </div>
  ));
}

export default function WwnListModal({ isOpen, onClose }: WwnListModalProps) {
  const [loadStatus, setLoadStatus] = React.useState<WwnListLoadStatus>("idle");
  const [wwnList, setWwnList] = React.useState<HbaWwnInfo[]>([]);
  const [errorMessage, setErrorMessage] = React.useState("");

  React.useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    let isCurrent = true;

    const loadWwnList = async () => {
      setLoadStatus("loading");
      setErrorMessage("");
      setWwnList([]);

      try {
        const nextWwnList = await fetchHbaWwnList();

        if (!isCurrent) {
          return;
        }

        setWwnList(nextWwnList);
        setLoadStatus("success");
      } catch (error) {
        if (!isCurrent) {
          return;
        }

        console.error("hba wwn list API error:", error);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "HBA WWN 목록 조회에 실패했습니다."
        );
        setLoadStatus("error");
      }
    };

    void loadWwnList();

    return () => {
      isCurrent = false;
    };
  }, [isOpen]);

  const renderBody = () => {
    if (loadStatus === "loading") {
      return (
        <div className="ct-wwn-list-modal__loading">
          <Spinner size="sm" aria-label="WWN 목록 조회 중" />
          <Content component="p">WWN 목록을 조회중입니다.</Content>
        </div>
      );
    }

    if (loadStatus === "error") {
      return (
        <Alert isInline variant="danger" title="WWN 목록 조회 실패">
          {errorMessage}
        </Alert>
      );
    }

    if (wwnList.length === 0) {
      return <Content component="p">데이터가 존재하지 않습니다.</Content>;
    }

    return (
      <div className="ct-wwn-list-modal__table-wrap">
        <table className="ct-wwn-list-modal__table">
          <thead>
            <tr>
              <th>호스트명</th>
              <th>WWN</th>
            </tr>
          </thead>
          <tbody>
            {wwnList.map((item, index) => (
              <tr key={`${item.hostname}-${item.target}-${index}`}>
                <td>{item.hostname}</td>
                <td>{renderWwnValues(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      variant="medium"
      aria-label="WWN 목록"
      className="ct-wwn-list-modal"
    >
      <ModalHeader title="WWN 목록" />
      <ModalBody>
        {renderBody()}
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={onClose}>
          확인
        </Button>
      </ModalFooter>
    </Modal>
  );
}
