# RPM 빌드 및 설정 보존

`tools/makerpm/rpmbuild.sh`는 기본적으로 스크립트가 위치한 저장소를 빌드합니다.
다른 소스 디렉터리를 빌드할 때는 세 번째 인자로 저장소 루트를 지정합니다.
기존 빌드와 같이 Linux의 `rpm-build` 패키지와 `node_modules`가 필요합니다.
React 브랜치는 빌드 서버에 Node.js 22 이상과 npm도 필요합니다. 빌드 스크립트가
`frontend/package-lock.json`을 기준으로 의존성을 설치하고 React 정적 파일을 생성합니다.
`frontend/node_modules`는 패키지에서 제외하며, 설치 대상 호스트에는 Node.js가 필요하지 않습니다.
`--source-only`도 React 빌드를 수행합니다. [React UI 안내](../../frontend/README.md)를 참고합니다.

```sh
./tools/makerpm/rpmbuild.sh v4.5.1 261028
./tools/makerpm/rpmbuild.sh v4.5.1 261028 /path/to/cockpit-plugin-ablestack
```

검증한 두 RPM은 아키텍처별 하위 디렉터리 없이 `rpmbuild/RPMS/` 한 곳에 생성됩니다.

```text
rpmbuild/RPMS/ablecube-<version>-<release>.x86_64.rpm
rpmbuild/RPMS/ablecube-agent-<version>-<release>.noarch.rpm
```

업데이트할 때는 설치된 패키지보다 높은 Version/Release를 사용하고 두 패키지를
같은 트랜잭션으로 업그레이드합니다.

```sh
rpm -Uvh ./ablecube-agent-v4.5.1-261028.noarch.rpm ./ablecube-v4.5.1-261028.x86_64.rpm
```

노드 에이전트 RPM도 `rpmbuild/RPMS/`에 함께 생성됩니다. 일반 sudo 계정 지원과
SSH 전송 대체를 사용하려면 먼저 [노드 에이전트 배포 절차](../node-agent/README.md)에
따라 호스트·관리 VM의 인증서와 연결을 준비합니다.
공통 Kickstart에는 두 패키지와 기본 `member` 설정을 동일하게 설치합니다.
브리지 구성 이후 첫 호스트의 클러스터 구성 준비에서 인증서를 발급하고,
나머지 호스트는 기존 프로파일과 자기 호스트용 통신 등록 파일을 가져옵니다.
Kickstart에서 별도 CA나 노드별 키를 미리 준비할 필요가 없습니다.
첫 부팅/NetworkManager 연결 후 `cube-agent-setup.service`는 자료가 준비될 때까지 대기합니다.
`agent.json`과 `install.json`에도 `%config(noreplace)`를 적용하며 업데이트 시
기존 키·설정과 서비스 활성화 상태를 유지합니다.
빌드는 에이전트 RPM을 먼저 생성한 후 같은 버전의 RPM을 Cube의
`tools/node-agent/ablecube-agent.rpm`에 포함하여 최종 바이너리 RPM과 소스 RPM을 다시 만듭니다.
VM cloud-init은 이 RPM을 사용하므로 첫 부팅에 외부 패키지 저장소에 접속할 필요가 없습니다.
빌드에 인증서나 운영 번들을 포함하지 않습니다.
클러스터 준비 및 VM 등록에서는 관리 인터페이스의 firewalld zone에 등록된 관리 IP 사이의
에이전트 포트만 허용합니다. 기존 설치의 적용 명령은 [에이전트 가이드](../node-agent/README.md)를 참고합니다.

## 빌드 서버에 현재 작업 소스 전달

빌드 로그에 `Processing files: ablecube-agent-...`가 없고 `%install`에 에이전트
설치 단계도 없다면 이전 명세를 사용하고 있는 것입니다. `git archive HEAD`는
수정 중인 파일과 아직 Git에 추가하지 않은 `tools/node-agent/` 파일을 포함하지 않습니다.
현재 작업 디렉터리에서 다음처럼 소스 아카이브를 만들 수 있습니다. 이 모드는
RPM 도구가 없는 개발 환경에서도 실행할 수 있습니다.

