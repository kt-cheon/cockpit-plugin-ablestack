# ABLESTACK Europa React UI

`ablestack-europa`에서 분기한 `ablestack-europa-react` 브랜치입니다. Cockpit의
**ABLESTACK** 메뉴는 `react.html`을 엽니다. 별도 ABLESTACK React 메뉴는 만들지
않습니다. 기존 HTML 화면을 iframe으로 삽입하지 않고 React 컴포넌트로 표시합니다.

화면 구성 요소의 출처와 기준 커밋은 `UPSTREAM.md`, 원본 라이선스는 `LICENSE`에
기록했습니다. 기존 Europa의 Python·Shell·Cube Agent를 실행하도록 서비스 연결을
변경했으며 별도 Cube API 서버를 설치하지 않습니다.

```text
React -> Cockpit 관리자 권한 -> python/react_bridge/bridge.py
                               -> 기존 Python·Shell
                               -> 기존 Cube Agent -> 원격 호스트·VM
SCVM 서비스 관리               -> SCVM의 기존 Glue API (loopback HTTPS)
```

## 화면과 실행 경로

- 호스트: 상태 카드(2열, 모바일 1열), 라이선스 등록, 설정파일·호스트 통신 등록파일 다운로드.
- 배포·구성: 클러스터 준비, SCVM·CCVM 배포, 스토리지센터·클라우드센터 구성,
  공유·로컬 스토리지, 모니터링센터, 클라우드 리소스 구성.
- 운영: VM 자원·전원, 마이그레이션, 서비스 제어, 스냅샷·DB 백업, VM 백업·복구·예약,
  디스크·CLVM·GFS·multipath, 유지보수, 보안 업데이트·증적, 버전 업데이트, PowerFlex 작업.
- SCVM: GlueFS·서브볼륨 그룹, NFS·Export, SMB·공유 폴더·사용자,
  iSCSI·NVMe-oF 서비스·타깃, 공유 디스크 이미지, Object Gateway·사용자·쿼터·버킷,
  Ingress, 게이트웨이 VM 배포·전원·마이그레이션.

호스트 상단의 **배포·운영 작업**과 각 카드 메뉴에서 작업을 엽니다. SCVM은 노드
등록 정보와 호스트명으로 판별하며 왼쪽 서비스 메뉴를 표시합니다. SCVM 서비스
요청은 기존 `glue_conf.json`의 `apiPort`(기본 8080)를 사용합니다. 고정된 API 계약만
허용하고 접속 대상은 현재 SCVM의 loopback으로 제한합니다.

긴 작업은 `/var/lib/ablestack/react-tasks/`에 관리자 전용 상태·실행 로그를 저장합니다.
요청 입력은 표준 입력으로 전달하고 작업 종료 후 입력 파일을 지웁니다. 화면을
새로 열어도 작업 결과와 한국어 진행 로그를 확인할 수 있습니다. 서버 재시작이나
프로세스 종료로 중단된 작업은 실패로 표시합니다. 동시에 여러 구성 작업을 실행하지
않도록 잠금을 사용합니다.

SCVM·CCVM 구성은 기존 `center_bootstrap.py`와 각각의 bootstrap Shell을 실행합니다.
SCVM 구성 전 점보 프레임 검사와 실패 안내, NIC의 실제 링크 상태 조회,
SSD·NVMe에만 적용하는 `rotation_rate`, 라이선스 검증은 기존 동작을 사용합니다.
Bridge 선택에서는 `virbr0`, `lo`를 제외합니다.

스토리지 OSD·풀 구성은 기존 스토리지센터의 관리 절차를 따릅니다. 호스트 제거는
VM 이전·클라우드 등록 해제·Glue 데이터와 데몬 정리를 먼저 완료한 후 설정을
정리하는 작업이며, 이를 자동으로 완료했다고 표시하지 않습니다. 호스트 통신 등록은
기존 CA와 등록파일을 사용합니다. 등록된 클러스터의 멤버 목록이 바뀌면 기존 CA의
멤버십 갱신을 먼저 완료해야 하며 React 전환이 인증서를 자동 교체하지 않습니다.

클라우드 리소스 구성은 CCVM 내부의 기존 Mold API에 접속하여 Zone·네트워크·Pod·
클러스터·호스트·주/보조 스토리지를 생성하고 시스템 VM 상태를 확인합니다.
동일한 이름의 기존 리소스는 재사용합니다. 기본 주 스토리지는 기존 제품 구성을
사용하며 필요하면 URL과 제공자를 입력할 수 있습니다. 관리 서비스 공개키와
기존 Glue 인증 정보를 사용합니다.

## 빌드와 검증

빌드 컴퓨터에 Node.js 22 이상, npm, Python 3가 필요합니다.

```sh
npm --prefix frontend ci
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix frontend test
python3 -m unittest discover -s tests -p 'test_react_*.py'
npm --prefix frontend run test:browser
```

JS·CSS·폰트와 라이선스는 `src/react/`에 생성됩니다. Git에서 제외되며 RPM 빌드 시
자동 생성해 포함합니다. 대상 장비에는 Node.js가 필요하지 않습니다.

브라우저 검사는 모의 Cockpit 응답으로 제품별 카드·2열 배치·라이선스·권한,
배포 마법사와 SCVM 서비스 폼·확인·생성 흐름을 검사합니다. 실제 VM·라이선스·
스토리지는 변경하지 않습니다. macOS 기본 Chrome 외에는 `CHROME_PATH`,
스크린샷 저장 위치는 `REACT_SCREENSHOTS`를 지정합니다.

## RPM 없이 시험 적용

먼저 로컬에서 빌드한 뒤 아래 파일을 서버 `/usr/share/cockpit/ablestack/`의 같은 상대
경로로 함께 복사합니다.

- `react.html`
- `manifest.json`
- `src/react/` 전체
- `python/react_bridge/` 전체

`frontend/src/`의 TSX 파일만 복사하면 화면에 반영되지 않습니다. UI 변경은 매번
빌드 후 생성된 `src/react/`를 복사합니다. Python 어댑터 변경은 해당 Python 파일도
함께 반영합니다. 브라우저 캐시를 비우고 Cockpit을 새로 열어 확인합니다.

현재 브랜치의 기존 Python·Shell·`src/common/privileged.js`와 등록된 Cube Agent가
설치되어 있어야 합니다. 호스트·VM의 `ablecube`·`ablecube-agent` 버전도 일치해야
합니다. 서버의 `tools/properties/`, `tools/vmconfig/`를 로컬 기본값으로 덮어쓰지 마세요.
이 디렉터리에는 실제 설정과 등록·키 파일이 있습니다. `.git/`, `frontend/node_modules/`,
로컬 RPM 결과물도 복사 대상에서 제외합니다.

실제 클러스터의 배포·스토리지·Mold 작업은 시험 장비에서 별도 검증해야 합니다.
모의 브라우저·단위 검사는 하드웨어 연결과 제품별 버전 호환성을 검증하지 않습니다.

`react.html?preview=1&product=hci`는 호스트 화면 미리보기입니다. 제품 값은 `hci`,
`filesystem`, `ablestack-vm`, `standalone`입니다. 미리보기 데이터로 장비 상태를
판단하지 마세요. `preview=1`·`mock=1`이 없으면 기존 백엔드에 실제로 연결합니다.
