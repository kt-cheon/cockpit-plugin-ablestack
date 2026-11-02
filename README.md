# cockpit-plugin-ablestack
ABLESTACK manages and distributes necessary packages and virtual machine appliances using Cockpit. cockpit-plugin-ablestack is a plugin that adds ABLESTACK component distribution to Cockpit.

일반 sudo 계정으로 접속하려면 Cockpit의 관리자 접근을 활성화합니다. 호스트·관리 VM 간
통신을 사용하기 전에 [노드 에이전트 등록 및 배포 안내](tools/node-agent/README.md)를
따라 상호 TLS 연결을 준비합니다. RPM 빌드와 업데이트 시 설정 보존 동작은
[RPM 빌드 안내](tools/makerpm/README.md)를 참고합니다.
공통 Kickstart 설치 후 브리지와 클러스터 구성 준비 단계에서 통신을 등록하는 절차는
[클러스터 준비 안내](tools/node-agent/README.md#공통-kickstart와-클러스터-구성-준비)를 참고합니다.

SCVM 배포 마법사는 기본적으로 PCI·Disk Passthrough만 표시합니다. LUN Passthrough도
표시하려면 해당 Cube 호스트의 `/usr/share/cockpit/ablestack/tools/properties/ablestack.json`에서
기존 설정을 유지한 채 아래 `ui` 항목을 추가하거나 값을 변경하고 마법사를 다시 여세요.

```json
"ui": {
    "scvm_lun_passthrough": true
}
```

`false` 또는 설정 누락 시에는 LUN 선택과 안내 문구를 숨깁니다. 이 값은 마법사의
표시만 제어하며 LUN XML 생성 및 배포 기능은 유지합니다. 설정에는 RPM의
`%config(noreplace)`를 적용하므로 업데이트 시 기존 값을 보존합니다.