```sh
./tools/makerpm/rpmbuild.sh v4.10.0 261029 . --source-only
```

`rpmbuild/SOURCES/ablecube-v4.10.0.tar.gz`를 빌드 서버에 전달하고 새 작업 디렉터리에
압축을 푼 다음 실행합니다. 아카이브에는 현재 작업 파일, 에이전트 코드, 명세,
`node_modules`가 포함되고 운영 키와 VM 작업 파일은 제외됩니다.

```sh
tar -xzf ablecube-v4.10.0.tar.gz
cd ablecube-v4.10.0
./tools/makerpm/rpmbuild.sh v4.10.0 261029 .
```

정상적인 최신 스크립트는 시작할 때 `BUILD_LAYOUT = ablecube-and-agent-v1`, 실제
`SPEC_PATH`, 명세의 SHA-256을 출력합니다. 에이전트 정의나 필수 소스가 없으면
빌드 전에 실패합니다. 출력 디렉터리를 바꾸려면 `ABLESTACK_RPM_TOPDIR`를 지정합니다.

두 빌드 단계는 각각 새로운 임시 출력 경로를 사용합니다. 최종 RPM 두 개의 이름·버전·
아키텍처, 플러그인의 에이전트 의존성, 에이전트의 `cube-agent.service` 포함 여부를
확인한 뒤 최종 경로에 복사합니다. 이전 빌드의 RPM이나 첫 단계의 임시 플러그인 RPM을
최종 산출물로 오인하지 않습니다. 성공 메시지는 `검증한 RPM 2개`와 실제 경로를 출력합니다.

## 설정 파일 처리

설치 경로 `/usr/share/cockpit/ablestack/tools/properties/` 아래의 패키지 기본 설정 파일은
`%config(noreplace)`로 등록됩니다. `cluster.json`, `ablestack.json`,
`glue_conf.json`, `pfmp_config.json` 및 이후 추가하는 설정 파일에 적용됩니다.
애플리케이션에서 사용하는 경로는 동일합니다.

RPM 업데이트는 **기존 JSON 값을 우선하고 새 버전에 추가된 키만 채우는 재귀 병합**을
수행합니다. 파일 전체를 이전 내용으로 되돌리는 방식이 아닙니다.

1. RPM의 설치 전 단계에서 기존 JSON 값과 파일 권한·소유자를 읽습니다.
   이 코드는 RPM 자체에 포함하므로 이전 버전에 병합 도구가 없어도 동작합니다.
2. 빌드 시 검증한 새 기본값은 `tools/makerpm/property-defaults/`에 일반 파일로
   별도 배포합니다. `.rpmnew`의 생성 여부나 이전 버전 파일에 의존하지 않습니다.
3. 설치 후 `properties_config.py merge`가 새 기본값에 기존 값을 재귀적으로 병합합니다.
   같은 디렉터리의 임시 파일을 원자적으로 교체하고 기존 권한·소유자를 유지합니다.

예를 들어 기존 설정이 다음과 같고,

```json
{"bootstrap": {"scvm": true}, "ui": {"enabled": false}}
```

새 RPM의 기본 설정이 다음과 같다면,

```json
{"bootstrap": {"scvm": false, "new_step": false}, "ui": {"enabled": true, "new_tab": true}}
```

업데이트 결과는 다음과 같습니다.

```json
{"bootstrap": {"scvm": true, "new_step": false}, "ui": {"enabled": false, "new_tab": true}}
```

중첩 객체도 같은 규칙을 적용합니다. `false`, `0`, 빈 문자열, `null`, 빈 배열을
유효한 기존 값으로 유지합니다. 호스트 목록 등의 배열은 전체 값을 유지하며
인덱스별로 샘플 항목을 합치지 않습니다. 사용자가 추가한 키와 새 기본값에서 제거된
기존 키도 유지합니다. 값의 자료형이 바뀌어도 기존 값을 우선하므로 자료형 변경에
따른 변환이 필요하면 별도 마이그레이션으로 처리합니다.

