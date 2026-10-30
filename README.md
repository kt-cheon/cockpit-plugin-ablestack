# cockpit-plugin-ablestack
ABLESTACK manages and distributes necessary packages and virtual machine appliances using Cockpit. cockpit-plugin-ablestack is a plugin that adds ABLESTACK component distribution to Cockpit.

일반 sudo 계정으로 접속하려면 Cockpit의 관리자 접근을 활성화합니다. 호스트·관리 VM 간
통신을 사용하기 전에 [노드 에이전트 등록 및 배포 안내](tools/node-agent/README.md)를
따라 상호 TLS 연결을 준비합니다. RPM 빌드와 업데이트 시 설정 보존 동작은
[RPM 빌드 안내](tools/makerpm/README.md)를 참고합니다.
공통 Kickstart 설치 후 브리지와 클러스터 구성 준비 단계에서 통신을 등록하는 절차는
[클러스터 준비 안내](tools/node-agent/README.md#공통-kickstart와-클러스터-구성-준비)를 참고합니다.
