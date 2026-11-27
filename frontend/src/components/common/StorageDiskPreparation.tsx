import React from "react";
import {Alert, Button, Checkbox, Content, FormGroup, Modal, ModalBody, ModalFooter, ModalHeader, Spinner, TextInput, Title} from "@patternfly/react-core";
import {DISK_ERASE_CONFIRMATION, fetchDiskInitializationInventory, initializeDisks,
  type DiskInitializationTarget, type DiskInitializationResult} from "../../services/api/disk-initialize";
import UnavailableStorageDisk from "./UnavailableStorageDisk";

export interface DiskPreparationHandle { confirm:()=>void }
interface Props {
  isActive:boolean;
  onContinue:()=>void;
  onStatus:(value:{busy:boolean; canInitialize:boolean})=>void;
}

const StorageDiskPreparation = React.forwardRef<DiskPreparationHandle,Props>(({isActive,onContinue,onStatus},ref)=>{
  const [disks,setDisks]=React.useState<DiskInitializationTarget[]>([]);
  const [hostname,setHostname]=React.useState("");
  const [selected,setSelected]=React.useState<string[]>([]);
  const [loading,setLoading]=React.useState(false);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState("");
  const [results,setResults]=React.useState<DiskInitializationResult[]>([]);
  const [targets,setTargets]=React.useState<DiskInitializationTarget[]>([]);
  const [confirmation,setConfirmation]=React.useState("");
  const inFlight=React.useRef(false);
  const load=React.useCallback(async()=>{
    setLoading(true);
    setSelected([]);
    try {
      const inventory=await fetchDiskInitializationInventory();
      setDisks(inventory.disks);
      setHostname(inventory.hostname);
    } catch(value) {
      setDisks([]);
      throw value;
    } finally { setLoading(false); }
  },[]);
  React.useEffect(()=>{
    if(isActive) {
      setError("");
      void load().catch(value=>setError(value instanceof Error?value.message:String(value)));
    }
  },[isActive,load]);
  const canInitialize=!loading&&!busy&&selected.length>0;
  React.useEffect(()=>onStatus({busy,canInitialize}),[busy,canInitialize,onStatus]);
  React.useImperativeHandle(ref,()=>({confirm:()=>{
    if(!canInitialize)return;
    setConfirmation("");
    setTargets(disks.filter(disk=>selected.includes(disk.path)&&disk.can_initialize));
  }}),[canInitialize,disks,selected]);
  const close=()=>{if(!inFlight.current){setTargets([]);setConfirmation("");}};
  const execute=async()=>{
    if(inFlight.current||confirmation!==DISK_ERASE_CONFIRMATION||!targets.length)return;
    inFlight.current=true;
    setBusy(true);
    setError("");
    setResults([]);
    let complete=false;
    try {
      const response=await initializeDisks(targets,confirmation);
      setResults(response.results);
      complete=response.success&&response.results.length===targets.length&&response.results.every(row=>row.status==="completed");
      if(!complete)setError("일부 디스크를 초기화하지 못했습니다. 디스크별 결과를 확인하세요.");
    } catch(value){setError(value instanceof Error?value.message:String(value));}
    try {await load();}
    catch(value){complete=false;setError("초기화 후 디스크 목록 재조회 실패: "+(value instanceof Error?value.message:String(value)));}
    inFlight.current=false;
    setBusy(false);
    setTargets([]);
    setConfirmation("");
    if(complete)onContinue();
  };
  return <>
    <Content component="p">기존 파티션이나 LVM 구성이 남아 있는 디스크를 선택해 초기화할 수 있습니다. 여러 디스크를 선택하면 한 개씩 순서대로 처리합니다. 초기화가 필요 없으면 건너뛰세요.</Content>
    <Alert isInline variant="warning" title="선택한 디스크의 모든 데이터가 삭제됩니다.">운영체제·마운트된 파일시스템·실행 중인 가상머신이 사용하는 디스크는 초기화할 수 없습니다.</Alert>
    {loading?<Spinner aria-label="디스크 초기화 목록 조회 중" />:
      <div className="ct-storage-vm-wizard__disk-list" aria-label="초기화할 디스크">
        {disks.map(disk => {
          const id = "disk-initialize-" + disk.path.replace(/[^a-zA-Z0-9]/g, "-");
          return <div key={disk.path} className="ct-storage-vm-wizard__disk-item">
            {disk.can_initialize ? <>
              <Checkbox id={id} label={disk.label} isDisabled={busy} isChecked={selected.includes(disk.path)}
                onChange={(_event,checked)=>setSelected(current=>checked?[...current,disk.path]:current.filter(path=>path!==disk.path))} />
              <small className="ct-storage-vm-wizard__disk-state">{disk.state}</small>
            </> : <UnavailableStorageDisk id={id} label={disk.label} reason={disk.reason} />}
          </div>;
        })}
        {!disks.length&&!error&&<Content component="p">초기화할 디스크가 없습니다.</Content>}
      </div>}
    {error&&<Alert isInline variant="danger" title={error} />}
    {results.length>0&&<ul aria-label="디스크별 초기화 결과">{results.map(row=><li key={row.path}>{row.path} · {row.status==="completed"?"완료":"실패"} · {row.message}</li>)}</ul>}
    {busy&&<Alert isInline variant="info" title="선택한 디스크를 한 개씩 초기화하고 장치 정보를 갱신하고 있습니다." />}
    <Button variant="link" isDisabled={busy||loading} onClick={()=>{setError("");void load().catch(value=>setError(String(value)));}}>디스크 목록 새로고침</Button>
    <Modal isOpen={targets.length>0} onClose={close} variant="medium" aria-label="디스크 초기화 확인">
      <ModalHeader title="디스크 초기화 확인" />
      <ModalBody>
        <Alert isInline variant="danger" title="이 작업은 되돌릴 수 없습니다.">선택한 디스크의 파티션, LVM 및 모든 데이터가 삭제됩니다.</Alert>
        <div className="ct-storage-vm-wizard__erase-summary">
          <Title headingLevel="h3" size="md" id="disk-erase-list-title">초기화 디스크 목록</Title>
          <Content component="p">현재 호스트: <strong>{hostname}</strong></Content>
          <ul aria-labelledby="disk-erase-list-title">{targets.map(disk=><li key={disk.path}>{disk.label}</li>)}</ul>
        </div>
        <FormGroup className="ct-storage-vm-wizard__erase-confirmation"
          label={<>계속하려면 <strong>‘{DISK_ERASE_CONFIRMATION}’</strong>를 정확히 입력하세요.</>}
          fieldId="disk-erase-confirmation">
          <TextInput id="disk-erase-confirmation" value={confirmation} isDisabled={busy} autoComplete="off"
            onChange={(_event,value)=>setConfirmation(value)} aria-label="디스크 초기화 확인 문구" />
        </FormGroup>
        {busy&&<Content component="p">디스크별로 초기화 중입니다. 완료될 때까지 기다려 주세요.</Content>}
      </ModalBody>
      <ModalFooter>
        <Button variant="danger" isDisabled={busy||confirmation!==DISK_ERASE_CONFIRMATION} isLoading={busy} onClick={()=>void execute()}>데이터 삭제 및 초기화</Button>
        <Button variant="link" isDisabled={busy} onClick={close}>취소</Button>
      </ModalFooter>
    </Modal>
  </>;
});
export default StorageDiskPreparation;