운영 중 생성하는 `<hostname>.cube-agent.json`도 같은 디렉터리에 보관하지만,
개인키가 포함되므로 root 소유 `0600`으로 저장합니다. 이 파일과 쓰기 중의
`.cube-setup-*` 임시 파일, 등록 JSON의 백업 파일은 소스 아카이브와 RPM payload에서 제외합니다.
RPM이 소유하지 않는 운영 파일이므로 업그레이드에서도 내용과 권한이 유지됩니다.
공통 `cluster.json`에는 개인키를 추가하지 않습니다.

| 상황 | RPM 업데이트 결과 |
| --- | --- |
| 운영 중 변경한 설정 | 기존 값을 유지하고 새 키만 추가 |
| 변경한 설정과 새 패키지 기본값이 모두 달라짐 | 기존 값과 새 키를 병합, RPM이 만든 `.rpmnew`는 별도 유지 |
| 설치 후 변경하지 않은 기본 설정 | 기존 값도 유지하고 새 키만 추가 |
| 새로 추가되었거나 현재 없는 설정 파일 | 패키지의 기본값으로 설치 |
| 코드, 화면, 배포 템플릿 | 새 버전으로 업데이트 |

기존 RPM이 설정 파일을 일반 파일로 등록했더라도 설치 전 읽은 값을 사용하므로
업데이트 도중 파일이 새 기본값으로 교체되어도 기존 값과 새 키를 병합합니다.
이미 이전 업데이트에서 사라진 값은 이 변경으로 복구되지 않습니다.

기존 JSON이 잘못되었거나 중복 키가 있으면 해당 패키지 설치 전에 오류로 중단합니다.
새 기본 JSON도 빌드 시 검사합니다. 병합 중 오류가 나면 실패를 반환하고
`/var/lib/ablestack/properties-upgrade/pending.json`에 읽어 둔 값을 보존합니다.
디렉터리는 `0700`, 상태 파일은 `0600`이며 설정값을 로그에 출력하지 않습니다.
미완료 상태를 새 작업으로 덮어쓰지 않습니다. 새 RPM 파일 설치 후 병합이 실패했다면
원인을 해결하고 다음 명령으로 병합을 완료한 뒤 업데이트를 다시 진행합니다.

```sh
python3 /usr/share/cockpit/ablestack/tools/makerpm/properties_config.py merge
```

병합 성공 후 임시 상태 파일은 삭제합니다. `.rpmnew` 파일 전체를 운영 JSON에 복사하면
기존 값이 사라질 수 있으므로 병합을 대체하는 용도로 사용하지 않습니다.

`rpm -e`로 삭제한 다음 새로 설치하는 방식과 소스 디렉터리의 `cp -r` 복사는
RPM 업그레이드와 동작이 다릅니다. 설정을 보존하는 업데이트에는 `rpm -Uvh`
또는 패키지 관리자의 업그레이드 기능을 사용합니다.

### 업데이트 후 구성 준비 단계가 다시 표시되는 경우

완료 여부는 `ablestack.json`의 `bootstrap.scvm`, `bootstrap.ccvm`,
`monitoring.wall`과 `cluster.json`의 프로파일을 기준으로 확인합니다.
기존 HTML 화면은 호스트 등록 또는 SSH 공개키 조회 실패 시 위 완료 값을
모두 `false`로 저장하는 경로가 있었으며, 상태 조회가 완료 상태를 변경하지 않도록
해당 자동 초기화 코드를 제거했습니다. 실제 구성 초기화와 가상머신 삭제는 사용자가
별도로 실행하는 작업입니다.

React 화면의 구성 준비 판정에는 프로파일의 호스트 목록, `/etc/hosts`의
`ablecube` 항목, `/root/.ssh/id_rsa.pub` 존재 여부도 사용합니다.
따라서 완료 값이 유지돼도 이 중 하나가 없으면 구성 준비 단계가 다시 표시될 수 있습니다.
화면 표시만으로 가상머신이나 센터 구성이 삭제됐다고 판단하지 않습니다.

업데이트 직후 재구성을 실행하기 전에 다음을 확인합니다.

```sh
rpm -q ablecube ablecube-agent
rpm -qc ablecube
cat /usr/share/cockpit/ablestack/tools/properties/ablestack.json
```

`rpm -qc ablecube`에 `tools/properties`의 설정 파일이 없으면 설정 보존 속성이 없는
이전 명세로 빌드된 RPM인지 확인합니다. 파일 내용이 유지된다면 프로파일·호스트 등록·
공개키를 확인하여 미완료 판정의 원인을 확인합니다. 이미 완료 값이 사라진 경우에는
업데이트 전 백업이나 실제 실행 상태를 확인한 뒤 복구하며, 모든 값을 일괄 `true`로
설정하거나 센터 구성을 자동 재실행하지 않습니다.

## 설치 및 빌드 시 처리

- 최초 설치에서만 `cockpit.socket`을 활성화합니다. 업데이트 시 Cockpit을
  강제 재시작하지 않습니다. 새 화면 코드는 브라우저를 새로고침하여 확인합니다.
- 디렉터리는 `0755`, 설정은 `0644`, 실행에 필요한 Shell/Python 스크립트는
  `0755`로 패키징합니다. 설치 후 전체 경로에 `chmod 644`를 실행하지 않습니다.
- 빌드마다 별도 임시 디렉터리를 사용합니다. 이전 빌드에만 존재하는 파일이
  새 RPM에 다시 들어가지 않습니다.
- `tools/vmconfig/`의 VM 작업 파일(SSH 키, XML, ISO),
  `tools/makerpm/rpmbuild/`, Python 캐시, `.rpmnew`/`.rpmsave`/`.rpmorig`는
  소스 아카이브에서 제외합니다. `tools/vmconfig/readme.md`와 디렉터리는 포함합니다.
  병합 임시 파일 `.properties-merge-*`와 빌드 중 생성하는 `property-defaults/`도
  아카이브에서 제외하며 새 기본값은 매 빌드마다 다시 생성합니다.
  설치된 시스템에서 RPM이 소유하지 않는 VM 작업 파일은 업데이트 때 유지됩니다.
- 개발용 소스와 기본 설정을 확인한 뒤 빌드합니다. 빌드 소스의
  `tools/properties` 값은 신규 설치용 기본값으로 패키지에 포함됩니다.

## 검증

저장소 루트에서 실행합니다.

```sh
python3 -m unittest discover -s tests -p 'test_rpm_packaging.py' -v
python3 -m unittest discover -s tests -p 'test_properties_config.py' -v
node --test tests/test_configuration_status.js
python3 -m unittest discover -s tests -p 'test_react_bridge.py' -v
```

소스 아카이브의 제외 항목, RPM 파일 목록과 권한, 설치 후 동작을 검사합니다.
Linux에 `rpm`과 `rpmbuild`가 있으면 작은 테스트 RPM 세 개를 만들고 임시 설치
경로와 별도 RPM DB에서 기존 형식 → 새 형식 → 후속 버전의 설정 보존·새 키 추가·코드
업데이트를 검증합니다. RPM에 포함된 설치 전 코드와 설치 후 도구도 임시 경로에서
실행합니다. 시스템 패키지 DB와 실제 Cockpit 서비스는 변경하지 않습니다.
RPM 도구가 없으면 실제 RPM 통합 검사만 건너뜁니다.

설정 보존 속성은 [RPM 공식 문서](https://rpm.org/docs/4.20.x/manual/spec.html#config)를 참고합니다.
설치 전후 실행 순서는 [RPM scriptlets](https://rpm.org/docs/latest/manual/file_triggers.html)를 참고합니다.
